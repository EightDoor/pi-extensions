import type {
  ToolExecutionEndEvent,
  ToolExecutionStartEvent,
  ToolExecutionUpdateEvent,
} from "@earendil-works/pi-coding-agent";
import type { Call } from "./model.ts";
import { capture, displayText } from "./privacy.ts";

export class Collector {
  readonly startedAt = Date.now();
  private calls = new Map<string, Call>();
  private current = new Map<string, string>();
  private partialAt = new Map<string, number>();
  private sequence = 0;
  dropped = 0;
  constructor(private readonly maxCalls = 128) {}
  private create(
    event: { toolCallId: string; parentToolCallId?: string; toolName: string },
    args: unknown,
    anchor: string | null,
  ): Call {
    const parent = event.parentToolCallId ? this.calls.get(this.current.get(event.parentToolCallId) ?? "") : undefined;
    const call: Call = {
      id: event.toolCallId,
      occurrenceId: `call-${++this.sequence}`,
      parentId: event.parentToolCallId,
      parentOccurrenceId: parent?.status === "running" ? parent.occurrenceId : undefined,
      name: displayText(event.toolName),
      status: "running",
      args: capture(args, 8192),
      branchAnchor: parent?.status === "running" ? parent.branchAnchor : anchor,
    };
    this.calls.set(call.occurrenceId, call);
    this.current.set(call.id, call.occurrenceId);
    while (this.calls.size > this.maxCalls) {
      const first = this.calls.keys().next().value;
      if (first === undefined) break;
      const removed = this.calls.get(first);
      this.calls.delete(first);
      this.partialAt.delete(first);
      if (removed && this.current.get(removed.id) === first) this.current.delete(removed.id);
      this.dropped++;
    }
    return call;
  }
  private active(rawId: string): Call | undefined {
    const running = this.list().filter((call) => call.id === rawId && call.status === "running");
    if (running.length > 1) {
      for (const call of running) call.correlationUnavailable = true;
      return undefined;
    }
    return running[0];
  }
  start(event: ToolExecutionStartEvent, anchor: string | null): void {
    const now = Date.now();
    const call = this.create(event, event.args, anchor);
    call.observedStartedAt = now;
    if (
      this.list().filter((parent) => parent.id === call.id && parent.branchAnchor === call.branchAnchor).length === 1
    ) {
      for (const child of this.calls.values())
        if (
          child.parentId === call.id &&
          !child.parentOccurrenceId &&
          child.status === "running" &&
          child.branchAnchor === call.branchAnchor
        )
          child.parentOccurrenceId = call.occurrenceId;
    }
    this.active(event.toolCallId); // Explicitly mark overlapping reused IDs as ambiguous, never misroute their results.
  }
  update(event: ToolExecutionUpdateEvent, anchor: string | null): boolean {
    const now = Date.now();
    let call = this.active(event.toolCallId);
    if (!call && this.list().some((call) => call.id === event.toolCallId && call.status === "running")) return false;
    call ??= this.create(event, event.args, anchor);
    if (now - (this.partialAt.get(call.occurrenceId) ?? -Infinity) < 250) return false;
    this.partialAt.set(call.occurrenceId, now);
    call.result = capture(event.partialResult);
    return true;
  }
  end(event: ToolExecutionEndEvent, anchor: string | null): void {
    const now = Date.now();
    const running = this.list().filter((call) => call.id === event.toolCallId && call.status === "running");
    const call = this.active(event.toolCallId) ?? this.create(event, "[not captured]", anchor);
    if (running.length > 1) {
      call.correlationUnavailable = true;
      call.parentOccurrenceId = undefined;
    }
    call.status = event.isError ? "error" : "ok";
    call.durationMs = event.durationMs;
    call.observedEndedAt = now;
    call.result = capture(event.result);
  }
  settle(): void {
    for (const call of this.calls.values()) if (call.status === "running") call.status = "unfinished";
    this.current.clear();
  }
  list(): Call[] {
    return [...this.calls.values()];
  }
}
