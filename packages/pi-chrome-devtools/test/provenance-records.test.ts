import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test, vi } from "vitest";
import { createMockContext } from "../../../test/support.js";
import { createMockPi } from "./mock-pi.js";

let root: string;
let previous: string | undefined;
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "chrome-provenance-"));
  previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = root;
  vi.resetModules();
  await import("../src/chrome-devtools.js");
});
afterEach(() => {
  if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previous;
  rmSync(root, { recursive: true, force: true });
});
for (const kind of ["owned", "explicit", "unknown-version", "invalid-names", "overlap", "invalid-latest"] as const) {
  test(`provenance record ${kind} is branch-scoped and conservatively validated`, async () => {
    const { default: extension } = await import("../src/chrome-devtools.js");
    const name = "chrome_devtools_list_pages";
    const valid = {
      type: "custom",
      customType: "chrome-devtools.activation-provenance",
      data: { version: 1, explicit: [] as string[], owned: [name], future: true },
    };
    const data =
      kind === "explicit"
        ? { version: 1, explicit: [name], owned: [] }
        : kind === "unknown-version"
          ? { ...valid.data, version: 2 }
          : kind === "invalid-names"
            ? { ...valid.data, owned: ["unknown"] }
            : kind === "overlap"
              ? { ...valid.data, explicit: [name] }
              : valid.data;
    const branch = kind === "invalid-latest" ? [valid, { ...valid, data: null }] : [{ ...valid, data }];
    const snapshot = JSON.stringify(branch);
    const mock = createMockPi({ activeTools: ["other", name] });
    const { ctx } = createMockContext();
    const context = ctx as unknown as { sessionManager: object };
    context.sessionManager = { ...context.sessionManager, getBranch: () => branch };
    extension(mock.pi);
    await mock.events.get("session_start")?.[0]?.({}, ctx);
    assert.deepEqual(mock.rawPi.getActiveTools(), ["other", ...(kind === "owned" ? [] : [name])]);
    assert.equal(JSON.stringify(branch), snapshot);
    await mock.events.get("session_shutdown")?.[0]?.({}, ctx);
  });
}
