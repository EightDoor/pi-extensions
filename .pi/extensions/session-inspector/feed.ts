import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Collector } from "./collector.ts";
import { EntryIndex } from "./entry-index.ts";
import { identityIssue, recordedLeaf } from "./identity.ts";
import type { SkillView, Snapshot } from "./model.ts";
import { capture, displayText, sessionName } from "./privacy.ts";
import { snapshot } from "./projection.ts";

export class SessionFeed {
  private dirty = true;
  private indexed?: EntryIndex;
  private closed = false;
  index(): EntryIndex {
    if (this.closed || this.options.signal.aborted) throw new Error("Inspector stopped");
    if (!this.indexed) this.indexed = new EntryIndex(this.options.context().sessionManager.getEntries());
    return this.indexed;
  }
  private cached?: Snapshot;
  private revision = 0;
  private stamp = "";
  private notification?: ReturnType<typeof setTimeout>;
  private poll?: ReturnType<typeof setInterval>;
  constructor(
    private readonly options: {
      pi: ExtensionAPI;
      context(): ExtensionContext;
      collector: Collector;
      skills: SkillView[];
      generation: string;
      signal: AbortSignal;
      invalidate(revision: number): void;
    },
  ) {}
  private stateStamp(): string {
    const ctx = this.options.context();
    const manager = ctx.sessionManager;
    const tools = this.options.pi.getAllTools();
    const entries = manager.getEntries(); // Public readonly API; shallow references only, no projection.
    return JSON.stringify({
      count: entries.length,
      last: identityIssue(entries.at(-1)) ? "[invalid identity]" : entries.at(-1)?.id,
      leaf: recordedLeaf(manager),
      name: sessionName(manager.getSessionName() ?? "Current session"),
      active: this.options.pi.getActiveTools(),
      toolCount: tools.length,
      tools: tools.slice(0, 256).map((tool) => ({
        name: tool.name,
        exposure: tool.exposure,
        namespace: tool.namespace?.name,
        description: displayText(tool.description).slice(0, 512),
        schema: capture(tool.parameters, 2048),
      })),
    });
  }
  start(): void {
    if (this.options.signal.aborted || this.poll) return;
    this.stamp = this.stateStamp();
    this.poll = setInterval(() => {
      if (this.options.signal.aborted) return;
      try {
        const next = this.stateStamp();
        if (next !== this.stamp) {
          this.stamp = next;
          this.changed(true);
        }
      } catch {
        this.changed(true);
      } // Context failures must not escape a timer callback.
    }, 1000);
    this.options.signal.addEventListener("abort", this.close, { once: true });
  }
  changed(structural: boolean): void {
    if (this.options.signal.aborted) return;
    if (structural) {
      this.dirty = true;
      this.indexed = undefined;
    }
    if (!this.notification)
      this.notification = setTimeout(() => {
        this.notification = undefined;
        if (!this.options.signal.aborted) this.options.invalidate(++this.revision);
      }, 250);
  }
  snapshot(): Snapshot {
    if (!this.cached || this.dirty) {
      const ctx = this.options.context();
      this.cached = snapshot(
        ctx.sessionManager,
        this.options.collector,
        this.options.generation,
        this.revision,
        ctx.getSystemPrompt(),
        this.options.pi.getAllTools(),
        this.options.pi.getActiveTools(),
        this.options.skills,
        this.index(),
      );
      this.cached.calls = []; // Do not retain evicted live results inside the static cache.
      this.dirty = false;
    }
    return {
      ...this.cached,
      revision: this.revision,
      calls: this.options.collector.list(),
      droppedCalls: this.options.collector.dropped,
    };
  }
  close = (): void => {
    this.closed = true;
    clearTimeout(this.notification);
    clearInterval(this.poll);
    this.notification = undefined;
    this.poll = undefined;
    this.options.signal.removeEventListener("abort", this.close);
    this.cached = undefined;
    this.indexed = undefined;
  };
}
