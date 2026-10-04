import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ExtensionCommandContext, initTheme } from "@earendil-works/pi-coding-agent";
import { test } from "vitest";
import { createCustomSelectorHarness, createMockContext } from "../../../test/support.js";
import { createUsageSettingsRuntime } from "../src/settings.js";
import { showUsageSettings } from "../src/usage-settings-ui.js";

initTheme("dark");

for (const mode of ["accept", "decline", "cancel consent", "save failure"] as const) {
  test(`companion setting ${mode} requires explicit disclosure and safe publication`, async () => {
    const root = await mkdtemp(join(tmpdir(), "usage-companion-setting-"));
    const path = join(root, "pi-usage.json");
    await writeFile(path, JSON.stringify({ unrelated: { preserved: true } }));
    const runtime = createUsageSettingsRuntime(
      mode === "save failure"
        ? {
            path,
            operations: {
              rename: async () => {
                throw new Error("disk unavailable");
              },
            },
          }
        : path,
    );
    await runtime.reload();
    let consent = "";
    let applied = 0;
    let latest = "";
    const controller = new AbortController();
    const context = createMockContext({
      mode: "tui",
      hasUI: true,
      custom: async (factory: unknown) => {
        const harness = createCustomSelectorHarness(factory);
        try {
          for (let index = 0; index < 3; index++) harness.handleInput("\u001b[B");
          harness.handleInput("\r");
          // Observe persisted state (or the error notification), never assume save timing.
          for (let index = 0; index < 100; index++) {
            await new Promise<void>((resolve) => setImmediate(resolve));
            if (
              runtime.get().settings.openaiCompanionUsage ||
              context.notifications.length ||
              mode === "decline" ||
              mode === "cancel consent"
            )
              break;
          }
          latest = harness.render().join("\n");
          harness.handleInput("\u0003");
          return (await harness.resultPromise) as boolean;
        } finally {
          harness.dispose();
        }
      },
    });
    Object.assign((context.ctx as ExtensionCommandContext).ui, {
      confirm: async (title: string, message: string, options: { signal: AbortSignal }) => {
        consent = `${title} ${message}`;
        assert.equal(options.signal.aborted, false);
        if (mode === "cancel consent") controller.abort();
        return mode !== "decline";
      },
    });
    try {
      const changed = await showUsageSettings(
        context.ctx,
        runtime,
        controller.signal,
        () => true,
        () => applied++,
      );
      assert.match(consent, /undocumented/);
      assert.match(consent, /not independent proof/);
      assert.match(consent, /same ChatGPT account\/workspace/);
      assert.equal(changed, mode === "accept");
      assert.equal(applied, mode === "accept" ? 1 : 0);
      assert.equal(runtime.get().settings.openaiCompanionUsage, mode === "accept");
      const saved = JSON.parse(await readFile(path, "utf8"));
      assert.deepEqual(saved.unrelated, { preserved: true });
      if (mode === "accept") assert.equal(saved.openaiCompanionUsage, true);
      else assert.equal(saved.openaiCompanionUsage, undefined);
      if (mode === "save failure") {
        assert.match(context.notifications[0]?.message ?? "", /disk unavailable/);
        assert.match(latest, /companion usage.*Off/s);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
