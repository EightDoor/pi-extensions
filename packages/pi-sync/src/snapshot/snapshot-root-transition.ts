import fs from "node:fs/promises";
import path from "node:path";
import { isPathInside } from "../paths.js";
import { expandSessionDir } from "./session-paths.js";
import { sessionStorageRoot } from "./snapshot-paths.js";
import { fileImage } from "./snapshot-transaction-plan.js";
import type { SnapshotApplyPlan } from "./snapshot-types.js";

export interface SessionRootTransition {
  beforeRoot: string;
  /** null is a verified missing postimage, never an empty settings file. */
  settingsAfterBase64: string | null;
}
interface TransitionGuards {
  signal?: AbortSignal;
  validateMutation?: () => void;
}
function validateOwner(guards: TransitionGuards) {
  guards.validateMutation?.();
  guards.signal?.throwIfAborted();
}
interface SettingsEntry {
  target: string;
  afterTarget?: string;
  backupName: string;
  kind: string;
  beforeImage?: string;
  afterImage?: string;
}

function rootFromSettings(root: string, bytes: Buffer) {
  let settings: unknown;
  try {
    settings = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error("Invalid settings root-transition evidence.");
  }
  if (!settings || typeof settings !== "object" || Array.isArray(settings))
    throw new Error("Invalid settings root-transition evidence.");
  const value = (settings as { sessionDir?: unknown }).sessionDir;
  if (value !== undefined && typeof value !== "string") throw new Error("Invalid settings root-transition evidence.");
  return path.resolve(sessionStorageRoot(root, value ? expandSessionDir(value) : undefined));
}

async function beforeRoot(directory: string, root: string, entry: SettingsEntry, guards: TransitionGuards) {
  validateOwner(guards);
  if (entry.kind === "missing" && entry.beforeImage === "missing") return path.join(root, "sessions");
  if (entry.kind !== "file") throw new Error("Root transition requires regular settings preimage evidence.");
  const backup = path.join(directory, "before", entry.backupName);
  const stat = await fs.lstat(backup);
  validateOwner(guards);
  if (!stat.isFile() || stat.size > 32 * 1024 * 1024) throw new Error("Invalid settings root-transition backup.");
  const bytes = await fs.readFile(backup);
  validateOwner(guards);
  if (fileImage(bytes) !== entry.beforeImage) throw new Error("Changed settings root-transition backup.");
  return rootFromSettings(root, bytes);
}

export async function prepareSessionRootTransition(
  directory: string,
  root: string,
  sessionRoot: string,
  entries: SettingsEntry[],
  plan: SnapshotApplyPlan,
  guards: TransitionGuards = {},
): Promise<SessionRootTransition | undefined> {
  const settingsTarget = path.join(root, "settings.json");
  const entry = entries.find((item) => item.target === settingsTarget || item.afterTarget === settingsTarget);
  const write = plan.writes.find((item) => item.target === settingsTarget || item.target === entry?.target);
  if (!entry || !entries.some((item) => item !== entry && isPathInside(sessionRoot, item.target))) return undefined;
  const deleted = !write && plan.deletes.includes(entry.target) && entry.afterImage === "missing";
  if (!write && !deleted) return undefined;
  const afterRoot = write ? rootFromSettings(root, write.content) : path.join(root, "sessions");
  // An explicit context root is not a settings-driven transition.
  if (afterRoot !== sessionRoot) return undefined;
  const previous = await beforeRoot(directory, root, entry, guards);
  if (previous === sessionRoot) return undefined;
  if (write && fileImage(write.content) !== entry.afterImage) throw new Error("Changed settings transition postimage.");
  return { beforeRoot: previous, settingsAfterBase64: write ? write.content.toString("base64") : null };
}

export function validateSessionRootTransition(value: SessionRootTransition) {
  if (
    !value ||
    typeof value.beforeRoot !== "string" ||
    !path.isAbsolute(value.beforeRoot) ||
    path.resolve(value.beforeRoot) !== value.beforeRoot ||
    (value.settingsAfterBase64 !== null &&
      (typeof value.settingsAfterBase64 !== "string" ||
        value.settingsAfterBase64.length > 32 * 1024 * 1024 ||
        Buffer.from(value.settingsAfterBase64, "base64").toString("base64") !== value.settingsAfterBase64))
  )
    throw new Error("Invalid session root-transition evidence.");
}

/** Authorization is bound to both settings images, never just an arbitrary pinned root. */
export async function resolveTransitionSessionRoot(
  directory: string,
  root: string,
  sessionRoot: string,
  transition: SessionRootTransition,
  entries: SettingsEntry[],
  currentRoot: string,
  guards: TransitionGuards = {},
) {
  const settingsTarget = path.join(root, "settings.json");
  const entry = entries.find((item) => item.target === settingsTarget || item.afterTarget === settingsTarget);
  if (!entry) throw new Error("Missing settings root-transition evidence.");
  const after =
    transition.settingsAfterBase64 === null ? undefined : Buffer.from(transition.settingsAfterBase64, "base64");
  if (
    (after ? fileImage(after) : "missing") !== entry.afterImage ||
    (after ? rootFromSettings(root, after) : path.join(root, "sessions")) !== sessionRoot ||
    (await beforeRoot(directory, root, entry, guards)) !== transition.beforeRoot
  )
    throw new Error("Inconsistent settings root-transition evidence.");
  if (currentRoot !== transition.beforeRoot && currentRoot !== sessionRoot)
    throw new Error("Transaction session root is not owned by this context; preserve evidence for review.");
  return sessionRoot;
}
