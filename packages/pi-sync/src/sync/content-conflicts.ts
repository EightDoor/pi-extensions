import { createHash } from "node:crypto";
import type { AnySyncConfig } from "../settings/settings-types.js";
import type { Snapshot, SnapshotFile } from "../snapshot/snapshot-types.js";
import { readMergeAncestors } from "../state/merge-baseline-store.js";
import type { SyncState } from "../state/state-types.js";
import { type FileMergePlan, mergePathIdentity } from "./file-merge-planner.js";
import { mergeSession } from "./session-merge.js";
import { isMergeTextPath, mergeText } from "./text-merge.js";
export function snapshotFile(filePath: string, bytes: Buffer): SnapshotFile {
  return {
    path: filePath,
    contentBase64: bytes.toString("base64"),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
export async function resolveContentConflicts(
  config: AnySyncConfig,
  state: SyncState,
  local: Snapshot,
  remote: Snapshot,
  plan: FileMergePlan,
  protectedPaths: ReadonlySet<string>,
): Promise<FileMergePlan> {
  if (plan.kind !== "planned" || !config.mergeContent) return plan;
  const decisions = [...plan.decisions];
  let ancestors: SnapshotFile[] = [];
  try {
    ancestors = (await readMergeAncestors(config, state)) ?? [];
  } catch {
    return plan;
  }
  for (const conflict of plan.conflicts) {
    if (
      conflict.reason !== "both-changed" ||
      [...protectedPaths].some((value) => mergePathIdentity(value) === mergePathIdentity(conflict.path))
    )
      continue;
    const session = conflict.path.startsWith("sessions/") && conflict.path.endsWith(".jsonl");
    if (!session && !isMergeTextPath(conflict.path)) continue;
    const ours = local.files.find((file) => file.path === conflict.path);
    const theirs = remote.files.find((file) => file.path === conflict.path);
    if (!ours || !theirs) continue;
    const ancestor = ancestors.find((file) => file.path === conflict.path);
    const base = ancestor ? Buffer.from(ancestor.contentBase64, "base64") : undefined;
    if (!base) continue;
    const bytes = (session ? mergeSession : mergeText)(
      base,
      Buffer.from(ours.contentBase64, "base64"),
      Buffer.from(theirs.contentBase64, "base64"),
    );
    if (!bytes) continue;
    decisions[decisions.indexOf(conflict)] = {
      kind: "accepted",
      path: conflict.path,
      source: "merged",
      file: snapshotFile(conflict.path, bytes),
    };
  }
  return {
    kind: "planned",
    decisions,
    conflicts: decisions.filter((item): item is Extract<typeof item, { kind: "conflict" }> => item.kind === "conflict"),
  };
}
