import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { agentDir } from "../snapshot/session-paths.js";
import { createSnapshot, snapshotTarget } from "../snapshot/snapshot.js";
import { preflightSnapshotApply, preflightSnapshotMutations } from "../snapshot/snapshot-apply.js";
import { sessionStorageRoot } from "../snapshot/snapshot-paths.js";
import type { Snapshot, SnapshotOptions } from "../snapshot/snapshot-types.js";
import { syncDirectory } from "../state/json-file.js";
import { syncMutationParents } from "../state/mutation-directory-sync.js";
import { mergePathIdentity } from "./file-merge-planner.js";
import { fileHashMap } from "./sync-state.js";

/** Read-only filesystem applicability check before publishing a combined result. */
export async function preflightMergedTargets(before: Snapshot, after: Snapshot, options: SnapshotOptions) {
  const root = agentDir();
  const beforeHashes: Record<string, string> = Object.assign(Object.create(null), fileHashMap(before));
  const afterHashes: Record<string, string> = Object.assign(Object.create(null), fileHashMap(after));
  for (const relative of new Set([...Object.keys(beforeHashes), ...Object.keys(afterHashes)])) {
    if (beforeHashes[relative] !== afterHashes[relative]) await assertFilesystemTarget(root, relative, options);
  }
}

async function assertFilesystemTarget(root: string, relative: string, options: SnapshotOptions) {
  const target = snapshotTarget(root, relative, options.sessionDir);
  const boundary =
    relative.startsWith("sessions/") && options.sessionDir
      ? path.resolve(sessionStorageRoot(root, options.sessionDir))
      : path.resolve(root);
  for (
    let parent = path.dirname(target);
    mergePathIdentity(parent) !== mergePathIdentity(boundary);
    parent = path.dirname(parent)
  ) {
    options.signal?.throwIfAborted();
    if (path.dirname(parent) === parent) throw new Error("Unowned merged target.");
    try {
      const stat = await fs.lstat(parent);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new Error("Unsafe merge filesystem layout; review the selected paths before transfer.");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw error;
    }
  }
  options.signal?.throwIfAborted();
  try {
    const stat = await fs.lstat(target);
    if (!stat.isFile() || stat.nlink > 1)
      throw new Error("Merge target is non-regular or hard-linked; review a directional operation before transfer.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

/** Roll forward only while each target is still its reviewed preimage or committed postimage. */
export async function applyMergedSnapshot(
  before: Snapshot,
  after: Snapshot,
  protectedPaths: Set<string>,
  options: SnapshotOptions,
  validate: () => Promise<void>,
) {
  const root = agentDir();
  const beforeHashes: Record<string, string> = Object.assign(Object.create(null), fileHashMap(before));
  const afterHashes: Record<string, string> = Object.assign(Object.create(null), fileHashMap(after));
  const changed = [...new Set([...Object.keys(beforeHashes), ...Object.keys(afterHashes)])]
    .filter((item) => beforeHashes[item] !== afterHashes[item])
    .sort();
  const protectedKeys = new Set([...protectedPaths].map(mergePathIdentity));
  if (changed.some((item) => protectedKeys.has(mergePathIdentity(item)))) {
    throw new Error("A merged transfer targets the current session; review is required.");
  }
  // Exact file queues, not a directory pseudo-lock: Pi edit/write tools use these keys.
  const targets = changed.map((item) => snapshotTarget(root, item, options.sessionDir));
  const queueKeys = new Set<string>();
  for (const target of targets) {
    options.signal?.throwIfAborted();
    let key = target;
    try {
      key = await fs.realpath(target);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
    }
    if (queueKeys.has(key))
      throw new Error("Merged paths resolve to the same file; reviewed directional recovery is required.");
    queueKeys.add(key);
  }
  async function acquire(index: number): Promise<void> {
    const target = targets[index];
    if (target) return withFileMutationQueue(target, () => acquire(index + 1));
    await validate();
    const current = await createSnapshot(before.profile, options);
    const currentHashes: Record<string, string> = Object.assign(Object.create(null), fileHashMap(current));
    for (const item of changed) {
      if (currentHashes[item] !== beforeHashes[item] && currentHashes[item] !== afterHashes[item]) {
        throw new Error(
          "Local content changed during merged transfer; journal retained for review. No newer bytes were replaced.",
        );
      }
      const target = snapshotTarget(root, item, options.sessionDir);
      try {
        const stat = await fs.lstat(target);
        if (!stat.isFile() || stat.nlink > 1)
          throw new Error("Merged transfer target is no longer an independent regular file.");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    const plan = preflightSnapshotApply(root, after, current, options);
    plan.writes = plan.writes.filter((item) => targets.includes(item.target));
    plan.deletes = plan.deletes.filter((target) => targets.includes(target));
    await preflightSnapshotMutations(root, plan, options.sessionDir);
    await validate();
    const revalidateTarget = async (target: string) => {
      await validate();
      const relative = changed[targets.indexOf(target)];
      if (!relative) throw new Error("Unowned merge target.");
      await assertFilesystemTarget(root, relative, options);
      await validate();
      let hash: string | undefined;
      try {
        const stat = await fs.lstat(target);
        if (!stat.isFile() || stat.nlink > 1)
          throw new Error("Merged transfer target is no longer an independent regular file.");
        hash = createHash("sha256")
          .update(await fs.readFile(target))
          .digest("hex");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      options.signal?.throwIfAborted();
      options.validateMutation?.();
      if (hash !== beforeHashes[relative] && hash !== afterHashes[relative])
        throw new Error("Local content changed at the apply boundary; journal retained, newer bytes untouched.");
    };
    for (const target of plan.deletes) {
      await revalidateTarget(target);
      await fs.rm(target, { force: true });
      await syncDirectory(path.dirname(target));
    }
    for (const item of plan.writes) {
      const temporary = path.join(path.dirname(item.target), `.pi-sync.json.${randomUUID()}.apply`);
      let mode = 0o600;
      try {
        mode = (await fs.stat(item.target)).mode & 0o777;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      try {
        const handle = await fs.open(temporary, "wx", mode);
        try {
          await handle.writeFile(item.content);
          await handle.sync();
        } finally {
          await handle.close();
        }
        await revalidateTarget(item.target);
        await fs.rename(temporary, item.target);
        await syncDirectory(path.dirname(item.target));
      } finally {
        await fs.rm(temporary, { force: true });
      }
    }
    await syncMutationParents(
      targets,
      [root, ...(options.sessionDir ? [sessionStorageRoot(root, options.sessionDir)] : [])],
      options,
    );
    await validate();
  }
  await acquire(0);
}
