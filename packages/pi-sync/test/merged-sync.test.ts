import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { test, vi } from "vitest";
import { createMockContext } from "../../../test/support.js";
import {
  type ExpectedRemoteHead,
  type PublishSnapshotOptions,
  SyncBackendConflictError,
} from "../src/backends/sync-backend.js";
import type { CommandOptions } from "../src/commands/command-types.js";
import { loadConfig } from "../src/settings/config.js";
import { localConfigPath } from "../src/settings/config-file.js";
import { createSnapshot, regenerateSnapshotIdentity } from "../src/snapshot/snapshot.js";
import type { Snapshot } from "../src/snapshot/snapshot-types.js";
import { readStateForConfig, statePathForConfig } from "../src/state/sync-state-store.js";
import { mergeJournalPath, readMergeJournal } from "../src/sync/merge-journal.js";
import { push, syncBoth } from "../src/sync/sync-mutations.js";
import { fileHashMap } from "../src/sync/sync-state.js";
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

async function fixture(agentDir: string, backend = new MemorySyncBackend()) {
  await fs.mkdir(agentDir, { recursive: true });
  const settings = v3S3Settings({ include: ["settings.json", "AGENTS.md", "prompts"] });
  await fs.writeFile(localConfigPath(), JSON.stringify(settings));
  await fs.writeFile(path.join(agentDir, "settings.json"), '{"theme":"original"}\n');
  await fs.writeFile(path.join(agentDir, "AGENTS.md"), "original instructions\n");
  const { ctx, notifications } = createMockContext({ hasUI: true });
  await push(ctx, options, undefined, () => backend);
  const baseHead = await backend.readHead();
  assert.ok(baseHead);
  const base = await backend.readSnapshot(baseHead.snapshotRef);
  async function remoteEdit(filePath: string, content?: string) {
    const head = await backend.readHead();
    assert.ok(head);
    const current = await backend.readSnapshot(head.snapshotRef);
    const changed = snapshot(content === undefined ? [] : [{ path: filePath, content: Buffer.from(content) }]).files;
    return backend.publishSnapshot(
      regenerateSnapshotIdentity({
        ...current,
        files: [...current.files.filter((file) => file.path !== filePath), ...changed],
      }),
      { kind: "revision", revision: head.revision },
    );
  }
  return { backend, ctx, notifications, base, baseHead, remoteEdit, config: await loadConfig() };
}

test("merged sync publishes both independent edits and applies remote bytes without reload", async () =>
  withTempHome(async (agentDir) => {
    const f = await fixture(agentDir);
    await fs.writeFile(path.join(agentDir, "settings.json"), '{"theme":"local"}\n');
    await f.remoteEdit("AGENTS.md", "remote instructions\n");
    await syncBoth(f.ctx, options, () => f.backend);
    assert.equal(await fs.readFile(path.join(agentDir, "AGENTS.md"), "utf8"), "remote instructions\n");
    assert.equal(await fs.readFile(path.join(agentDir, "settings.json"), "utf8"), '{"theme":"local"}\n');
    const head = await f.backend.readHead();
    assert.ok(head);
    assert.deepEqual(
      (await readStateForConfig(f.config)).lastFileHashes,
      fileHashMap(await f.backend.readSnapshot(head.snapshotRef)),
    );
    assert.equal(await readMergeJournal(f.config), undefined);
    assert.match(f.notifications.at(-1)?.message ?? "", /No automatic reload/);
  }));

test("merged sync applies unilateral deletion and addition while retaining independent local bytes", async () =>
  withTempHome(async (agentDir) => {
    const f = await fixture(agentDir);
    await fs.writeFile(path.join(agentDir, "settings.json"), '{"local":true}\n');
    await f.remoteEdit("AGENTS.md");
    await f.remoteEdit("prompts/new.md", "remote prompt\n");
    await syncBoth(f.ctx, options, () => f.backend);
    await assert.rejects(fs.readFile(path.join(agentDir, "AGENTS.md")), { code: "ENOENT" });
    assert.equal(await fs.readFile(path.join(agentDir, "prompts/new.md"), "utf8"), "remote prompt\n");
  }));

test("true conflict prevents every publication, local apply and baseline advance", async () =>
  withTempHome(async (agentDir) => {
    const f = await fixture(agentDir);
    await fs.writeFile(path.join(agentDir, "AGENTS.md"), "local divergent\n");
    await f.remoteEdit("AGENTS.md", "remote divergent\n");
    await f.remoteEdit("prompts/new.md", "independent\n");
    const state = await readStateForConfig(f.config);
    const head = await f.backend.readHead();
    await assert.rejects(
      syncBoth(f.ctx, options, () => f.backend),
      /Conflicting or protected/,
    );
    assert.deepEqual(await readStateForConfig(f.config), state);
    assert.deepEqual(await f.backend.readHead(), head);
    await assert.rejects(fs.readFile(path.join(agentDir, "prompts/new.md")), { code: "ENOENT" });
  }));

test("review cancellation and a newer local edit never mutate the reviewed files", async () =>
  withTempHome(async (agentDir) => {
    const f = await fixture(agentDir);
    await fs.writeFile(path.join(agentDir, "settings.json"), '{"local":true}\n');
    await f.remoteEdit("AGENTS.md", "remote\n");
    const cancelled = createMockContext({ mode: "rpc", select: async () => undefined });
    assert.equal(await syncBoth(cancelled.ctx, { ...options, yes: false }, () => f.backend), "cancelled");
    const stale = createMockContext({
      mode: "rpc",
      select: async () => {
        await fs.writeFile(path.join(agentDir, "AGENTS.md"), "newer writer\n");
        return "Apply merged transfer";
      },
    });
    await assert.rejects(
      syncBoth(stale.ctx, { ...options, yes: false }, () => f.backend),
      /Local content changed during review/,
    );
    assert.equal(await fs.readFile(path.join(agentDir, "AGENTS.md"), "utf8"), "newer writer\n");
    assert.equal(await readMergeJournal(f.config), undefined);
  }));

test("unknown committed publication is reconciled once without republishing", async () =>
  withTempHome(async (agentDir) => {
    const f = await fixture(agentDir);
    await fs.writeFile(path.join(agentDir, "settings.json"), '{"local":true}\n');
    await f.remoteEdit("AGENTS.md", "remote\n");
    f.backend.failNextPublicationAfterCommit = true;
    await assert.rejects(
      syncBoth(f.ctx, options, () => f.backend),
      /interrupted.*retained/,
    );
    assert.ok(await readMergeJournal(f.config));
    const committed = await f.backend.readHead();
    const count = (await f.backend.listHistory()).length;
    await assert.rejects(
      push(f.ctx, options, undefined, () => f.backend),
      /needs recovery/,
    );
    await syncBoth(f.ctx, options, () => f.backend);
    assert.deepEqual(await f.backend.readHead(), committed);
    assert.equal((await f.backend.listHistory()).length, count);
    assert.equal(await fs.readFile(path.join(agentDir, "AGENTS.md"), "utf8"), "remote\n");
  }));

test("new local bytes after remote publication prevent apply and survive repeated recovery", async () =>
  withTempHome(async (agentDir) => {
    const f = await fixture(agentDir);
    await fs.writeFile(path.join(agentDir, "settings.json"), '{"local":true}\n');
    await f.remoteEdit("AGENTS.md", "remote\n");
    await assert.rejects(
      syncBoth(
        f.ctx,
        {
          ...options,
          onCommit: () => {
            void 0;
          },
        },
        () => ({
          ...backendFacade(f.backend),
          publishSnapshot: async (s, e, o) => {
            const result = await f.backend.publishSnapshot(s, e, o);
            await fs.writeFile(path.join(agentDir, "AGENTS.md"), "newer\n");
            return result;
          },
        }),
      ),
      /Local content changed/,
    );
    await assert.rejects(
      syncBoth(f.ctx, options, () => f.backend),
      /Local content changed/,
    );
    assert.equal(await fs.readFile(path.join(agentDir, "AGENTS.md"), "utf8"), "newer\n");
    assert.ok(await readMergeJournal(f.config));
  }));

test("state persistence obstruction retains recovery evidence", async () =>
  withTempHome(async (agentDir) => {
    const f = await fixture(agentDir);
    await fs.writeFile(path.join(agentDir, "settings.json"), '{"local":true}\n');
    await f.remoteEdit("AGENTS.md", "remote\n");
    const stateFile = statePathForConfig(f.config);
    const saved = await fs.readFile(stateFile);
    const backend = {
      ...backendFacade(f.backend),
      publishSnapshot: async (s: Snapshot, e: ExpectedRemoteHead, o?: PublishSnapshotOptions) => {
        const result = await f.backend.publishSnapshot(s, e, o);
        await fs.rm(stateFile);
        await fs.mkdir(stateFile);
        return result;
      },
    };
    await assert.rejects(syncBoth(f.ctx, options, () => backend));
    assert.ok(await readMergeJournal(f.config));
    await fs.rm(stateFile, { recursive: true });
    await fs.writeFile(stateFile, saved);
    await syncBoth(f.ctx, options, () => f.backend);
    assert.equal(await readMergeJournal(f.config), undefined);
  }));

function backendFacade(backend: MemorySyncBackend) {
  return {
    identity: backend.identity,
    destination: backend.destination,
    capability: backend.capability,
    sameRevision: backend.sameRevision.bind(backend),
    readHead: backend.readHead.bind(backend),
    readSnapshot: backend.readSnapshot.bind(backend),
    publishSnapshot: backend.publishSnapshot.bind(backend),
    listHistory: backend.listHistory.bind(backend),
    diagnose: backend.diagnose.bind(backend),
  };
}

for (const races of [1, 3])
  test(`precommit races replan with a finite bound (${races})`, async () =>
    withTempHome(async (agentDir) => {
      const f = await fixture(agentDir);
      await fs.writeFile(path.join(agentDir, "settings.json"), '{"local":true}\n');
      await f.remoteEdit("AGENTS.md", "remote\n");
      let attempts = 0;
      const backend = {
        ...backendFacade(f.backend),
        publishSnapshot: async (s: Snapshot, e: ExpectedRemoteHead, o?: PublishSnapshotOptions) => {
          if (attempts++ < races) {
            await f.remoteEdit("prompts/race.md", `race ${attempts}\n`);
            throw new SyncBackendConflictError("race");
          }
          return f.backend.publishSnapshot(s, e, o);
        },
      };
      if (races === 3)
        await assert.rejects(
          syncBoth(f.ctx, options, () => backend),
          /all three attempts/,
        );
      else await syncBoth(f.ctx, options, () => backend);
      assert.equal(attempts, races === 3 ? 3 : 2);
      assert.equal(await readMergeJournal(f.config), undefined);
    }));

test("automatic transfer rejects missing baseline and nonconditional publication", async () =>
  withTempHome(async (agentDir) => {
    const f = await fixture(agentDir);
    const settings = v3S3Settings({ include: ["settings.json", "AGENTS.md", "prompts"] });
    Object.assign(settings.syncSetups.home.sync, { automaticTransfer: true });
    await fs.writeFile(localConfigPath(), JSON.stringify(settings));
    const weak = { ...backendFacade(f.backend), capability: "read-check-write-verify" as const };
    await assert.rejects(
      syncBoth(f.ctx, { ...options, auto: true }, () => weak),
      /requires conditional/,
    );
  }));

test("merge journal is private and snapshots cannot select the operational files", async () =>
  withTempHome(async (agentDir) => {
    const f = await fixture(agentDir);
    await fs.writeFile(path.join(agentDir, "settings.json"), '{"local":true}\n');
    await f.remoteEdit("AGENTS.md", "remote\n");
    f.backend.failNextPublicationAfterCommit = true;
    await assert.rejects(syncBoth(f.ctx, options, () => f.backend));
    if (process.platform !== "win32") assert.equal((await fs.stat(mergeJournalPath(f.config))).mode & 0o777, 0o600);
    const local = await createSnapshot(f.config.snapshotIdentity, { include: f.config.include });
    assert.ok(local.files.every((file) => !file.path.includes("pi-sync") && !file.path.includes("journal")));
  }));

test("local apply and baseline-write fault boundaries recover without republishing", async () =>
  withTempHome(async (agentDir) => {
    const f = await fixture(agentDir);
    await fs.writeFile(path.join(agentDir, "settings.json"), '{"local":true}\n');
    await f.remoteEdit("AGENTS.md", "remote\n");
    await f.remoteEdit("prompts/new.md", "new\n");
    const originalRename = fs.rename.bind(fs);
    let failLocal = true;
    let failState = false;
    const spy = vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
      if (
        (failLocal && to === path.join(agentDir, "prompts/new.md")) ||
        (failState && to === statePathForConfig(f.config))
      ) {
        throw Object.assign(new Error("injected rename failure"), { code: "EACCES" });
      }
      return originalRename(from, to);
    });
    try {
      await assert.rejects(
        syncBoth(f.ctx, options, () => f.backend),
        /injected/,
      );
      assert.equal(await fs.readFile(path.join(agentDir, "AGENTS.md"), "utf8"), "remote\n");
      assert.ok(await readMergeJournal(f.config));
      const committedHead = await f.backend.readHead();
      const count = (await f.backend.listHistory()).length;
      failLocal = false;
      failState = true;
      await assert.rejects(
        syncBoth(f.ctx, options, () => f.backend),
        /injected/,
      );
      assert.equal(await fs.readFile(path.join(agentDir, "prompts/new.md"), "utf8"), "new\n");
      assert.ok(await readMergeJournal(f.config));
      failState = false;
      await syncBoth(f.ctx, options, () => f.backend);
      assert.equal(await readMergeJournal(f.config), undefined);
      assert.deepEqual(await f.backend.readHead(), committedHead);
      assert.equal((await f.backend.listHistory()).length, count);
    } finally {
      spy.mockRestore();
    }
  }));

for (const committed of [false, true])
  test(`cancellation ${committed ? "after" : "before"} backend commit retains safe recovery`, async () =>
    withTempHome(async (agentDir) => {
      const f = await fixture(agentDir);
      await fs.writeFile(path.join(agentDir, "settings.json"), '{"local":true}\n');
      await f.remoteEdit("AGENTS.md", "remote\n");
      const controller = new AbortController();
      const backend = {
        ...backendFacade(f.backend),
        publishSnapshot: async (s: Snapshot, e: ExpectedRemoteHead, o?: PublishSnapshotOptions) => {
          if (!committed) {
            controller.abort();
            throw controller.signal.reason;
          }
          const result = await f.backend.publishSnapshot(s, e, o);
          controller.abort();
          return result;
        },
      };
      await assert.rejects(syncBoth(f.ctx, { ...options, signal: controller.signal }, () => backend));
      assert.equal(await fs.readFile(path.join(agentDir, "AGENTS.md"), "utf8"), "original instructions\n");
      const count = (await f.backend.listHistory()).length;
      const result = await syncBoth(f.ctx, options, () => f.backend);
      assert.equal(result, committed ? "applied" : "cancelled");
      assert.equal((await f.backend.listHistory()).length, count);
      assert.equal(await readMergeJournal(f.config), undefined);
    }));

test("a reviewed force direction archives a stale journal without restoring newer bytes", async () =>
  withTempHome(async (agentDir) => {
    const f = await fixture(agentDir);
    await fs.writeFile(path.join(agentDir, "settings.json"), '{"local":true}\n');
    await f.remoteEdit("AGENTS.md", "remote\n");
    f.backend.failNextPublicationAfterCommit = true;
    await assert.rejects(syncBoth(f.ctx, options, () => f.backend));
    await fs.writeFile(path.join(agentDir, "AGENTS.md"), "newer chosen local\n");
    await assert.rejects(
      syncBoth(f.ctx, options, () => f.backend),
      /Local content changed/,
    );
    await push(f.ctx, { ...options, force: true }, undefined, () => f.backend);
    assert.equal(await readMergeJournal(f.config), undefined);
    assert.equal(await fs.readFile(path.join(agentDir, "AGENTS.md"), "utf8"), "newer chosen local\n");
    const archived = await fs.readdir(path.dirname(mergeJournalPath(f.config)));
    assert.ok(archived.some((name) => name.endsWith(".resolved")));
  }));

test("Pi exact-path mutation queues serialize apply behind a newer writer", async () =>
  withTempHome(async (agentDir) => {
    await fs.mkdir(agentDir, { recursive: true });
    const target = path.join(agentDir, "AGENTS.md");
    await fs.writeFile(target, "before");
    const before = snapshot([{ path: "AGENTS.md", content: Buffer.from("before") }]);
    const after = snapshot([{ path: "AGENTS.md", content: Buffer.from("approved") }]);
    const { withFileMutationQueue } = await import("@earendil-works/pi-coding-agent");
    const { applyMergedSnapshot } = await import("../src/sync/merge-apply.js");
    const { deferred } = await import("./startup-check-helpers.js");
    const held = deferred();
    const release = deferred();
    const writer = withFileMutationQueue(target, async () => {
      held.resolve();
      await release.promise;
      await fs.writeFile(target, "newer");
    });
    await held.promise;
    const applied = assert.rejects(
      applyMergedSnapshot(before, after, new Set(), { include: ["AGENTS.md"] }, async () => {}),
      /Local content changed/,
    );
    release.resolve();
    await writer;
    await applied;
    assert.equal(await fs.readFile(target, "utf8"), "newer");
  }));

test("literal prototype-named paths retain explicit missing-file semantics", async () =>
  withTempHome(async (agentDir) => {
    await fs.mkdir(agentDir, { recursive: true });
    const { applyMergedSnapshot } = await import("../src/sync/merge-apply.js");
    const before = snapshot([]);
    const after = snapshot([{ path: "constructor", content: Buffer.from("literal file") }]);
    await applyMergedSnapshot(before, after, new Set(), { include: ["constructor"] }, async () => {});
    assert.equal(await fs.readFile(path.join(agentDir, "constructor"), "utf8"), "literal file");
  }));

for (const kind of ["symlink", "hardlink"] as const)
  test(`filesystem ${kind} review barriers precede combined publication`, async () =>
    withTempHome(async (agentDir) => {
      const f = await fixture(agentDir);
      const outside = path.join(path.dirname(agentDir), "outside");
      await fs.mkdir(outside, { recursive: true });
      if (kind === "symlink") {
        await fs.mkdir(path.join(agentDir, "prompts"), { recursive: true });
        await fs.symlink(outside, path.join(agentDir, "prompts/linked"), "dir");
        await f.remoteEdit("prompts/linked/incoming.md", "incoming");
      } else {
        await fs.link(path.join(agentDir, "AGENTS.md"), path.join(outside, "linked.md"));
        await f.remoteEdit("AGENTS.md", "incoming");
      }
      await fs.writeFile(path.join(agentDir, "settings.json"), '{"local":true}');
      const publish = vi.spyOn(f.backend, "publishSnapshot");
      try {
        await assert.rejects(
          syncBoth(f.ctx, options, () => f.backend),
          /filesystem layout|hard-linked/,
        );
        assert.equal(publish.mock.calls.length, 0);
        assert.equal(await readMergeJournal(f.config), undefined);
        assert.equal(await fs.readFile(path.join(agentDir, "AGENTS.md"), "utf8"), "original instructions\n");
      } finally {
        publish.mockRestore();
      }
    }));

test("same-manager in-memory session replacement cancels reviewed authorization", async () =>
  withTempHome(async (agentDir) => {
    const f = await fixture(agentDir);
    await fs.writeFile(path.join(agentDir, "settings.json"), '{"local":true}');
    await f.remoteEdit("AGENTS.md", "remote");
    let id = "original";
    const context = createMockContext({
      mode: "rpc",
      select: async () => {
        id = "replacement";
        return "Apply merged transfer";
      },
    });
    Object.defineProperty((context.ctx as ExtensionContext).sessionManager, "getSessionId", { value: () => id });
    const publish = vi.spyOn(f.backend, "publishSnapshot");
    try {
      assert.equal(await syncBoth(context.ctx, { ...options, yes: false }, () => f.backend), "cancelled");
      assert.equal(publish.mock.calls.length, 0);
      assert.equal(await readMergeJournal(f.config), undefined);
    } finally {
      publish.mockRestore();
    }
  }));
