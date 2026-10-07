import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  type ExtensionContext,
  type InlineExtension,
  ModelRegistry,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { createMockContext } from "../../../test/support.js";
import type { ChromeDevToolsToolMode } from "../src/settings.js";

const fauxSpecifier = "@earendil-works/pi-ai/providers/faux";
export async function withChromeRuntime(
  options: { native: boolean; toolMode: ChromeDevToolsToolMode; tools?: readonly string[]; extensionPath?: string },
  run: (fixture: {
    session: Awaited<ReturnType<typeof createAgentSession>>["session"];
    faux: ReturnType<typeof import("@earendil-works/pi-ai/providers/faux")["createFauxCore"]>;
    fauxModule: typeof import("@earendil-works/pi-ai/providers/faux");
    model: NonNullable<ExtensionContext["model"]>;
    file: string;
    errors: unknown[];
    setExtensionPath: (path: string) => void;
  }) => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), "chrome-runtime-regression-"));
  const agentDir = join(root, "agent");
  const previousDir = process.env.PI_CODING_AGENT_DIR;
  let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
  try {
    await mkdir(agentDir);
    process.env.PI_CODING_AGENT_DIR = agentDir;
    const file = join(agentDir, "pi-chrome-devtools.json");
    await writeFile(
      file,
      JSON.stringify({
        toolMode: options.toolMode,
        browser: { autoLaunch: false },
        ...(options.tools ? { tools: options.tools, updatedAt: 1 } : {}),
      }),
    );
    const fauxModule = (await import(fauxSpecifier)) as typeof import("@earendil-works/pi-ai/providers/faux");
    const faux = fauxModule.createFauxCore({
      api: options.native ? "openai-responses" : `chrome-${crypto.randomUUID()}`,
      provider: `chrome-${crypto.randomUUID()}`,
      models: [{ id: "test", contextWindow: 100000, maxTokens: 4000 }],
    });
    const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null });
    const registry = new ModelRegistry(runtime);
    registry.registerProvider(faux.provider, {
      api: faux.api,
      apiKey: "test",
      baseUrl: "http://localhost",
      streamSimple: faux.streamSimple,
      models: faux.models.map((model) => ({ ...model, compat: { supportsToolSearch: options.native } })),
    });
    const model = registry.find(faux.provider, "test");
    assert.ok(model);
    const settingsManager = SettingsManager.inMemory({
      defaultTools: ["+codemode"],
      retry: { enabled: false },
      compaction: { enabled: false },
    });
    const builtinSpecifier = new URL("extensions/index.js", import.meta.resolve("@earendil-works/pi-coding-agent"))
      .href;
    const { builtInExtensions } = (await import(builtinSpecifier)) as { builtInExtensions: InlineExtension[] };
    const extensionPaths = ["builtin:codemode", options.extensionPath ?? resolve("packages/pi-chrome-devtools")];
    const loader = new DefaultResourceLoader({
      cwd: root,
      agentDir,
      settingsManager,
      extensionFactories: builtInExtensions,
      noExtensions: true,
      noSkills: true,
      noContextFiles: true,
      additionalExtensionPaths: extensionPaths,
    });
    await loader.reload();
    assert.deepEqual(loader.getExtensions().errors, []);
    const created = await createAgentSession({
      cwd: root,
      agentDir,
      modelRuntime: runtime,
      model,
      settingsManager,
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory(root),
    });
    session = created.session;
    const errors: unknown[] = [];
    const context = createMockContext({ mode: "rpc", hasUI: true });
    await session.bindExtensions({
      mode: "rpc",
      uiContext: (context.ctx as ExtensionContext).ui,
      onError: (error) => errors.push(error),
    });
    await run({
      session,
      faux,
      fauxModule,
      model,
      file,
      errors,
      setExtensionPath: (path) => {
        extensionPaths[1] = path;
      },
    });
    assert.deepEqual(errors, []);
  } finally {
    await session?.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
    session?.dispose();
    if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousDir;
    await rm(root, { recursive: true, force: true });
  }
}
