import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createSyncBackend, type SyncBackendFactory } from "../backends/backend-factory.js";
import type { CommandOptions } from "../commands/command-types.js";
import { loadConfig, syncCheckConfigFingerprint } from "../settings/config.js";
import { readStateForConfig, syncStateFingerprint } from "../state/sync-state-store.js";
import { confirmMergeReview } from "../ui/merge-review.js";
import { safeTerminalText } from "../ui/terminal-text.js";
import { conflictArtifactFingerprint, readConflictArtifact } from "./conflict-artifacts.js";
import { mergeSync } from "./merged-sync.js";
import { captureMutationOwner } from "./sync-local.js";
export async function showConflicts(
  ctx: ExtensionContext,
  options: CommandOptions,
  factory: SyncBackendFactory = createSyncBackend,
) {
  const validate = captureMutationOwner(ctx, options.signal);
  const config = await loadConfig(options.setup);
  validate();
  const state = await readStateForConfig(config);
  validate();
  if (!state.unresolved?.length) {
    ctx.ui.notify("No recorded unresolved conflict groups.", "info");
    return;
  }
  if (!ctx.hasUI) {
    ctx.ui.notify(
      `${state.unresolved.length} conflict groups remain unresolved. Review with TUI/RPC; no transfer performed.`,
      "warning",
    );
    return;
  }
  const backend = await factory(config);
  validate();
  const labels = state.unresolved.map(
    (group, index) => `${index + 1}: ${group.paths.length} paths · ${group.paths.map(safeTerminalText).join(", ")}`,
  );
  const choice = await ctx.ui.select("Review unresolved dependency group", [...labels, "Keep all unresolved"], {
    signal: options.signal,
  });
  validate();
  const index = labels.indexOf(choice ?? "");
  if (index < 0) return;
  const reference = state.unresolved[index];
  if (!reference) return;
  const artifact = await readConflictArtifact(config, backend.identity, reference.artifact);
  validate();
  const groupIndex = artifact.groups.findIndex(
    (group) => JSON.stringify(group.paths) === JSON.stringify(reference.paths),
  );
  if (groupIndex < 0) throw new Error("Conflict reference is stale; refresh sync.");
  const version = (source: typeof artifact.local.files, filePath: string) => {
    const file = source.find((item) => item.path === filePath);
    if (!file) return "(absent)";
    const bytes = Buffer.from(file.contentBase64, "base64");
    const value = bytes.toString("utf8");
    return [`sha256: ${file.sha256}`, Buffer.from(value).equals(bytes) ? value : `base64: ${file.contentBase64}`].join(
      "\n",
    );
  };
  const body = [
    `Storage: ${safeTerminalText(backend.destination)}`,
    "Private conflict versions. Historical artifact is not authority for changed bytes/head. No automatic activation.",
    ...reference.paths.flatMap((filePath) => [
      `Path: ${safeTerminalText(filePath)}`,
      "Base:",
      artifact.state.lastFileHashes[filePath] && !artifact.ancestors?.some((file) => file.path === filePath)
        ? `(verified ancestor unavailable; sha256: ${artifact.state.lastFileHashes[filePath]})`
        : version(artifact.ancestors ?? [], filePath),
      "Local:",
      version(artifact.local.files, filePath),
      "Remote:",
      version(artifact.remote.files, filePath),
    ]),
  ].join("\n");
  if (Buffer.byteLength(body) > 2 * 1024 * 1024)
    throw new Error(
      "Conflict review exceeds the 2 MiB display bound; inspect private evidence and use a reviewed explicit direction.",
    );
  if (
    !(await confirmMergeReview(
      ctx,
      "Review private conflict versions",
      body.split("\n").map(safeTerminalText).join("\n"),
      options.signal,
      () => {
        try {
          validate();
          return true;
        } catch {
          return false;
        }
      },
      "Continue to resolution choices",
    ))
  )
    return;
  validate();
  const decision = await ctx.ui.select(
    "Resolve the entire reviewed group",
    ["Keep unresolved", "Use local group", "Use remote group"],
    { signal: options.signal },
  );
  validate();
  if (decision !== "Use local group" && decision !== "Use remote group") return;
  if (syncCheckConfigFingerprint(config) !== syncCheckConfigFingerprint(await loadConfig(options.setup)))
    throw new Error("Settings changed during conflict review.");
  validate();
  await mergeSync(ctx, { ...options, yes: false, auto: false }, factory, {
    token: reference.artifact,
    group: groupIndex,
    source: decision === "Use local group" ? "local" : "remote",
    stateIdentity: syncStateFingerprint(state),
    artifactIdentity: conflictArtifactFingerprint(artifact),
  });
  validate();
}
