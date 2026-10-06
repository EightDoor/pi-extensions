# Content merge and partial-progress audit

New content/partial policies are opt-in and leave legacy defaults, directional semantics, and activation unchanged. This phase builds on the safe automatic-transfer and settings/local-field audits; no resource reload, session resume, model-visible prefix transition, cross-extension protocol, or watcher was added.

## Contracts and touched-area rules

The applicable guides are `docs/extension-conventions.md`, `docs/extension-settings.md`, and `docs/readme-conventions.md`. Lifecycle ownership/cancellation, fresh state after awaits, ordered unknown-preserving settings writes, private persistence, sanitized exact reviews, native standard keys/mode behavior, independent packaging, Changesets, root gates and runtime smokes remain mandatory. Native Pi select/confirm and the existing Kit document review own key handling/disposal; there are no new screen-level shortcuts or custom key hints.

Authoritative session sources are installed Pi `core/session-manager.js`/`.d.ts` and `core/messages.d.ts`. Pi's loader repairs incomplete/old logs and ignores malformed lines; the merger deliberately does neither. Only the audited v3 format is eligible. Header and every complete immutable record must remain byte-identical in the prefix; ids are unique, parents are backward references, the first entry is the only null-parent root, context targets/compaction/branch references exist, and every supported kind passes its payload checks. Opaque custom details are retained, not interpreted. Unknown roles/kinds/API migrations and unsupported payloads require review; no branch union or live resume is performed.

Text allowlist: `AGENTS.md`, and Markdown/text below `prompts/` or `skills/`. UTF-8 round-trip validation and NUL refusal precede bounded line-preserving LCS hunks. Equal edits deduplicate; disjoint edits apply deterministically; overlapping replacement, delete/modify, ambiguous insertion boundaries, unsupported encoding, 1 MiB inputs/outputs, or four-million-cell work bounds withhold the whole file. JSON/keybindings/executable code is not generic text. Syntax-level merging cannot establish semantic correctness.

## Review regression audit

The first review follow-up rechecked its six findings against the installed Pi runtime and the current PR head, not their severity badges. Session fixtures enumerate every builtin message/entry discriminant, system/tool transitions, pending/deferred assistant records and provider-scoped tool IDs. Public `SessionManager` fixtures verify retain-none compaction self-references, re-edit root entries and branch-summary root sentinels; forward references, damaged payloads and divergent byte histories still remain withheld.

Partial artifact persistence now follows approved review and fresh local, baseline, owner/config and remote-head checks. Cancelled or stale transfer reviews do not create new conflict artifacts and preserve existing evidence. A manual no-transfer inspection may still persist referenced conflict state; uncertain failures after approved persistence retain evidence rather than pruning unproven records. Automatic new-transfer plans stop at unresolved conflicts even when partial sync is enabled. All content and reviewed-resolution protection checks use the already resolved session root.

Raw collision participants must all be represented in the managed plan (including accepted-baseline paths now absent on both sides) before partial withholding is allowed. Unmanaged case aliases, unmanaged ancestor/descendant paths and cross-policy collisions remain barriers. Managed collision groups still preserve both sides, including explicit absence. The conflicts route now completes `--setup` and known setup values, but does not offer unsupported bypass flags.

Verification: `content-merge.test.ts`, `partial-sync.test.ts` and `sync.test.ts`; the new regressions produced 23 failures on the reviewed source and pass with the fixes. Semantic audits cover cancellation, after-await ownership/freshness, immutable prefix/reference handling, the full collision path set, portable acceptance ordering and retained evidence. No default, model-visible prefix, resource activation or automatic session-resume behavior changes.

### Subsequent review evidence

The next five findings are independently verified and covered by public session-ID grammar fixtures, committed partial-recovery fault injection, connected-closure equivalence/scale tests, bounded preview tests and manager dispatch/cancellation tests. The new header predicate mirrors Pi's public alphanumeric-ended grammar (including internal dots and long IDs), separately from generated entry IDs.

Recovery permits baseline-only absent paths only with the pinned previous-state fingerprint and matching retained artifact group/hash evidence. Unknown paths and forged group membership still refuse recovery; restart rolls forward without republishing or resurrecting equal deletions.

Indexed identity/ancestor/resource/include edges replace pairwise grouping rescans without changing conservative closure. Group/hash indexes also replace repeat scans in artifact reuse and journal verification. The 16,384-independent-conflict scale fixture completed in 18 ms in one local run and normalizes each path once; this measurement is not a timing guarantee.

Preview indexes each version once, enforces cumulative raw display bytes before decoding/appending, preserves exact line endings and binary fallback, and leaves raw evidence unchanged. Compact sanitized labels avoid listing every path before group selection. Artifact loading/verification still reads the bounded private record; the display budget prevents additional whole-group materialization, not that required verification.

The manager conflicts action dispatches direction/selection decisions through the existing sync-origin reviewer and propagates cancellation/closure. Targeted tests reproduced 13 failures on the preceding reviewed source; fixed fixtures remain under the existing 5,000 ms timeout. No defaults, model-visible prefix or activation behavior changes.

## PR #1459 feedback ledger

Every inline item was classified against the current branch and the installed Pi implementation; review-summary and conversation comments contain no additional requests. The first eleven items are **already addressed by current code** and their threads were replied to and resolved before this follow-up:

| Inline comment | Evidence |
| --- | --- |
| 4187925529 valid v3 records | `45fbff77`, `content-merge.test.ts` Pi writer/system/compaction fixtures |
| 4187925535 cancelled artifact writes | `45fbff77`, `partial-sync.test.ts` repeated cancellation |
| 4187925541 startup conflict barrier | `45fbff77`, automatic partial-conflict regression |
| 4188176574 effective session root | `45fbff77`, external loaded-session protection |
| 4188176583 unmanaged collisions | `45fbff77`, unmanaged/cross-policy collision regressions |
| 4188176594 setup completions | `45fbff77`, `sync.test.ts` route completions |
| 4190474935 dotted IDs | `8f6f2aa5`, public session-ID grammar fixtures |
| 4190474942 absent recovery paths | `8f6f2aa5`, pinned baseline-only deletion recovery |
| 4190474952 grouping complexity | `8f6f2aa5`, 16,384-conflict grouping fixture |
| 4190474960 preview materialization | `8f6f2aa5`, bounded preview/decoder fixtures |
| 4190474965 conflict-route dispatch | `8f6f2aa5`, RPC manager route/review tests |

Four later findings were **actionable and not yet addressed** at the preceding head; this follow-up implements them:

| Inline comment | Change and verification |
| --- | --- |
| 4190830248 transactional `sessionDir` | Journal v4 pins the settings postimage; recovery authorizes the root from hash-checked reviewed/backup settings before reading a mutable live value, while preserving explicit-manager and current-session barriers. `snapshot-transaction-recovery.test.ts` covers old-root and malformed-postimage interruption; `recovery-durability.test.ts` covers manager mismatch and newer bytes. Unsupported old evidence remains manual rather than guessed. |
| 4190830255 reused artifact group | New artifacts contain only newly assigned groups and their version/ancestor files; unchanged groups keep their original token. `partial-sync.test.ts` verifies both tokens, membership and file subsets after a changed-group transfer. |
| 4190830258 content lookup complexity | Indexed local, remote, ancestor, protected and decision paths once per plan, without changing merge eligibility; existing content/partial fixtures and full package suite exercise both text and session paths. |
| 4190830261 reviewed collisions | Distinguish mutually exclusive case aliases from simultaneous physical aliases, check protected preimages and selected final layout, reject unknown directory contents, delete reviewed preimages before replacing them and recreate parent directories after removal. `partial-sync.test.ts` exercises remote case rename and both file/directory transitions; `merge-target-safety.test.ts` retains active-session and cross-root alias refusals. |

No new question, superseded finding, or conflicting/incorrect request was identified. Semantic audit: all four changes preserve owner/cancellation checks at publication and destructive boundaries, keep newer/unrecognized bytes and journals rather than overwriting them, and do not change extension settings reads/writes, model-visible prefixes, UI keybindings or activation. Arbitrary concurrent external writer CAS, live providers, Windows and compiled startup remain unverified.

## Concurrent stack integration

Phase 3 includes the latest Phase 2 portability fixes and the latest Phase 1 target-identity/session-root/recovery hardening, without rewriting either other feature branch. Physical pre-publication/recovery guards compare raw local images, while accepted cache/state remains a portable projection. Version-5 setup/connection CRUD and menus preserve the new schema; all transport validators, including Git manifests, accept the deliberate snapshot-v3 barrier. Shared backend-contract fixtures now exercise both v2 and v3 round trips on Git (both publication paths), S3 and WebDAV, and settings-manager fixtures exercise versions 3, 4 and 5.

## Versioned state and transitions

| Boundary | Local content | Remote publication | Accepted state / recovery |
| --- | --- | --- | --- |
| Default policy | Existing file/optional settings strategy | Existing complete snapshot | Existing acceptance semantics |
| Partial plan with conflicts | Preserve every withheld local path, including additions and physical machine-local settings | Complete v3 snapshot retains every observed withheld remote path, including absence | v3 progress state retains withheld hashes/ancestors; Last observed advances separately; Last applied remains the last fully accepted snapshot |
| No independent transfer | No content mutation | No redundant publication once v3 barrier is present | Deduplicated conflict references and observed head persist; no unresolved baseline advancement |
| Proven pre-commit race | No local install | Finite re-read/replan retry under backend CAS/lease | Private immutable evidence retained/reused by content identity |
| Unknown publication / apply / state failure | Guarded preimage/postimage roll-forward only | Verify candidate/head; never blindly republish | Journal and backup retained; cache staging precedes state; unresolved artifacts are verified before recovery |
| Explicit group resolution | Chosen complete local/remote group, including reviewed deletion | Preserve all other unresolved remote groups | Compare reviewed artifact fingerprint, bytes, baselines, policy, owner and observed revision; retire resolved references only after durable acceptance |
| Newer local or remote bytes | Refuse stale choice/install | No unreviewed overwrite | Refresh sync and review; preserve evidence |
| Disable / downgrade | No undo or reload | No historical erasure | Re-enable partial or review a full forced direction; keep evidence; older settings/snapshot readers refuse new formats |

Settings v5 explicitly gates content/partial booleans; partial publication uses snapshot v3, including the first metadata-only barrier when content hashes are otherwise unchanged. v4 local-field behavior and legacy absent policy remain intact. Legacy directional force operations are still whole selected-copy acceptance, not deferred group resolution; their reviewed journal-archive behavior is unchanged.

Dependency grouping includes canonical case/Unicode aliases, ancestor file/directory transitions, and an entire prompts/skills/extensions/themes resource root when any member conflicts. Unproved selection, malformed bytes/metadata, unauthorized filesystem layouts and invalid settings remain global barriers rather than being invented into safe groups. Active loaded-session aliases cannot be resolved from that session; external Pi/editor writers have no arbitrary content CAS guarantee.

## Evidence and private retention

Accepted ancestors are identity/fingerprint/hash checked and never invented from independently edited current content. Staging carries old evidence only where its hash is still the accepted withheld hash. Private artifacts contain baseline content where verified, both logical versions and explicit absence, grouping and observation; unavailable ancestors are labelled unavailable, not absent. They use opaque content identities, immutable reuse, 0600 files / 0700 POSIX directories and bounded atomic JSON publication under denied storage. They are not resource files or portable payloads. Exact requested review is capped at 2 MiB; larger groups require private/manual inspection and a reviewed direction.

After durable acceptance and journal retirement, completed cleanup retains at most 32 unreferenced artifacts whose paths are proven common against accepted/local/remote images and equal one recorded choice. Pinned unresolved records, unknown schemas, corrupted evidence and unproved orphan records are retained. Per-record bounds are not a promise of a total unresolved-history quota.

## Verification map

- `content-merge.test.ts`: deterministic/equal/overlapping hunks, deletion/modification, CRLF, no final newline, binary/invalid UTF-8, size/complexity bounds; equal/comparable sessions, divergence, malformed/partial/blank records, old/future formats, changed header/identity, duplicated ids and broken references.
- `partial-sync.test.ts`: real orchestration with accepted cache; both withheld images and old baseline surviving restart, local-only dependency members, remote collisions with independent progress, missing ancestors, stale bytes/artifact fingerprints, explicit deletion without resurrection, partial state-write failure and guarded recovery without republishing, three-machine interleaving/convergence and stable conflict identity, RPC cancellation, private modes, pinned/unknown retention and completed cleanup.
- Existing `merged-sync`, `merge-review`, automatic-transfer, settings/local-field, transaction recovery, all backend publication/CAS/unknown-outcome suites, generated-runtime and Jiti tests remain the shared protocol/lifecycle regression gates. Exact review keeps their non-default-keybinding, non-interactive rendering, cancellation and hard Ctrl+C contracts.

Scheduling evaluation measured two repeated unchanged-head partial operations: **two verified remote reads, zero publications, zero new artifacts**. Revision-only shortcuts would save those reads but cannot prove mutable content equality; no watcher/debounce/polling is added. The artifact identity optimization reduces repeated identical evidence to one record without skipping content/head revalidation. There are no new timers or watcher disposal obligations.

Repository check/test, package build/pack/tarball, generated lazy-boundary Jiti and isolated RPC smoke evidence is recorded in the Phase 3 PR. Live Git/WebDAV/S3/R2 providers, Windows filesystem persistence and compiled-binary startup remain unverified; deterministic backend contracts replace live-provider claims. The safe session strategy is intentionally narrower than Pi's repair-tolerant reader, and very large/private/unsupported conflict groups remain manual paths.
