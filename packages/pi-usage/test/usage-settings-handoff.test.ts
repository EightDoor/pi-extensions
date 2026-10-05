import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ExtensionCommandContext, InteractiveMode, initTheme } from "@earendil-works/pi-coding-agent";
import { type Component, getKeybindings } from "@earendil-works/pi-tui";
import { test, vi } from "vitest";
import { createMockContext } from "../../../test/support.js";
import { createUsageSettingsRuntime } from "../src/settings.js";
import { showUsageSettings } from "../src/usage-settings-ui.js";

initTheme("dark");

// Exercise Pi's real screen replacement methods without starting a terminal or session.
function createHost() {
  let focused: Component | undefined;
  const editor = { getText: () => "draft", setText() {} };
  const container = {
    children: [] as Component[],
    clear() {
      this.children = [];
    },
    addChild(component: Component) {
      this.children.push(component);
    },
  };
  const host = Object.assign(Object.create(InteractiveMode.prototype), {
    editor,
    editorContainer: container,
    ui: {
      terminal: { rows: 30 },
      setFocus(component: Component) {
        focused = component;
      },
      requestRender() {},
    },
  }) as {
    showExtensionCustom: ExtensionCommandContext["ui"]["custom"];
    showExtensionConfirm: ExtensionCommandContext["ui"]["confirm"];
    extensionSelector?: Component;
  };
  return { host, container, editor, focused: () => focused };
}

for (const answer of ["accept", "decline", "escape", "abort", "stale", "remapped accept"] as const) {
  test(`companion consent ${answer} closes Settings before Pi replaces the screen`, async () => {
    const root = await mkdtemp(join(tmpdir(), "usage-settings-handoff-"));
    const runtime = createUsageSettingsRuntime(join(root, "pi-usage.json"));
    await runtime.reload();
    const { host, container, editor, focused } = createHost();
    const controller = new AbortController();
    let current = true;
    const bindings = getKeybindings();
    const previousBindings = bindings.getUserBindings();
    const remapped = answer === "remapped accept";
    if (remapped)
      bindings.setUserBindings({
        "tui.select.down": "ctrl+n",
        "tui.select.confirm": "ctrl+y",
        "tui.select.cancel": "ctrl+x",
      });
    const down = remapped ? "\u000e" : "\u001b[B";
    const confirm = remapped ? "\u0019" : "\r";
    const cancel = remapped ? "\u0018" : "\u001b";
    const accepted = answer === "accept" || remapped;
    let mountedAtConsent = false;
    let applied = 0;
    let screenCount = 0;
    let consent = "";
    const context = createMockContext({ mode: "tui", hasUI: true });
    const ctx = context.ctx as ExtensionCommandContext;
    Object.assign(ctx.ui, {
      custom: (...args: Parameters<typeof host.showExtensionCustom>) => {
        screenCount++;
        return host.showExtensionCustom(...args);
      },
      confirm: (title: string, message: string, options: { signal: AbortSignal }) => {
        mountedAtConsent = container.children.some((child) => child !== (editor as unknown));
        consent = `${title} ${message}`;
        return host.showExtensionConfirm(title, message, options);
      },
    });
    const operation = showUsageSettings(
      ctx,
      runtime,
      controller.signal,
      () => current,
      () => {
        applied++;
      },
    );
    try {
      await vi.waitFor(() => assert.ok(focused()?.handleInput));
      for (let i = 0; i < 3; i++) focused()?.handleInput?.(down);
      focused()?.handleInput?.(confirm);
      await vi.waitFor(() => assert.ok(host.extensionSelector));
      // Assert outside custom callbacks: menu error handling must not swallow failures.
      assert.equal(mountedAtConsent, false);
      assert.match(consent, /companion token and.*account ID.*undocumented/);
      if (answer === "abort") controller.abort();
      else {
        if (answer === "decline") host.extensionSelector?.handleInput?.(down);
        if (answer === "stale") current = false;
        host.extensionSelector?.handleInput?.(answer === "escape" ? cancel : confirm);
        if (answer !== "stale") {
          await vi.waitFor(() => assert.equal(screenCount, 2));
          await vi.waitFor(() => assert.ok(focused()?.handleInput));
          const screen = focused();
          assert.ok(container.children.includes(screen as Component));
          assert.match(screen?.render(100).join("\n") ?? "", /→.*Experimental ChatGPT/);
          screen?.handleInput?.(cancel);
        }
      }
      assert.equal(await operation, accepted);
      assert.equal(applied, accepted ? 1 : 0);
      assert.equal(runtime.get().settings.openaiCompanionUsage, accepted);
    } finally {
      controller.abort();
      await operation;
      bindings.setUserBindings(previousBindings);
      await runtime.flush();
      await rm(root, { recursive: true, force: true });
    }
  });
}
