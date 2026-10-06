import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { test, vi } from "vitest";
import { coalesceCaseReplacements } from "../src/snapshot/snapshot-case-replacement.js";
import { applySnapshotTransaction, recoverPendingSnapshotTransactions } from "../src/snapshot/snapshot-transaction.js";
import { withTempHome } from "./helpers.js";

const image = (value: string) => `file:${createHash("sha256").update(value).digest("hex")}`;

/** Emulate only top-level case-insensitive lookup; names and durable I/O remain real. */
function caseInsensitiveLookup(root: string) {
  const readdir = fs.readdir.bind(fs);
  const spies: { mockRestore(): void }[] = [];
  async function resolve(target: unknown) {
    if (typeof target !== "string" || path.dirname(target) !== root) return target;
    const name = (await readdir(root)).find((item) => item.toLowerCase() === path.basename(target).toLowerCase());
    return name ? path.join(root, name) : target;
  }
  for (const method of ["lstat", "realpath", "readFile", "copyFile", "chmod", "open", "rm"] as const) {
    const original = fs[method];
    const spy = vi.spyOn(fs, method);
    const implementation = async (...args: unknown[]) => {
      args[0] = await resolve(args[0]);
      return Reflect.apply(original, fs, args);
    };
    // Vitest's union of overloaded fs signatures cannot express this forwarding wrapper.
    spy.mockImplementation(implementation as never);
    spies.push(spy);
  }
  const rename = fs.rename.bind(fs);
  spies.push(
    vi
      .spyOn(fs, "rename")
      .mockImplementation(async (source, destination) =>
        rename((await resolve(source)) as string, (await resolve(destination)) as string),
      ),
  );
  return () => {
    for (const spy of spies.reverse()) spy.mockRestore();
  };
}

test("native case-insensitive filesystem installs and recovers a case replacement", async ({ skip }) =>
  withTempHome(async (root) => {
    await fs.mkdir(root, { recursive: true });
    const before = path.join(root, "append_system.md");
    const after = path.join(root, "APPEND_SYSTEM.md");
    await fs.writeFile(before, "before");
    try {
      if ((await fs.realpath(before)) !== (await fs.realpath(after))) skip();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") skip();
      throw error;
    }
    const controller = new AbortController();
    const rename = fs.rename.bind(fs);
    const spy = vi.spyOn(fs, "rename").mockImplementation(async (source, destination) => {
      await rename(source, destination);
      if (String(source).endsWith(".apply") && destination === after) controller.abort();
    });
    try {
      await assert.rejects(
        applySnapshotTransaction(
          { deletes: [before], writes: [{ target: after, content: Buffer.from("after") }] },
          { signal: controller.signal },
        ),
        /cancelled/,
      );
      assert.deepEqual(
        (await fs.readdir(root)).filter((name) => name.endsWith(".md")),
        ["APPEND_SYSTEM.md"],
      );
      await recoverPendingSnapshotTransactions();
      assert.equal(await fs.readFile(before, "utf8"), "before");
      assert.deepEqual(
        (await fs.readdir(root)).filter((name) => name.endsWith(".md")),
        ["append_system.md"],
      );
    } finally {
      spy.mockRestore();
    }
  }));

for (const content of ["after", "before"])
  test(`case replacement installs canonical spelling with ${content === "before" ? "equal" : "changed"} bytes`, async () =>
    withTempHome(async (root) => {
      await fs.mkdir(root, { recursive: true });
      const before = path.join(root, "append_system.md");
      const after = path.join(root, "APPEND_SYSTEM.md");
      await fs.writeFile(before, "before");
      const restore = caseInsensitiveLookup(root);
      try {
        await applySnapshotTransaction({
          deletes: [before],
          writes: [{ target: after, content: Buffer.from(content) }],
        });
        assert.deepEqual(
          (await fs.readdir(root)).filter((name) => name.toLowerCase() === "append_system.md"),
          ["APPEND_SYSTEM.md"],
        );
        assert.equal(await fs.readFile(after, "utf8"), content);
        assert.deepEqual(await fs.readdir(path.join(root, "pi-sync/transactions")), []);
      } finally {
        restore();
      }
    }));

for (const phase of [
  "prepared",
  "removed",
  "armed-missing",
  "installed",
  "installed-equal",
  "newer",
  "deleted",
] as const)
  test(`case replacement recovery: ${phase}`, async () =>
    withTempHome(async (root) => {
      const before = path.join(root, "append_system.md");
      const after = path.join(root, "APPEND_SYSTEM.md");
      const directory = path.join(root, "pi-sync/transactions/interrupted");
      await fs.mkdir(path.join(directory, "before"), { recursive: true });
      await fs.writeFile(path.join(directory, "before/0"), "before");
      if (phase === "prepared") await fs.writeFile(before, "before");
      if (phase === "installed") await fs.writeFile(after, "after");
      if (phase === "installed-equal") await fs.writeFile(after, "before");
      if (phase === "newer") await fs.writeFile(after, "newer");
      await fs.writeFile(
        path.join(directory, "journal.json"),
        JSON.stringify({
          version: 5,
          root,
          entries: [
            {
              target: before,
              afterTarget: after,
              backupName: "0",
              kind: "file",
              beforeImage: image("before"),
              afterImage: image(phase === "installed-equal" ? "before" : "after"),
              postFiles: [],
              removalPending: phase === "removed",
              replacementStarted: !["prepared", "removed"].includes(phase),
            },
          ],
        }),
      );
      const restore = caseInsensitiveLookup(root);
      try {
        if (["armed-missing", "newer", "deleted"].includes(phase)) {
          await assert.rejects(recoverPendingSnapshotTransactions(), /unrecognized or newer/);
          await fs.access(directory);
          if (phase === "newer") assert.equal(await fs.readFile(after, "utf8"), "newer");
          else
            assert.deepEqual(
              (await fs.readdir(root)).filter((name) => name.endsWith(".md")),
              [],
            );
        } else {
          await recoverPendingSnapshotTransactions();
          assert.equal(await fs.readFile(before, "utf8"), "before");
          assert.deepEqual(
            (await fs.readdir(root)).filter((name) => name.endsWith(".md")),
            ["append_system.md"],
          );
          await assert.rejects(fs.access(directory), { code: "ENOENT" });
        }
      } finally {
        restore();
      }
    }));

for (const newer of [false, true])
  test(`interrupted actual case replacement retains one backup and ${newer ? "refuses newer bytes" : "restores original spelling"}`, async () =>
    withTempHome(async (root) => {
      await fs.mkdir(root, { recursive: true });
      const before = path.join(root, "append_system.md");
      const after = path.join(root, "APPEND_SYSTEM.md");
      await fs.writeFile(before, "before");
      const rename = fs.rename.bind(fs);
      const restore = caseInsensitiveLookup(root);
      const controller = new AbortController();
      const spy = vi.spyOn(fs, "rename").mockImplementation(async (source, destination) => {
        await rename(source, destination);
        if (String(source).endsWith(".apply") && destination === after) controller.abort();
      });
      try {
        await assert.rejects(
          applySnapshotTransaction(
            { deletes: [before], writes: [{ target: after, content: Buffer.from("after") }] },
            { signal: controller.signal },
          ),
          /cancelled/,
        );
        spy.mockRestore();
        const pending = path.join(root, "pi-sync/transactions");
        const directories = await fs.readdir(pending);
        assert.equal(directories.length, 1);
        const directory = path.join(pending, directories[0] ?? "");
        const journal = JSON.parse(await fs.readFile(path.join(directory, "journal.json"), "utf8"));
        assert.equal(journal.version, 5);
        assert.equal(journal.entries.length, 1);
        assert.equal(journal.entries[0].target, before);
        assert.equal(journal.entries[0].afterTarget, after);
        assert.equal(await fs.readFile(path.join(directory, "before/0"), "utf8"), "before");
        if (newer) await fs.writeFile(after, "newer");
        if (newer) {
          await assert.rejects(recoverPendingSnapshotTransactions(), /unrecognized or newer/);
          assert.equal(await fs.readFile(after, "utf8"), "newer");
          await fs.access(directory);
        } else {
          await recoverPendingSnapshotTransactions();
          assert.equal(await fs.readFile(before, "utf8"), "before");
          assert.deepEqual(
            (await fs.readdir(root)).filter((name) => name.endsWith(".md")),
            ["append_system.md"],
          );
        }
      } finally {
        spy.mockRestore();
        restore();
      }
    }));

for (const malformed of ["old-version", "non-file", "other-name", "other-root"] as const)
  test(`case replacement rejects ${malformed} naming evidence`, async () =>
    withTempHome(async (root) => {
      const target = path.join(root, "append_system.md");
      const directory = path.join(root, "pi-sync/transactions/interrupted");
      await fs.mkdir(path.join(directory, "before"), { recursive: true });
      await fs.writeFile(target, "before");
      await fs.writeFile(path.join(directory, "before/0"), "before");
      await fs.writeFile(
        path.join(directory, "journal.json"),
        JSON.stringify({
          version: malformed === "old-version" ? 4 : 5,
          root,
          entries: [
            {
              target,
              afterTarget:
                malformed === "other-root"
                  ? path.join(path.dirname(root), "APPEND_SYSTEM.md")
                  : path.join(root, malformed === "other-name" ? "OTHER.md" : "APPEND_SYSTEM.md"),
              backupName: "0",
              kind: malformed === "non-file" ? "directory" : "file",
              beforeImage: image("before"),
              afterImage: image("after"),
              postFiles: [],
            },
          ],
        }),
      );
      await assert.rejects(recoverPendingSnapshotTransactions(), /Invalid transaction case replacement/);
      assert.equal(await fs.readFile(target, "utf8"), "before");
      await fs.access(directory);
    }));

test("case-sensitive independent spellings keep separate targets", async () =>
  withTempHome(async (root) => {
    await fs.mkdir(root, { recursive: true });
    const before = path.join(root, "append_system.md");
    const after = path.join(root, "APPEND_SYSTEM.md");
    await fs.writeFile(before, "before");
    const plan = { deletes: [before], writes: [{ target: after, content: Buffer.from("after") }] };
    assert.equal((await coalesceCaseReplacements(root, plan)).replacements.size, 0);
    await applySnapshotTransaction(plan);
    assert.equal(await fs.readFile(after, "utf8"), "after");
    await assert.rejects(fs.access(before), { code: "ENOENT" });
  }));

for (const kind of ["symlink", "hardlink", "multiple-writes"] as const)
  test(`case replacement refuses ${kind}`, async () =>
    withTempHome(async (root) => {
      await fs.mkdir(root, { recursive: true });
      const before = path.join(root, "append_system.md");
      const after = path.join(root, "APPEND_SYSTEM.md");
      const other = path.join(root, "other.md");
      await fs.writeFile(other, "before");
      if (kind === "symlink") await fs.symlink(other, before);
      else if (kind === "hardlink") await fs.link(other, before);
      else await fs.writeFile(before, "before");
      const restore = caseInsensitiveLookup(root);
      try {
        const writes = [{ target: after, content: Buffer.from("after") }];
        if (kind === "multiple-writes") writes.push({ target: after, content: Buffer.from("different") });
        await assert.rejects(applySnapshotTransaction({ deletes: [before], writes }), /Unsafe case|Multiple writes/);
        assert.equal(await fs.readFile(before, "utf8"), "before");
        assert.equal(await fs.readFile(other, "utf8"), "before");
      } finally {
        restore();
      }
    }));
