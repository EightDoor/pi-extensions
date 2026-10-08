import type { ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";

// Pi's native projection walks parent links without cycle detection; validate before invoking it.
export function ancestry(
  manager: ExtensionContext["sessionManager"],
  id: string,
): { path: SessionEntry[]; issue?: string } {
  const path: SessionEntry[] = [];
  const seen = new Set<string>();
  let current = manager.getEntry(id);
  while (current) {
    if (seen.has(current.id)) return { path: path.reverse(), issue: "recorded parent cycle" };
    if (path.length >= 10000)
      return { path: path.reverse(), issue: "ancestry exceeds the 10,000-entry inspection budget" };
    seen.add(current.id);
    path.push(current);
    const parent = current.parentId;
    current = parent ? manager.getEntry(parent) : undefined;
    if (parent && !current) return { path: path.reverse(), issue: "missing recorded parent" };
  }
  return { path: path.reverse() };
}
