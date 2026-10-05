import { CURRENT_SESSION_VERSION } from "@earendil-works/pi-coding-agent";
import { parseJsonObjectDocument } from "./json-document.js";
import { text } from "./text-merge.js";

const id = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/u.test(value);
const content = (value: unknown): boolean =>
  typeof value === "string" ||
  (Array.isArray(value) &&
    value.every(
      (block) =>
        object(block) &&
        ((block.type === "text" && typeof block.text === "string") ||
          (block.type === "image" && typeof block.data === "string" && typeof block.mimeType === "string") ||
          (block.type === "thinking" && typeof block.thinking === "string") ||
          (block.type === "toolCall" && id(block.id) && typeof block.name === "string" && object(block.arguments))),
    ));
const message = (value: unknown) => {
  if (!object(value) || typeof value.timestamp !== "number" || !Number.isFinite(value.timestamp)) return false;
  switch (value.role) {
    case "user":
      return content(value.content);
    case "assistant":
      return (
        Array.isArray(value.content) &&
        content(value.content) &&
        typeof value.api === "string" &&
        typeof value.provider === "string" &&
        typeof value.model === "string" &&
        object(value.usage) &&
        ["stop", "length", "toolUse", "error", "aborted"].includes(String(value.stopReason))
      );
    case "toolResult":
      return (
        id(value.toolCallId) &&
        typeof value.toolName === "string" &&
        Array.isArray(value.content) &&
        content(value.content) &&
        typeof value.isError === "boolean"
      );
    case "custom":
      return typeof value.customType === "string" && content(value.content) && typeof value.display === "boolean";
    case "bashExecution":
      return (
        typeof value.command === "string" &&
        typeof value.output === "string" &&
        typeof value.cancelled === "boolean" &&
        typeof value.truncated === "boolean"
      );
    default:
      return false;
  }
};
const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
/** Stricter than Pi's repair-tolerant reader: never skip malformed lines or migrate a log. */
export function validateSession(bytes: Buffer) {
  if (CURRENT_SESSION_VERSION !== 3) throw new Error("Unaudited Pi session format; require review.");
  const raw = text(bytes);
  if (!raw.endsWith("\n")) throw new Error("Incomplete session tail.");
  const rows: unknown[] = raw
    .slice(0, -1)
    .split("\n")
    .map((line) => {
      if (line.startsWith("\uFEFF")) throw new Error("Unexpected session-record BOM; require review.");
      return parseJsonObjectDocument(Buffer.from(line)).root.value;
    });
  if (rows.length > 16_384) throw new Error("Session entry bound exceeded.");
  const header = rows[0];
  if (
    !object(header) ||
    header.type !== "session" ||
    header.version !== CURRENT_SESSION_VERSION ||
    !id(header.id) ||
    typeof header.cwd !== "string" ||
    typeof header.timestamp !== "string" ||
    !Number.isFinite(Date.parse(header.timestamp)) ||
    (header.parentSession !== undefined && typeof header.parentSession !== "string")
  )
    throw new Error("Unsupported session header.");
  const ids = new Set<string>();
  const known = (value: unknown) => id(value) && ids.has(value);
  for (const row of rows.slice(1)) {
    if (
      !object(row) ||
      !id(row.id) ||
      ids.has(row.id) ||
      typeof row.timestamp !== "string" ||
      !Number.isFinite(Date.parse(row.timestamp)) ||
      (row.parentId !== null && !known(row.parentId)) ||
      (row.parentId === null && ids.size > 0)
    )
      throw new Error("Invalid session graph.");
    const strings = (...keys: string[]) => keys.every((key) => typeof row[key] === "string");
    let valid = false;
    switch (row.type) {
      case "message":
        valid = message(row.message);
        break;
      case "thinking_level_change":
        valid = strings("thinkingLevel");
        break;
      case "model_change":
        valid = strings("provider", "modelId");
        break;
      case "usage":
        valid = strings("kind", "provider", "model") && object(row.usage);
        break;
      case "compaction":
        valid =
          strings("summary") &&
          known(row.firstKeptEntryId) &&
          typeof row.tokensBefore === "number" &&
          Number.isFinite(row.tokensBefore) &&
          row.tokensBefore >= 0;
        break;
      case "branch_summary":
        valid = strings("summary") && known(row.fromId);
        break;
      case "custom":
        valid = strings("customType");
        break;
      case "custom_message":
        valid = strings("customType") && typeof row.display === "boolean" && content(row.content);
        break;
      case "context_edit":
        valid =
          known(row.targetId) &&
          (row.replacement === null || (object(row.replacement) && content(row.replacement.content)));
        break;
      case "label":
        valid = known(row.targetId) && (row.label === undefined || typeof row.label === "string");
        break;
      case "session_info":
        valid = row.name === undefined || typeof row.name === "string";
        break;
    }
    if (!valid) throw new Error("Unsupported session entry.");
    ids.add(row.id);
  }
  return header.id;
}
export function mergeSession(base: Buffer, local: Buffer, remote: Buffer): Buffer | undefined {
  try {
    const identity = validateSession(base);
    if (validateSession(local) !== identity || validateSession(remote) !== identity) return;
    const prefix = (left: Buffer, right: Buffer) =>
      right.length >= left.length && right.subarray(0, left.length).equals(left);
    if (!prefix(base, local) || !prefix(base, remote)) return;
    if (prefix(local, remote)) return remote;
    if (prefix(remote, local)) return local;
  } catch {
    return;
  }
}
