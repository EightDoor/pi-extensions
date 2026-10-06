# Pi Sync Phase 3: Content Merge and Partial Sync

## Goal

Merge independent text changes, reconcile safe session extensions, and let independent conflict-free paths synchronize while genuine conflicts remain available for later review. Preserve every divergent version without loading recovery copies as Pi resources.

This phase depends on [Phase 1](2026-10-05_pi-sync-safe-automatic-sync-plan.md) and [Phase 2](../../packages/pi-sync/docs/settings-merge-audit.md). Finish and verify each dependency before enabling the features below. This is planned behavior, not an implemented guarantee.

## Context

`packages/pi-sync/src/snapshot/snapshot-types.ts` models complete snapshots. `state/state-types.ts` records one snapshot identity and per-file hashes, but no explicit unresolved-path state. Partial sync therefore needs a state contract that distinguishes an observed remote head from each path's accepted baseline.

`snapshot/snapshot-apply.ts` deletes absent managed paths and protects the current session. A partial result cannot simply omit a conflicted file: absence could become a deletion. `sync/sync-mutations.ts` identifies the active session through `sessionManager`; preserve this protection and discover the full Pi session entry/branch contract before implementing reconciliation.

## Non-Goals

No mtime-based overwrite, LLM conflict resolution, generic binary merge, CRDT, blind JSONL concatenation, arbitrary divergent-session union, automatic resource reload, mandatory Git dependency for WebDAV/S3 users, or new cross-extension coordination. Content that merges syntactically is not guaranteed semantically correct; document that limit.

## Touched Areas and Required Verification

| Area | Applicable requirements | Verification |
| --- | --- | --- |
| Content and session mutation | Preserve Phase 1/2 deny rules, backup, secret scanning, authoritative format validation, applicable Pi file-mutation serialization, and transaction recovery. | Review merge equivalence classes; Test text fixtures, session structure, crash boundaries, and stale writers. |
| Partial state and publication | Separate observation from acceptance; never advance an unresolved path's baseline or interpret withheld content as deletion. | Test multi-machine convergence, mixed-version state, full-snapshot application, and every backend conflict phase. |
| Async review and lifecycle | MUST release owned tasks on cancel/dispose/shutdown, avoid stale continuations, and preserve stable status ownership under `../extension-conventions.md`. | Review every await/owner boundary; Test replacement, reload, hard cancellation, repeated disposal, and persistent attention. |
| Settings and UI | MUST follow `../extension-settings.md` for opt-ins and migration; TUI-only custom screens, supported-mode observability, bounded/sanitized rendering, and configured standard actions. | Test persistence failures, invalid files, TUI/RPC, unsupported modes, non-default keybindings, and non-interactive previews. |
| Documentation and release | MUST add deterministic tests, pass both gates, and add a Changeset for published behavior; follow `../readme-conventions.md`. | Validator `npm run check`; Test `npm test`; applicable pack and Jiti/package-loader Smoke. |

## Architecture

### Text and sessions

Use Phase 2's verified baseline store for three-way text merge. Select a minimal merge implementation after reviewing supported-platform and dependency requirements; Git's `merge-file` behavior is a reference, not a mandatory backend dependency. Scope the allowlist to supported UTF-8 text; binary or unsupported encodings remain file conflicts. Clean merges may be accepted; never write conflict markers into managed files.

For sessions, validate the authoritative format, session identity, entry identities, parent/branch relationships, and complete-record boundaries. Different session paths already benefit from Phase 1's file merge. For the same path, accept a longer version only when the shorter validated history is an exact prefix and the extension is structurally valid. A partial final record, changed header, duplicated entry, divergent append, compaction rewrite, or unsupported format requires review. Never overwrite the active session; do not claim protection of sessions active in other Pi processes without a public, tested ownership mechanism.

### Partial progress and conflicts

Represent accepted path baselines, deletions, unresolved versions, conflict identities, and the last observed remote revision separately. An unresolved path keeps its previous accepted ancestor across transfers and restarts. If conflict-free publication changes the remote snapshot, that is not proof the conflict disappeared.

Keep immutable conflict artifacts with private permissions under the denied pi-sync state root, not `extensions/`, `skills/`, or another discoverable resource directory. Preserve baseline/local/remote evidence where available, bound storage, and never prune unresolved artifacts automatically. Deduplicate attention by conflict identity; show a persistent count rather than repeated modal prompts.

Publish a complete remote snapshot: update only accepted paths and preserve the observed remote versions of unresolved paths. Apply only explicitly accepted local writes/deletes; do not reuse whole-snapshot omission as a partial apply plan. Re-read and replan when the head changes. Treat path/file-directory collisions and semantically coupled resources as indivisible dependency groups; defer the group if independent application cannot be proven safe. Initially keep partially conflicted JSON files and sessions atomic even when some internal fields or records could merge.

## Plan

- [ ] Complete Phase 1/2 and inventory complete-snapshot readers, protected sessions, deletion planners, baseline consumers, and installed Pi session branches. Acceptance: source-backed Review lists every relevant decision branch and records compatibility limits for external active writers and older clients.
- [ ] Specify versioned partial-state and conflict schemas, crash recovery, accepted deletion semantics, retention, and downgrade behavior before implementation. Acceptance: reviewed transition table distinguishes observed head from per-path acceptance and proves unresolved content survives whole-snapshot operations.
- [ ] Choose a bounded text-merge implementation and explicit file allowlist without imposing Git on other backend users. Acceptance: dependency/platform Review plus fixtures proving non-overlapping edits merge deterministically and overlapping edits never install markers.
- [ ] Integrate validated text merging with baseline availability, output bounds, secret scanning, and opt-in policy. Acceptance: Tests cover insertions, deletions, adjacent/overlapping hunks, line endings, missing newline, large files, invalid UTF-8, binary files, absent ancestors, and a newer local edit during planning.
- [ ] Implement conservative same-session prefix reconciliation against the authoritative entry and branch contract. Acceptance: Tests cover valid extension, equal history, partial trailing record, changed identity/header, duplicate or invalid entries, divergent appends, compaction/rewrite, and active-session protection; no generic JSONL concatenation is used.
- [ ] Add private immutable conflict artifacts and durable unresolved-path state under denied storage. Acceptance: Tests prove artifact integrity, secret-safe output, bounded completed-artifact cleanup, unresolved retention, restart restoration, setup isolation, and no resource discovery or snapshot inclusion.
- [ ] Add explicit accepted-path apply plans and dependency grouping so conflicts cannot turn into deletions or broken file/directory transitions. Acceptance: Tests combine accepted edits/deletes with withheld paths, local/remote asymmetry, case collisions, resource dependencies, and currently protected sessions.
- [ ] Publish accepted changes while preserving current remote conflicted versions, and advance only accepted baselines after durable success. Acceptance: three-machine/backend Tests cover interleaved edits, partial sync then restart, later conflict resolution, deletion without resurrection, no conflict forgetting, bounded pre-commit retries, and unknown publication outcomes.
- [ ] Add opt-in partial progress and deferred conflict review through the existing manager, not a second command framework. Acceptance: persistence and UI Tests retain current behavior when disabled, show one deduplicated pending-conflict count, keep unrelated progress visible, and sanitize paths/session text without exposing content secrets.
- [ ] Resolve selected conflicts against freshly validated artifacts, local bytes, setup identity, policy, and remote revision; keep explicit push/pull and recovery semantics documented. Acceptance: Tests cover stale review, cancellation, disposal, hard Ctrl+C under non-default keybindings, artifact failure, chosen deletion, and retry without overwriting unreviewed changes.
- [ ] Evaluate debounced local-change scheduling and unchanged-revision fast paths as a final substep, retaining no polling by default. Acceptance: measured before/after operation counts plus Tests prove ignored sync-generated events, cancellation, no overlap, no shutdown leaks, and content revalidation before apply; do not accept metadata equality as definitive content equality.
- [ ] Update package guidance and a pi-sync Changeset with supported text/session formats, pending-conflict behavior, retention, active-session limits, opt-ins, and downgrade instructions. Acceptance: semantic Review distinguishes syntax-level merge from semantic correctness and documents all remaining manual paths.

## Rollback / Recovery

Disable partial progress and drain owned work before changing its state or restoring data. Retain unresolved artifacts and ancestors; do not collapse new per-path state into a single last-snapshot marker. Before an older binary is used, provide a tested migration or refuse stateful work with actionable recovery guidance. Recovery must compare current local and remote state before restoring bytes, preserve newer unrelated changes, and never activate extension recovery copies. Disabling features does not reverse published snapshots or delete conflict history.

## Completion Checklist

- [ ] Text and session merging pass authoritative-format and adversarial fixtures; active sessions remain protected and unresolved versions remain recoverable without resource discovery.
- [ ] Partial-sync transitions pass deterministic multi-machine convergence, crash, baseline, deletion, dependency-group, and all-backend publication audits; conflicts neither vanish nor block proven-independent paths.
- [ ] Review is non-modal until requested, fresh on commit, cancellable, mode-correct, width-bounded, and tested with non-default bindings and non-interactive rendering.
- [ ] Scheduling optimizations have recorded operation-count evidence and no watcher/timer leaks; absent opt-ins retain current behavior and no background operation reloads Pi resources.
- [ ] Run `npm run check` and `npm test` separately from the repository root; rebuild pi-tui-kit before consumer tests and keep root gates separate from Kit builds/checks.
- [ ] Build with `npm --workspace @narumitw/pi-sync run build --if-present`; exercise generated lazy boundaries through Jiti and run a bounded non-interactive package-directory `pi -e ./packages/pi-sync` Smoke when runtime loading changes.
- [ ] If metadata or published contents change, run `npm run package:pack -- sync` and inspect the tarball; stop after one clear entitlement failure in a provider smoke and record deterministic substitutes and unverified paths.
- [ ] Handoff records applicable guides, semantic audits, checks, smokes, compatibility, Changeset, deviations, and accepted limits; no unapproved publication, tags, or release dispatch.
- [ ] Delete this plan only after all tasks and completion checks pass, keeping durable state/format/recovery guidance and verification evidence outside the plan.
