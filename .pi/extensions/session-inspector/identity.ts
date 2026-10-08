import type { ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";

export function identityIssue(entry: SessionEntry | undefined): string | undefined {
  if (typeof entry?.id !== "string" || !entry.id.length) return "missing, empty or non-string entry id";
  if (entry.parentId !== null && (typeof entry.parentId !== "string" || !entry.parentId.length))
    return "missing, empty or non-string parent id";
  if (typeof entry.type !== "string" || !entry.type.length) return "missing, empty or non-string entry type";
  if (entry.type === "message" && (typeof entry.message?.role !== "string" || !entry.message.role.length))
    return "missing, empty or non-string message role";
  if (
    entry.type === "message" &&
    entry.message.role === "assistant" &&
    Array.isArray(entry.message.content) &&
    entry.message.content.some((block) => !block || typeof block !== "object")
  )
    return "malformed assistant content block";
  if (typeof entry.timestamp !== "string") return "non-string entry timestamp";
  return undefined;
}

export function recordedLeaf(
  manager: ExtensionContext["sessionManager"],
  duplicates?: ReadonlySet<string>,
): string | null {
  const leaf = manager.getLeafId();
  return typeof leaf === "string" && !duplicates?.has(leaf) && !identityIssue(manager.getEntry(leaf)) ? leaf : null;
}
