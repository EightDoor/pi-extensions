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
