import { getCurrentSystemMessage, getCurrentSystemPrompt, getCurrentTools } from "@earendil-works/pi-ai";
import {
  buildSessionProjection,
  type ExtensionContext,
  parseSkillBlock,
  type SessionEntry,
  type ToolInfo,
} from "@earendil-works/pi-coding-agent";

type ReadonlySessionManager = ExtensionContext["sessionManager"];

import type { Collector } from "./collector.ts";
import type { BranchView, DetailView, EntrySummary, SkillView, Snapshot } from "./model.ts";
import { capture, displayText } from "./privacy.ts";

export function summarize(entry: SessionEntry, label?: string): EntrySummary {
  const message = entry.type === "message" ? entry.message : undefined;
  const kind = message ? message.role : entry.type;
  const value = message && "content" in message ? message.content : entry;
  const preview = capture(value, 180).value;
  const name =
    entry.type === "custom" || entry.type === "custom_message"
      ? entry.customType
      : entry.type === "model_change"
        ? entry.modelId
        : entry.type === "thinking_level_change"
          ? entry.thinkingLevel
          : message?.role === "assistant"
            ? message.model
            : message?.role === "toolResult"
              ? message.toolName
              : undefined;
  return {
    id: entry.id,
    parentId: entry.parentId,
    kind,
    timestamp: entry.timestamp,
    name: typeof name === "string" ? displayText(name).slice(0, 128) : undefined,
    tokens:
      message?.role === "assistant" && Number.isFinite(message.usage?.totalTokens)
        ? message.usage?.totalTokens
        : undefined,
    status:
      message?.role === "toolResult" && typeof message.isError === "boolean"
        ? message.isError
          ? "error"
          : "success"
        : message?.role === "assistant" && message.stopReason === "error"
          ? "error"
          : message?.role === "assistant" && message.stopReason === "aborted"
            ? "cancelled"
            : undefined,
    toolCallId: message?.role === "toolResult" ? message.toolCallId : undefined,
    label: displayText(label ?? (typeof preview === "string" ? preview : JSON.stringify(preview))).slice(0, 180),
  };
}

export function snapshot(
  manager: ReadonlySessionManager,
  collector: Collector,
  generation: string,
  revision: number,
  prompt: string,
  tools: ToolInfo[],
  active: string[],
  skills: SkillView[],
): Snapshot {
  const entries = manager.getEntries();
  return {
    protocol: 1,
    generation,
    revision,
    sessionId: manager.getSessionId(),
    name: displayText(manager.getSessionName() ?? "Current session"),
    leafId: manager.getLeafId(),
    totalEntries: entries.length,
    nodes: entries.slice(0, 10000).map((e) => summarize(e, manager.getLabel(e.id))),
    incomplete: entries.length > 10000 || tools.length > 256 || skills.length > 256,
    currentPrompt: capture(prompt, 65536),
    tools: tools.slice(0, 256).map((t) => ({
      name: displayText(t.name),
      description: displayText(t.description.slice(0, 512)),
      exposure: t.exposure,
      active: active.includes(t.name),
      callable:
        t.exposure === "codemode" || t.exposure === "deferred" || (t.exposure === "direct" && active.includes(t.name)),
      namespace: t.namespace ? displayText(t.namespace.name) : undefined,
      schema: capture(t.parameters, 2048),
    })),
    skills: skills.slice(0, 256).map((s) => ({
      name: displayText(s.name),
      path: displayText(s.path),
      description: displayText(s.description.slice(0, 512)),
    })),
    calls: collector.list(),
    droppedCalls: collector.dropped,
    captureStartedAt: collector.startedAt,
  };
}

export function branch(
  manager: ReadonlySessionManager,
  leafId: string,
  offset: number,
  skills: SkillView[],
): BranchView {
  if (!manager.getEntry(leafId)) throw new Error("Unknown entry");
  const entries = manager.getEntries();
  const projection = buildSessionProjection(entries, leafId);
  const path = manager.getBranch(leafId);
  const historicalSystem = getCurrentSystemMessage(projection.messages);
  const target = manager.getEntry(leafId);
  const previous = target?.parentId ? buildSessionProjection(entries, target.parentId).messages : [];
  const evidence: { name: string; state: string; entryId: string }[] = [];
  const callPaths = new Map<string, string>();
  for (const entry of path) {
    if (entry.type !== "message") continue;
    const m = entry.message;
    if (m.role === "assistant")
      for (const block of m.content) {
        if (block.type === "toolCall" && block.name === "read" && typeof block.arguments.path === "string") {
          callPaths.set(block.id, block.arguments.path);
        }
      }
    if (m.role === "user" && typeof m.content === "string") {
      const invoked = parseSkillBlock(m.content);
      if (invoked) evidence.push({ name: invoked.name, state: "explicitly invoked", entryId: entry.id });
    }
    if (m.role === "toolResult" && !m.isError) {
      const path = callPaths.get(m.toolCallId);
      const skill = skills.find((s) => s.path === path);
      if (skill) evidence.push({ name: skill.name, state: "successfully read", entryId: entry.id });
      // Public bounded nested metadata provides names/arguments/status, never child results.
      for (const call of m.nestedCalls?.calls ?? []) {
        const skill = skills.find((s) => s.path === call.arguments?.path);
        if (call.name === "read" && call.status === "ok" && skill) {
          evidence.push({ name: skill.name, state: "successfully read (nested metadata)", entryId: entry.id });
        }
      }
    }
  }
  return {
    leafId,
    entries: path.slice(offset, offset + 50).map((e) => summarize(e, manager.getLabel(e.id))),
    total: path.length,
    offset,
    prompt: capture(
      historicalSystem ? getCurrentSystemPrompt(projection.messages) : "[unavailable: no stored system prompt]",
      65536,
    ),
    previousPrompt: capture(
      getCurrentSystemMessage(previous) ? getCurrentSystemPrompt(previous) : "[unavailable: no stored system prompt]",
      65536,
    ),
    sections: capture(historicalSystem?.sections),
    declaredTools: capture(
      getCurrentTools(projection.messages).map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      })),
    ),
    promptUpdates: capture(
      path
        .filter((e) => e.type === "message" && e.message.role === "system")
        .map((e) => ({ id: e.id, message: e.type === "message" ? e.message : null })),
    ),
    projection: capture(
      projection.entries.map((e) => ({ id: e.sourceEntry.id, messages: e.messages })),
      65536,
    ),
    skillEvidence: capture(evidence),
  };
}

export function detail(manager: ReadonlySessionManager, id: string, leafId: string, collector: Collector): DetailView {
  const entry = manager.getEntry(id);
  if (!entry || !manager.getEntry(leafId)) throw new Error("Unknown entry");
  const projected = buildSessionProjection(manager.getEntries(), leafId).entries.find((e) => e.sourceEntry.id === id);
  const ids = new Set<string>();
  if (entry.type === "message") {
    const m = entry.message;
    if (m.role === "assistant") for (const b of m.content) if (b.type === "toolCall") ids.add(b.id);
    if (m.role === "toolResult") ids.add(m.toolCallId);
  }
  const all = collector.list();
  // Parent chains are finite and bounded; include multi-depth descendants regardless of arrival order.
  for (let i = 0; i < all.length; i++) for (const c of all) if (c.parentId && ids.has(c.parentId)) ids.add(c.id);
  return {
    raw: capture(entry, 65536),
    projected: capture(projected?.messages),
    calls: all.filter((c) => ids.has(c.id)),
  };
}
