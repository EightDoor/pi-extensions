# 🔎 Pi Session Inspector

A project-local, read-only live browser view of the current Pi session. It uses React with Radix Themes, Primitives, Colors tokens, and Icons. This is not an independently installable package.

> Opening the viewer exposes session prompts, code, paths, and tool output to your browser. Structured credential fields and Bearer tokens are redacted, but arbitrary secrets in prose cannot be reliably removed. Open the URL privately; do not share it, record it, or load the viewer in an untrusted browser profile. Nothing is uploaded, and detailed traces are kept only in memory after consent.

## Quick start

From the repository root:

```bash
npm install
node .pi/extensions/session-inspector/build.mjs
```

Pi discovers `.pi/extensions/session-inspector/index.ts` after project trust. In an existing trusted session, use `/reload`, then `/session-inspector`. Accept the sensitive-data warning to start serving and collecting live child results. The command opens your default browser; if opening fails, it shows a private URL instead.

For explicit loading, use `pi --no-extensions -e ./.pi/extensions/session-inspector/index.ts`. Browser assets must be built first; factory loading does not start a server or require those assets.

Use `/session-inspector stop` to stop recording, clear the owned collector, close connections, and revoke the URL. Reload, session replacement, and shutdown do the same. Closing the browser tab alone does not stop the server; collection continues until stopped, within its bounds. Revoking the URL cannot erase data already received by a browser; close the tab to release that view.

## Commands and modes

| Command | TUI | RPC | JSON / print |
| --- | --- | --- | --- |
| `/session-inspector` | Confirm, start, open/reopen viewer | Observable notification rejecting opening | Extension command error reported by Pi |
| `/session-inspector stop` | Stop and notify | Stop and notify | Stop; no ad hoc protocol output |
| Unknown or trailing arguments | Usage warning | Usage warning | Extension command error reported by Pi |

The default command is a frequent single action, not a manager menu. `stop` is the deterministic cleanup route; tab closure is intentionally not a server shutdown signal. There are no saved settings, extension environment variables, model tools, or browser-controlled agent actions.

## Views and data provenance

The interface uses a top identity/session bar, left tree and filter cards, central session overview and expandable trace table, right event inspector, and bottom connection bar. The center is intentionally wider than either side pane. At narrower widths, the panes stack without horizontal page scrolling.

The tree supports branch previews, collapse controls, search, entry-type filtering, and Model/Tool/Custom category filters. Checked categories are combined with OR; error and slow-call filters add AND constraints. Slow filtering uses only captured tool durations. The selected preview leaf scrolls into view on selection, not on every live update. Controls use ordinary Tab/Shift+Tab, Enter/Space, and Radix keybindings; the tree is a collapsible navigation list, not an ARIA TreeView.

The trace table provides Timeline/List views, Expand all/Collapse all for the current branch page, independently selectable/expandable rows, inline overview/content/context, and separate parent-correlated live executions. Expanded unselected rows use summaries rather than fetching every entry. The right inspector provides Formatted/JSON views, metadata, related-entry navigation, bounded data copying, and Raw/Prompt/Tools/Context/Skills/Codemode tabs. Browser selection never changes Pi\'s active leaf.

Overview counts distinguish persisted entries and assistant messages from the bounded live call/error collector. Recorded span is the first-to-last indexed entry timestamp, not execution duration. Tokens are persisted assistant `totalTokens`, excluding compaction and auxiliary usage; missing values show `—`. Model durations, transport latency, p95 and full-request token totals are not invented. The small chart shows only supplied live tool durations.

| View | Available | Limitations |
| --- | --- | --- |
| Tree / transcript | Raw entries, roots, branches, labels, compaction, summaries, and unknown entry previews | First 10,000 entries in tree; branch pages contain 50 entries |
| Prompt | Historical replay through Pi AI helpers, sections, updates, previous-node diff; separate current runtime prompt | Older history may have no system checkpoint; current runtime changes may not have been sent yet |
| Tools / MCP | Configured tool schemas, namespace, exposure, active/callable status; historical declared tools on selected branch | Active does not equal provider-visible; full MCP connection/auth/config state is unavailable |
| Skills | Currently advertised catalog, explicit skill invocation, successful exact-path reads and persisted nested-read metadata | Relative/aliased reads may lack evidence; old catalogs and model compliance are unknown |
| Context | Pi's compaction/context-edit projection and selected-entry contribution | Request-local hooks and provider adapters may transform it further; not a final HTTP request |
| Codemode | Script source, final printed output, public persisted nestedCalls metadata, and live correlated child results | Historical child results are not saved by Pi; metadata can be incomplete |
| Live calls | Parent IDs, bounded args/results, status, provided duration, partial updates | Session-wide, not a selected-branch Promise dependency graph; running calls at settle become unfinished |

Live results come from public `tool_execution_end` events, after the runtime's tool-result transformation pipeline (verified with a real nested call and a transforming hook). Partial updates are provisional. Unknown tools, schema failures, and permission blocks still have nested execution events. Direct transcript results remain authoritative persisted history. The inspector observes only; it registers no context/payload/result-transforming handler.

Codemode discovery helpers (`searchTools`, `describeTool`, `describeNamespace`, catalog helpers), sandbox local variables, and internal Promise scheduling are not normal child-tool events. `models.classify` and `models.generateImages` are also not normal nested tools: their complete input/output is unavailable unless printed. The generic Raw tab can show documented persisted metadata but the inspector never imports another extension or depends on private codemode implementation types.

## Bounds and security

- The server binds only `127.0.0.1` on a random port, checks Host and Origin, rejects cross-site requests and non-GET methods, and authenticates every data/SSE request with a random per-session token and generation.
- The URL token is in the fragment, not the query or HTTP request. The browser moves it to origin-scoped sessionStorage and removes the fragment from history. The launch notification necessarily contains the private credential URL for manual opening; it is not an API key. No request logs are written.
- A data-free shell and bundled JS/CSS are publicly readable on that loopback port; session data requires authentication. There is no CORS grant, arbitrary file read, attachment path endpoint, or upstream credential/header/environment API.
- Data previews are literal text with line numbers and bounded JSON coloring (at most 1,000 lines and 512 colored tokens per preview); long lines fall back to plain text. Copy acts only on the bounded redacted display value, including lines omitted by the local preview cap, and reports success or denial. Pending clipboard feedback is ignored after its owning component is disposed; the browser clipboard API itself cannot be aborted.
- CSP blocks remote scripts, connections, frames, fonts, and images. Tool text and Markdown are shown literally, not as executable HTML. Only small validated PNG/JPEG/GIF/WebP base64 blocks can render as images; SVG, remote images, opaque signatures, and large image payloads are omitted. No filesystem attachment is opened automatically.
- The collector keeps 128 records, at most 8 KiB-equivalent argument characters and 32 KiB-equivalent result characters per call, with depth/node limits. Tool schemas are bounded, inventory limits are 256 tools/skills, prompt/raw/projection fields are bounded to 64 KiB-equivalent characters, and evictions/truncation are visible. These are character/traversal budgets, not exact serialized-byte caps; JSON overhead adds size.
- SSE sends revision invalidations rather than result payloads. At most eight stream clients and 32 sockets are accepted. A backpressured stream is closed, and reconnect triggers a fresh snapshot. Pending fetches, readers, reconnect timers, browser-launch tasks, and session resources are cancelled on their owning boundary.
- Tokens do not defend against a malicious process running as your local user. Redaction is not a secrecy guarantee. Do not expose the port remotely or assume this is a multi-user service.

## Local verification

Root TypeScript and Vitest discovery exclude project-local extensions. Run these checks explicitly from the root:

```bash
node .pi/extensions/session-inspector/build.mjs
npm exec tsc -- --project .pi/extensions/session-inspector/tsconfig.json
npm exec vitest -- run --config .pi/extensions/session-inspector/vitest.config.ts
npm exec playwright -- install chromium
npm exec playwright -- test --config .pi/extensions/session-inspector/playwright.config.ts
node .pi/extensions/session-inspector/smoke.mjs
npm run check
npm test
```

Browser dependencies are root development dependencies, bundled by the local esbuild helper. The runtime imports only Node and public Pi APIs; it does not need React, a bundler, or another extension at runtime. Generated assets remain ignored; rebuild after frontend changes. The smoke uses non-interactive RPC to verify explicit loading, trusted project discovery, rejection behavior, reload, and orderly shutdown without a paid provider request.

Tests cover Pi's real nested tool pipeline, non-mutating request prefixes, compaction/context edits, missing historical data, privacy controls, authenticated requests, bounded SSE clients, pending-task cancellation, multiple session managers with a shared UI, browser navigation, raster safety, and a 1,500-entry fixture. See `VERIFICATION.md` for recorded results and remaining environment-specific paths.

## Layout

- `index.ts`, `extension.ts`: factory registration, command and session ownership.
- `projection.ts`, `model.ts`, `collector.ts`, `privacy.ts`: public-data projection and bounded display copies.
- `server.ts`: authenticated loopback snapshot/details/SSE.
- `web/app.tsx`: cancellable live requests and top-level layout.
- `web/tree.tsx`, `overview.tsx`, `trace.tsx`, `inspector.tsx`: screenshot-form navigation, metrics, trace table and inspector.
- `web/components.tsx`, `format.ts`, focused CSS modules: bounded display primitives and formatting.
- `build.mjs`: static browser assets build.
- `test/`, local configs, `smoke.mjs`: local tests and non-interactive loading smoke.

## License

Repository MIT license. Browser bundles preserve third-party license comments emitted by esbuild.
