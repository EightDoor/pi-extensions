import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { test, vi } from "vitest";
import { createMockContext } from "../../../test/support.js";
import type { CommandOptions } from "../src/commands/command-types.js";
import { loadConfig } from "../src/settings/config.js";
import { localConfigPath } from "../src/settings/config-file.js";
import { validateSettingsDocument } from "../src/settings/settings-validation.js";
import { normalizeLocalFields, overlayLocalFields, portableSnapshot } from "../src/sync/local-fields.js";
import { pull, push, syncBoth } from "../src/sync/sync-mutations.js";
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
const image = (value: unknown) => snapshot([{ path: "settings.json", content: Buffer.from(JSON.stringify(value)) }]);
const object = (value: ReturnType<typeof image>) =>
  JSON.parse(Buffer.from(value.files[0]?.contentBase64 ?? "", "base64").toString());
for (const rules of ["x", ["x", "x"], ["__proto__"], ["bad\nfield"], ["defaultModel"], ["skills"], [1]]) {
  test(`invalid explicit exclusion: ${JSON.stringify(rules)}`, () => assert.throws(() => normalizeLocalFields(rules)));
}
test("portable projection omits exact fields and local overlay preserves values and absence", () => {
  const remote = portableSnapshot(image({ theme: "dark", machine: "remote-secret" }), ["machine"]);
  assert.deepEqual(object(remote), { theme: "dark" });
  assert.equal(remote.version, 2);
  assert.deepEqual(
    object(overlayLocalFields(remote, image({ theme: "light", machine: "local-secret" }), ["machine"])),
    { theme: "dark", machine: "local-secret" },
  );
  assert.deepEqual(object(overlayLocalFields(remote, image({ theme: "light" }), ["machine"])), { theme: "dark" });
  assert.throws(
    () => overlayLocalFields(snapshot([]), image({ machine: "keep" }), ["machine"]),
    /deletion requires manual review/,
  );
});
test("version 3 cannot silently enable machine-local policy", () => {
  const settings = v3S3Settings();
  Object.assign(settings.syncSetups.home.sync, { localFields: ["machine"] });
  assert.throws(() => validateSettingsDocument(settings), /version 4/);
  assert.equal(validateSettingsDocument({ ...settings, version: 4 }).version, 4);
});
async function machine(root: string, value: unknown) {
  process.env.PI_CODING_AGENT_DIR = root;
  await fs.mkdir(root, { recursive: true });
  const settings = v3S3Settings();
  Object.assign(settings.syncSetups.home.sync, { localFields: ["machine"], mergeSettings: true });
  await fs.writeFile(localConfigPath(), JSON.stringify({ ...settings, version: 4 }));
  await fs.writeFile(path.join(root, "settings.json"), JSON.stringify(value));
  return createMockContext({ hasUI: true }).ctx;
}
test("two machines converge portable fields without upload, false conflict or local-value replacement", async () =>
  withTempHome(async (root) => {
    const backend = new MemorySyncBackend();
    const a = path.join(root, "a");
    const b = path.join(root, "b");
    const first = await machine(a, { theme: "light", machine: "A-private" });
    await push(first, options, undefined, () => backend);
    const second = await machine(b, { machine: "B-private" });
    await pull(second, options, () => backend);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(b, "settings.json"), "utf8")), {
      theme: "light",
      machine: "B-private",
    });
    await fs.writeFile(path.join(b, "settings.json"), JSON.stringify({ theme: "dark", machine: "B-new-private" }));
    await push(second, options, undefined, () => backend);
    process.env.PI_CODING_AGENT_DIR = a;
    await syncBoth(first, options, () => backend);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(a, "settings.json"), "utf8")), {
      theme: "dark",
      machine: "A-private",
    });
    await syncBoth(first, options, () => backend);
    const head = await backend.readHead();
    assert.ok(head);
    const remote = await backend.readSnapshot(head.snapshotRef);
    assert.doesNotMatch(Buffer.from(remote.files[0]?.contentBase64 ?? "", "base64").toString(), /private|machine/);
  }));
test("migration cancellation and stale local review are mutation-free even with --yes", async () =>
  withTempHome(async (root) => {
    const backend = new MemorySyncBackend();
    const ctx = await machine(root, { theme: "base", machine: "keep" });
    await push(ctx, options, undefined, () => backend);
    const settings = JSON.parse(await fs.readFile(localConfigPath(), "utf8"));
    settings.syncSetups.home.sync.localFields = [];
    await fs.writeFile(localConfigPath(), JSON.stringify(settings));
    const publication = vi.spyOn(backend, "publishSnapshot");
    (ctx as ExtensionContext).ui.confirm = async () => false;
    assert.equal(await push(ctx, { ...options, force: true }, undefined, () => backend), "cancelled");
    assert.equal(publication.mock.calls.length, 0);
    (ctx as ExtensionContext).ui.confirm = async () => {
      await fs.writeFile(path.join(root, "settings.json"), '{"theme":"newer","machine":"keep"}');
      return true;
    };
    await assert.rejects(
      push(ctx, { ...options, force: true }, undefined, () => backend),
      /Local content changed/,
    );
    assert.equal(publication.mock.calls.length, 0);
    assert.equal((await loadConfig()).localFields?.length, 0);
  }));
