import type { ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createSyncBackend, type SyncBackendFactory } from "../backends/backend-factory.js";
import {
  expectedRemoteHead,
  type PublishSnapshotResult,
  type RemoteHead,
  type SyncBackend,
} from "../backends/sync-backend.js";
import type { CommandOptions } from "../commands/command-types.js";
import { loadConfig } from "../settings/config.js";
import type { AnySyncConfig } from "../settings/settings-types.js";
import { sessionDirForApply, snapshotOptionsForContext } from "../snapshot/session-paths.js";
import {
  createSnapshot,
  filterSnapshotForConfigPolicy,
  mergeRemotePreservedFiles,
  regenerateSnapshotIdentity,
  scanSnapshot,
  snapshotIncludesSessions,
  snapshotWithoutSessions,
} from "../snapshot/snapshot.js";
import { applySnapshot } from "../snapshot/snapshot-apply.js";
import type { Snapshot } from "../snapshot/snapshot-types.js";
import type { SyncState } from "../state/state-types.js";
import { readStateForConfig, writeStateForConfig } from "../state/sync-state-store.js";
import {
  countPreservedRemoteFiles,
  formatPullSummary,
  formatPushSummary,
  formatRollbackSummary,
} from "../ui/sync-format.js";
import { setSyncStatus } from "../ui/sync-status.js";
import { readMergeJournal, requireNoMergeJournal, retireMergeJournal } from "./merge-journal.js";
import { mergeSync } from "./merged-sync.js";
import { readRemoteSnapshot, readSnapshotForHead, requireCompatibleRemoteSelection } from "./remote-snapshot.js";
import { throwIfAborted } from "./signals.js";
import { createSyncDecision } from "./sync-decision.js";
import { errorMessage } from "./sync-errors.js";

import { backupLocal, captureMutationOwner, protectedSessionPaths } from "./sync-local.js";
import { inspectRemoteSelection } from "./sync-policy.js";
import {
  canPullRemoteSessionsOnFirstSync,
  canPullRemoteSettingsOnFirstSync,
  fileHashMap,
  hasLocalChanges,
  hasRemoteChanges,
  remoteChangedSinceState,
  sameHashes,
  shouldRefreshSyncedState,
  snapshotHashesMatchState,
  snapshotsMatch,
  syncPolicyChanged,
} from "./sync-state.js";

const VERSION = 1;
const POST_LOCAL_COMMIT_TIMEOUT_MS = 30_000;

export class PublicationStatePersistenceError extends Error {
  readonly head: RemoteHead;
  readonly backupPath?: string;

  constructor(head: RemoteHead, cause: unknown, backupPath?: string) {
    super(
      `Remote publication ${head.snapshotId} is active, but local sync state could not be saved${backupPath ? `; local backup: ${backupPath}` : ""}: ${errorMessage(cause)}`,
      { cause },
    );
    this.name = "PublicationStatePersistenceError";
    this.head = head;
    this.backupPath = backupPath;
  }
}

export class RollbackPublicationError extends Error {
  readonly backupPath: string;

  constructor(backupPath: string, cause: unknown) {
    super(`Rollback applied locally with backup ${backupPath}, but remote publication failed: ${errorMessage(cause)}`, {
      cause,
    });
    this.name = "RollbackPublicationError";
    this.backupPath = backupPath;
  }
}

interface PushInput {
  config: AnySyncConfig;
  state: SyncState;
  local: Snapshot;
  backend?: SyncBackend;
}

export async function push(
  ctx: ExtensionCommandContext | ExtensionContext,
  options: CommandOptions,
  input?: PushInput,
  factory: SyncBackendFactory = createSyncBackend,
) {
  const config = input?.config ?? (await loadConfig(options.setup));
  throwIfAborted(options.signal);
  await requireNoMergeJournal(config, options);
  setSyncStatus(ctx, `pushing ${config.setupName}`);
  const backend = input?.backend ?? (await factory(config));
  const state = input?.state ?? (await readStateForConfig(config));
  throwIfAborted(options.signal);
  const local = input?.local ?? (await createSnapshot(config.snapshotIdentity, snapshotOptionsForContext(ctx, config)));
  throwIfAborted(options.signal);

  let head = await backend.readHead(options.signal);
  let remoteForUpload = await readRemoteSnapshotForUpload(backend, config, head, state, options.signal);
  if (
    !options.force &&
    !remoteForUpload &&
    head?.selection &&
    inspectRemoteSelection(config.include, { selection: head.selection, files: [] }).kind === "different"
  ) {
    remoteForUpload = await readSnapshotForHead(backend, head, options.signal);
  }
  if (remoteForUpload && !options.force) {
    requireCompatibleRemoteSelection(config, remoteForUpload);
  }
  if (
    remoteChangedSinceState(head, state, config, (left, right) => backend.sameRevision(left, right)) &&
    !options.force
  ) {
    const remoteForConflict = remoteForUpload ? filterSnapshotForConfigPolicy(remoteForUpload, config) : undefined;
    if (!remoteForConflict || !snapshotHashesMatchState(remoteForConflict, state, config)) {
      throw createSyncDecision({
        kind: head ? "remote-or-policy-changed" : "remote-empty",
        config,
        state,
        local,
        remote: remoteForConflict,
        localChanged: hasLocalChanges(local, state, config),
        remoteChanged: true,
        directMessage: "Remote or sync policy changed since last sync. Run /sync pull first or /sync push --force.",
      });
    }
  }

  let upload = await snapshotForUpload(backend, config, local, head, remoteForUpload, options.signal);
  if (!config.skipSecretScan) {
    const secrets = scanSnapshot(local);
    if (secrets.length > 0) {
      throw new Error(`Refusing to push possible secrets:\n${secrets.map((s) => `- ${s}`).join("\n")}`);
    }
  }

  if (!(await confirmPush(ctx, options, config, backend, local, upload, head, remoteForUpload))) {
    return "cancelled" as const;
  }

  if (options.force) {
    const refreshedHead = await backend.readHead(options.signal);
    if (!sameRemoteHead(backend, head, refreshedHead)) {
      head = refreshedHead;
      remoteForUpload = head ? await backend.readSnapshot(head.snapshotRef, options.signal) : undefined;
      upload = await snapshotForUpload(backend, config, local, head, remoteForUpload, options.signal);
      if (
        !(await confirmPush(
          ctx,
          options,
          config,
          backend,
          local,
          upload,
          head,
          remoteForUpload,
          "Remote changed during review. Push the refreshed plan?",
        ))
      ) {
        return "cancelled" as const;
      }
    }
  }

  if (await readMergeJournal(config)) {
    const current = await createSnapshot(config.snapshotIdentity, snapshotOptionsForContext(ctx, config));
    if (!sameHashes(fileHashMap(current), fileHashMap(local)))
      throw new Error("Local content changed during recovery review; retry from current bytes.");
  }
  const result = await backend.publishSnapshot(upload, expectedRemoteHead(head), {
    signal: options.signal,
    onCommit: options.onCommit,
  });
  try {
    await writeStateForConfig(config, {
      version: VERSION,
      profile: config.snapshotIdentity,
      lastAppliedSnapshot: result.head.snapshotId,
      lastRemoteRevision: result.head.revision,
      lastFileHashes: fileHashMap(local),
      include: [...config.include],
    });
  } catch (error) {
    throw new PublicationStatePersistenceError(result.head, error);
  }
  await retireMergeJournal(config);
  if (options.signal?.aborted) return;
  setSyncStatus(ctx, undefined);
  if (!options.silent) {
    ctx.ui.notify(
      [
        `Pushed ${upload.files.length} files from sync setup “${config.setupName}” as ${result.head.snapshotId}.`,
        ...result.warnings,
      ]
        .filter(Boolean)
        .join("\n"),
      result.warnings.length > 0 ? "warning" : "info",
    );
  }
  return "applied" as const;
}

export async function pull(
  ctx: ExtensionCommandContext | ExtensionContext,
  options: CommandOptions,
  factory: SyncBackendFactory = createSyncBackend,
) {
  const validateMutation = captureMutationOwner(ctx, options.signal);
  const config = await loadConfig(options.setup);
  throwIfAborted(options.signal);
  await requireNoMergeJournal(config, options);
  setSyncStatus(ctx, `pulling ${config.setupName}`);
  const backend = await factory(config);
  const state = await readStateForConfig(config);
  throwIfAborted(options.signal);
  const local = await createSnapshot(config.snapshotIdentity, snapshotOptionsForContext(ctx, config));
  throwIfAborted(options.signal);
  const { head, snapshot: remote } = await readRemoteSnapshot(backend, config, options.signal);
  throwIfAborted(options.signal);
  const localChanged = hasLocalChanges(local, state, config);
  if (!remote) {
    throw createSyncDecision({
      kind: "remote-empty",
      config,
      state,
      local,
      localChanged,
      remoteChanged: false,
      directMessage: "Remote is empty. Run /sync push from a configured machine first.",
    });
  }

  const remoteChanged = hasRemoteChanges(remote, state, config, protectedSessionPaths(ctx));
  if (localChanged && remoteChanged && state.lastAppliedSnapshot && !options.force) {
    throw createSyncDecision({
      kind: "both-changed",
      config,
      state,
      local,
      remote,
      localChanged,
      remoteChanged,
      directMessage:
        "Both local and remote changed since last sync. Run /sync diff, then choose /sync pull --force or /sync push --force.",
    });
  }

  if (
    !options.yes &&
    !(await ctx.ui.confirm(
      snapshotIncludesSessions(remote) ? "Pull pi settings and sessions?" : "Pull pi settings?",
      formatPullSummary(config, backend.destination, local, remote, protectedSessionPaths(ctx).size),
    ))
  ) {
    setSyncStatus(ctx, undefined);
    ctx.ui.notify("Pull cancelled.", "info");
    return "cancelled" as const;
  }

  throwIfAborted(options.signal);
  const recoveringMerge = Boolean(await readMergeJournal(config));
  const requireFreshRecovery = async () => {
    validateMutation();
    const currentHead = await backend.readHead(options.signal);
    validateMutation();
    const current = await createSnapshot(config.snapshotIdentity, snapshotOptionsForContext(ctx, config));
    validateMutation();
    if (!sameHashes(fileHashMap(current), fileHashMap(local)) || !sameRemoteHead(backend, head, currentHead)) {
      throw new Error("Local or remote content changed during recovery review; retry from a fresh diff.");
    }
  };
  if (recoveringMerge) await requireFreshRecovery();
  const backup = await backupLocal(config.snapshotIdentity, snapshotOptionsForContext(ctx, config), options.signal);
  const applySessionDir = await sessionDirForApply(ctx, remote);
  if (recoveringMerge) await requireFreshRecovery();
  validateMutation();
  options.onCommit?.();
  const lastFileHashes = await applySnapshot(remote, protectedSessionPaths(ctx), {
    include: config.include,
    sessionDir: applySessionDir,
    signal: options.signal,
    validateMutation,
  });
  validateMutation();
  await writeStateForConfig(config, {
    version: VERSION,
    profile: config.snapshotIdentity,
    lastAppliedSnapshot: remote.id,
    lastRemoteRevision: head?.revision,
    lastFileHashes,
    include: [...config.include],
  });
  await retireMergeJournal(config);
  if (options.signal?.aborted) return "applied" as const;
  validateMutation();
  setSyncStatus(ctx, undefined);
  if (!options.silent) {
    ctx.ui.notify(`Pulled ${remote.files.length} files from ${remote.id}. Backup: ${backup}`, "info");
  } else if (options.auto && config.include.includes("sessions") && snapshotIncludesSessions(remote)) {
    ctx.ui.notify(
      "Pulled Pi sessions after startup selected the current session. Restart Pi or resume a pulled session to use newly synced conversations.",
      "warning",
    );
  }
  if (options.reload) await maybeReload(ctx, options.signal, validateMutation);
  return "applied" as const;
}

export async function syncBoth(
  ctx: ExtensionCommandContext | ExtensionContext,
  options: CommandOptions,
  factory: SyncBackendFactory = createSyncBackend,
) {
  const config = await loadConfig(options.setup);
  throwIfAborted(options.signal);
  if (config.include.length > 0 && options.auto && config.automaticTransfer) return mergeSync(ctx, options, factory);
  if (!options.auto && config.include.length > 0 && (await readMergeJournal(config)))
    return mergeSync(ctx, options, factory);
  const state = await readStateForConfig(config);
  throwIfAborted(options.signal);
  if (!options.auto && config.include.length > 0 && state.lastAppliedSnapshot) return mergeSync(ctx, options, factory);
  const backend = await factory(config);
  const local = await createSnapshot(config.snapshotIdentity, snapshotOptionsForContext(ctx, config));
  throwIfAborted(options.signal);
  if (config.include.length === 0) {
    if (!options.silent) {
      ctx.ui.notify(
        `Sync setup “${config.setupName}” includes no files. Choose included content in /sync Settings before syncing.`,
        "warning",
      );
    }
    return;
  }
  const { head, snapshot: remote } = await readRemoteSnapshot(backend, config, options.signal);
  throwIfAborted(options.signal);
  const localChanged = hasLocalChanges(local, state, config);
  const remoteChanged = remote ? hasRemoteChanges(remote, state, config, protectedSessionPaths(ctx)) : false;
  const firstSync = !state.lastAppliedSnapshot;
  if (options.auto) throw new Error("Automatic transfer is not authorized by the current settings.");

  if (firstSync && remote && remote.files.length > 0 && local.files.length > 0) {
    if (!canPullRemoteSettingsOnFirstSync(local, remote)) {
      throw createSyncDecision({
        kind: "first-sync-settings-diverged",
        config,
        state,
        local,
        remote,
        localChanged: true,
        remoteChanged: true,
        directMessage:
          "Remote settings exist and this machine has different local Pi settings. Run /sync diff, then manually choose /sync pull or /sync push.",
      });
    }
    if (!sameHashes(fileHashMap(local), fileHashMap(remote))) {
      if (!canPullRemoteSessionsOnFirstSync(local, remote)) {
        throw createSyncDecision({
          kind: "first-sync-sessions-diverged",
          config,
          state,
          local,
          remote,
          localChanged: true,
          remoteChanged: true,
          directMessage:
            "Remote settings match, but local and remote Pi sessions differ. Run /sync diff, then manually choose /sync pull or /sync push.",
        });
      }
      await pull(ctx, options, factory);
      return;
    }
    await writeStateForConfig(config, {
      version: VERSION,
      profile: config.snapshotIdentity,
      lastAppliedSnapshot: remote.id,
      lastRemoteRevision: head?.revision,
      lastFileHashes: fileHashMap(remote),
      include: [...config.include],
    });
    if (!options.silent) ctx.ui.notify("pi-sync state initialized; local settings already match remote.", "info");
    return;
  }
  if (localChanged && remoteChanged && remote && snapshotsMatch(local, remote)) {
    await writeStateForConfig(config, {
      version: VERSION,
      profile: config.snapshotIdentity,
      lastAppliedSnapshot: remote.id,
      lastRemoteRevision: head?.revision,
      lastFileHashes: fileHashMap(remote),
      include: [...config.include],
    });
    if (!options.silent) ctx.ui.notify("pi-sync is already up to date.", "info");
    return;
  }
  if (localChanged && remoteChanged && state.lastAppliedSnapshot) {
    throw createSyncDecision({
      kind: "both-changed",
      config,
      state,
      local,
      remote,
      localChanged,
      remoteChanged,
      directMessage: "Both local and remote changed. Run /sync diff and resolve with push --force or pull --force.",
    });
  }
  if (remoteChanged) {
    await pull(ctx, options, factory);
    return;
  }
  if (localChanged || !remote) {
    await push(ctx, options, undefined, factory);
    return;
  }
  if (shouldRefreshSyncedState(remote, head, state, config, (left, right) => backend.sameRevision(left, right))) {
    await writeStateForConfig(config, {
      version: VERSION,
      profile: config.snapshotIdentity,
      lastAppliedSnapshot: remote.id,
      lastRemoteRevision: head?.revision,
      lastFileHashes: fileHashMap(remote),
      include: [...config.include],
    });
  }
  if (!options.silent) ctx.ui.notify("pi-sync is already up to date.", "info");
}

export async function rollback(
  ctx: ExtensionCommandContext,
  options: CommandOptions,
  factory: SyncBackendFactory = createSyncBackend,
  expectedSelection?: { backendIdentity: string; setup?: string },
) {
  const validateMutation = captureMutationOwner(ctx, options.signal);
  const target = options.args[0];
  if (!target) throw new Error("Usage: /sync rollback <snapshot-id> [--yes]");

  const config = await loadConfig(options.setup);
  throwIfAborted(options.signal);
  const backend = await factory(config);
  if (
    expectedSelection &&
    (backend.identity !== expectedSelection.backendIdentity || config.setupName !== expectedSelection.setup)
  ) {
    throw new Error("Sync setup or storage location changed while history was open; reopen history and retry.");
  }
  // --force is only a rollback compatibility flag, not a reviewed merge-recovery direction.
  await requireNoMergeJournal(config);
  const decoded = await backend.readSnapshot(target, options.signal);
  const selected = filterSnapshotForConfigPolicy(
    config.include.includes("sessions") ? decoded : snapshotWithoutSessions(decoded),
    config,
  );
  const remote = regenerateSnapshotIdentity(selected);
  const local = await createSnapshot(config.snapshotIdentity, snapshotOptionsForContext(ctx, config));
  const expectedHead = await backend.readHead(options.signal);
  throwIfAborted(options.signal);

  if (
    !options.yes &&
    !(await ctx.ui.confirm(
      snapshotIncludesSessions(remote) ? "Rollback pi settings and sessions?" : "Rollback pi settings?",
      formatRollbackSummary(config, backend.destination, local, remote, target, protectedSessionPaths(ctx).size),
    ))
  ) {
    ctx.ui.notify("Rollback cancelled.", "info");
    return;
  }

  throwIfAborted(options.signal);
  const backup = await backupLocal(config.snapshotIdentity, snapshotOptionsForContext(ctx, config), options.signal);
  const applySessionDir = await sessionDirForApply(ctx, remote);
  throwIfAborted(options.signal);
  options.onCommit?.();
  const lastFileHashes = await applySnapshot(remote, protectedSessionPaths(ctx), {
    include: config.include,
    sessionDir: applySessionDir,
    signal: options.signal,
    validateMutation,
  });
  validateMutation();
  let result: PublishSnapshotResult;
  try {
    const completionSignal = AbortSignal.timeout(POST_LOCAL_COMMIT_TIMEOUT_MS);
    const upload = await snapshotForUpload(backend, config, remote, expectedHead, undefined, completionSignal, {
      ignoreUnreadableRemote: true,
    });
    result = await backend.publishSnapshot(upload, expectedRemoteHead(expectedHead), {
      signal: completionSignal,
    });
  } catch (error) {
    throw new RollbackPublicationError(backup, error);
  }
  try {
    await writeStateForConfig(config, {
      version: VERSION,
      profile: config.snapshotIdentity,
      lastAppliedSnapshot: result.head.snapshotId,
      lastRemoteRevision: result.head.revision,
      lastFileHashes,
      include: [...config.include],
    });
  } catch (error) {
    throw new PublicationStatePersistenceError(result.head, error, backup);
  }
  await retireMergeJournal(config);
  if (options.signal?.aborted) return;
  validateMutation();
  ctx.ui.notify(
    [
      `Rolled back sync setup “${config.setupName}” to ${target}; latest: ${result.head.snapshotId}. Backup: ${backup}`,
      ...result.warnings,
    ]
      .filter(Boolean)
      .join("\n"),
    result.warnings.length > 0 ? "warning" : "info",
  );
  await maybeReload(ctx, options.signal, validateMutation);
}

async function maybeReload(
  ctx: ExtensionCommandContext | ExtensionContext,
  signal?: AbortSignal,
  validateMutation = captureMutationOwner(ctx, signal),
) {
  if (signal?.aborted || !("reload" in ctx)) return;
  validateMutation();
  if (
    ctx.hasUI &&
    (await ctx.ui.confirm(
      "Reload Pi resources now?",
      "This reloads extensions, skills, prompts, themes, and context files.",
    ))
  ) {
    if (signal?.aborted) return;
    validateMutation();
    await ctx.reload();
  }
}

async function readRemoteSnapshotForUpload(
  backend: SyncBackend,
  config: AnySyncConfig,
  head: RemoteHead | undefined,
  state: SyncState,
  signal?: AbortSignal,
) {
  if (
    !head ||
    (head.snapshotId === state.lastAppliedSnapshot &&
      !syncPolicyChanged(state, config) &&
      (!state.lastRemoteRevision || backend.sameRevision(head.revision, state.lastRemoteRevision)))
  ) {
    return undefined;
  }
  return backend.readSnapshot(head.snapshotRef, signal);
}

async function snapshotForUpload(
  backend: SyncBackend,
  config: AnySyncConfig,
  local: Snapshot,
  head: RemoteHead | undefined,
  remote?: Snapshot,
  signal?: AbortSignal,
  options: { ignoreUnreadableRemote?: boolean } = {},
) {
  if (!head) return local;
  let snapshot = remote;
  if (!snapshot) {
    try {
      snapshot = await backend.readSnapshot(head.snapshotRef, signal);
    } catch (error) {
      if (options.ignoreUnreadableRemote) return local;
      throw error;
    }
  }
  return mergeRemotePreservedFiles(local, snapshot, config);
}

async function confirmPush(
  ctx: ExtensionCommandContext | ExtensionContext,
  options: CommandOptions,
  config: AnySyncConfig,
  backend: SyncBackend,
  local: Snapshot,
  upload: Snapshot,
  head: RemoteHead | undefined,
  remote: Snapshot | undefined,
  title = snapshotIncludesSessions(upload) ? "Push pi settings and sessions?" : "Push pi settings?",
) {
  throwIfAborted(options.signal);
  if (options.yes) return true;
  const confirmed = await ctx.ui.confirm(
    title,
    formatPushSummary(config, backend.destination, upload, head, countPreservedRemoteFiles(local, upload), remote),
  );
  throwIfAborted(options.signal);
  if (confirmed) return true;
  setSyncStatus(ctx, undefined);
  ctx.ui.notify("Push cancelled.", "info");
  return false;
}

function sameRemoteHead(backend: SyncBackend, left: RemoteHead | undefined, right: RemoteHead | undefined) {
  if (!left || !right) return left === right;
  return backend.sameRevision(left.revision, right.revision);
}

export { backupLocal } from "./sync-local.js";
