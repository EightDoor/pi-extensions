# Verification evidence

Recorded on 2026-10-08 for the project-local Session Inspector. Commands run from the repository root; installed dependency versions come from the manifest and lockfile.

## Checks

| Gate | Evidence |
| --- | --- |
| Browser build | `node .pi/extensions/session-inspector/build.mjs` passes; bundled React/Radix JS/CSS load through authenticated loopback serving with no development server. |
| Local types | `npm exec tsc -- --project .pi/extensions/session-inspector/tsconfig.json` passes. |
| Local tests | `npm exec vitest -- run --config .pi/extensions/session-inspector/vitest.config.ts`: 8 files, 56 tests pass within the 5,000 ms test limit. |
| Browser tests | `npm exec playwright -- test --config .pi/extensions/session-inspector/playwright.config.ts`: 25 Chromium tests pass, including real Pi codemode, cancellation, reload and runtime shutdown. |
| Pi loading/modes | `node .pi/extensions/session-inspector/smoke.mjs` passes explicit loading, trusted auto-discovery, RPC rejection/stop, reload, replacement, orderly exit, and text/JSON rejection without protocol corruption. |
| Root gate | `npm run check` passes builds, Biome, boundaries and workspace typechecks. Existing unrelated `pi-sync` test lint warnings remain warnings. |
| Root tests | `npm test`: 542 files pass; 7,461 tests pass and one existing test is skipped. |
| Dependency installation | Root `npm install` completed; comparison with the base lockfile found no changed version at any existing package path. New dependencies support local frontend building and browser verification only. |

The current 1,500-entry browser fixture verifies at most 50 trace rows and 100 navigator rows in the DOM, an actual hierarchy level beyond 1,500, and only one initial selected-entry detail request. A separate deterministic chain test covers 1,600 levels without recursive traversal or a UI depth cap. The older pre-redesign sample (182,216 snapshot characters in 2.2 ms) was observational evidence, not an SLA; it is not claimed as a benchmark of the current layout. The deterministic 10,000-entry inventory cap test remains.

## Review remediation

All nine original threads were evaluated independently in `REVIEW.md`: eight introduced/exposed defects are fixed in scope; the old endpoint-page issue is already covered by the current 1,500-level selected-leaf regression. New tests cover coalesced notifications and static-node identity during high-frequency partials, zero retained timers after abort, silent append/label/name/active/schema changes without projection polling, missing versus known-empty historical tool baselines, long OSC/CSI sanitation before visible budgets, repeated raw/nested IDs and per-assistant correlation, overlapping ambiguous IDs and occurrence eviction, independent repeated-ID selection, eviction fallback, navigator scrolling without live-update scroll resets, and selected-detail error/retry recovery. Final native pipeline tests continue to compare enabled/disabled model-visible prefixes.

The reconciliation path uses only public readonly APIs. No private extension implementation, model-prefix transition, new dependency or persistent setting is introduced. Static cache strips live-call references so it cannot retain evicted results. Existing budgets remain; sanitization scans complete strings before output truncation, using Node\'s control-sequence remover and bounded object traversal. Original payloads remain unchanged.

## Repeat-review remediation

Four additional comments at head `745969a2` were verified against current code and native Pi ancestry traversal. New regressions cover a visible roving trace target after paging, keyboard page crossing, collapse and filtering; 429/503 reconnect and terminal HTTP/generation refusal; self/disconnected parent cycles, missing parents, both selected/leaf ancestry and the explicit 10,000-entry inspection budget; and sanitized 512-character session-name publication/reconciliation with truncation metadata and unchanged raw source. Browser cycle selection retains raw evidence and remains responsive. All ancestry traversal call sites were audited; unsafe native `getBranch()` is no longer used by the inspector. Canonical Pi projections remain unchanged for valid bounded paths.

Both root gates, local build/types/Biome, 42 local tests, 21 browser tests and explicit/discovery Pi CLI smoke passed. Original model-prefix/native pipeline and prior UI regressions remain covered. No package promotion, private extension dependency, settings or model-visible prefix transition was introduced.

## Third-review remediation

Four new comments at `c63b99f7` were confirmed independently. Runtime identity tests cover missing/null/numeric/object/array/boolean/empty entry IDs; missing/non-string/empty parent IDs; ancestry rejection; malformed leaf publication; bounded diagnostic samples and unchanged source. A browser test serves a real synthetic malformed entry through the native fixture server and verifies healthy navigation plus raw evidence. Other browser regressions verify branch-error survival across live snapshot refresh and retry, independent retained JSON disclosure across A/B/A/B selections, and visible child counts with matching/hidden siblings. All Inspector historical structured-data scopes were audited alongside the core scope-key fix.

The full local suite now contains 56 tests and 25 Chromium tests. Identity validation uses public readonly fields only and does not repair sessions or invent IDs. Scoped branch requests preserve abort/stale-owner protection, and no model-visible prefix or settings transition is introduced.

## Progressive Explorer revision

The latest authorized redesign makes the center the primary developer surface: compact horizontal actual-parent rows, independent selection/disclosure, retained descendants, inline Overview/Content/Raw/Metadata, recursive object/array disclosure, and a collapsed live drawer. The metrics panel is now a small toolbar; heavy per-section blue framing and repetitive recorded-status badges were removed. Desktop sides resize/collapse, while constrained viewports use accessible Radix Dialog drawers.

Current generated Chromium artifacts (ignored) are `test-results/browser-compact-desktop-la-5d1fe-ew-JSON-copy-and-screenshot/session-explorer-desktop.png` and `test-results/browser-medium-narrow-and--04553-wers-without-page-scrolling/session-explorer-narrow.png`. Both were inspected after disabling screenshot-time animations. The 1115×627 layout is an effective 150% CSS-viewport surrogate for 1672×941, not a claim that native desktop Chrome zoom controls were automated.

Acceptance coverage includes three-plus actual nesting levels, sibling/orphan/cycle preservation, collapsed-parent descendant restoration, independently controlled selection, synchronized related navigation even outside filters, ArrowUp/Down/Left/Right/Enter/Space, retained JSON expansion, non-wrapping labels/tabs, pointer/keyboard resize and Escape cancellation, drawer focus trapping/restoration, scrolling only the owned panel, four-request concurrency and cancellation, 64-entry detail caching, compact empty live state and no auto-opening on updates. Existing public native codemode/post-transform/cancellation/reload/shutdown and redaction/CSP coverage remain.

Public execution events expose monotonic `durationMs` but no start/end timestamp. The collector therefore records explicitly named callback-observation wall-clock times, only for events actually seen. List remains default; log entries are points and live observed intervals use a shared axis. Tests verify start/end provenance, end/update-only records, running calls, reversed clocks, equal-time points and unchanged native durations. No inferred model/provider span is introduced. Source UI/async audit covers API queue abort listeners, immutable own-node projection cache keys, clipboard feedback guards, resize listener disposal, media listener cleanup, Radix focus ownership, and additive non-model metadata.

## Earlier screenshot-form revision (superseded interaction model)

The earlier UI was changed to the supplied screenshot\'s structure rather than merely recolored: top session bar, left tree/filter cards, wide center overview and expandable trace table, right event inspector with Formatted/JSON, and bottom connection bar. A rendered 1672×941 Chromium screenshot was inspected against the reference; the generated artifact is `test-results/browser-screenshot-form-la-98bd7-ON-filters-and-bounded-copy/session-inspector-desktop.png` under the local extension (ignored).

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

The default command is intentionally a frequent single action, with `stop` for deterministic cleanup rather than a manager menu. The Navigator remains a compact collapsible navigation list, while the Trace Explorer exposes actual levels, selected/expanded states and tree keyboard semantics. Existing capture/index bounds remain; hierarchy depth is not capped by the UI. Markdown/code are rendered as literal text rather than enabling rich HTML. These choices are documented in the README.

Headless Chromium and actual Pi SDK/RPC runtimes were exercised. A physical interactive terminal and the user's default desktop browser opener were not launched by automation; OS-specific macOS/Windows opener behavior remains unverified. The public dialog/notification contract and cancellation/fallback paths are covered by deterministic tests. No live paid provider or real external MCP server was used: native codemode and namespaced tool fixtures cover their public tool pipeline without external side effects.

`npm install` reports five existing dependency advisories (three high, two critical) in the Pi/concurrently dependency trees. No existing package version changed, and no force audit fix was applied; unrelated dependency maintenance is outside this change. Package packing, publication and release smokes are not applicable to a project-local extension.

The saved implementation plan remains until user acceptance of the first-version behavior and documented limitations; automated verification is not a substitute for that acceptance.
