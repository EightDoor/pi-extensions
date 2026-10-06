import fs from "node:fs/promises";
import path from "node:path";
import { backendIdentityCoordinates } from "../backends/backend-identity.js";
import type { AnySyncConfig } from "../settings/settings-types.js";
import type { Snapshot, SnapshotFile } from "../snapshot/snapshot-types.js";
import { planFileMerge } from "../sync/file-merge-planner.js";
import { parseSettingsDocument } from "../sync/json-document.js";
import { syncDirectory, writeJson } from "./json-file.js";
import type { SyncState } from "./state-types.js";
import { statePathForConfig, syncStateFingerprint } from "./sync-state-store.js";

interface MergeBaseline {
  version: 1;
  identity: string;
  acceptedState: string;
  files: SnapshotFile[];
}
const MAX_BYTES = 2 * 1024 * 1024;

function identity(config: AnySyncConfig) {
  return JSON.stringify([
    config.setupName,
    backendIdentityCoordinates(config),
    config.include,
    config.localFields ?? [],
  ]);
}
function directory(config: AnySyncConfig) {
  return `${statePathForConfig(config)}.ancestors`;
}
async function checkDirectory(config: AnySyncConfig, create = false) {
  const target = directory(config);
  if (create) await fs.mkdir(target, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(target);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (process.platform !== "win32" && (stat.mode & 0o077) !== 0))
    throw new Error("Unsafe private ancestor directory; preserve evidence.");
}
function baselinePath(config: AnySyncConfig, state: SyncState) {
  return path.join(directory(config), `${syncStateFingerprint(state)}.json`);
}

/** Stage before accepted state, retain its previous ancestor until journal retirement. Never bootstrap from current edits. */
export async function stageMergeBaseline(config: AnySyncConfig, snapshot: Snapshot, accepted: SyncState) {
  const files = snapshot.files.filter((file) => {
    if (file.path !== "settings.json" || accepted.lastFileHashes[file.path] !== file.sha256) return false;
    try {
      parseSettingsDocument(Buffer.from(file.contentBase64, "base64"));
      return true;
    } catch {
      return false;
    }
  });
  const plan = planFileMerge({ baseline: {}, local: files, remote: [], selectionCompatible: true });
  if (plan.kind !== "planned" || plan.conflicts.length)
    throw new Error("Cannot stage unverified merge ancestor bytes.");
  const record: MergeBaseline = {
    version: 1,
    identity: identity(config),
    acceptedState: syncStateFingerprint(accepted),
    files,
  };
  await checkDirectory(config, true);
  await writeJson(baselinePath(config, accepted), record, { maxBytes: MAX_BYTES });
}

/** Reader and pruning must agree on which records are safe, owned and byte-valid. */
async function readBaselineRecord(
  config: AnySyncConfig,
  target: string,
  acceptedState: string,
  validate: () => void = () => {},
): Promise<MergeBaseline> {
  const stat = await fs.lstat(target);
  validate();
  if (!stat.isFile() || stat.size > MAX_BYTES || (process.platform !== "win32" && (stat.mode & 0o077) !== 0))
    throw new Error("Unsafe cache.");
  const record = JSON.parse(await fs.readFile(target, "utf8")) as MergeBaseline;
  validate();
  if (
    record.version !== 1 ||
    record.identity !== identity(config) ||
    record.acceptedState !== acceptedState ||
    !Array.isArray(record.files) ||
    record.files.length > 1 ||
    record.files.some((file) => file?.path !== "settings.json")
  )
    throw new Error("Invalid cache identity.");
  const plan = planFileMerge({ baseline: {}, local: record.files, remote: [], selectionCompatible: true });
  if (plan.kind !== "planned" || plan.conflicts.length) throw new Error("Invalid cache bytes.");
  return record;
}

export async function readMergeAncestor(
  config: AnySyncConfig,
  state: SyncState,
  filePath: string,
): Promise<Buffer | undefined> {
  let record: MergeBaseline;
  try {
    await checkDirectory(config);
    record = await readBaselineRecord(config, baselinePath(config, state), syncStateFingerprint(state));
    for (const file of record.files)
      if (state.lastFileHashes[file.path] !== file.sha256) throw new Error("Cache hash mismatch.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw new Error("Merge ancestor is invalid; preserve its private cache and review the conflict.");
  }
  const file = record.files.find((file) => file.path === filePath);
  return file ? Buffer.from(file.contentBase64, "base64") : undefined;
}

/** Caller must hold the sync operation lock and retire the commit journal before pruning. */
export async function pruneMergeBaselines(config: AnySyncConfig, state: SyncState, validate: () => void) {
  validate();
  const keep = path.basename(baselinePath(config, state));
  let names: string[];
  try {
    await checkDirectory(config);
    validate();
    names = await fs.readdir(directory(config));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const name of names) {
    validate();
    if (name === keep || !/^[a-f0-9]{64}\.json$/u.test(name)) continue;
    const target = path.join(directory(config), name);
    try {
      await readBaselineRecord(config, target, name.slice(0, -5), validate);
    } catch {
      validate();
      continue; // Unknown/corrupted evidence is not an owned pruning candidate.
    }
    validate();
    await fs.rm(target);
    validate();
  }
  await syncDirectory(directory(config));
  validate();
}
