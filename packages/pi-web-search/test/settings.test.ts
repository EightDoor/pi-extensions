import assert from "node:assert/strict";
import { chmod, lstat, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, test } from "vitest";
import { DEFAULTS, normalizeSettings, SettingsStore } from "../src/settings.js";

let root: string;
let path: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "web-search-settings-"));
  path = join(root, "agent", "pi-web-search.json");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
async function document(value: unknown) {
  await mkdir(join(root, "agent"), { recursive: true });
  await writeFile(path, JSON.stringify(value), { mode: 0o600 });
}

test("missing loads are side-effect free; explicit saves create a private canonical file", async () => {
  const store = new SettingsStore(path);
  assert.deepEqual(await store.load(), DEFAULTS);
  await assert.rejects(lstat(join(root, "agent")), { code: "ENOENT" });
  await store.save({ exposure: "direct" });
  assert.equal((await store.load()).exposure, "direct");
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { exposure: "direct" });
  if (process.platform !== "win32") assert.equal((await lstat(path)).mode & 0o777, 0o600);
});

test.each([
  [],
  null,
  true,
  { limit: 0 },
  { limit: 1.2 },
  { exposure: "unknown" },
  { apiToken: "secret\n" },
  { accountId: "../escape" },
  { gatewayId: "" },
  { timeoutMs: 999 },
  { byokAlias: "bad alias" },
])("rejects invalid settings without value disclosure: %j", (value) => {
  assert.throws(() => normalizeSettings(value));
});

test("malformed, insecure, symlinked, nonregular and oversized files block reads and saves", async () => {
  await document({ apiToken: "TOP_SECRET" });
  await writeFile(path, '{"apiToken":"TOP_SECRET",');
  const store = new SettingsStore(path);
  await assert.rejects(store.load(), (error: Error) => !error.message.includes("TOP_SECRET"));
  await assert.rejects(store.save({ limit: 1 }));
  assert.equal(await readFile(path, "utf8"), '{"apiToken":"TOP_SECRET",');
  await writeFile(path, JSON.stringify({ apiToken: "TOP_SECRET" }));
  if (process.platform !== "win32") {
    await chmod(path, 0o644);
    await assert.rejects(store.load());
    await chmod(path, 0o600);
  }
  const target = join(root, "original.json");
  await writeFile(target, "{}", { mode: 0o600 });
  await rm(path);
  await symlink(target, path);
  await assert.rejects(store.save({ limit: 1 }));
  assert.equal(await readFile(target, "utf8"), "{}");
  await rm(path);
  await mkdir(path);
  await assert.rejects(store.load());
  await rm(path, { recursive: true });
  await writeFile(path, " ".repeat(65537), { mode: 0o600 });
  await assert.rejects(store.load());
});

test("patches preserve unknown fields and latest external values; replacing maintains permissions", async () => {
  await document({ future: { nested: true }, limit: 2, gatewayId: "initial" });
  const store = new SettingsStore(path);
  await store.load();
  await document({ future: { nested: false }, limit: 3, gatewayId: "external" });
  await store.save({ exposure: "hidden" });
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), {
    future: { nested: false },
    limit: 3,
    gatewayId: "external",
    exposure: "hidden",
  });
  if (process.platform !== "win32") assert.equal((await lstat(path)).mode & 0o777, 0o600);
});

test("save failures preserve the file, clean temporary files and do not poison queues", async () => {
  await document({ future: 42, limit: 2 });
  let fail = true;
  const { rename } = await import("node:fs/promises");
  const store = new SettingsStore(path, async (from, to) => {
    if (fail) throw new Error("TOP_SECRET");
    await rename(from, to);
  });
  await assert.rejects(store.save({ limit: 7 }), (error: Error) => !error.message.includes("TOP_SECRET"));
  assert.equal((await store.load()).limit, 2);
  assert.deepEqual(await readdir(join(root, "agent")), ["pi-web-search.json"]);
  fail = false;
  await store.save({ limit: 8 });
  assert.equal((await store.load()).limit, 8);
});

test("reads and flush wait for ordered saves, including other stores using the same path", async () => {
  let release!: () => void;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { rename } = await import("node:fs/promises");
  const store = new SettingsStore(path, async (from, to) => {
    started();
    await gate;
    await rename(from, to);
  });
  const first = store.save({ limit: 1 });
  await ready;
  const second = store.save({ limit: 9 });
  const reading = new SettingsStore(path).load();
  let flushed = false;
  const flush = store.flush().then(() => {
    flushed = true;
  });
  await Promise.resolve();
  assert.equal(flushed, false);
  release();
  await first;
  // A separate store's read queues behind the already-enqueued first save;
  // own-store reads additionally wait for every earlier local save.
  assert.equal((await reading).limit, 1);
  await second;
  await flush;
  assert.equal((await store.load()).limit, 9);
});

test("cancellation while waiting for mutation ownership prevents publication", async () => {
  let release!: () => void;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const lock = withFileMutationQueue(path, async () => {
    started();
    await gate;
  });
  await ready;
  const controller = new AbortController();
  const pending = new SettingsStore(path).save({ limit: 1 }, controller.signal);
  const rejection = assert.rejects(pending);
  controller.abort();
  release();
  await lock;
  await rejection;
  await assert.rejects(lstat(join(root, "agent")), { code: "ENOENT" });
});

test("cancelled saves do not publish or create defaults", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(new SettingsStore(path).save({ limit: 1 }, controller.signal));
  await assert.rejects(lstat(join(root, "agent")), { code: "ENOENT" });
});
