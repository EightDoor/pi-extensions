import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { test, vi } from "vitest";
import {
  applySnapshotTransaction,
  recoverPendingSnapshotTransactions,
  recoverSnapshotTransactionsOnStartup,
} from "../src/snapshot/snapshot-transaction.js";
import { withTempHome } from "./helpers.js";

const fileImage = (value: string) => `file:${createHash("sha256").update(value).digest("hex")}`;

for (const [version, completed] of [
  [4, true],
  [6, false],
  [6, "true"],
] as const)
  test(`completion evidence refuses version ${version} / ${completed}`, async () =>
    withTempHome(async (agentDir) => {
      const directory = path.join(agentDir, "pi-sync/transactions/pending");
      const target = path.join(agentDir, "AGENTS.md");
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(target, "newer");
      await fs.writeFile(
        path.join(directory, "journal.json"),
        JSON.stringify({
          version,
          completed,
          root: agentDir,
          entries: [
            {
              target,
              backupName: "0",
              kind: "file",
              beforeImage: fileImage("before"),
              afterImage: fileImage("after"),
              postFiles: [],
            },
          ],
        }),
      );
      await assert.rejects(recoverPendingSnapshotTransactions(), /completion evidence/);
      assert.equal(await fs.readFile(target, "utf8"), "newer");
      await fs.access(directory);
    }));

test("completed external-session cleanup needs neither backups nor current settings/root authorization", async () =>
  withTempHome(async (agentDir) => {
    const directory = path.join(agentDir, "pi-sync/transactions/pending");
    const sessionRoot = path.join(path.dirname(agentDir), "old-custom-sessions");
    const target = path.join(sessionRoot, "deleted.jsonl");
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(agentDir, "settings.json"), "invalid settings postimage");
    await fs.writeFile(
      path.join(directory, "journal.json"),
      JSON.stringify({
        version: 6,
        completed: true,
        root: agentDir,
        sessionRoot,
        entries: [
          {
            target,
            backupName: "0",
            kind: "file",
            beforeImage: fileImage("before"),
            afterImage: fileImage("after"),
            postFiles: [],
          },
        ],
      }),
    );
    await recoverSnapshotTransactionsOnStartup({ protectedTargets: [target] });
    await assert.rejects(fs.access(target), { code: "ENOENT" });
    await assert.rejects(fs.access(directory), { code: "ENOENT" });
    assert.equal(await fs.readFile(path.join(agentDir, "settings.json"), "utf8"), "invalid settings postimage");
  }));

test("failed completion publication preserves evidence without rolling back durable apply", async () =>
  withTempHome(async (agentDir) => {
    const root = path.join(agentDir, "pi-sync/transactions");
    const target = path.join(agentDir, "AGENTS.md");
    await fs.mkdir(agentDir, { recursive: true });
    await fs.writeFile(target, "before");
    const rename = fs.rename.bind(fs);
    let journalWrites = 0;
    const publication = vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
      if (String(to).endsWith("/journal.json") && ++journalWrites === 2)
        throw new Error("injected completion publication failure");
      return rename(from, to);
    });
    try {
      await assert.rejects(
        applySnapshotTransaction({ deletes: [], writes: [{ target, content: Buffer.from("after") }] }),
        /completion publication failure/,
      );
      assert.equal(await fs.readFile(target, "utf8"), "after");
      const entries = await fs.readdir(root);
      assert.equal(entries.length, 1);
      const directory = path.join(root, entries[0] as string);
      assert.equal(await fs.readFile(path.join(directory, "before/0"), "utf8"), "before");
      assert.equal(JSON.parse(await fs.readFile(path.join(directory, "journal.json"), "utf8")).completed, undefined);
    } finally {
      publication.mockRestore();
    }
  }));
