# Settings merge audit

Phase 2 extends [Phase 1 PR #1455](https://github.com/narumiruna/pi-extensions/pull/1455) with explicit opt-in settings merging, verified accepted ancestors and portable machine-local field rules. Existing defaults remain unchanged.

## Touched areas and MUST verification

| Area | Requirements | Verification |
| --- | --- | --- |
| Ancestors and journal | Private bounded atomic persistence, verified identity/hashes, preserve recovery evidence, revalidate ownership after awaits. | Cache/state/journal boundary Review; `merge-baseline-store.test.ts` and existing merged fault-injection tests. |
| JSON and file mutation | Preserve parser semantics and unknown fields, whole-transfer barriers, secret scanning, queues and stale-byte guards. | Format table below; `settings-merge.test.ts`, `merged-sync.test.ts`, `local-fields.test.ts`; apply-boundary Review. |
| Settings/migration | Explicit opt-in, ordered private writes, invalid-file protection, unknown-field preservation, no credential values in review. | `docs/extension-settings.md` Review; existing cross-process settings tests; new rule validation and cancellation/stale-review tests. |
| UI/lifecycle | Observable supported modes, owned cancellation, no automatic activation or prefix changes. | `docs/extension-conventions.md` Review; Settings uses existing Kit settings screen and native input/confirm; lifecycle and remapped review tests retained. |
| Packaging/docs | README warnings/sections, Changeset, both root gates, generated-loader smoke. | `docs/readme-conventions.md` Review; check/test/pack/Jiti/RPC evidence in PR handoff. |

## Authoritative format table

Installed Pi's `dist/core/settings-manager.js` loads `JSON.parse(stripBom(content))`, then migrates queue/steering, websocket/transport, old skill objects and retry delay fields. Public `SettingsManager.inMemory(...).getGlobalSettings()` exercises that migration path without private imports or filesystem writes. Inputs changed by migration are withheld, not repaired. Parser failures are sanitized without retaining raw payload causes.

Installed `dist/core/keybindings.js` parses BOM-compatible JSON, filters invalid binding values, migrates legacy names with canonical-name precedence, orders known names then extras, and delegates matching to TUI. Those aliases and overlapping keys need their own semantic strategy: **keybindings.json remains file-level**.

| Input/unit | Decision |
| --- | --- |
| Global settings.json, UTF-8 object JSON, optional BOM | Eligible only with a verified accepted ancestor and mergeSettings enabled. |
| Comments, trailing comma, nonobject, invalid UTF-8, duplicate/prototype-sensitive keys, over 1 MiB/depth 64/16,384 nodes | Review; original bytes remain unchanged. |
| Scalars, absence, null, unknown fields | Conservative presence-aware three-way decisions; accepted deletion preserves absence. |
| Objects/arrays | Atomic, including unknown nested objects; no array union or unproven recursive invariants. |
| Provider/model, queue/steering, websocket/transport, skills/skill-command fields | Coupled root units; incompatible group edits conflict. |
| Unaffected local members | Raw spelling, separators, ordering, BOM, line endings and trailing bytes retained; new members use local indentation. Output is parsed again. |
| Missing/mismatched/corrupt ancestor | Review, never synthesize current data or rely on remote retention. |

## Ancestors and crash boundaries

Cache only eligible settings.json bytes under the denied private state root. Version-1 records bind ordered selection, local-field rules, setup/backend coordinates and the complete accepted-state fingerprint. Each fingerprint has a bounded private file in a checked private directory. Staging a candidate never replaces the previous state's ancestor. Every cache read validates schema, identity, canonical bytes and SHA; unknown/corrupted evidence is retained. Reader and pruning share private-regular-file, size, schema/identity and byte validation; reading additionally checks file hashes against the supplied accepted state. Nonprivate and nonregular records are never pruning candidates.

| Durable boundary | Recovery |
| --- | --- |
| Cache staging fails before state | Existing state/ancestor survive; merge journal remains; directional accepted remote/apply is reported as persistence failure. |
| Cache exists but state not advanced | Old ancestor remains; publication journal can reconcile known images and restage idempotently. |
| State accepted but journal remains | Accepted fingerprint retires redundant journal without replaying old local bytes. |
| Journal retired, pruning interrupted | Accepted ancestor retained; extra owned historical records are safe to prune later. Unknown records are never pruning candidates. |
| Missing cache after restart/history removal | Field conflicts remain review; remote history is not an ancestor dependency. |

Directional push, pull and rollback stage accepted logical snapshots before baseline acceptance, then prune only after successful acceptance/journal retirement. All critical continuations validate session ownership. Pull and rollback recheck reviewed local bytes/settings/head; full-byte guards conservatively refuse changes even if only excluded fields changed while a plan was pending.

## Portable policy and compatibility

mergeSettings defaults false and is independently toggleable without deleting evidence. localFields is an explicit sorted array of settings.json root names, with bounded safe names and whole coupled-group rules. Existing locked ordered settings persistence remains authoritative; saves preserve unknown fields and invalid files. UI input uses Pi's native editing/paste behavior, with signal and owner checks after every await.

Saving rules explicitly upgrades settings to version 4, including after rule removal; portable snapshots use version 2. Old settings validators/decoders reject these versions. No new schema is inferred from absent fields: unrelated setups in the shared version-4 document retain absent policy and snapshot version 1. Explicit empty rules remain a portable opt-in and require migration from absence. Snapshot version 2 requires an explicit rule array across codecs, backend validators and journal images. Portable codec/transport/raw-remote/upload/accepted images also verify that declared root exclusions are absent, including case-normalized settings paths and escaped JSON keys. Physical journal before/after images intentionally retain local-only values; a portable journal requires an explicit accepted projection. Empty initial acceptance checks policy compatibility, and advisory inspection detects policy-only baseline changes. A setup without rules cannot accept a portable snapshot without explicit configuration. Returning to an older client requires a separately reviewed full copy into a distinct version-3 setup; pending evidence must not be downgraded.

Portable JSON is deterministically canonicalized, excluding selected fields. Local overlay retains latest validated values/absence and unaffected semantic values' raw spelling. Complete settings deletion with any excluded root field present is refused, including null values; validated documents with no excluded fields may be deleted. State hashes and ancestors describe the portable common version; journal before/after describe physical local bytes, accepted describes portable bytes, and upload preserves unmanaged remote files. Journal validation checks the accepted projection against physical after-images. Journal identity preserves policy presence, and the upload policy must match before either candidate retirement or committed recovery. Older ambiguous absent-policy identities fail closed without deleting evidence; reviewed force directions remain the recovery route.

Rule additions/removals and transitions from absent to explicit empty policy block ordinary/background merge. Explicit force directions require extra TUI/RPC migration confirmation even with --yes, warn about old history and removal risks, and validate the fresh setup/local/head before mutation. Push publishes the configured policy; pull only adopts already-matching authoritative remote rules and refuses a mismatch before review or mutation. A pull cannot manufacture a portable baseline against an unchanged nonportable remote. Cancelled/stale review changes neither files nor head. Remote bytes and newly merged/projected content remain subject to secret scanning. Excluding a value now does not erase prior remote history or private backups.

## Limits and evidence

Node cannot provide atomic content CAS against arbitrary external writers; pause those writers for stronger exclusion. Only this process's current session is protected. No resources, model prefix or active tools are changed by transfer. POSIX directory syncing is exercised; Windows and compiled-binary paths are not claimed verified. No live storage/provider transfer is required by deterministic tests.

Root check and 492 files / 6,346 tests passed before the final documentation and additional rollback/parser hardening; final gate counts and packaging evidence belong in the PR handoff, not an inferred completion claim here.
