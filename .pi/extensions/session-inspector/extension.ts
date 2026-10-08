import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Collector } from "./collector.ts";
import { SessionFeed } from "./feed.ts";
import type { SkillView } from "./model.ts";
import { branch, detail } from "./projection.ts";
import { startServer, type ViewerServer } from "./server.ts";

interface Owner {
  controller: AbortController;
  generation: string;
  feed?: SessionFeed;
  ctx: ExtensionContext;
  collector?: Collector;
  skills: SkillView[];
  server?: ViewerServer;
  opening?: Promise<void>;
}
export interface Dependencies {
  start: typeof startServer;
  launch(pi: ExtensionAPI, url: string, signal: AbortSignal): Promise<boolean>;
}
const defaults: Dependencies = {
  start: startServer,
  async launch(pi, url, signal) {
    const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer.exe" : "xdg-open";
    const result = await pi.exec(command, [url], { signal, timeout: 5000 });
    return result.code === 0 && !result.killed;
  },
};

export function registerInspector(pi: ExtensionAPI, deps: Dependencies = defaults): void {
  const owners = new Map<ExtensionContext["sessionManager"], Owner>();
  const epochs = new WeakMap<ExtensionContext["sessionManager"], object>();
  function epochFor(ctx: ExtensionContext): object {
    let epoch = epochs.get(ctx.sessionManager);
    if (!epoch) {
      epoch = {};
      epochs.set(ctx.sessionManager, epoch);
    }
    return epoch;
  }
  const alive = (owner: Owner) => !owner.controller.signal.aborted && owners.get(owner.ctx.sessionManager) === owner;
  async function stop(ctx: ExtensionContext): Promise<void> {
    const owner = owners.get(ctx.sessionManager);
    if (!owner) return;
    owners.delete(ctx.sessionManager);
    owner.controller.abort();
    owner.feed?.close();
    await owner.server?.close();
    await owner.opening;
    owner.collector = undefined;
  }
  function ownerFor(ctx: ExtensionContext): Owner {
    epochFor(ctx);
    let owner = owners.get(ctx.sessionManager);
    if (!owner) {
      owner = { controller: new AbortController(), generation: randomUUID(), ctx, skills: [] };
      owners.set(ctx.sessionManager, owner);
    }
    owner.ctx = ctx;
    return owner;
  }
  function changed(ctx: ExtensionContext, structural = true): Owner | undefined {
    const owner = owners.get(ctx.sessionManager);
    if (!owner || !alive(owner)) return;
    owner.ctx = ctx;
    owner.feed?.changed(structural);
    return owner;
  }
  pi.on("session_start", async (_event, ctx) => {
    const epoch = {};
    epochs.set(ctx.sessionManager, epoch);
    await stop(ctx);
    if (epochs.get(ctx.sessionManager) === epoch) ownerFor(ctx);
  });
  pi.on("session_shutdown", async (_event, ctx) => {
    epochs.delete(ctx.sessionManager);
    await stop(ctx);
  });
  pi.on("message_end", (_event, ctx) => {
    changed(ctx);
  });
  pi.on("session_tree", (_event, ctx) => {
    changed(ctx);
  });
  pi.on("session_compact", (_event, ctx) => {
    changed(ctx);
  });
  pi.on("session_info_changed", (_event, ctx) => {
    changed(ctx);
  });
  pi.on("model_select", (_event, ctx) => {
    changed(ctx);
  });
  pi.on("thinking_level_select", (_event, ctx) => {
    changed(ctx);
  });
  function executionAnchor(ctx: ExtensionContext, rawId: string): string | null {
    const leaf = ctx.sessionManager.getLeafId();
    const entry = ctx.sessionManager.getLeafEntry();
    if (entry?.type === "message" && entry.message.role === "assistant") return entry.id;
    return (
      ctx.sessionManager
        .getBranch(leaf ?? undefined)
        .slice()
        .reverse()
        .find(
          (entry) =>
            entry.type === "message" &&
            entry.message.role === "assistant" &&
            entry.message.content.some((block) => block.type === "toolCall" && block.id === rawId),
        )?.id ?? leaf
    );
  }
  pi.on("tool_execution_start", (event, ctx) => {
    const owner = owners.get(ctx.sessionManager);
    owner?.collector?.start(event, executionAnchor(ctx, event.toolCallId));
    changed(ctx, false);
  });
  pi.on("tool_execution_update", (event, ctx) => {
    const owner = owners.get(ctx.sessionManager);
    if (owner?.collector?.update(event, ctx.sessionManager.getLeafId())) changed(ctx, false);
  });
  pi.on("tool_execution_end", (event, ctx) => {
    const owner = owners.get(ctx.sessionManager);
    owner?.collector?.end(event, executionAnchor(ctx, event.toolCallId));
    changed(ctx, false);
  });
  pi.on("agent_settled", (_event, ctx) => {
    owners.get(ctx.sessionManager)?.collector?.settle();
    changed(ctx, false);
  });

  async function open(owner: Owner, ctx: ExtensionCommandContext): Promise<void> {
    try {
      if (!owner.server) {
        const accepted = await ctx.ui.confirm(
          "Open Session Inspector?",
          "Serve this session's prompts, code and tool outputs to a local browser and record bounded child results in memory? Redaction is incomplete. Nothing is uploaded or saved.",
          { signal: owner.controller.signal },
        );
        if (!alive(owner) || !accepted) return;
        const options = ctx.getSystemPromptOptions();
        owner.skills = (options.skills ?? [])
          .slice(0, 257) // One sentinel lets the snapshot disclose an incomplete catalog.
          .map((s) => ({ name: s.name, path: s.filePath, description: s.description }));
        owner.collector = new Collector();
        owner.feed = new SessionFeed({
          pi,
          context: () => owner.ctx,
          collector: owner.collector,
          skills: owner.skills,
          generation: owner.generation,
          signal: owner.controller.signal,
          invalidate: (revision) => {
            if (alive(owner)) owner.server?.invalidate(revision);
          },
        });
        const server = await deps.start({
          generation: owner.generation,
          signal: owner.controller.signal,
          snapshot: () => owner.feed?.snapshot(),
          branch: (id, offset) => branch(ctx.sessionManager, id, offset, owner.skills),
          detail: (id, leaf) => detail(ctx.sessionManager, id, leaf, owner.collector ?? new Collector()),
        });
        if (!alive(owner)) {
          await server.close();
          return;
        }
        owner.server = server;
        owner.feed.start();
      }
      if (!alive(owner)) return;
      const url = owner.server.url;
      let launched = false;
      try {
        launched = await deps.launch(pi, url, owner.controller.signal);
      } catch {
        /* URL fallback; no command stderr or token logging. */
      }
      if (!alive(owner)) return;
      ctx.ui.notify(
        `${launched ? "Session Inspector" : "Browser unavailable; open privately"}: ${url}\n/session-inspector stop revokes this URL.`,
        launched ? "info" : "warning",
      );
    } catch {
      if (!alive(owner)) return;
      owner.collector = undefined;
      owner.feed?.close();
      owner.feed = undefined;
      await owner.server?.close();
      owner.server = undefined;
      if (alive(owner))
        ctx.ui.notify(
          "Could not open Session Inspector. Build its browser assets first; see the local README.",
          "error",
        );
    }
  }

  pi.registerCommand("session-inspector", {
    description: "Open a private, read-only live session web inspector",
    getArgumentCompletions: (prefix) =>
      ["stop"].filter((s) => s.startsWith(prefix)).map((value) => ({ value, label: value })),
    handler: async (args, ctx) => {
      const route = args.trim();
      if (route !== "" && route !== "stop") {
        if (ctx.hasUI) {
          ctx.ui.notify("Usage: /session-inspector [stop]", "warning");
          return;
        }
        throw new Error("Usage: /session-inspector [stop]");
      }
      if (route === "stop") {
        const epoch = epochFor(ctx);
        await stop(ctx);
        if (ctx.hasUI && epochs.get(ctx.sessionManager) === epoch)
          ctx.ui.notify("Session Inspector stopped; URL revoked.", "info");
        return;
      }
      if (ctx.mode !== "tui") {
        if (ctx.hasUI) {
          ctx.ui.notify("Opening Session Inspector requires TUI mode. Stop remains available.", "warning");
          return;
        }
        throw new Error("Opening Session Inspector requires TUI mode.");
      }
      const owner = ownerFor(ctx);
      if (owner.opening) return;
      owner.opening = open(owner, ctx);
      try {
        await owner.opening;
      } finally {
        owner.opening = undefined;
      }
    },
  });
}
