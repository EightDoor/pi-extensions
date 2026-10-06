import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionCommandContext, ExtensionToolContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, test, vi } from "vitest";
import { createMockContext, createMockPi } from "../../../test/support.js";
import type { Settings } from "../src/settings.js";

let root: string;
let previous: string | undefined;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "web-search-lifecycle-"));
  previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = root;
  vi.resetModules();
});
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.doUnmock("../src/settings-ui.js");
  if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previous;
  await rm(root, { recursive: true, force: true });
});
async function setup(mode = "print") {
  await writeFile(
    join(root, "pi-web-search.json"),
    JSON.stringify({ accountId: "a".repeat(32), apiToken: "TOP_SECRET" }),
    { mode: 0o600 },
  );
  const { default: extension } = await import("../src/web-search.js");
  const mock = createMockPi();
  await extension(mock.pi);
  const context = createMockContext({ mode });
  const emit = async (name: string, ctx = context.ctx) => {
    for (const handler of mock.events.get(name) ?? []) await handler({ type: name }, ctx);
  };
  await emit("session_start");
  return { ...mock, ...context, emit, tool: mock.tools.at(-1) as unknown as ToolDefinition };
}

test.each(["print", "json", "rpc"])(
  "%s command safely reports help/status and rejects arguments without TUI",
  async (mode) => {
    const h = await setup(mode);
    const command = h.commands.get("web-search");
    assert.ok(command);
    const rejections: string[] = [];
    for (const args of ["", "settings trailing"]) {
      if (mode === "print")
        await assert.rejects(command.handler(args, h.ctx) as Promise<unknown>, (error: Error) => {
          rejections.push(error.message);
          return true;
        });
      else await command.handler(args, h.ctx);
    }
    const reports = JSON.stringify(mode === "print" ? rejections : mode === "rpc" ? h.notifications : h.sentMessages);
    assert.match(reports, /pi-web-search.json/);
    assert.match(reports, /does not accept arguments/);
    assert.doesNotMatch(reports, /TOP_SECRET/);
  },
);

test.each(["session_shutdown", "session_start"])(
  "%s cancels pending network work even when headless UI is shared",
  async (event) => {
    const h = await setup();
    let ready!: () => void;
    const started = new Promise<void>((resolve) => {
      ready = resolve;
    });
    let requestSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      async (_url: string, options: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          requestSignal = options.signal as AbortSignal;
          requestSignal.addEventListener("abort", () => reject(new Error("transport")), { once: true });
          ready();
        }),
    );
    const pending = h.tool.execute(
      "call",
      { query: "news" },
      undefined,
      undefined,
      h.ctx as unknown as ExtensionToolContext,
    );
    const rejection = assert.rejects(pending, /cancelled/);
    await started;
    const replacement = createMockContext({ mode: "print" });
    Object.assign(replacement.ctx, { ui: (h.ctx as unknown as ExtensionToolContext).ui });
    await h.emit(event, event === "session_shutdown" ? h.ctx : replacement.ctx);
    await rejection;
    assert.ok(requestSignal?.aborted);
    if (event === "session_shutdown") await h.emit(event);
    else
      await assert.rejects(
        h.tool.execute("old", { query: "news" }, undefined, undefined, h.ctx as unknown as ExtensionToolContext),
        /not active/,
      );
  },
);

test("a stale shutdown cannot cancel the replacement session sharing the same headless UI", async () => {
  const h = await setup();
  const replacement = createMockContext({ mode: "print" });
  Object.assign(replacement.ctx, { ui: (h.ctx as unknown as ExtensionToolContext).ui });
  await h.emit("session_start", replacement.ctx);
  await h.emit("session_shutdown", h.ctx);
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ items: [], metadata: {} })));
  const result = await h.tool.execute(
    "new",
    { query: "news" },
    undefined,
    undefined,
    replacement.ctx as unknown as ExtensionToolContext,
  );
  assert.match(JSON.stringify(result), /No results/);
  await h.emit("session_shutdown", replacement.ctx);
  await assert.rejects(
    h.tool.execute(
      "closed",
      { query: "news" },
      undefined,
      undefined,
      replacement.ctx as unknown as ExtensionToolContext,
    ),
    /not active/,
  );
});

test("invalid session-start settings fail closed, never overwrite the file or leak secrets", async () => {
  const h = await setup();
  const invalid = '{"apiToken":"TOP_SECRET",';
  await writeFile(join(root, "pi-web-search.json"), invalid);
  await h.emit("session_start");
  await assert.rejects(
    h.tool.execute("call", { query: "news" }, undefined, undefined, h.ctx as unknown as ExtensionToolContext),
    /Invalid pi-web-search.json/,
  );
  const { readFile } = await import("node:fs/promises");
  assert.equal(await readFile(join(root, "pi-web-search.json"), "utf8"), invalid);
  assert.doesNotMatch(JSON.stringify(h.sentMessages), /TOP_SECRET/);
});

test("project settings and environment aliases do not override user settings", async () => {
  const h = await setup();
  await mkdir(join(root, ".pi"));
  await writeFile(
    join(root, ".pi", "pi-web-search.json"),
    JSON.stringify({ apiToken: "PROJECT_SECRET", exposure: "direct" }),
  );
  Object.assign(h.ctx, { cwd: root, isProjectTrusted: () => true });
  await h.emit("session_start");
  assert.equal(h.tools.at(-1)?.exposure, "codemode");
  let auth: unknown;
  vi.stubGlobal("fetch", async (_url: string, options: RequestInit) => {
    auth = options.headers;
    return new Response(JSON.stringify({ items: [], metadata: {} }));
  });
  await h.tool.execute("call", { query: "news" }, undefined, undefined, h.ctx as unknown as ExtensionToolContext);
  assert.deepEqual(auth, { Authorization: "Bearer TOP_SECRET", "Content-Type": "application/json" });
});

test.each(["success", "runtime-failure", "busy", "recovery-failure"])(
  "command persists and applies preferences safely: %s",
  async (scenario) => {
    let shown: Settings | undefined;
    let failed = false;
    vi.doMock("../src/settings-ui.js", () => ({
      showSettings: async (
        _ctx: unknown,
        current: () => Settings,
        save: (patch: Partial<Settings>, signal: AbortSignal) => Promise<void>,
        signal: AbortSignal,
      ) => {
        try {
          await save({ exposure: "direct", limit: 7 }, signal);
        } catch {
          failed = true;
        }
        shown = { ...current() };
      },
    }));
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    const h = await setup("tui");
    assert.equal(request.mock.calls.length, 0); // factory/startup never send requests
    const ctx = h.ctx as unknown as ExtensionCommandContext;
    ctx.ui.select = async () => "Settings";
    if (scenario === "busy") ctx.isIdle = () => false;
    if (scenario === "runtime-failure" || scenario === "recovery-failure") {
      const register = h.rawPi.registerTool;
      let fail = true;
      h.rawPi.registerTool = (tool) => {
        if (fail && (tool as ToolDefinition).exposure === "direct") {
          fail = false;
          throw new Error("runtime failure");
        }
        register(tool);
      };
    }
    if (scenario === "recovery-failure") {
      const { SettingsStore } = await import("../src/settings.js");
      const save = SettingsStore.prototype.save;
      let calls = 0;
      vi.spyOn(SettingsStore.prototype, "save").mockImplementation(function (
        this: InstanceType<typeof SettingsStore>,
        patch,
        signal,
      ) {
        calls++;
        return calls === 2 ? Promise.reject(new Error("disk rollback failed")) : save.call(this, patch, signal);
      });
    }
    const command = h.commands.get("web-search");
    assert.ok(command);
    await command.handler("", ctx);
    const { readFile } = await import("node:fs/promises");
    const document = JSON.parse(await readFile(join(root, "pi-web-search.json"), "utf8"));
    assert.equal(shown?.exposure, scenario === "success" ? "direct" : "codemode");
    assert.equal(failed, scenario !== "success");
    assert.equal(
      document.exposure ?? "codemode",
      scenario === "success" || scenario === "recovery-failure" ? "direct" : "codemode",
    );
    assert.equal(document.limit ?? 5, scenario === "success" || scenario === "recovery-failure" ? 7 : 5);
    if (scenario === "recovery-failure") {
      await assert.rejects(
        h.tool.execute("call", { query: "news" }, undefined, undefined, ctx as unknown as ExtensionToolContext),
        /rollback failed/,
      );
      assert.match(JSON.stringify(h.notifications), /repair pi-web-search.json/);
    }
    assert.doesNotMatch(JSON.stringify(h.notifications), /TOP_SECRET/);
  },
);
