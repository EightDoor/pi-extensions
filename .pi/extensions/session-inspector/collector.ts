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
  dropped = 0;
  constructor(private readonly maxCalls = 128) {}
  start(event: ToolExecutionStartEvent, anchor: string | null): void {
    const observedStartedAt = Date.now();
    this.put({
      id: event.toolCallId,
      parentId: event.parentToolCallId,
      name: displayText(event.toolName),
      status: "running",
      args: capture(event.args, 8192),
      branchAnchor: anchor,
      observedStartedAt,
    });
  }
  update(event: ToolExecutionUpdateEvent, anchor: string | null): void {
    if (!this.calls.has(event.toolCallId))
      this.put({
        id: event.toolCallId,
        parentId: event.parentToolCallId,
        name: displayText(event.toolName),
        status: "running",
        args: capture(event.args, 8192),
        branchAnchor: anchor,
      });
    const call = this.calls.get(event.toolCallId);
    if (call) call.result = capture(event.partialResult);
  }
  end(event: ToolExecutionEndEvent, anchor: string | null): void {
    const observedEndedAt = Date.now();
    if (!this.calls.has(event.toolCallId)) {
      this.put({
        id: event.toolCallId,
        parentId: event.parentToolCallId,
        name: displayText(event.toolName),
        status: "running",
        args: capture("[not captured]", 8192),
        branchAnchor: anchor,
      });
    }
    const call = this.calls.get(event.toolCallId);
    if (call) {
      call.status = event.isError ? "error" : "ok";
      call.durationMs = event.durationMs;
      call.observedEndedAt = observedEndedAt;
      call.result = capture(event.result);
    }
  }
  settle(): void {
    for (const call of this.calls.values()) if (call.status === "running") call.status = "unfinished";
  }
  list(): Call[] {
    return [...this.calls.values()];
  }
  private put(call: Call): void {
    this.calls.set(call.id, call);
    while (this.calls.size > this.maxCalls) {
      const first = this.calls.keys().next().value;
      if (first === undefined) break;
      this.calls.delete(first);
      this.dropped++;
    }
  }
}
