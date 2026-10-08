import type { ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";

export function identityIssue(entry: SessionEntry | undefined): string | undefined {
  if (typeof entry?.id !== "string" || !entry.id.length) return "missing, empty or non-string entry id";
  if (entry.id.length > 512) return "over-budget entry id";
  if (typeof entry.parentId === "string" && entry.parentId.length > 512) return "over-budget parent id";
  if (entry.type === "label" && entry.label !== undefined && typeof entry.label !== "string")
    return "non-string stored label";
  if (entry.parentId !== null && (typeof entry.parentId !== "string" || !entry.parentId.length))
    return "missing, empty or non-string parent id";
  if (entry.type === "session_info" && typeof entry.name !== "string") return "non-string stored session name";
  if (typeof entry.type !== "string" || !entry.type.length) return "missing, empty or non-string entry type";
  if (entry.type === "message" && (typeof entry.message?.role !== "string" || !entry.message.role.length))
    return "missing, empty or non-string message role";
  if (
    entry.type === "message" &&
    entry.message.role === "assistant" &&
    (!Array.isArray(entry.message.content) ||
      entry.message.content.some((block) => !block || typeof block !== "object" || Array.isArray(block)))
  )
    return "malformed assistant content block or envelope";
  if (
    entry.type === "message" &&
    entry.message.role === "assistant" &&
    Array.isArray(entry.message.content) &&
    entry.message.content.some(
      (block) =>
        block.type === "toolCall" &&
        (!block.arguments ||
          typeof block.arguments !== "object" ||
          Array.isArray(block.arguments) ||
          typeof block.id !== "string" ||
          typeof block.name !== "string"),
    )
  )
    return "malformed tool-call envelope";
  if (typeof entry.timestamp !== "string") return "non-string entry timestamp";
  return undefined;
}

export function recordedLeaf(
  manager: ExtensionContext["sessionManager"],
  duplicates?: ReadonlySet<string>,
): string | null {
  const leaf = manager.getLeafId();
  return typeof leaf === "string" &&
    leaf.length > 0 &&
    leaf.length <= 512 &&
    !duplicates?.has(leaf) &&
    !identityIssue(manager.getEntry(leaf))
    ? leaf
    : null;
}
