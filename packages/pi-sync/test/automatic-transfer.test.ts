import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test, vi } from "vitest";
import { createMockContext, createMockPi } from "../../../test/support.js";
import { loadConfig } from "../src/settings/config.js";
import { localConfigPath } from "../src/settings/config-file.js";
import { updateSyncSetup } from "../src/settings/settings-management.js";
import { readLocalConfigObject } from "../src/settings/settings-store.js";
import sync from "../src/sync-extension.js";
import { v3S3Settings, withTempHome } from "./helpers.js";
import { contextUi, deferred, inspectionFixture, observeCheckCompletion } from "./startup-check-helpers.js";

async function configure(agentDir: string) {
  await fs.mkdir(agentDir, { recursive: true });
  const settings = v3S3Settings({ automatic: false });
  Object.assign(settings.syncSetups.home.sync, { automaticTransfer: true, futurePolicy: { keep: true } });
  await fs.writeFile(localConfigPath(), JSON.stringify(settings));
  await fs.writeFile(path.join(agentDir, "settings.json"), "{}\n");
}

for (const mode of ["tui", "rpc", "print", "json"] as const)
  test(`automatic-transfer ${mode} is explicit and never opens a modal`, async () =>
    withTempHome(async (agentDir) => {
      await configure(agentDir);
      const mock = createMockPi();
      let transfers = 0;
      sync(mock.pi, {
        loadSyncInspection: async () => ({ inspectSync: (config) => inspectionFixture(config) }),
        loadSyncOperations: async () => ({
          ...(await import("../src/sync/sync-operations.js")),
          syncBoth: async (_ctx, options) => {
            assert.equal(options.auto, true);
            assert.equal(options.yes, true);
            assert.equal(options.reload, false);
            transfers++;
            return "applied";
          },
        }),
      });
      const context = createMockContext({ mode });
      const done = observeCheckCompletion(context.ctx);
      const confirm = vi.spyOn(contextUi(context.ctx), "confirm");
      const custom = vi.spyOn(contextUi(context.ctx), "custom");
      await mock.events.get("session_start")?.[0]?.({}, context.ctx);
      if (mode === "tui" || mode === "rpc") await done.completed;
      await mock.events.get("session_shutdown")?.[0]?.({ reason: "reload" }, context.ctx);
      assert.equal(transfers, mode === "tui" || mode === "rpc" ? 1 : 0);
      assert.equal(confirm.mock.calls.length, 0);
      assert.equal(custom.mock.calls.length, 0);
      confirm.mockRestore();
      custom.mockRestore();
    }));

test("busy startup queues one attempt until agent_settled, not agent_end", async () =>
  withTempHome(async (agentDir) => {
    await configure(agentDir);
    const mock = createMockPi();
    let idle = false;
    let inspections = 0;
    let transfers = 0;
    sync(mock.pi, {
      loadSyncInspection: async () => ({
        inspectSync: async (config) => {
          inspections++;
          return inspectionFixture(config);
        },
      }),
      loadSyncOperations: async () => ({
        ...(await import("../src/sync/sync-operations.js")),
        syncBoth: async () => {
          transfers++;
          return "applied";
        },
      }),
    });
    const context = createMockContext({ mode: "rpc", isIdle: () => idle });
    const done = observeCheckCompletion(context.ctx);
    await mock.events.get("session_start")?.[0]?.({}, context.ctx);
    assert.equal(inspections, 0);
    assert.equal(mock.events.get("agent_end"), undefined);
    idle = true;
    await mock.events.get("agent_settled")?.[0]?.({}, context.ctx);
    await done.completed;
    await mock.events.get("agent_settled")?.[0]?.({}, context.ctx);
    assert.equal(inspections, 1);
    assert.equal(transfers, 1);
    await mock.events.get("session_shutdown")?.[0]?.({ reason: "reload" }, context.ctx);
  }));

for (const event of ["foreground", "agent_start", "replacement", "shutdown"] as const)
  test(`${event} cancels and drains automatic work before continuing`, async () =>
    withTempHome(async (agentDir) => {
      await configure(agentDir);
      const mock = createMockPi();
      const entered = deferred();
      const aborted = deferred();
      const cleanup = deferred();
      sync(mock.pi, {
        loadSyncInspection: async () => ({ inspectSync: (config) => inspectionFixture(config) }),
        loadSyncOperations: async () => ({
          ...(await import("../src/sync/sync-operations.js")),
          syncBoth: async (_ctx, options) => {
            entered.resolve();
            await new Promise<void>((resolve) =>
              options.signal?.addEventListener(
                "abort",
                () => {
                  aborted.resolve();
                  resolve();
                },
                { once: true },
              ),
            );
            await cleanup.promise;
            return "cancelled";
          },
        }),
      });
      const context = createMockContext({ mode: "rpc" });
      await mock.events.get("session_start")?.[0]?.({}, context.ctx);
      await entered.promise;
      let completed = false;
      const next =
        event === "foreground"
          ? mock.commands.get("sync")?.handler("help", context.ctx)
          : mock.events.get(
              event === "replacement" ? "session_start" : event === "shutdown" ? "session_shutdown" : "agent_start",
            )?.[0]?.({ reason: "reload" }, context.ctx);
      const drain = Promise.resolve(next).then(() => {
        completed = true;
      });
      await aborted.promise;
      assert.equal(completed, false);
      if (event === "replacement")
        await updateSyncSetup("home", (setup) => ({ ...setup, sync: { ...setup.sync, automaticTransfer: false } }));
      cleanup.resolve();
      await drain;
      await mock.events.get("session_shutdown")?.[0]?.({ reason: "reload" }, context.ctx);
      assert.equal(context.statuses.get("sync"), undefined);
    }));

test("cancelled automatic transfer does not publish its stale observation", async () =>
  withTempHome(async (agentDir) => {
    await configure(agentDir);
    const { createStartupCheck } = await import("../src/sync/startup-check.js");
    const { createSyncLoaders } = await import("../src/sync/sync-loaders.js");
    const { createSyncAttentionController } = await import("../src/ui/sync-attention.js");
    const entered = deferred();
    const attention = createSyncAttentionController();
    const publish = vi.spyOn(attention, "publish");
    const controller = createStartupCheck(
      createSyncLoaders({
        loadSyncInspection: async () => ({ inspectSync: (config) => inspectionFixture(config) }),
        loadSyncOperations: async () => ({
          ...(await import("../src/sync/sync-operations.js")),
          syncBoth: async (_ctx, options) => {
            entered.resolve();
            await new Promise<void>((resolve) =>
              options.signal?.addEventListener("abort", () => resolve(), { once: true }),
            );
            return "cancelled" as const;
          },
        }),
      }),
      attention,
    );
    const context = createMockContext({ mode: "rpc" });
    controller.start(context.ctx, new AbortController().signal, await loadConfig());
    await entered.promise;
    await controller.stop();
    assert.equal(publish.mock.calls.length, 0);
    assert.equal(context.widgets.get("sync:attention"), undefined);
  }));

test("turning off a queued policy before idle performs no transfer", async () =>
  withTempHome(async (agentDir) => {
    await configure(agentDir);
    const mock = createMockPi();
    let idle = false;
    let transfers = 0;
    sync(mock.pi, {
      loadSyncInspection: async () => ({ inspectSync: (config) => inspectionFixture(config) }),
      loadSyncOperations: async () => {
        transfers++;
        throw new Error("must not load");
      },
    });
    const context = createMockContext({ mode: "rpc", isIdle: () => idle });
    await mock.events.get("session_start")?.[0]?.({}, context.ctx);
    await updateSyncSetup("home", (setup) => ({ ...setup, sync: { ...setup.sync, automaticTransfer: false } }));
    idle = true;
    const done = observeCheckCompletion(context.ctx);
    await mock.events.get("agent_settled")?.[0]?.({}, context.ctx);
    await done.completed;
    await mock.events.get("session_shutdown")?.[0]?.({ reason: "reload" }, context.ctx);
    assert.equal(transfers, 0);
  }));

for (const barrier of ["firstSync", "missingRemote", "selection"] as const)
  test(`${barrier} remains a startup review barrier`, async () =>
    withTempHome(async (agentDir) => {
      await configure(agentDir);
      const mock = createMockPi();
      let transfers = 0;
      sync(mock.pi, {
        loadSyncInspection: async () => ({
          inspectSync: (config) =>
            inspectionFixture(
              config,
              barrier === "firstSync"
                ? { firstSync: true }
                : barrier === "missingRemote"
                  ? { head: undefined }
                  : {
                      selectionState: {
                        kind: "different",
                        include: ["AGENTS.md"],
                        remoteOnly: ["AGENTS.md"],
                        localOnly: ["settings.json"],
                      },
                    },
            ),
        }),
        loadSyncOperations: async () => {
          transfers++;
          throw new Error("must not load");
        },
      });
      const context = createMockContext({ mode: "rpc" });
      const done = observeCheckCompletion(context.ctx);
      await mock.events.get("session_start")?.[0]?.({}, context.ctx);
      await done.completed;
      assert.equal(transfers, 0);
      assert.ok(context.notifications.some((item) => /review|baseline|missing/i.test(item.message)));
      await mock.events.get("session_shutdown")?.[0]?.({ reason: "reload" }, context.ctx);
    }));

test("automatic-transfer writes are validated, ordered, private and preserve unknown policy", async () =>
  withTempHome(async (agentDir) => {
    await configure(agentDir);
    const first = updateSyncSetup("home", (setup) => ({ ...setup, sync: { ...setup.sync, automaticTransfer: false } }));
    const second = updateSyncSetup("home", (setup) => ({ ...setup, sync: { ...setup.sync, automaticTransfer: true } }));
    await Promise.all([first, second]);
    assert.equal((await loadConfig()).automaticTransfer, true);
    assert.deepEqual((await readLocalConfigObject())?.syncSetups.home?.sync.futurePolicy, { keep: true });
    const before = await fs.readFile(localConfigPath());
    await assert.rejects(
      updateSyncSetup("home", (setup) => ({
        ...setup,
        sync: { ...setup.sync, automaticTransfer: "yes" as unknown as boolean },
      })),
      /must be boolean/,
    );
    assert.deepEqual(await fs.readFile(localConfigPath()), before);
    if (process.platform !== "win32") assert.equal((await fs.stat(localConfigPath())).mode & 0o777, 0o600);
  }));
