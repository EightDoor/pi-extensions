import assert from "node:assert/strict";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ExtensionCommandContext, initTheme } from "@earendil-works/pi-coding-agent";
import { test } from "vitest";
import { createCustomSelectorHarness, createMockContext } from "../../../test/support.js";
import { createUsageSettingsRuntime } from "../src/settings.js";
import { showUsageSettings } from "../src/usage-settings-ui.js";

initTheme("dark");

for (const mode of ["accept", "decline", "cancel consent", "cancel publication", "save failure"] as const) {
  test(`companion setting ${mode} requires explicit disclosure and safe publication`, async () => {
    const root = await mkdtemp(join(tmpdir(), "usage-companion-setting-"));
    const path = join(root, "pi-usage.json");
    await writeFile(path, JSON.stringify({ unrelated: { preserved: true } }));
    let entered!: () => void;
    const saveEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release!: () => void;
    const publication = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runtime = createUsageSettingsRuntime({
      path,
      operations: {
        rename: async (from, to) => {
          entered();
          await publication;
          if (mode === "save failure") throw new Error("disk unavailable");
          return rename(from, to);
        },
      },
    });
    await runtime.reload();
    let screenCount = 0;
    let firstScreenResult: unknown;
    let consent = "";
    let consentSignal: AbortSignal | undefined;
    let signalFreshAtConsent = false;
    let applied = 0;
    let latest = "";
    let pendingSave: { aborted: boolean | undefined; effective: boolean | undefined; result: unknown } | undefined;
    const controller = new AbortController();
    const context = createMockContext({
      mode: "tui",
      hasUI: true,
      custom: async (factory: unknown) => {
        screenCount++;
        const harness = createCustomSelectorHarness(factory);
        try {
          if (screenCount === 1) {
            for (let index = 0; index < 3; index++) harness.handleInput("\u001b[B");
            harness.handleInput("\r");
            firstScreenResult = await harness.resultPromise;
            return firstScreenResult;
          }
          latest = harness.render().join("\n");
          harness.handleInput("\u0003");
          return await harness.resultPromise;
        } finally {
          harness.dispose();
        }
      },
    });
    const ui = (context.ctx as ExtensionCommandContext).ui;
    Object.assign(ui, {
      confirm: async (title: string, message: string, options: { signal: AbortSignal }) => {
        consent = `${title} ${message}`;
        consentSignal = options.signal;
        signalFreshAtConsent = !options.signal.aborted;
        if (mode === "cancel consent") {
          controller.abort();
        }
        return mode !== "decline";
      },
    });
    try {
      const operation = showUsageSettings(
        context.ctx,
        runtime,
        controller.signal,
        () => true,
        () => {
          applied++;
        },
      );
      if (mode === "accept" || mode === "save failure" || mode === "cancel publication") {
        await saveEntered;
        pendingSave = {
          aborted: consentSignal?.aborted,
          effective: runtime.get().settings.openaiCompanionUsage,
          result: firstScreenResult,
        };
        if (mode === "cancel publication") controller.abort();
        release();
      }
      const changed = await operation;
      assert.match(consent, /companion token and.*account ID.*undocumented/);
      assert.match(consent, /not independent proof/);
      assert.match(consent, /same ChatGPT account\/workspace/);
      assert.equal(signalFreshAtConsent, true);
      const published = mode === "accept" || mode === "cancel publication";
      assert.equal(changed, published);
      assert.equal(applied, published ? 1 : 0);
      assert.equal(runtime.get().settings.openaiCompanionUsage, published);
      assert.equal(screenCount, mode === "cancel consent" || mode === "cancel publication" ? 1 : 2);
      if (mode === "accept" || mode === "save failure" || mode === "cancel publication")
        assert.deepEqual(pendingSave, { aborted: false, effective: false, result: "consent" });
      const saved = JSON.parse(await readFile(path, "utf8"));
      assert.deepEqual(saved.unrelated, { preserved: true });
      if (published) assert.equal(saved.openaiCompanionUsage, true);
      else assert.equal(saved.openaiCompanionUsage, undefined);
      if (mode === "save failure") {
        assert.match(context.notifications[0]?.message ?? "", /disk unavailable/);
        assert.match(latest, /companion usage.*Off/s);
      }
    } finally {
      controller.abort();
      release();
      await runtime.flush();
      await rm(root, { recursive: true, force: true });
    }
  });
}
