import type { ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";

export function identityIssue(entry: SessionEntry | undefined): string | undefined {
  if (typeof entry?.id !== "string" || !entry.id.length) return "missing, empty or non-string entry id";
  if (entry.parentId !== null && (typeof entry.parentId !== "string" || !entry.parentId.length))
    return "missing, empty or non-string parent id";
  return undefined;
}

export function recordedLeaf(manager: ExtensionContext["sessionManager"]): string | null {
  const leaf = manager.getLeafId();
  return typeof leaf === "string" && !identityIssue(manager.getEntry(leaf)) ? leaf : null;
}
