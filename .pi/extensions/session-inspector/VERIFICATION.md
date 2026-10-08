# Verification evidence

Recorded on 2026-10-08 for the project-local Session Inspector. Commands run from the repository root; installed dependency versions come from the manifest and lockfile.

## Checks

| Gate | Evidence |
| --- | --- |
| Browser build | `node .pi/extensions/session-inspector/build.mjs` passes; bundled React/Radix JS/CSS load through authenticated loopback serving with no development server. |
| Local types | `npm exec tsc -- --project .pi/extensions/session-inspector/tsconfig.json` passes. |
| Local tests | `npm exec vitest -- run --config .pi/extensions/session-inspector/vitest.config.ts`: 4 files, 22 tests pass within the 5,000 ms test limit. |
| Browser tests | `npm exec playwright -- test --config .pi/extensions/session-inspector/playwright.config.ts`: 6 Chromium tests pass, including real Pi codemode, cancellation, reload and runtime shutdown. |
| Pi loading/modes | `node .pi/extensions/session-inspector/smoke.mjs` passes explicit loading, trusted auto-discovery, RPC rejection/stop, reload, replacement, orderly exit, and text/JSON rejection without protocol corruption. |
| Root gate | `npm run check` passes builds, Biome, boundaries and workspace typechecks. Existing unrelated `pi-sync` test lint warnings remain warnings. |
| Root tests | `npm test`: 542 files pass; 7,461 tests pass and one existing test is skipped. |
| Dependency installation | Root `npm install` completed; comparison with the base lockfile found no changed version at any existing package path. New dependencies support local frontend building and browser verification only. |

The finite 1,500-entry browser fixture produced a 182,216-character snapshot in 2.2 ms on this host; its transcript loaded 50 entries and only one selected-entry detail request. This is observational evidence, not an SLA or a timing assertion. A separate deterministic test verifies the 10,000-entry inventory cap and visible overflow marker.

## Screenshot-form revision

The UI was changed to the supplied screenshot\'s structure rather than merely recolored: top session bar, left tree/filter cards, wide center overview and expandable trace table, right event inspector with Formatted/JSON, and bottom connection bar. A rendered 1672×941 Chromium screenshot was inspected against the reference; the generated artifact is `test-results/browser-screenshot-form-la-98bd7-ON-filters-and-bounded-copy/session-inspector-desktop.png` under the local extension (ignored).

New browser coverage verifies column proportions, overview/trace/inspector regions, Expand all/Collapse all, Timeline/List, Formatted/JSON, copy success/denial, category/error/slow filters and the 1,000-line preview cap. Existing coverage still verifies search/keyboard, light/narrow layouts, malicious payloads, real native codemode/cancellation/reload/shutdown and lazy details. New deterministic metadata coverage verifies recorded usage, absent legacy usage/model fields, tool-result provenance and raw-history preservation.

Metrics intentionally differ from the mockup where data is unavailable: recorded timestamp span is not execution time; assistant-message count is not provider request count; tokens include only persisted assistant usage; errors count the bounded live collector; unavailable model durations/latency remain `—`. File-parent branch order and live execution-parent relationships are not merged into a fictitious execution graph. Clipboard output is a bounded redacted display copy, and feedback is guarded after component disposal. No new Pi hooks, settings, dependencies or model-visible prefix transitions were introduced.

## Semantic audit

Applicable guides: root `AGENTS.md`, `docs/extension-conventions.md`, and `docs/extension-settings.md` (persistent settings are not implemented).

- **Boundary:** All implementation, browser source, build helper, tests, configs and documentation are local to `.pi/extensions/session-inspector/`. Root changes are limited to frontend/test development dependencies, their lockfile, and generated-path ignores. No workspace, package manifest, Changeset, shared TypeScript configuration, root test support, root script or root extension registration was added.
- **Read-only contract:** Actual model-visible inputs are identical in enabled and disabled inspector sessions after excluding non-model metadata. Consecutive requests preserve the earlier normalized prefix. Activation does not alter prompt, messages or ordered active tools. Browser previews leave the Pi leaf unchanged.
- **Data provenance:** Pi AI replay and Pi projection helpers own prompt/tool/context reconstruction. Direct, parallel nested, permission-blocked, schema-invalid, unknown-tool and cancelled calls are represented without inventing child transcript entries. Live results are observed after result transformation; historical nested metadata is not mistaken for saved results. Unknown/legacy data and missing system checkpoints remain explicit.
- **Lifecycle:** Consent receives an owned abort signal. Startup reads/listening and the opener task are cancellable. Ownership is revalidated after awaits, including overlapping lifecycle boundaries. Resources are keyed by session manager rather than UI. Stop/reload/replacement/shutdown revoke serving resources, while browser effects cancel stale fetches/readers/timers. Tests cover partial startup, failed startup/retry, cancelled consent, stale launch, repeated activation, two managers sharing a UI, native SSE socket closure, real reload token rotation, and real runtime disposal.
- **Security:** Authentication includes constant-time equal-byte-length token comparison and generation checks. Host/Origin/method validation, malformed URLs, path traversal, client/socket limits and SSE backpressure have tests. Display traversal is bounded and does not evaluate object accessors; source entries/events are unchanged. Raster formats are allowlisted; SVG and oversized payloads are omitted, Markdown/HTML is literal, CSP and browser tests prove no remote requests or script execution.
- **Compatibility:** Entrypoint loading and public APIs are exercised through the manifest-selected Pi runtime and CLI resource loader. No implementation imports another extension or its private structures. Discovery/model-helper results and transport bytes are not claimed to be observable.
- **Recovery:** No settings or trace files are created. Failed activation can be retried; reconnect fetches a fresh snapshot. No session-file rewrites, migrations, uploads or release operations occur.

## Scope decisions and unverified paths

The default command is intentionally a frequent single action, with `stop` for deterministic cleanup rather than a manager menu. The tree is a keyboard-accessible collapsible navigation list, not a complete ARIA TreeView. Markdown/code are rendered as literal text rather than enabling rich HTML. These choices are documented in the README.

Headless Chromium and actual Pi SDK/RPC runtimes were exercised. A physical interactive terminal and the user's default desktop browser opener were not launched by automation; OS-specific macOS/Windows opener behavior remains unverified. The public dialog/notification contract and cancellation/fallback paths are covered by deterministic tests. No live paid provider or real external MCP server was used: native codemode and namespaced tool fixtures cover their public tool pipeline without external side effects.

`npm install` reports five existing dependency advisories (three high, two critical) in the Pi/concurrently dependency trees. No existing package version changed, and no force audit fix was applied; unrelated dependency maintenance is outside this change. Package packing, publication and release smokes are not applicable to a project-local extension.

The saved implementation plan remains until user acceptance of the first-version behavior and documented limitations; automated verification is not a substitute for that acceptance.
