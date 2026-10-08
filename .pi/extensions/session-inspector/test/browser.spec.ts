import { expect, test } from "@playwright/test";
import { Collector } from "../collector.ts";
import { branch, detail, snapshot } from "../projection.ts";
import { startServer, type ViewerServer } from "../server.ts";
import { fixture, skills, tools } from "./fixtures.ts";

let server: ViewerServer;
let data: ReturnType<typeof fixture>;
let collector: Collector;
let revision = 0;
test.beforeEach(async () => {
  data = fixture();
  collector = new Collector();
  revision = 0;
  server = await startServer({
    generation: "browser-fixture",
    signal: new AbortController().signal,
    snapshot: () =>
      snapshot(data.manager, collector, "browser-fixture", revision, "current runtime prompt", tools, ["read"], skills),
    branch: (leaf, offset) => branch(data.manager, leaf, offset, skills),
    detail: (id, leaf) => detail(data.manager, id, leaf, collector),
  });
});
test.afterEach(async () => {
  await server.close();
});

test("Radix views, branch preview, prompt diff, search, filters, keyboard and narrow layout", async ({ page }) => {
  const initialLeaf = data.manager.getLeafId();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(server.url);
  await expect(page.getByText("Live", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pi Session Inspector" })).toBeVisible();
  expect(page.url()).not.toContain("token");
  const alternate = page.locator(`[data-entry-id="${data.alternate}"]`);
  await alternate.click();
  await expect(page.getByText(`Browser preview: ${data.alternate}`, { exact: false })).toBeVisible();
  expect(data.manager.getLeafId()).toBe(initialLeaf);
  await page.getByRole("tab", { name: "prompt", exact: true }).click();
  await expect(page.getByText("Historical prompt · browser preview branch")).toBeVisible();
  await expect(page.getByText("Current runtime effective prompt · may not yet be sent")).toBeVisible();
  await page.locator(`[data-entry-id="${data.delta}"]`).click();
  await expect(page.getByText("+ changed", { exact: false })).toBeVisible();
  await page.getByRole("tab", { name: "tools", exact: true }).click();
  await expect(page.getByText("mcp__docs__search", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "skills", exact: true }).click();
  await expect(page.getByText("successfully read (nested metadata)", { exact: false })).toBeVisible();
  await page.getByRole("tab", { name: "context", exact: true }).click();
  await expect(page.getByText("Projected branch entries", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "raw", exact: true }).click();
  await expect(page.getByText("Raw selected entry · redacted display copy")).toBeVisible();
  await page.getByRole("textbox", { name: "Search session" }).fill("Alternative");
  await expect(page.locator(".node")).toHaveCount(2); // Entry and its label-change record both match.
  await expect(page.locator(`[data-entry-id="${data.alternate}"]`)).toBeVisible();
  await page.getByRole("textbox", { name: "Search session" }).fill("");
  await page.getByRole("combobox", { name: "Filter entry type" }).click();
  await page.getByRole("option", { name: "assistant", exact: true }).click();
  await expect(page.locator(".node")).toHaveCount(1);
  await page.locator(".node").focus();
  await page.keyboard.press("Enter");
  await page.getByRole("tab", { name: "codemode", exact: true }).click();
  await expect(
    page.getByText('await tools.read({path:"/skills/example/SKILL.md"}); text("done")', { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Toggle appearance" }).click();
  await expect(page.locator(".radix-themes")).toHaveClass(/light/);
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.reload();
  await expect(page.getByText("Live", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("live child results, error expansion, raster preview, no script execution or remote requests", async ({
  page,
}) => {
  const external: string[] = [];
  page.on("request", (req) => {
    if (!req.url().startsWith(server.origin)) external.push(req.url());
  });
  await page.goto(server.url);
  await expect(page.getByText("Live", { exact: true })).toBeVisible();
  collector.start(
    {
      type: "tool_execution_start",
      toolCallId: "parent/1",
      parentToolCallId: "parent",
      toolName: "mcp__docs__search",
      args: { query: "<img src=https://evil.example/onload>" },
    },
    data.assistant,
  );
  server.invalidate(++revision);
  const trigger = page.getByRole("button", { name: "mcp__docs__search · running", exact: true });
  await expect(trigger).toBeVisible();
  await trigger.click();
  collector.end(
    {
      type: "tool_execution_end",
      toolCallId: "parent/1",
      parentToolCallId: "parent",
      toolName: "mcp__docs__search",
      isError: true,
      durationMs: 4,
      result: {
        content: [
          { type: "text", text: "<script>globalThis.hacked=true</script>\u001b[31merror" },
          {
            type: "image",
            mimeType: "image/png",
            data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXs8AAAAASUVORK5CYII=",
          },
        ],
      },
    },
    data.assistant,
  );
  server.invalidate(++revision);
  await expect(page.getByRole("button", { name: "mcp__docs__search · error", exact: true })).toBeVisible();
  await expect(page.getByText("<script>globalThis.hacked=true", { exact: false }).first()).toBeVisible();
  await expect(page.getByAltText("Captured raster tool output")).toBeVisible();
  expect(await page.evaluate(() => "hacked" in globalThis)).toBe(false);
  expect(external).toEqual([]);
  await server.close();
  await expect(page.getByText("Disconnected", { exact: true })).toBeVisible();
});

test("screenshot-form layout, trace controls, formatted JSON, filters and bounded copy", async ({ page }) => {
  await page.setViewportSize({ width: 1672, height: 941 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (text: string) => {
          Object.defineProperty(window, "copiedDisplay", { value: text, configurable: true });
        },
      },
      configurable: true,
    });
  });
  collector.end(
    {
      type: "tool_execution_end",
      toolCallId: "parent",
      toolName: "codemode",
      isError: false,
      durationMs: 4280,
      result: { content: [{ type: "text", text: "done" }] },
    },
    data.assistant,
  );
  collector.end(
    {
      type: "tool_execution_end",
      toolCallId: "parent/1",
      parentToolCallId: "parent",
      toolName: "read",
      isError: true,
      durationMs: 11000,
      result: { content: [{ type: "text", text: "fixture read failure" }] },
    },
    data.assistant,
  );
  await page.goto(server.url);
  await expect(page.getByRole("heading", { name: "Session overview" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Trace explorer" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Event inspector" })).toBeVisible();
  const positions = await page.locator(".sidebar, .center-column, .inspector-panel").evaluateAll((elements) =>
    elements.map((element) => ({
      x: element.getBoundingClientRect().x,
      width: element.getBoundingClientRect().width,
    })),
  );
  expect(positions[0]?.x).toBeLessThan(positions[1]?.x ?? 0);
  expect(positions[1]?.width).toBeGreaterThan(positions[2]?.width ?? 0);
  expect(positions[1]?.x).toBeLessThan(positions[2]?.x ?? 0);
  await page.getByRole("button", { name: "Expand all", exact: true }).click();
  await expect(page.locator(".trace-item[data-state=open]")).toHaveCount(
    data.manager.getBranch(data.manager.getLeafId() ?? undefined).length,
  );
  await page.getByRole("button", { name: "Collapse all", exact: true }).click();
  await expect(page.locator(".trace-item[data-state=open]")).toHaveCount(0);
  await page.getByRole("button", { name: "List", exact: true }).click();
  await expect(page.locator(".trace-list")).toBeVisible();
  await page.locator(`[data-entry-id="${data.alternate}"]`).click();
  await expect(page.locator(".trace-list")).toBeVisible();
  await page.locator(`[data-entry-id="${data.manager.getLeafId()}"]`).click();
  await expect(page.locator(".trace-list")).toBeVisible();
  await page.getByRole("button", { name: "Timeline", exact: true }).click();
  await page.getByRole("button", { name: `Expand event ${data.assistant}` }).click();
  await expect(page.locator(".event-overview-grid")).toBeVisible();
  await page.getByRole("button", { name: "JSON", exact: true }).click();
  await expect(page.locator(".inspector-metadata")).toHaveCount(0);
  await page.getByRole("button", { name: "Formatted", exact: true }).click();
  await expect(page.locator(".inspector-metadata")).toBeVisible();
  await page.locator(".inspector-panel").getByRole("button", { name: "Copy display data" }).first().click();
  expect(await page.evaluate(() => Reflect.get(window, "copiedDisplay"))).toContain("future-state");
  await page.getByRole("checkbox", { name: "Errors only", exact: true }).check();
  await expect(page.locator(".call-trigger")).toHaveCount(1);
  await page.getByRole("checkbox", { name: "Slow tool calls (> 10s)", exact: true }).check();
  await expect(page.locator(".call-trigger")).toHaveCount(1);
  await page.getByRole("checkbox", { name: "Errors only", exact: true }).uncheck();
  await page.getByRole("checkbox", { name: "Slow tool calls (> 10s)", exact: true }).uncheck();
  await page.getByRole("button", { name: "Model", exact: true }).click();
  await expect(page.locator(".node")).toHaveCount(1);
  await page.getByRole("button", { name: "All", exact: true }).click();
  await page.screenshot({ path: test.info().outputPath("session-inspector-desktop.png") });
});

test("clipboard denial is observable and preview rendering stays bounded", async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async () => {
          throw new Error("denied");
        },
      },
    }),
  );
  data.manager.appendCustomEntry("large-preview", {
    text: Array.from({ length: 1200 }, (_, i) => `line ${i}`).join("\n"),
  });
  data.manager.appendMessage({
    role: "system",
    content: Array.from({ length: 1200 }, (_, i) => `prompt line ${i}`).join("\n"),
    timestamp: 10,
  });
  await page.goto(server.url);
  await page.locator(".inspector-panel").getByRole("button", { name: "Copy display data" }).first().click();
  await expect(page.getByText("Copy failed", { exact: true })).toBeVisible();
  // A plain multiline historical prompt exercises the DOM line cap, not JSON escaping.
  await page.getByRole("tab", { name: "prompt", exact: true }).click();
  await expect(page.locator(".code-line").first()).toBeVisible();
  const preview = page
    .locator(".data")
    .filter({ has: page.getByText("Historical prompt · browser preview branch", { exact: true }) });
  await expect(preview.locator(".code-line")).toHaveCount(1000);
  await expect(preview.locator(".preview-limit")).toBeVisible();
});

test("large-session inventory and paginated lazy details stay bounded", async ({ page }) => {
  for (let i = 0; i < 1500; i++)
    data.manager.appendMessage({ role: "user", content: `fixture row ${i}`, timestamp: i });
  const before = performance.now();
  const view = snapshot(data.manager, collector, "browser-fixture", 0, "prompt", tools, [], skills);
  const elapsed = performance.now() - before;
  expect(view.nodes.length).toBeGreaterThan(1500);
  expect(JSON.stringify(view).length).toBeLessThan(1000000);
  const requests: string[] = [];
  page.on("request", (req) => requests.push(req.url()));
  await page.goto(server.url);
  await expect(page.locator(".node")).toHaveCount(view.nodes.length);
  await expect(page.locator(".transcript-entry")).toHaveCount(50);
  expect(requests.filter((url) => url.includes("/api/detail"))).toHaveLength(1);
  test.info().annotations.push({
    type: "performance",
    description: `1500-entry snapshot: ${elapsed.toFixed(1)} ms; ${JSON.stringify(view).length} chars`,
  });
});
