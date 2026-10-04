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

for (const mode of ["accept", "decline", "cancel consent", "save failure"] as const) {
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
    let complete!: () => void;
    const completed = new Promise<void>((resolve) => {
      complete = resolve;
    });
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
        const harness = createCustomSelectorHarness(
          (tui: { requestRender(): void }, theme: unknown, keys: unknown, done: unknown) =>
            (factory as (...args: unknown[]) => unknown)(
              {
                ...tui,
                requestRender() {
                  tui.requestRender();
                  // The decline path completes only after SettingsList restores Off.
                  if (mode === "decline" && consent) complete();
                },
              },
              theme,
              keys,
              done,
            ),
        );
        try {
          for (let index = 0; index < 3; index++) harness.handleInput("\u001b[B");
          harness.handleInput("\r");
          if (mode === "accept" || mode === "save failure") {
            // Deliberately hold atomic publication; UI completion must come from
            // onApplied/notify, never from a count of event-loop turns.
            await saveEntered;
            pendingSave = {
              aborted: consentSignal?.aborted,
              effective: runtime.get().settings.openaiCompanionUsage,
              result: harness.result,
            };
            release();
          }
          await completed;
          latest = harness.render().join("\n");
          harness.handleInput("\u0003");
          return (await harness.resultPromise) as boolean;
        } finally {
          harness.dispose();
        }
      },
    });
    const ui = (context.ctx as ExtensionCommandContext).ui;
    const notify = ui.notify;
    Object.assign(ui, {
      notify: (...args: Parameters<typeof notify>) => {
        notify(...args);
        complete();
      },
      confirm: async (title: string, message: string, options: { signal: AbortSignal }) => {
        consent = `${title} ${message}`;
        consentSignal = options.signal;
        signalFreshAtConsent = !options.signal.aborted;
        if (mode === "cancel consent") {
          controller.abort();
          complete();
        }
        return mode !== "decline";
      },
    });
    try {
      const changed = await showUsageSettings(
        context.ctx,
        runtime,
        controller.signal,
        () => true,
        () => {
          applied++;
          complete();
        },
      );
      assert.match(consent, /companion token and.*account ID.*undocumented/);
      assert.match(consent, /not independent proof/);
      assert.match(consent, /same ChatGPT account\/workspace/);
      assert.equal(signalFreshAtConsent, true);
      assert.equal(changed, mode === "accept");
      assert.equal(applied, mode === "accept" ? 1 : 0);
      assert.equal(runtime.get().settings.openaiCompanionUsage, mode === "accept");
      if (mode === "accept" || mode === "save failure")
        assert.deepEqual(pendingSave, { aborted: false, effective: false, result: undefined });
      const saved = JSON.parse(await readFile(path, "utf8"));
      assert.deepEqual(saved.unrelated, { preserved: true });
      if (mode === "accept") assert.equal(saved.openaiCompanionUsage, true);
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
