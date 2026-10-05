import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { RemoteHead } from "../backends/sync-backend.js";
import type { AnySyncConfig } from "../settings/settings-types.js";
import type { Snapshot } from "../snapshot/snapshot-types.js";
import { readJsonIfExists, syncDirectory, writeJson } from "../state/json-file.js";
import { statePathForConfig, syncStateFingerprint } from "../state/sync-state-store.js";
import { planFileMerge } from "./file-merge-planner.js";
import { portableSnapshot } from "./local-fields.js";
import type { PartialProgress } from "./partial-progress.js";
import { fileHashMap, sameHashes } from "./sync-state.js";

export interface MergeJournal {
  version: 1;
  identity: string;
  before: Snapshot;
  after: Snapshot;
  accepted?: Snapshot;
  progress?: PartialProgress;
  upload: Snapshot;
  expectedHead: RemoteHead;
  committedHead?: RemoteHead;
  backup: string;
  stateIdentity: string;
  warnings?: string[];
}

export function mergeJournalIdentity(config: AnySyncConfig, backendIdentity: string) {
  return JSON.stringify([config.setupName, backendIdentity, [...config.include].sort(), config.localFields ?? []]);
}

export function mergeJournalPath(config: AnySyncConfig) {
  return `${statePathForConfig(config)}.merge-journal.json`;
}

export async function readMergeJournal(config: AnySyncConfig): Promise<MergeJournal | undefined> {
  let journal: MergeJournal | undefined;
  try {
    const stat = await fs.lstat(mergeJournalPath(config));
    if (!stat.isFile() || stat.size > 384 * 1024 * 1024) throw new Error("Unsafe or oversized journal.");
    journal = await readJsonIfExists<MergeJournal>(mergeJournalPath(config));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    // A JSON parser error may quote sensitive journal contents; do not retain it in a public error.
    throw new Error("Cannot read the private merge journal; preserve it and review recovery.");
  }
  if (!journal) return;
  if (
    journal.version !== 1 ||
    typeof journal.identity !== "string" ||
    typeof journal.backup !== "string" ||
    typeof journal.stateIdentity !== "string" ||
    (journal.warnings !== undefined &&
      (!Array.isArray(journal.warnings) ||
        journal.warnings.length > 64 ||
        journal.warnings.some((item) => typeof item !== "string"))) ||
    !journal.expectedHead ||
    typeof journal.expectedHead.revision !== "string" ||
    !journal.before ||
    !journal.after ||
    !journal.upload ||
    !Array.isArray(journal.before.files) ||
    !Array.isArray(journal.after.files) ||
    !Array.isArray(journal.upload.files)
  )
    throw new Error("Unsupported or damaged merge journal; preserve it and review recovery before syncing.");
  // Verify every path and byte, including the unmanaged remote files retained for publication.
  try {
    for (const snapshot of [
      journal.before,
      journal.after,
      journal.upload,
      ...(journal.accepted ? [journal.accepted] : []),
    ]) {
      if (
        (snapshot.version !== 1 && snapshot.version !== 2 && snapshot.version !== 3) ||
        typeof snapshot.id !== "string" ||
        typeof snapshot.profile !== "string" ||
        snapshot.files.length > 16_384 ||
        snapshot.files.reduce(
          (bytes, file) =>
            bytes + (typeof file?.contentBase64 === "string" ? file.contentBase64.length * 0.75 : Infinity),
          0,
        ) >
          64 * 1024 * 1024
      )
        throw new Error("Invalid journal input.");
      const plan = planFileMerge({ baseline: {}, local: snapshot.files, remote: [], selectionCompatible: true });
      if (
        plan.kind !== "planned" ||
        plan.conflicts.some(
          (conflict) =>
            conflict.reason !== "path-collision" ||
            !journal.progress?.groups.some((group) => group.paths.includes(conflict.path)),
        )
      )
        throw new Error("Invalid journal collision group.");
    }
  } catch {
    throw new Error("Invalid merge journal paths, metadata, or bytes; preserve evidence for review.");
  }
  if (
    journal.accepted &&
    !sameHashes(fileHashMap(portableSnapshot(journal.after, config.localFields)), fileHashMap(journal.accepted))
  )
    throw new Error("Invalid accepted merge projection; preserve journal evidence.");
  if (journal.progress) {
    const known = new Set(
      [...journal.before.files, ...journal.after.files, ...journal.upload.files].map((file) => file.path),
    );
    const progress = journal.progress;
    if (
      !config.partialSync ||
      !progress.previous ||
      syncStateFingerprint(progress.previous) !== journal.stateIdentity ||
      !Array.isArray(progress.groups) ||
      progress.groups.length > 16_384 ||
      progress.groups.some(
        (group) =>
          !Array.isArray(group.paths) ||
          !group.paths.length ||
          group.paths.length > 16_384 ||
          group.paths.some((filePath) => !known.has(filePath)) ||
          !/^[a-f0-9-]{36}$/u.test(group.artifact),
      )
    )
      throw new Error("Invalid partial acceptance metadata; preserve journal evidence.");
  }
  if (journal.progress) {
    const before = fileHashMap(journal.before);
    const after = fileHashMap(journal.after);
    const { readConflictArtifact } = await import("./conflict-artifacts.js");
    const backendIdentity = (JSON.parse(journal.identity) as unknown[])[1];
    if (typeof backendIdentity !== "string") throw new Error("Invalid partial backend identity.");
    for (const token of new Set(journal.progress.groups.map((group) => group.artifact))) {
      const artifact = await readConflictArtifact(config, backendIdentity, token);
      const remote = fileHashMap(artifact.remote);
      const upload = fileHashMap(journal.upload);
      for (const group of journal.progress.groups.filter((group) => group.artifact === token))
        for (const filePath of group.paths)
          if (before[filePath] !== after[filePath] || remote[filePath] !== upload[filePath])
            throw new Error("Withheld version changed in journal; preserve evidence.");
    }
  }
  return journal;
}

export async function writeMergeJournal(config: AnySyncConfig, journal: MergeJournal) {
  await writeJson(mergeJournalPath(config), journal, { maxBytes: 384 * 1024 * 1024 });
}

export async function clearMergeJournal(config: AnySyncConfig) {
  await fs.rm(mergeJournalPath(config), { force: true });
  await syncDirectory(path.dirname(mergeJournalPath(config)));
}

export async function retireMergeJournal(config: AnySyncConfig) {
  if (!(await readMergeJournal(config))) return;
  const file = mergeJournalPath(config);
  await fs.rename(file, `${file}.${randomUUID()}.resolved`);
  await syncDirectory(path.dirname(file));
}

export async function requireNoMergeJournal(config: AnySyncConfig, options: { force?: boolean } = {}) {
  const journal = await readMergeJournal(config);
  if (options.force || !journal) return;
  if (journal) {
    throw new Error(
      "A merged transfer needs recovery. Run /sync sync to reconcile it. If newer local edits or remote revisions prevent recovery, review /sync diff and explicitly choose push --force or pull --force; the selected directional result will archive the old journal, not restore old bytes. Keep its backup; do not downgrade while recovery is pending.",
    );
  }
}
