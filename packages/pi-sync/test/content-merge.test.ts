import assert from "node:assert/strict";
import { test } from "vitest";
import { mergeSession, validateSession } from "../src/sync/session-merge.js";
import { isMergeTextPath, mergeText } from "../src/sync/text-merge.js";

const b = (value: string) => Buffer.from(value);
for (const [name, base, local, remote, expected] of [
  ["independent", "a\nb\nc\n", "A\nb\nc\n", "a\nb\nC\n", "A\nb\nC\n"],
  ["same edit", "a\nb\n", "A\nb\n", "A\nb\n", "A\nb\n"],
  ["disjoint deletions", "a\nb\nc\nd\n", "b\nc\nd\n", "a\nb\nc\n", "b\nc\n"],
  ["CRLF", "a\r\nb\r\nc\r\n", "A\r\nb\r\nc\r\n", "a\r\nb\r\nC\r\n", "A\r\nb\r\nC\r\n"],
  ["trailing", "a\nb\nc", "A\nb\nc", "a\nb\nC", "A\nb\nC"],
  ["overlap", "a\nb\n", "A\nb\n", "X\nb\n", undefined],
  ["same insertion point", "a\nb\n", "a\nL\nb\n", "a\nR\nb\n", undefined],
  ["delete modify", "a\nb\n", "a\n", "a\nB\n", undefined],
] as const)
  test(`text ${name}`, () => assert.equal(mergeText(b(base), b(local), b(remote))?.toString(), expected));
test("binary, invalid UTF-8, complexity and size bounds withhold merge", () => {
  assert.equal(mergeText(b("a"), Buffer.from([255]), b("b")), undefined);
  assert.equal(mergeText(b("a"), b("a\u0000"), b("b")), undefined);
  assert.equal(mergeText(b("a"), b("x".repeat(1024 * 1024 + 1)), b("b")), undefined);
  assert.equal(mergeText(b("x\n".repeat(2500)), b("a\n".repeat(2500)), b("b\n")), undefined);
  assert.equal(isMergeTextPath("keybindings.json"), false);
  assert.equal(isMergeTextPath("extensions/runtime.ts"), false);
});
const header = { type: "session", version: 3, id: "session-one", cwd: "/tmp", timestamp: "2026-10-05T00:00:00Z" };
const entry = (id: string, parentId: string | null) => ({
  type: "message",
  id,
  parentId,
  timestamp: header.timestamp,
  message: { role: "user", content: "hello", timestamp: 1 },
});
const log = (...rows: unknown[]) => b(`${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
const base = log(header, entry("root", null));
const longer = log(header, entry("root", null), entry("next", "root"));
const longest = log(header, entry("root", null), entry("next", "root"), entry("last", "next"));
test("sessions accept only comparable complete byte-prefix histories", () => {
  assert.deepEqual(mergeSession(base, longer, longest), longest);
  assert.deepEqual(mergeSession(base, longest, longer), longest);
  assert.equal(mergeSession(base, longer, log(header, entry("root", null), entry("other", "root"))), undefined);
});
for (const [name, bytes] of [
  ["partial", longer.subarray(0, longer.length - 1)],
  ["malformed tail", Buffer.concat([base, b("broken\n")])],
  ["blank", Buffer.concat([base, b("\n")])],
  [
    "duplicate JSON key",
    Buffer.concat([
      base,
      b(
        '{"type":"message","id":"a","id":"b","parentId":"root","timestamp":"now","message":{"role":"user","content":"secret","timestamp":1}}\n',
      ),
    ]),
  ],
  ["record BOM", Buffer.concat([base, b(`\uFEFF${JSON.stringify(entry("new", "root"))}\n`)])],
  ["old version", log({ ...header, version: 2 }, entry("root", null))],
  ["future version", log({ ...header, version: 4 }, entry("root", null))],
  ["duplicate", log(header, entry("root", null), entry("root", "root"))],
  ["missing parent", log(header, entry("root", null), entry("next", "missing"))],
  ["second root", log(header, entry("root", null), entry("next", null))],
  ["unknown kind", log(header, { ...entry("root", null), type: "future" })],
] as const)
  test(`session refuses ${name}`, () => {
    if (name === "duplicate JSON key") assert.throws(() => validateSession(bytes), /Unsupported JSON object/);
    else assert.throws(() => validateSession(bytes));
    assert.equal(mergeSession(base, longer, bytes), undefined);
  });
test("identity or immutable prefix change never joins sessions", () => {
  assert.equal(mergeSession(base, longer, log({ ...header, id: "other" }, entry("root", null))), undefined);
  assert.equal(mergeSession(base, longer, log({ ...header, cwd: "/changed" }, entry("root", null))), undefined);
});
