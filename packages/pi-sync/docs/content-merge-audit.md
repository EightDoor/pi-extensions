# Content merge and partial-progress audit

New content/partial policies are opt-in and leave legacy defaults, directional semantics, and activation unchanged. This phase builds on the safe automatic-transfer and settings/local-field audits; no resource reload, session resume, model-visible prefix transition, cross-extension protocol, or watcher was added.

## Contracts and touched-area rules

The applicable guides are `docs/extension-conventions.md`, `docs/extension-settings.md`, and `docs/readme-conventions.md`. Lifecycle ownership/cancellation, fresh state after awaits, ordered unknown-preserving settings writes, private persistence, sanitized exact reviews, native standard keys/mode behavior, independent packaging, Changesets, root gates and runtime smokes remain mandatory. Native Pi select/confirm and the existing Kit document review own key handling/disposal; there are no new screen-level shortcuts or custom key hints.

Authoritative session sources are installed Pi `core/session-manager.js`/`.d.ts` and `core/messages.d.ts`. Pi's loader repairs incomplete/old logs and ignores malformed lines; the merger deliberately does neither. Only the audited v3 format is eligible. Header and every complete immutable record must remain byte-identical in the prefix; ids are unique, parents are backward references, the first entry is the only null-parent root, context targets/compaction/branch references exist, and every supported kind passes its payload checks. Opaque custom details are retained, not interpreted. Unknown roles/kinds/API migrations and unsupported payloads require review; no branch union or live resume is performed.

Text allowlist: `AGENTS.md`, and Markdown/text below `prompts/` or `skills/`. UTF-8 round-trip validation and NUL refusal precede bounded line-preserving LCS hunks. Equal edits deduplicate; disjoint edits apply deterministically; overlapping replacement, delete/modify, ambiguous insertion boundaries, unsupported encoding, 1 MiB inputs/outputs, or four-million-cell work bounds withhold the whole file. JSON/keybindings/executable code is not generic text. Syntax-level merging cannot establish semantic correctness.

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
