import { createHash, randomUUID } from "node:crypto";
import type { Stats } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { assertWithinRoot, isDeniedPath, isPathInside } from "../paths.js";
import { syncDirectory, writeJson } from "../state/json-file.js";
import { withLock } from "../state/lock.js";
import { syncMutationParents } from "../state/mutation-directory-sync.js";
import { stateDir } from "../state/state-directory.js";
import { mergePathIdentity } from "../sync/file-merge-planner.js";
import { agentDir } from "./session-paths.js";
import { sessionStorageRoot } from "./snapshot-paths.js";
import type { SnapshotApplyPlan } from "./snapshot-types.js";

const JOURNAL_VERSION = 2;
interface TransactionEntry {
  target: string;
  backupName: string;
  kind: "missing" | "file" | "directory" | "symlink";
  linkTarget?: string;
  beforeImage?: string;
  afterImage?: string;
  postFiles?: { relative: string; image: string }[];
}
interface TransactionJournal {
  version: number;
  root: string;
  sessionRoot?: string;
  entries: TransactionEntry[];
}
interface TransactionOptions {
  sessionDir?: string;
  signal?: AbortSignal;
  validateMutation?: () => void;
  protectedTargets?: readonly string[];
}

export async function applySnapshotTransaction(plan: SnapshotApplyPlan, options: TransactionOptions = {}) {
  options.validateMutation?.();
  await recoverPendingSnapshotTransactions(options);
  const targets = [...new Set([...plan.deletes, ...plan.writes.map((item) => item.target)])].sort();
  return withTargetQueues(targets, async () => {
    options.signal?.throwIfAborted();
    if (
      targets.some((target) =>
        options.protectedTargets?.some(
          (protectedTarget) =>
            mergePathIdentity(target) === mergePathIdentity(protectedTarget) ||
            isPathInside(mergePathIdentity(target), mergePathIdentity(protectedTarget)),
        ),
      )
    )
      throw new Error("Snapshot transaction targets the current session; review is required.");
    const transaction = await prepareTransaction(plan, options);
    try {
      const deleted = new Set<string>();
      const deletes = plan.deletes.filter((target) => !plan.deletes.some((parent) => isStrictlyInside(parent, target)));
      for (const target of deletes.sort((a, b) => a.length - b.length)) {
        options.signal?.throwIfAborted();
        const entry = transaction.journal.entries.find((item) => item.target === target);
        if (!entry) throw new Error("Unowned transaction target.");
        await verifyTarget(transaction.directory, entry, transaction.journal);
        options.signal?.throwIfAborted();
        options.validateMutation?.();
        await fs.rm(target, { force: true, recursive: true });
        deleted.add(target);
        await syncDirectory(path.dirname(target));
      }
      for (const item of plan.writes) {
        options.signal?.throwIfAborted();
        const entry = transaction.journal.entries.find((entry) => entry.target === item.target);
        if (!entry) throw new Error("Unowned transaction target.");
        const deletedByThisCall = [...deleted].some(
          (target) => target === item.target || isPathInside(target, item.target),
        );
        await verifyTarget(transaction.directory, entry, transaction.journal, deletedByThisCall);
        await fs.mkdir(path.dirname(item.target), { recursive: true });
        const temp = path.join(path.dirname(item.target), `.pi-sync.json.${randomUUID()}.apply`);
        try {
          let mode = 0o600;
          try {
            const stat = await fs.lstat(item.target);
            if (stat.isFile()) mode = stat.mode & 0o777;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
          const handle = await fs.open(temp, "wx", mode);
          try {
            await handle.writeFile(item.content);
            await handle.sync();
          } finally {
            await handle.close();
          }
          await verifyTarget(transaction.directory, entry, transaction.journal, deletedByThisCall);
          options.signal?.throwIfAborted();
          options.validateMutation?.();
          await fs.rename(temp, item.target);
          await syncDirectory(path.dirname(item.target));
        } finally {
          await fs.rm(temp, { force: true });
        }
      }
      options.validateMutation?.();
      options.signal?.throwIfAborted();
      await syncMutationParents(
        targets,
        [transaction.journal.root, ...(transaction.journal.sessionRoot ? [transaction.journal.sessionRoot] : [])],
        options,
      );
      options.validateMutation?.();
      options.signal?.throwIfAborted();
      await removeTransaction(transaction.directory);
    } catch (error) {
      // Aborted owners cannot roll back files after another session has replaced them.
      if (options.signal?.aborted)
        throw new Error("Snapshot apply cancelled; guarded transaction evidence retained for review.");
      try {
        await restoreTransaction(transaction.directory, transaction.journal, options);
      } catch (recoveryError) {
        throw new AggregateError(
          [error, recoveryError],
          "Snapshot apply failed and guarded recovery requires review. Transaction and backup retained; newer bytes were not restored over.",
        );
      }
      throw error;
    }
  });
}

export async function recoverSnapshotTransactionsOnStartup(options: TransactionOptions = {}) {
  if (!(await pendingTransactionEntries()).some((entry) => entry.isDirectory())) return;
  await withLock("recovery", () => recoverPendingSnapshotTransactions(options), { reclaimStale: true });
}

export async function recoverPendingSnapshotTransactions(options: TransactionOptions = {}) {
  for (const entry of (await pendingTransactionEntries()).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(transactionRoot(), entry.name);
    let journal: TransactionJournal;
    try {
      const file = path.join(directory, "journal.json");
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.size > 32 * 1024 * 1024) throw new Error("Invalid journal file.");
      journal = JSON.parse(await fs.readFile(file, "utf8")) as TransactionJournal;
    } catch (error) {
      // Unknown evidence is not disposable, including interrupted preparation directories.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw new Error("Cannot recover malformed pi-sync transaction; preserve private evidence for review.");
    }
    validateJournal(directory, journal, options.sessionDir);
    await withTargetQueues(journal.entries.map((entry) => entry.target).sort(), () =>
      restoreTransaction(directory, journal, options),
    );
  }
}

async function pendingTransactionEntries() {
  try {
    return await fs.readdir(transactionRoot(), { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function prepareTransaction(plan: SnapshotApplyPlan, options: TransactionOptions) {
  const { sessionDir } = options;
  const root = path.resolve(agentDir());
  const sessionRoot = sessionDir ? path.resolve(sessionStorageRoot(root, sessionDir)) : undefined;
  const directory = path.join(transactionRoot(), randomUUID());
  const backupDirectory = path.join(directory, "before");
  await fs.mkdir(backupDirectory, { recursive: true, mode: 0o700 });
  const entries: TransactionEntry[] = [];
  const targets = [...new Set([...plan.deletes, ...plan.writes.map((item) => item.target)])].sort();
  if (targets.length > 16_384)
    throw new Error("Snapshot transaction exceeds its target bound; review a smaller transfer.");
  for (const [index, target] of targets.entries()) {
    options.signal?.throwIfAborted();
    options.validateMutation?.();
    assertAllowedTarget(root, sessionRoot, target);
    await assertSafeParents(root, sessionRoot, target);
    const entry: TransactionEntry = { target, backupName: `${index}`, kind: "missing" };
    const backup = path.join(backupDirectory, entry.backupName);
    try {
      const stat = await fs.lstat(target);
      if (stat.isSymbolicLink()) {
        entry.kind = "symlink";
        entry.linkTarget = await fs.readlink(target);
      } else if (stat.isDirectory()) {
        entry.kind = "directory";
        await fs.cp(target, backup, {
          recursive: true,
          dereference: false,
          preserveTimestamps: true,
          filter: () => {
            options.signal?.throwIfAborted();
            options.validateMutation?.();
            return true;
          },
        });
      } else if (stat.isFile()) {
        entry.kind = "file";
        await fs.copyFile(target, backup);
        await fs.chmod(backup, stat.mode);
      } else throw new Error("Unsupported existing snapshot target.");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
    }
    entry.beforeImage =
      entry.kind === "symlink"
        ? `symlink:${entry.linkTarget}`
        : entry.kind === "missing"
          ? "missing"
          : await image(backup, true);
    const write = plan.writes.find((item) => item.target === target);
    entry.afterImage = write ? fileImage(write.content) : "missing";
    entry.postFiles = plan.writes
      .filter((item) => isStrictlyInside(target, item.target))
      .map((item) => ({ relative: path.relative(target, item.target), image: fileImage(item.content) }));
    entries.push(entry);
  }
  const journal: TransactionJournal = { version: JOURNAL_VERSION, root, sessionRoot, entries };
  options.signal?.throwIfAborted();
  options.validateMutation?.();
  await writeJson(path.join(directory, "journal.json"), journal, { maxBytes: 32 * 1024 * 1024 });
  await syncDirectory(transactionRoot());
  await syncDirectory(stateDir());
  await syncDirectory(path.dirname(stateDir()));
  return { directory, journal };
}

async function restoreTransaction(directory: string, journal: TransactionJournal, options: TransactionOptions) {
  validateJournal(directory, journal, options.sessionDir);
  options.validateMutation?.();
  options.signal?.throwIfAborted();
  for (const entry of journal.entries) {
    if (
      options.protectedTargets?.some(
        (target) =>
          mergePathIdentity(target) === mergePathIdentity(entry.target) ||
          isPathInside(mergePathIdentity(entry.target), mergePathIdentity(target)),
      )
    )
      throw new Error(
        "Pending transaction touches the current session; resume a different session before guarded recovery.",
      );
    await verifyTarget(directory, entry, journal);
  }
  // Verify the complete group before removing any path. Recheck each destructive boundary.
  for (const entry of [...journal.entries].sort((a, b) => a.target.length - b.target.length)) {
    const current = await verifyTarget(directory, entry, journal);
    const before = await beforeImage(directory, entry);
    if (current === before) continue;
    options.signal?.throwIfAborted();
    options.validateMutation?.();
    if (entry.kind === "file") {
      const temporary = path.join(path.dirname(entry.target), `.pi-sync.json.${randomUUID()}.restore`);
      try {
        await fs.mkdir(path.dirname(entry.target), { recursive: true });
        await fs.copyFile(path.join(directory, "before", entry.backupName), temporary);
        const handle = await fs.open(temporary, "r");
        try {
          await handle.sync();
        } finally {
          await handle.close();
        }
        const verified = await verifyTarget(directory, entry, journal);
        options.validateMutation?.();
        options.signal?.throwIfAborted();
        if (verified === before) continue;
        if (verified.startsWith("directory:")) await fs.rm(entry.target, { recursive: true, force: true });
        await fs.rename(temporary, entry.target);
        await syncDirectory(path.dirname(entry.target));
      } finally {
        await fs.rm(temporary, { force: true });
      }
      continue;
    }
    const verified = await verifyTarget(directory, entry, journal);
    options.validateMutation?.();
    options.signal?.throwIfAborted();
    if (verified === before) continue;
    await fs.rm(entry.target, { recursive: true, force: true });
    if (entry.kind !== "missing") {
      await fs.mkdir(path.dirname(entry.target), { recursive: true });
      await assertSafeParents(journal.root, journal.sessionRoot, entry.target);
      options.signal?.throwIfAborted();
      const backup = path.join(directory, "before", entry.backupName);
      options.validateMutation?.();
      if (entry.kind === "directory")
        await fs.cp(backup, entry.target, { recursive: true, dereference: false, preserveTimestamps: true });
      else if (entry.linkTarget !== undefined) await fs.symlink(entry.linkTarget, entry.target);
    }
    await image(entry.target, true);
    await syncDirectory(path.dirname(entry.target));
  }
  await syncMutationParents(
    journal.entries.map((entry) => entry.target),
    [journal.root, ...(journal.sessionRoot ? [journal.sessionRoot] : [])],
    options,
  );
  options.validateMutation?.();
  options.signal?.throwIfAborted();
  await removeTransaction(directory);
}

async function verifyTarget(
  directory: string,
  entry: TransactionEntry,
  journal: TransactionJournal,
  deletedByThisCall = false,
) {
  await assertSafeParents(journal.root, journal.sessionRoot, entry.target);
  // Hash the potentially large backup before observing the live target, not after it.
  const before = await beforeImage(directory, entry);
  if (journal.version === 2 && before !== entry.beforeImage)
    throw new Error("Transaction backup changed; preserve evidence for review.");
  const current = await image(entry.target);
  if (current === before || (deletedByThisCall && current === "missing")) return current;
  if (
    journal.version === 2 &&
    (current === entry.afterImage || (await ownedPostTree(entry.target, entry.postFiles ?? [])))
  )
    return current;
  throw new Error(
    "Transaction target has unrecognized or newer bytes; automatic rollback refused. Preserve the transaction and review its backup with Pi closed.",
  );
}

async function beforeImage(directory: string, entry: TransactionEntry) {
  if (entry.kind === "missing") return "missing";
  if (entry.kind === "symlink") return `symlink:${entry.linkTarget}`;
  const value = await image(path.join(directory, "before", entry.backupName));
  if (value === "missing") throw new Error("Transaction backup is missing; preserve evidence for review.");
  return value;
}
function fileImage(content: Buffer) {
  return `file:${createHash("sha256").update(content).digest("hex")}`;
}
async function image(target: string, durable = false): Promise<string> {
  let stat: Stats;
  try {
    stat = await fs.lstat(target);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return "missing";
    throw error;
  }
  if (stat.isSymbolicLink()) return `symlink:${await fs.readlink(target)}`;
  if (stat.isFile()) {
    const content = await fs.readFile(target);
    if (durable) {
      const handle = await fs.open(target, "r");
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
    }
    return fileImage(content);
  }
  if (!stat.isDirectory()) throw new Error("Unsupported transaction image.");
  const entries = [];
  for (const name of (await fs.readdir(target)).sort())
    entries.push([name, await image(path.join(target, name), durable)]);
  if (durable) await syncDirectory(target);
  return `directory:${createHash("sha256").update(JSON.stringify(entries)).digest("hex")}`;
}
async function ownedPostTree(target: string, files: { relative: string; image: string }[]) {
  if (!files.length) return false;
  const expected = new Map(files.map((file) => [mergePathIdentity(file.relative), file.image]));
  async function visit(directory: string): Promise<boolean> {
    let stat: Stats;
    try {
      stat = await fs.lstat(directory);
    } catch {
      return false;
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
    for (const name of await fs.readdir(directory)) {
      const child = path.join(directory, name);
      const relative = mergePathIdentity(path.relative(target, child));
      const value = await image(child);
      if (value.startsWith("directory:")) {
        if (![...expected.keys()].some((key) => key.startsWith(relative + path.sep)) || !(await visit(child)))
          return false;
      } else if (expected.get(relative) !== value) return false;
    }
    return true;
  }
  return visit(target);
}

function validateJournal(directory: string, journal: TransactionJournal, sessionDir?: string) {
  if (![1, 2].includes(journal.version) || !Array.isArray(journal.entries) || journal.entries.length > 16_384)
    throw new Error("Unsupported pi-sync transaction journal; preserve evidence for review.");
  const root = path.resolve(agentDir());
  if (typeof journal.root !== "string" || path.resolve(journal.root) !== root)
    throw new Error("Transaction root no longer matches the Pi agent directory.");
  const trustedSessionRoot = sessionDir
    ? path.resolve(sessionStorageRoot(root, sessionDir))
    : path.join(root, "sessions");
  if (
    journal.sessionRoot !== undefined &&
    (typeof journal.sessionRoot !== "string" || path.resolve(journal.sessionRoot) !== trustedSessionRoot)
  )
    throw new Error("Transaction session root is not owned by this context; preserve evidence for review.");
  for (const entry of journal.entries) {
    if (
      !entry ||
      typeof entry.target !== "string" ||
      !path.isAbsolute(entry.target) ||
      path.resolve(entry.target) !== entry.target ||
      typeof entry.backupName !== "string" ||
      !/^\d+$/u.test(entry.backupName) ||
      !["missing", "file", "directory", "symlink"].includes(entry.kind)
    )
      throw new Error("Invalid pi-sync transaction entry.");
    assertWithinRoot(directory, path.join(directory, "before", entry.backupName));
    assertAllowedTarget(root, journal.sessionRoot, entry.target);
    if (
      journal.version === 2 &&
      (typeof entry.beforeImage !== "string" || typeof entry.afterImage !== "string" || !Array.isArray(entry.postFiles))
    )
      throw new Error("Invalid transaction postimage evidence.");
    for (const file of entry.postFiles ?? []) {
      if (
        typeof file.relative !== "string" ||
        typeof file.image !== "string" ||
        !isStrictlyInside(entry.target, path.resolve(entry.target, file.relative))
      )
        throw new Error("Invalid transaction subtree evidence.");
    }
  }
}
function isStrictlyInside(root: string, target: string) {
  return path.relative(path.resolve(root), path.resolve(target)) !== "" && isPathInside(root, target);
}

function assertAllowedTarget(root: string, sessionRoot: string | undefined, target: string) {
  const resolved = path.resolve(target);
  if (isStrictlyInside(root, resolved)) {
    if (isDeniedPath(path.relative(root, resolved))) throw new Error("Transaction targets denied private storage.");
    assertWithinRoot(root, resolved);
    return;
  }
  if (sessionRoot && isStrictlyInside(sessionRoot, resolved)) {
    if (isDeniedPath(`sessions/${path.relative(sessionRoot, resolved)}`))
      throw new Error("Transaction targets denied session storage.");
    assertWithinRoot(sessionRoot, resolved);
    return;
  }
  throw new Error("Transaction target is outside configured roots.");
}
async function assertSafeParents(root: string, sessionRoot: string | undefined, target: string) {
  assertAllowedTarget(root, sessionRoot, target);
  const boundary = isPathInside(root, target) ? root : sessionRoot;
  for (
    let parent = path.dirname(target);
    boundary && mergePathIdentity(parent) !== mergePathIdentity(boundary);
    parent = path.dirname(parent)
  ) {
    if (path.dirname(parent) === parent) throw new Error("Transaction parent did not reach its owned boundary.");
    try {
      const stat = await fs.lstat(parent);
      if ((!stat.isDirectory() && !stat.isFile()) || stat.isSymbolicLink())
        throw new Error("Unsafe transaction parent.");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
    }
  }
}
async function withTargetQueues<T>(targets: string[], action: () => Promise<T>) {
  const keys = new Set<string>();
  for (const target of targets) {
    let key = path.resolve(target);
    try {
      key = await fs.realpath(target);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
    }
    if (keys.has(key)) throw new Error("Transaction targets alias the same file.");
    keys.add(key);
  }
  async function acquire(index: number): Promise<T> {
    const target = targets[index];
    return target ? withFileMutationQueue(target, () => acquire(index + 1)) : action();
  }
  return acquire(0);
}
async function removeTransaction(directory: string) {
  await fs.rm(directory, { recursive: true, force: true });
  await syncDirectory(transactionRoot());
}
function transactionRoot() {
  return path.join(stateDir(), "transactions");
}
