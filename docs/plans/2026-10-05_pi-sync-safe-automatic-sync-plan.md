# Pi Sync Phase 1: Safe Automatic Sync

## Goal

Reduce manual direction choices by merging independent file changes, and offer explicit opt-in automatic transfer without weakening backup, concurrency, session protection, or resource-loading safety.

This is an implementation plan, not a description of shipped behavior. Complete this phase before [Phase 2](2026-10-05_pi-sync-settings-merge-plan.md); [Phase 3](2026-10-05_pi-sync-content-merge-plan.md) adds content merging and partial progress.

## Context

`packages/pi-sync/src/sync/sync-mutations.ts` currently asks for a direction when both sides changed against a baseline, except when the complete snapshots already match. `state/state-types.ts` stores per-file baseline hashes, sufficient for file-level decisions but not content merging. `sync/startup-check.ts` only inspects; `sync/automatic-sync.ts` pushes selected content at shutdown only when automatic sync and sessions are enabled. Preserve these existing semantics unless a separately enabled transfer policy applies.

`sync/sync-policy.ts` compares ordered include lists. Order-only review can be removed only after proving that order has no transfer, permission, or selection effect across all consumers.

## Non-Goals

No timestamp-based winner, JSON or text content merge, partial publication during unresolved conflicts, watcher or polling loop, CRDT, automatic reload, credential synchronization, or new print/JSON command support. Explicit push and pull remain directional operations; do not silently turn them into bidirectional merge.

## Touched Areas and Required Verification

| Area | Applicable requirements | Verification |
| --- | --- | --- |
| Merge and file mutation | Serialize applicable Pi file mutations; preserve deny rules, backups, transaction recovery, secret scanning, protected sessions, and conditional backend publication. | Review write boundaries; Test decision classes, races, crash recovery, and backend contracts. |
| Lifecycle and background transfer | MUST start owned work after factory load, release it on shutdown/replacement, and avoid stale context after awaits or reload; use `agent_settled` as the idle boundary. | Review ownership; Test cancellation, disposal, shutdown, and generation changes. |
| Settings | MUST follow `../extension-settings.md`: explicit opt-in defaulting to existing behavior, side-effect-free reads, validation, unknown-field preservation, private atomic writes, ordered durable saves, and failure rollback. | Test settings storage, cross-process ordering, invalid-file protection, and immediate policy changes. |
| Commands, status, and TUI | MUST preserve public routes, observable supported modes, TUI-only custom UI, stable status ownership, cleanup, and width-bounded widgets. | Test TUI/RPC and print/JSON rejection; Review sanitized output and configured keybindings. |
| Documentation and release | MUST follow `../extension-conventions.md` verification and Changeset rules; preserve README warnings and structure under `../readme-conventions.md`. | Review semantic diff; Validator `npm run check`; Test `npm test`; applicable runtime Smoke. |

## Architecture

Keep a pure per-path planner under `packages/pi-sync/src/sync/`, separate from mutation orchestration and the session-owned scheduler. Compare the union of baseline, local, and remote paths; absence is an explicit state, not an empty-file hash.

| Baseline-relative observation | Decision |
| --- | --- |
| Both sides equal, including both absent | Accept equality; preserve existing identical-snapshot behavior. |
| Only local differs | Select local content or deletion. |
| Only remote differs | Select remote content or deletion. |
| Both differ and final contents differ | Require review; includes different concurrent additions and delete/modify conflicts. |
| Missing baseline or incompatible selection | Retain initial-source or selection review. |

Phase 1 is all-or-nothing: any unresolved path prevents the merged transfer. Classify content conflict separately from policy review and backend publication races. Do not advance the baseline before the committed outcome is known.

Automatic transfer is a new per-setup opt-in policy, with final field naming decided during discovery. Existing automatic settings retain their startup-check and shutdown behavior when the new policy is absent. Successful authorized transfers produce a concise summary, not repeated confirmations. First-source selection, changed include membership, missing established remote, secrets, and unresolved conflicts remain review barriers. Transfers never automatically reload extensions or rewrite the active model-visible prefix.

## Plan

- [ ] Inventory decision and include-order consumers in `sync/`, `snapshot/`, settings, all backends, and tests; record a complete decision table and prove whether include order is semantically irrelevant before changing comparisons. Acceptance: source-backed Review and regression cases for order-only versus membership changes.
- [ ] Define the automatic-transfer opt-in and safe apply boundary using installed Pi lifecycle APIs; distinguish idle from absence of external writers and document TUI/RPC/headless behavior plus startup and shutdown interaction. Acceptance: approved policy table and tests demonstrating absent settings retain current behavior.
- [x] Add the pure file-level planner with explicit missing-path states and protected-session handling. Acceptance: table-driven Tests cover unilateral additions, edits, deletions, independent edits, equal concurrent changes, divergent additions, delete/modify, missing baseline, case/path collisions, and selection changes. Evidence: `packages/pi-sync/test/file-merge-planner.test.ts` passes 35 tests, including exhaustive absence/hash equivalence combinations; the planner remains unintegrated.
- [ ] Add merged transfer orchestration without changing explicit push/pull semantics; revalidate local hashes, setup identity, selection, session ownership, and remote revision before commit. Acceptance: Tests preserve both independent edits and reject stale local plans without overwriting newer bytes; Review documents unavoidable external-writer limits.
- [ ] Define publication/apply/state ordering using existing backend conflict phases and transaction recovery; recover crashes between every durable boundary. Acceptance: fault-injection Tests cover upload success/local failure, baseline-write failure, cancellation before and after commit, and ambiguous publication without false success or lost edits.
- [ ] Add bounded replan/retry only for proven pre-commit revision races; preserve backend capability constraints and never blindly retry after-commit or unknown outcomes. Acceptance: deterministic backend Tests cover successful race recovery, finite exhaustion, network failure, and unknown-outcome reconciliation.
- [ ] Persist the opt-in through the existing private settings store and expose it in the owning Settings screen with accurate permissions and reload guidance. Acceptance: settings Tests cover invalid files, unknown fields, ordered saves, cross-process races, write failure, and turning the policy off while work is pending.
- [ ] Schedule one startup observation/transfer attempt at a validated idle boundary, with foreground commands cancelling and draining background work; retain existing shutdown behavior without overlapping transfers. Acceptance: lifecycle Tests cover busy startup, idle startup, replacement, reload, abort, shutdown, and shared headless UI ownership; no polling or watcher is introduced.
- [ ] Separate review attention from successful-transfer summaries and reload-needed information; normalize include equality only if the discovery proof passes. Acceptance: TUI/RPC Tests show no modal for authorized conflict-free transfer, review persists for real barriers, and resource code is never activated automatically.
- [ ] Update the package README and add a pi-sync Changeset for implementation behavior. Acceptance: Review states opt-in defaults, automatic compatibility, deletion behavior, trust boundaries, recovery, and remaining manual cases without claiming future phases.

## Rollback / Recovery

Disabling the new policy stops and drains pending background work but does not undo completed transfers. Keep existing backups and immutable remote history; restore only through a reviewed recovery operation against the current head. Journal any new cross-boundary operation before mutation and never restore old bytes over newer unreviewed edits. If state schema changes, define compatibility and refusal behavior before writing it; do not claim that an older binary can safely consume new state without a test.

## Completion Checklist

- [ ] File-level decision and all commit/recovery boundaries have passing deterministic coverage; true conflicts still stop the complete Phase 1 transfer.
- [ ] Existing installations keep current automatic semantics and explicit push/pull interfaces; enabling and disabling the new policy pass settings and lifecycle audits.
- [ ] Run `npm run check` and `npm test` separately from the repository root; rebuild pi-tui-kit before consumer tests and do not overlap root gates with Kit checks/builds.
- [ ] Build with `npm --workspace @narumitw/pi-sync run build --if-present`; exercise the generated lazy boundary through Pi's Jiti loader and use a bounded non-interactive harness for the package-directory `pi -e ./packages/pi-sync` Smoke. Record impractical live paths instead of claiming coverage.
- [ ] If metadata or published contents change, run `npm run package:pack -- sync` and inspect the tarball; otherwise record why packing is not applicable.
- [ ] Handoff names the guides, semantic audits, passing checks, smokes, deviations, and unverified paths; no publication, tag, or release workflow occurs without explicit approval.
- [ ] Delete this plan only after its tasks and completion checks pass, retaining durable behavior guidance and evidence outside the plan.
