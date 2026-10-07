import assert from "node:assert/strict";
import { test } from "vitest";
import { WIDGET_KEY } from "../src/progress-widget.js";
import { createContext, createHarness, identityTheme, setProgress } from "./progress-harness.js";

test("context UI defaults match Pi modes and preserve explicit overrides", () => {
  for (const mode of ["tui", "rpc", "print", "json"] as const) {
    assert.equal(createContext({ mode }).ctx.hasUI, mode === "tui" || mode === "rpc", mode);
    for (const hasUI of [true, false]) {
      assert.equal(createContext({ mode, hasUI }).ctx.hasUI, hasUI, `${mode}: ${hasUI}`);
    }
  }
  assert.equal(createContext().ctx.hasUI, true);
});

test("renders and clears progress widgets in UI-capable RPC sessions", async () => {
  const harness = createHarness();
  const current = createContext({ mode: "rpc" });

  await harness.emit("session_start", current.ctx);
  await setProgress(harness, current.ctx, [{ text: "web progress", status: "in_progress" }]);

  const widget = current.widgets.at(-1);
  assert.equal(widget?.key, WIDGET_KEY);
  assert.equal(widget?.options?.placement, "aboveEditor");
  assert.deepEqual(widget?.content?.(current.tui, identityTheme().theme).render(80).at(-1), "▶ web progress");

  await harness.emit("session_shutdown", current.ctx);
  assert.deepEqual(current.widgets.at(-1), { key: WIDGET_KEY, content: undefined, options: undefined });
});

test("keeps genuinely headless modes free of progress widgets", async () => {
  for (const mode of ["print", "json"] as const) {
    const harness = createHarness();
    const current = createContext({ mode });

    await harness.emit("session_start", current.ctx);
    await setProgress(harness, current.ctx, [{ text: "headless", status: "pending" }]);

    assert.equal(current.widgets.length, 0, mode);
  }
});
