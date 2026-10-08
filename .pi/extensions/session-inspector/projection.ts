import {
  getCurrentSystemMessage,
  getCurrentSystemPrompt,
  getCurrentTools,
  getInitialSystemMessage,
} from "@earendil-works/pi-ai";
import {
  buildSessionProjection,
  type ExtensionContext,
  parseSkillBlock,
  type SessionEntry,
  type ToolInfo,
} from "@earendil-works/pi-coding-agent";

type ReadonlySessionManager = ExtensionContext["sessionManager"];

import { ancestry } from "./ancestry.ts";
import type { Collector } from "./collector.ts";
import { sessionContext } from "./context.ts";
import { correlatedCalls } from "./correlation.ts";
import { EntryIndex } from "./entry-index.ts";
import { identityIssue, recordedLeaf } from "./identity.ts";
import type { BranchView, ContextComposition, DetailView, EntrySummary, SkillView, Snapshot } from "./model.ts";
import { capture, displayText, sessionName } from "./privacy.ts";

export function summarize(entry: SessionEntry, label?: string): EntrySummary {
  const issue = identityIssue(entry);
  if (issue) throw new Error(issue);
  const message = entry.type === "message" ? entry.message : undefined;
  const kind = displayText(message ? message.role : entry.type).slice(0, 512);
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
  const displayName = typeof name === "string" ? displayText(name) : undefined;
  return {
    id: entry.id,
    parentId: entry.parentId,
    kind,
    timestamp: entry.timestamp,
    name: displayName?.slice(0, 512),
    nameTruncated: displayName !== undefined && displayName.length > 512 ? true : undefined,
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
  index = new EntryIndex(manager.getEntries()),
  observedContext?: ContextComposition,
): Snapshot {
  const entries = index.entries;
  const owning = new Map<string, { id: string; ids: Set<string> }>();
  const invalidEntries: NonNullable<Snapshot["invalidEntries"]> = [];
  let invalidEntryCount = 0;
  const nodes: EntrySummary[] = [];
  for (const [ordinal, entry] of entries.slice(0, 10000).entries()) {
    const reason = index.duplicates.has(entry.id) ? "duplicate entry id" : identityIssue(entry);
    if (reason) {
      invalidEntryCount++;
      if (invalidEntries.length < 20) invalidEntries.push({ index: ordinal, reason, raw: capture(entry, 2048) });
      continue;
    }
    const source =
      entry.type === "message" && entry.message.role === "assistant"
        ? {
            id: entry.id,
            ids: new Set(
              (Array.isArray(entry.message.content) ? entry.message.content : [])
                .filter((block) => block.type === "toolCall")
                .map((block) => block.id),
            ),
          }
        : entry.parentId
          ? owning.get(entry.parentId)
          : undefined;
    if (source) owning.set(entry.id, source);
    const node = summarize(entry, manager.getLabel(entry.id));
    if (node.toolCallId && source?.ids.has(node.toolCallId)) node.toolAnchor = source.id;
    nodes.push(node);
  }
  return {
    protocol: 1,
    generation,
    revision,
    sessionId: manager.getSessionId(),
    ...sessionName(manager.getSessionName() ?? "Current session"),
    leafId: recordedLeaf(manager, index.duplicates),
    totalEntries: entries.length,
    nodes,
    incomplete: entries.length > 10000 || tools.length > 256 || skills.length > 256 || invalidEntryCount > 0,
    invalidEntryCount,
    invalidEntries,
    context: observedContext ?? sessionContext(manager, index),
    currentPrompt: capture(prompt, 65536),
    tools: tools.slice(0, 256).map((t) => ({
      name: displayText(t.name),
      description: displayText(t.description).slice(0, 512),
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
      description: displayText(s.description).slice(0, 512),
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
  index = new EntryIndex(manager.getEntries()),
): BranchView {
  if (!index.byId.has(leafId)) throw new Error("Unknown entry");
  const { path, issue } = ancestry(manager, leafId, index);
  if (issue) {
    const unavailable = capture(`[unavailable: ${issue}]`);
    return {
      leafId,
      ancestryIssue: issue,
      entries: path.slice(offset, offset + 50).map((entry) => summarize(entry, manager.getLabel(entry.id))),
      total: path.length,
      offset,
      prompt: unavailable,
      previousPrompt: unavailable,
      sections: unavailable,
      declaredTools: unavailable,
      promptUpdates: unavailable,
      projection: unavailable,
      skillEvidence: unavailable,
    };
  }
  const projection = buildSessionProjection(path, leafId);
  const historicalSystem = getCurrentSystemMessage(projection.messages);
  const target = index.get(leafId);
  const previous = target?.parentId ? buildSessionProjection(path, target.parentId).messages : [];
  const evidence: { name: string; state: string; entryId: string }[] = [];
  const callPaths = new Map<string, string>();
  for (const entry of path) {
    if (entry.type !== "message") continue;
    const m = entry.message;
    if (m.role === "assistant")
      for (const block of Array.isArray(m.content) ? m.content : []) {
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
      getInitialSystemMessage(projection.messages)
        ? getCurrentTools(projection.messages).map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          }))
        : "[unavailable: no initial system/tool checkpoint]",
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

export function detail(
  manager: ReadonlySessionManager,
  id: string,
  leafId: string,
  collector: Collector,
  index = new EntryIndex(manager.getEntries()),
): DetailView {
  if (index.duplicates.has(id) || index.duplicates.has(leafId)) throw new Error("Ambiguous duplicate entry id");
  const entry = index.get(id);
  if (!entry || !index.get(leafId)) throw new Error("Unknown entry");
  const selected = ancestry(manager, id, index);
  const leaf = id === leafId ? selected : ancestry(manager, leafId, index);
  const issue = selected.issue ?? leaf.issue;
  if (issue)
    return {
      ancestryIssue: issue,
      raw: capture(entry, 65536),
      projected: capture(`[unavailable: ${issue}]`),
      calls: [],
    };
  const projected = buildSessionProjection(leaf.path, leafId).entries.find((e) => e.sourceEntry.id === id);
  const ids = new Set<string>();
  if (entry.type === "message") {
    const m = entry.message;
    if (m.role === "assistant")
      for (const b of Array.isArray(m.content) ? m.content : []) if (b.type === "toolCall") ids.add(b.id);
    if (m.role === "toolResult") ids.add(m.toolCallId);
  }
  const toolAnchor =
    entry.type === "message" && entry.message.role === "assistant"
      ? entry.id
      : selected.path
          .slice()
          .reverse()
          .find(
            (candidate) =>
              candidate.type === "message" &&
              candidate.message.role === "assistant" &&
              candidate.message.content.some((block) => block.type === "toolCall" && ids.has(block.id)),
          )?.id;
  return {
    toolAnchor,
    raw: capture(entry, 65536),
    projected: capture(projected?.messages),
    calls: correlatedCalls(ids, toolAnchor, collector.list()),
  };
}
