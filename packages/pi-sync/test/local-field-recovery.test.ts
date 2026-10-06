import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "vitest";
import { createMockContext } from "../../../test/support.js";
import type { CommandOptions } from "../src/commands/command-types.js";
import { loadConfig } from "../src/settings/config.js";
import { localConfigPath } from "../src/settings/config-file.js";
import { updateLocalConfig } from "../src/settings/settings-store.js";
import { createSnapshot, regenerateSnapshotIdentity } from "../src/snapshot/snapshot.js";
import { readStateForConfig, syncStateFingerprint } from "../src/state/sync-state-store.js";
import { overlayLocalFields, portableSnapshot } from "../src/sync/local-fields.js";
import {
  mergeJournalIdentity,
  mergeJournalPath,
  readMergeJournal,
  writeMergeJournal,
} from "../src/sync/merge-journal.js";
import { push, syncBoth } from "../src/sync/sync-mutations.js";
import { snapshot, v3S3Settings, withTempHome } from "./helpers.js";
import { MemorySyncBackend } from "./memory-sync-backend.js";

const options: CommandOptions = {
  args: [],
  yes: true,
  force: false,
  stale: false,
  silent: false,
  reload: false,
  auto: false,
};
async function fixture(root: string, fields: string[] | undefined, committed: boolean, legacyIdentity = false) {
  await fs.mkdir(root, { recursive: true });
  const settings = v3S3Settings();
  if (fields !== undefined) Object.assign(settings.syncSetups.home.sync, { localFields: fields });
  await fs.writeFile(localConfigPath(), JSON.stringify({ ...settings, version: fields === undefined ? 3 : 4 }));
  const bytes = '{"theme":"base"}';
  await fs.writeFile(path.join(root, "settings.json"), bytes);
  const { ctx } = createMockContext({ hasUI: true });
  const backend = new MemorySyncBackend();
  await push(ctx, options, undefined, () => backend);
  const config = await loadConfig();
  const state = await readStateForConfig(config);
  const head = await backend.readHead();
  assert.ok(head);
  const before = await createSnapshot(config.snapshotIdentity, { include: config.include });
  const accepted = portableSnapshot(
    regenerateSnapshotIdentity({
      ...before,
      files: snapshot([{ path: "settings.json", content: Buffer.from('{"theme":"remote"}') }]).files,
    }),
    fields,
  );
  const after = overlayLocalFields(accepted, before, fields);
  const committedHead = committed
    ? (await backend.publishSnapshot(accepted, { kind: "revision", revision: head.revision })).head
    : undefined;
  const identity = legacyIdentity
    ? JSON.stringify([config.setupName, backend.identity, [...config.include].sort(), fields ?? []])
    : mergeJournalIdentity(config, backend.identity);
  await writeMergeJournal(config, {
    version: 1,
    identity,
    before,
    after,
    accepted,
    upload: accepted,
    expectedHead: head,
    ...(committedHead ? { committedHead } : {}),
    backup: "retained-backup",
    stateIdentity: syncStateFingerprint(state),
  });
  assert.ok(await readMergeJournal(config));
  return {
    ctx,
    config,
    backend,
    state,
    bytes,
    journalBytes: await fs.readFile(mergeJournalPath(config)),
    head: await backend.readHead(),
  };
}

for (const committed of [false, true]) {
  for (const [beforePolicy, afterPolicy, legacy] of [
    [undefined, [], false],
    [[], undefined, false],
    [undefined, [], true],
    [undefined, undefined, true],
    [[], ["machine"], false],
    [["machine"], [], false],
  ] as const) {
    test(`policy transition preserves ${committed ? "committed" : "unpublished"} journal (${JSON.stringify(beforePolicy)} -> ${JSON.stringify(afterPolicy)}, legacy=${legacy})`, async () =>
      withTempHome(async (root) => {
        const f = await fixture(root, beforePolicy === undefined ? undefined : [...beforePolicy], committed, legacy);
        await updateLocalConfig((current) => {
          const setup = current.syncSetups.home;
          assert.ok(setup);
          const sync = { ...setup.sync };
          if (afterPolicy === undefined) delete sync.localFields;
          else sync.localFields = [...afterPolicy];
          return { ...current, version: 4, syncSetups: { ...current.syncSetups, home: { ...setup, sync } } };
        });
        await assert.rejects(
          syncBoth(f.ctx, options, () => f.backend),
          /different setup, selection or local-field policy|Invalid accepted merge projection/,
        );
        assert.equal(await fs.readFile(path.join(root, "settings.json"), "utf8"), f.bytes);
        assert.deepEqual(await readStateForConfig(f.config), f.state);
        assert.deepEqual(await f.backend.readHead(), f.head);
        assert.deepEqual(await fs.readFile(mergeJournalPath(f.config)), f.journalBytes);
      }));
  }
  for (const policy of [undefined, [], ["machine"]]) {
    test(`matching policy ${JSON.stringify(policy)} permits ${committed ? "committed" : "unpublished"} journal recovery`, async () =>
      withTempHome(async (root) => {
        const f = await fixture(root, policy, committed);
        assert.equal(await syncBoth(f.ctx, options, () => f.backend), committed ? "applied" : "cancelled");
        assert.equal(await readMergeJournal(f.config), undefined);
        assert.equal(
          JSON.parse(await fs.readFile(path.join(root, "settings.json"), "utf8")).theme,
          committed ? "remote" : "base",
        );
        if (committed) {
          assert.deepEqual((await readStateForConfig(f.config)).localFields, policy);
          await syncBoth(f.ctx, options, () => f.backend);
        } else assert.deepEqual(await readStateForConfig(f.config), f.state);
      }));
  }
}
