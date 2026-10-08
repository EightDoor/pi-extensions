# 🔎 Pi Session Inspector

A project-local, read-only live browser view of the current Pi session. It uses React with Radix Themes, Primitives, Colors tokens, and Icons. This is not an independently installable package.

> Opening the viewer exposes session prompts, code, paths, and tool output to your browser. Structured credential fields and Bearer tokens are redacted, but arbitrary secrets in prose cannot be reliably removed. Open the URL privately; do not share it, record it, or load the viewer in an untrusted browser profile. Nothing is uploaded, and detailed traces are kept only in memory after consent.

## Quick start

From the repository root:

```bash
npm install
node .pi/extensions/inspect/build.mjs
```

Pi discovers `.pi/extensions/inspect/index.ts` after project trust. In an existing trusted session, use `/reload`, then `/inspect`. Accept the sensitive-data warning to start serving and collecting live child results. The command opens your default browser; if opening fails, it shows a private URL instead.

For explicit loading, use `pi --no-extensions -e ./.pi/extensions/inspect/index.ts`. Browser assets must be built first; factory loading does not start a server or require those assets.

Use `/inspect stop` to stop recording, clear the owned collector, close connections, and revoke the URL. Reload, session replacement, and shutdown do the same. Closing the browser tab alone does not stop the server; collection continues until stopped, within its bounds. Revoking the URL cannot erase data already received by a browser; close the tab to release that view.

## Commands and modes

| Command | TUI | RPC | JSON / print |
| --- | --- | --- | --- |
| `/inspect` | Confirm, start, open/reopen viewer | Observable notification rejecting opening | Extension command error reported by Pi |
| `/inspect stop` | Stop and notify | Stop and notify | Stop; no ad hoc protocol output |
| Unknown or trailing arguments | Usage warning | Usage warning | Extension command error reported by Pi |

`/session-inspector` and `/session-inspector stop` remain compatibility aliases with identical consent, mode checks and lifecycle behavior.

The default command is a frequent single action, not a manager menu. `stop` is the deterministic cleanup route; tab closure is intentionally not a server shutdown signal. There are no saved settings, extension environment variables, model tools, or browser-controlled agent actions.

## Views and data provenance

**Context composition is the primary view.** A warm off-white document layout uses muted, consistent system/developer, user, assistant, tool-call, tool-result and neutral colors. Each ordered message or supported content block is an expandable row; assistant thinking/text/tool calls remain distinct. Desktop details place source metadata beside content, with lightweight structured/metadata/raw accordions. Copy acts on captured display data; the raw message and original role remain available. Missing segment token sizes are explicitly unavailable: persisted assistant totalTokens is usage, not the size of an individual context block.

A narrow right-hand minimap summarizes the same filtered segment sequence in up to 160 contiguous buckets, with category proportions and the actual viewport region. Clicking a bucket jumps/focuses its first segment. Variable-height virtualization renders the viewport plus five-row overscan on each side; measured heights and source-ID anchoring preserve older scroll while expanding or appending. Search covers available bounded captured message content, not uncaptured data. Category filters and source-mode navigation retain row expansion; keyboard ArrowUp/ArrowDown/Home/End navigate and Enter/Space or Left/Right control disclosure. Light is the default; dark and responsive inline details remain available.

**Source distinction is explicit.** After consent, context_with_system observes Pi messages after conversation-only context handlers and prompt/tool restoration. It returns nothing and does not modify the event. The primary view labels this as the last observed Pi-stage context, including its leaf/time when available; later context_with_system hooks, provider conversion and payload hooks can still differ. The advanced provider-payload copy is an independently timestamped hook-stage observation, not a guaranteed final transport body. Public callbacks have no request identity proving turn ownership: cache-warming and retry bodies may appear, so they are never attributed to the context leaf or observation time. Until a request is observed, the native active-leaf projection is labeled session-derived, not exact model input. Compaction/context edits use native Pi semantics, not the full session log. Session events and execution events are never silently appended to context.

**Session events** is a secondary source view retaining the existing actual-parent Trace Explorer and timeline. Navigator and Event Inspector are collapsed by default and open only on request; choosing a Navigator event switches to Session events without changing the Pi leaf; captured live calls remain in a compact closed drawer and its empty primary region is omitted. The Session Navigator handles search, filtering and concise hierarchy navigation; the Trace Explorer handles progressive inline log inspection; the Event Inspector shows complete bounded historical/debugging details. Desktop side panes are resizable with pointer dragging or focused-separator ArrowLeft/ArrowRight/Home/End, and can be collapsed. Pointer cancellation, Escape, blur and unmount release drag listeners. When the viewport or resized sides leave insufficient trace space, side panes become Radix Dialog drawers with focus trapping, Escape dismissal and focus restoration. Widths and view choices are ephemeral browser state, not saved settings.

Log rows use actual `parentId` relationships; live execution rows use only `parentToolCallId`. They are never merged into a fictional execution graph. Filters retain actual ancestors, visibly marked as context; trace child counts are labeled visible counts, not persisted totals. Explicit related-entry navigation can reveal a selected entry outside the current filters without clearing them; changing filters ends that exception. Metadata-only navigation items do not print JSON snippets. Entry and session names are sanitized before the 512-character bound; truncation is labeled. Raw exposes the full bounded captured entry value without changing its source. Long labels remain one line with ellipsis and hover text.

**List is the default Session events mode.** Clicking a trace row selects and toggles it; its chevron toggles without changing selection. Enter selects, Space toggles, ArrowUp/ArrowDown move focus, ArrowRight expands or enters a child, and ArrowLeft collapses or moves to the recorded parent. Multiple rows can be expanded. Collapsing a parent retains descendant expansion state. Selected, expanded and keyboard-focused states are distinct. Inline Overview/Content/Raw/Metadata panels lazily fetch full bounded entries, display recorded text/output and tool arguments, and expose collapsible JSON objects/arrays. Inspector and navigator selection stay synchronized without navigating Pi.

Trace pages contain at most 50 visible rows; navigator pages contain at most 100. Paging, filtering and collapse retain one visible keyboard tab target; ArrowUp/ArrowDown can cross trace pages. Arbitrary hierarchy levels are supported with iterative traversal, not a depth cap. Long chains use page-local/scaled indentation while retaining absolute ARIA levels and original parent IDs. Initial selection reveals its ancestors without fetching every ancestor\'s details. Detail request failures are shown with an explicit retry for both the Inspector and inline sections; historical-branch request failures have a separate selected-branch alert/retry that survives live snapshot refreshes; unavailable historical data remains a separate display state. Inline loads use four concurrent requests and a 64-entry immutable historical-detail cache; collapsing/unmounting rows cancels their work. JSON object disclosure state is isolated by scope and retained within a bounded 128-scope cache; Inspector historical sections use entry-specific scopes. Existing ingestion depth/node/character bounds still apply; UI expansion cannot recover omitted data.

Malformed entry/parent IDs, non-string type/role/timestamp fields and all duplicated entry identities are excluded from navigation without manufacturing replacement IDs. Duplicate ancestor/detail identities are explicitly unavailable rather than selecting the last indexed occurrence. The overview labels the count and exposes up to 20 indexed raw diagnostic samples, each bounded to 2 KiB-equivalent characters; source entries are unchanged. Invalid leaf identities cannot become a browser selection or captured transcript anchor.

A session-owned structural index is rebuilt on structural changes and released on stop/replacement. Inline requests reuse it and project only their validated ancestor path, not every off-branch entry; valid context-edit/compaction replay remains the native Pi result.

Before historical replay, ancestry is validated with a visited set and a 10,000-entry inspection budget. Recorded parent cycles, missing parents or a budget overflow keep the raw entry and original parent links visible but mark projection unavailable; the inspector never asks Pi to traverse those malformed paths or mutates the session to repair them.

The compact overview distinguishes persisted entries, indexed assistant messages/tokens/log errors and captured calls. Recorded span is the indexed log timestamp range, not execution duration. Tokens are persisted assistant `totalTokens`, excluding compaction/auxiliary usage; inline input/output bars appear only when recorded usage supplies both values, with cache excluded explicitly. Missing metrics are omitted or neutral. No model durations, transport latency, p95 or request totals are invented.

Each captured execution has a unique `occurrenceId`; `id` remains the provider/native raw tool-call ID. Repeated raw IDs retain separate history and occurrence-parent links. Transcript correlation requires the recorded owning-assistant anchor, not raw ID alone; overlapping invalid IDs are explicitly marked unavailable rather than assigning an ambiguous result. Evicting a selected occurrence returns selection to its remembered recorded anchor (or current leaf).

Live calls occupy a collapsed bottom drawer, including when calls arrive. Opening it is explicit; its own scroll area shows parent-correlated records and allows selecting an execution in the Inspector. The navigation highlight then denotes that execution\'s recorded anchor entry, not a new transcript result.

Timeline is an optional shared-axis view. Log timestamps are points, not duration spans. `observedStartedAt`/`observedEndedAt` are wall-clock samples taken on entry to this collector\'s actual start/end callbacks, after activation; their intervals are labeled observations, not provider transport timing. Public `durationMs` remains the separate monotonic time spent in `execute()`, absent if it did not run. Missing starts are never synthesized from durations; update/end-only, running or reversed-clock records do not become closed spans. Earlier callbacks or framework work can separate observation intervals from reported execution durations.

The Inspector preserves Raw/Prompt/Tools/Context/Skills/Codemode, uses a non-wrapping horizontally scrollable tab strip, and disables inapplicable tabs consistently: Context is unavailable for non-transcript live events, Skills requires catalog/evidence, and Codemode requires recorded codemode source/output. It falls back to Raw if the selected tab becomes inapplicable. Structured metadata and object disclosure are the default; Raw JSON text is explicit. Data sections can be collapsed, and technical strings/JSON scroll horizontally rather than forcing page-wide overflow. The panel owns vertical scrolling, rather than stacking nested vertical code scrollers.

| View | Available | Limitations |
| --- | --- | --- |
| Tree / transcript | Raw entries, roots, branches, labels, compaction, summaries, and unknown entry previews | Up to 10,000 nodes, reserving the active leaf and bounded real ancestry; 50 trace rows and 100 navigator rows per page |
| Prompt | Historical replay through Pi AI helpers, sections, updates, previous-node diff; separate current runtime prompt | Older history may have no system checkpoint; current runtime changes may not have been sent yet |
| Tools / MCP | Configured tool schemas, namespace, exposure, active/callable status; historical declared tools on selected branch | Active does not equal provider-visible; full MCP connection/auth/config state is unavailable |
| Skills | Currently advertised catalog, explicit skill invocation, successful exact-path reads and persisted nested-read metadata | Relative/aliased reads may lack evidence; old catalogs and model compliance are unknown |
| Context | Pi's compaction/context-edit projection and selected-entry contribution | Request-local hooks and provider adapters may transform it further; not a final HTTP request |
| Codemode | Script source, final printed output, public persisted nestedCalls metadata, and live correlated child results | Historical child results are not saved by Pi; metadata can be incomplete |
| Live calls | Parent IDs, bounded args/results, status, reported duration, observed callback timestamps, partial updates | Session-wide, not a selected-branch Promise dependency graph; running calls at settle become unfinished |

Live results come from public `tool_execution_end` events, after the runtime's tool-result transformation pipeline (verified with a real nested call and a transforming hook). Partial updates are provisional. Unknown tools, schema failures, and permission blocks still have nested execution events. Direct transcript results remain authoritative persisted history. The inspector observes only: its context_with_system and before_provider_request handlers return nothing and never mutate messages or payloads; it registers no result-transforming handler.

Codemode discovery helpers (`searchTools`, `describeTool`, `describeNamespace`, catalog helpers), sandbox local variables, and internal Promise scheduling are not normal child-tool events. `models.classify` and `models.generateImages` are also not normal nested tools: their complete input/output is unavailable unless printed. The generic Raw tab can show documented persisted metadata but the inspector never imports another extension or depends on private codemode implementation types.

## Bounds and security

- The server binds only `127.0.0.1` on a random port, checks Host and Origin, rejects cross-site requests and non-GET methods, and authenticates every data/SSE request with a random per-session token and generation.
- The URL is at most 68 characters and printed on its own line for manual opening. Its fragment contains the full 256-bit token in Base64url, not a query or HTTP request; the data-free HTML supplies the public generation identifier. Legacy token/generation fragments remain supported. The browser moves it to origin-scoped sessionStorage and removes the fragment from history. The launch notification necessarily contains the private credential URL for manual opening; it is not an API key. No request logs are written.
- A data-free shell and bundled JS/CSS are publicly readable on that loopback port; session data requires authentication. There is no CORS grant, arbitrary file read, attachment path endpoint, or upstream credential/header/environment API.
- Structured previews use native object/array disclosure. JSON text and plain content are literal with line numbers and bounded coloring (at most 1,000 lines and 512 colored tokens); long lines fall back to plain text. Copy acts only on the bounded redacted display value, including lines omitted by the local preview cap, and reports success or denial. Pending clipboard feedback is ignored after its owning component is disposed; the browser clipboard API itself cannot be aborted.
- CSP blocks remote scripts, connections, frames, fonts, and images. Tool text and Markdown are shown literally, not as executable HTML. Only small validated PNG/JPEG/GIF/WebP base64 blocks can render as images; SVG, remote images, opaque signatures, and large image payloads are omitted. No filesystem attachment is opened automatically.
- The collector keeps 128 records, at most 8 KiB-equivalent argument characters and 32 KiB-equivalent result characters per call, with depth/node limits. Tool schemas are bounded, inventory limits are 256 tools/skills, prompt/raw/projection fields are bounded to 64 KiB-equivalent characters, and evictions/truncation are visible. These are character/traversal budgets, not exact serialized-byte caps; JSON overhead adds size.
- Context observation is consent-gated, in-memory and discarded on stop/replacement/reload/shutdown. It captures at most 4,000 segments, up to 8 KiB-equivalent characters per message and approximately 1 MiB-equivalent serialized message characters overall; provider-payload copies use 64 KiB-equivalent characters. Bounds, omitted content and source-stage limitations are labeled. Expanded Raw/Copy can reveal all captured text beyond local preview limits, but cannot recover content excluded by capture bounds.
- SSE sends revision invalidations rather than result payloads. Notifications and intermediate partial copies are sampled/coalesced to at most one per 250 ms; final results are always captured. Live-only requests reuse the static snapshot rather than re-summarizing history. An owned 1-second reconciliation checks the public SDK entry count (when exposed), leaf/name and bounded public tool metadata for actions without extension change events, without rebuilding context projections or copying idle history on SDK managers. Readonly adapters lacking that public count method fall back to getEntries. At most eight stream clients and 32 sockets are accepted. A backpressured stream is closed, and reconnect triggers a fresh snapshot. Viewer-capacity responses (429), transient server failures and offline transport retry after one second. Snapshot request failures also retry with an owned one-second timer even when SSE is quiet; authentication/closed-session/generation responses do not retry. Authentication, closed-session, generation and protocol failures stop the connection and require reopening from Pi. Pending fetches, readers, reconnect timers, reconciliation/coalescing timers, browser-launch tasks, and session resources are cancelled on their owning boundary.
- Tokens do not defend against a malicious process running as your local user. Redaction is not a secrecy guarantee. Do not expose the port remotely or assume this is a multi-user service.

Entry IDs, parent IDs, timestamps and tool-result IDs over 512 characters are rejected, not truncated; malformed labels, session names, assistant/tool-call envelopes and context-edit replacements remain bounded raw diagnostics. Missing or empty session names preserve Pi’s title-clear semantics. Credential classification includes camelCase/acronym suffixes without masking metric keys. Search queries strip terminal controls before a 512-character bound and normalize once per filter update. Responsive mode depends only on viewport width, with side widths constrained to preserve the central workspace. Explicit filter resets start at the source top even when the matching IDs do not change.

## Local verification

Root TypeScript and Vitest discovery exclude project-local extensions. Run these checks explicitly from the root:

```bash
node .pi/extensions/inspect/build.mjs
npm exec tsc -- --project .pi/extensions/inspect/tsconfig.json
npm exec vitest -- run --config .pi/extensions/inspect/vitest.config.ts
npm exec playwright -- install chromium
npm exec playwright -- test --config .pi/extensions/inspect/playwright.config.ts
node .pi/extensions/inspect/smoke.mjs
npm run check
npm test
```

Browser dependencies are root development dependencies, bundled by the local esbuild helper. The runtime imports only Node and public Pi APIs; it does not need React, a bundler, or another extension at runtime. Generated assets remain ignored; rebuild after frontend changes. The smoke uses non-interactive RPC to verify explicit loading, trusted project discovery, rejection behavior, reload, and orderly shutdown without a paid provider request.

Tests cover Pi's real nested tool pipeline, non-mutating request prefixes, compaction/context edits, missing historical data, privacy controls, authenticated requests, bounded SSE clients, pending-task cancellation, multiple session managers with a shared UI, browser navigation, raster safety, and a 1,500-entry fixture. See `VERIFICATION.md` for recorded results and remaining environment-specific paths.

## Layout

- `index.ts`, `extension.ts`: factory registration, command and session ownership.
- `context.ts`: bounded stage-observed messages/blocks and native active-leaf fallback, without synthetic token sizes.
- `web/context-composition.tsx`, `virtual-context.ts`, `composition.css`: primary composition, minimap, variable-height virtualization and editorial light/dark presentation.
- `projection.ts`, `model.ts`, `collector.ts`, `correlation.ts`, `privacy.ts`: public-data projection, occurrence identity and bounded sanitized copies.
- `entry-index.ts`: session-owned unique-identity index reused across inline requests.
- `identity.ts`: runtime identity validation, safe leaf selection and diagnostic boundaries.
- `ancestry.ts`: bounded, cycle-aware parent validation before native historical replay.
- `feed.ts`: session-owned notification coalescing, static snapshot caching and quiet-action reconciliation.
- `server.ts`: authenticated loopback snapshot/details/SSE.
- `web/app.tsx`, `api.ts`: selection, cancellable live requests, bounded lazy detail work and top-level layout.
- `web/hierarchy.ts`, `trace.tsx`, `inline-entry.tsx`, `tree.tsx`: actual-parent traversal, keyboard exploration and progressive disclosure.
- `web/timing.ts`, `timeline.tsx`, `live-drawer.tsx`: recorded points/intervals and separately scoped live executions.
- `web/inspector.tsx`, `json-tree.tsx`, `panes.tsx`, `overview.tsx`: structured inspection, retained object disclosure, responsive panes and compact metrics.
- `web/components.tsx`, `format.ts`, focused CSS modules: bounded display primitives and formatting.
- `build.mjs`: static browser assets build, retaining generated third-party legal notices inline.
- `test/`, local configs, `smoke.mjs`: local tests and non-interactive loading smoke.

## License

Repository MIT license. Browser bundles preserve third-party license comments emitted by esbuild.
