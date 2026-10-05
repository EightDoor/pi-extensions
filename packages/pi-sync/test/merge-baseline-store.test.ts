import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "vitest";
import { loadConfig } from "../src/settings/config.js";
import { localConfigPath } from "../src/settings/config-file.js";
import { pruneMergeBaselines, readMergeAncestor, stageMergeBaseline } from "../src/state/merge-baseline-store.js";
import { statePathForConfig, syncStateFingerprint } from "../src/state/sync-state-store.js";
import { fileHashMap } from "../src/sync/sync-state.js";
import { snapshot, v3S3Settings, withTempHome } from "./helpers.js";

async function fixture(agentDir: string) {
  await fs.mkdir(agentDir, { recursive: true });
  await fs.writeFile(localConfigPath(), JSON.stringify(v3S3Settings()));
  const config = await loadConfig();
  const image = snapshot([{ path: "settings.json", content: Buffer.from('{"theme":"base"}') }]);
  const state = {
    version: 1,
    profile: image.profile,
    lastAppliedSnapshot: image.id,
    lastFileHashes: fileHashMap(image),
  };
  const directory = `${statePathForConfig(config)}.ancestors`;
  const target = path.join(directory, `${syncStateFingerprint(state)}.json`);
  return { config, image, state, directory, target };
}
test("ancestor is absent before acceptance and verified after private staging", async () =>
  withTempHome(async (root) => {
    const f = await fixture(root);
    assert.equal(await readMergeAncestor(f.config, f.state, "settings.json"), undefined);
    await stageMergeBaseline(f.config, f.image, f.state);
    assert.equal((await readMergeAncestor(f.config, f.state, "settings.json"))?.toString(), '{"theme":"base"}');
    assert.equal(await readMergeAncestor(f.config, f.state, "other.json"), undefined);
    if (process.platform !== "win32") assert.equal((await fs.stat(f.target)).mode & 0o077, 0);
    assert.equal(
      await readMergeAncestor(f.config, { ...f.state, lastRemoteRevision: "different" }, "settings.json"),
      undefined,
    );
  }));
for (const corruption of ["parser", "identity", "hash", "version"] as const) {
  test(`corrupted ${corruption} ancestor refuses without payload disclosure`, async () =>
    withTempHome(async (root) => {
      const f = await fixture(root);
      await stageMergeBaseline(f.config, f.image, f.state);
      const record = JSON.parse(await fs.readFile(f.target, "utf8"));
      if (corruption === "identity") record.identity = "other-setup";
      if (corruption === "version") record.version = 999;
      if (corruption === "hash") record.files[0].sha256 = "0".repeat(64);
      await fs.writeFile(f.target, corruption === "parser" ? '{"secret":"DO_NOT_DISCLOSE"' : JSON.stringify(record));
      await assert.rejects(readMergeAncestor(f.config, f.state, "settings.json"), (error) => {
        assert.ok(error instanceof Error);
        assert.doesNotMatch(error.message, /DO_NOT_DISCLOSE/);
        return /ancestor is invalid/.test(error.message);
      });
      assert.ok((await fs.stat(f.target)).isFile());
    }));
}
test("old ancestor survives staged next acceptance and pruning preserves unknown evidence", async () =>
  withTempHome(async (root) => {
    const f = await fixture(root);
    await stageMergeBaseline(f.config, f.image, f.state);
    const next = snapshot([{ path: "settings.json", content: Buffer.from('{"theme":"next"}') }]);
    const accepted = { ...f.state, lastFileHashes: fileHashMap(next) };
    await stageMergeBaseline(f.config, next, accepted);
    assert.equal((await readMergeAncestor(f.config, f.state, "settings.json"))?.toString(), '{"theme":"base"}');
    const unknown = path.join(f.directory, `${"f".repeat(64)}.json`);
    await fs.writeFile(unknown, "unknown evidence");
    await pruneMergeBaselines(f.config, accepted, () => {});
    assert.equal((await readMergeAncestor(f.config, accepted, "settings.json"))?.toString(), '{"theme":"next"}');
    assert.equal(await readMergeAncestor(f.config, f.state, "settings.json"), undefined);
    assert.equal(await fs.readFile(unknown, "utf8"), "unknown evidence");
  }));
test("pruning respects cancellation and unsupported formats never become ancestors", async () =>
  withTempHome(async (root) => {
    const f = await fixture(root);
    await stageMergeBaseline(f.config, f.image, f.state);
    await assert.rejects(
      pruneMergeBaselines(f.config, f.state, () => {
        throw new Error("cancelled");
      }),
      /cancelled/,
    );
    assert.ok(await readMergeAncestor(f.config, f.state, "settings.json"));
    const unsupported = snapshot([{ path: "settings.json", content: Buffer.from('{/*comment*/"theme":"x"}') }]);
    const state = { ...f.state, lastFileHashes: fileHashMap(unsupported) };
    await stageMergeBaseline(f.config, unsupported, state);
    assert.equal(await readMergeAncestor(f.config, state, "settings.json"), undefined);
  }));
