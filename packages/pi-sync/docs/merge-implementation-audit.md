# Sync merge implementation audit

The merge plans are not complete. The file planner is an internal, unused primitive; it does not change `/sync`, startup checks, shutdown pushes, settings, state, or backend publication. Do not enable automatic transfer or claim content/partial merging from this primitive alone.

## Current evidence

`src/sync/file-merge-planner.ts` compares the union of established baseline, local, and remote paths. Undefined baseline means unavailable; an established empty map means every path was absent. File absence is not an empty-file hash.

| Baseline-relative observation | Decision |
| --- | --- |
| Local and remote hashes match, including absence | Accept equality. |
| Remote equals baseline; local differs | Select local bytes or deletion. |
| Local equals baseline; remote differs | Select remote bytes or deletion. |
| Both differ, and final hashes differ | Retain a content conflict. |
| Ancestor unavailable | Require baseline review. |
| Selection incompatible | Require selection review. |
| Remote would replace or delete a protected session | Withhold that path. |
| Case aliases or file/descendant paths occur across the inputs | Withhold the complete colliding path group. |

`test/file-merge-planner.test.ts` covers named decision classes and exhausts combinations of absence, two different nonempty contents, and empty content. It also checks independent edits/deletions, protected-session directionality, missing baselines, selection changes, unsafe/denied paths, checksums, duplicate paths, case/ancestor collisions, deterministic order, and input immutability. Planner errors do not include file contents.

The planner returns conflict evidence alongside accepted decisions. Phase 1 orchestration must refuse the entire transfer when any conflict remains. Returning an accepted decision is not permission to mutate a file or to advance a baseline.

## Existing contracts requiring integration

| Area | Source evidence | Remaining obligation |
| --- | --- | --- |
| Directional operations | `sync/sync-mutations.ts`: `push`, `pull`, `rollback` | Preserve these interfaces; integrate merging only in bidirectional orchestration. |
| Baseline | `state/state-types.ts`, `state/sync-state-store.ts`, `sync/sync-state.ts` | Existing state retains hashes, not verified ancestor contents or unresolved-path acceptance. Define schema compatibility and recovery first. |
| Local recovery | `snapshot/snapshot-transaction.ts` | Current journals restore local preimages. They do not coordinate remote publication, accepted baselines, or content-cache durability. Prevent restoring preimages over newer external edits. |
| Remote outcomes | `backends/sync-backend.ts` | Distinguish proven pre-commit races, after-commit conflicts, and unknown publication outcomes; never blindly retry the latter two. |
| Local mutation queue | Installed Pi `dist/core/tools/file-mutation-queue.js` | `withFileMutationQueue` serializes exact canonical file paths in this process, not external writers or an entire directory tree. Queue applicable targets and revalidate bytes at apply. |
| Startup | `sync/startup-check.ts`, `sync/automatic-sync.ts`, `sync-extension.ts` | Existing automatic startup behavior only observes; shutdown may push when sessions are selected. Preserve absent-policy behavior. |
| Idle boundary | Installed Pi `dist/core/extensions/types.d.ts`: `isIdle`, `agent_settled` | An idle agent is not proof of no external writers. New transfer scheduling needs session ownership, cancellation/draining, and fresh-policy tests. |
| Private settings | `settings/settings-store.ts`, `settings/settings-management.ts` | Persist explicit opt-ins/exclusion changes using the existing queue, validation, cross-process lock, and private atomic publication. |
| Whole-snapshot apply | `snapshot/snapshot-apply.ts` | Missing paths mean deletion. Partial sync needs explicit accepted writes/deletes, not a snapshot with conflicts omitted. |

### Include ordering

No include comparison has changed. `sync-policy.ts` rejects duplicates and overlapping roots; `snapshot.ts` uses membership for built-ins and sessions, iterates custom paths, then sorts collected files. Those observations alone are not sufficient evidence to change every policy comparison.

The remaining audit must cover `sync-state.ts` policy changes; `remote-snapshot.ts` head/snapshot consistency; `settings-management.ts` stale-selection guards; config/review fingerprints in `settings/config.ts`; selection review and attention in `ui/remote-selection-ui.ts` and `ui/sync-attention.ts`; metadata serialization in `snapshot.ts`, `snapshot-codec.ts`, and all backend readers/writers; and their tests. Wire metadata and stale-review identity currently retain ordered lists. Membership and identity/freshness comparisons must not be conflated.

### Formats

Installed Pi `dist/core/settings-manager.js` and `dist/core/keybindings.js` parse JSON after stripping a BOM. This does not establish that recursively merging arbitrary settings is semantically safe. A finite allowlist still needs duplicate-key, dangerous-key, formatting, arrays, migration, and cross-field validation evidence before field merging is integrated.

Installed Pi `dist/core/session-manager.js` includes session migration, `id`/`parentId` trees, branches, and tolerant parsing of session records. Tolerant parsing is not a safety validator for prefix reconciliation. A merge-specific validator must reject incomplete records, unsupported versions, duplicate entries, unknown parent relationships, changed headers, and divergent histories before choosing a longer session. Current-process protection does not establish protection of sessions active in other processes.

## Applicable guides and verification

`docs/extension-conventions.md` requires deterministic behavior tests and both root gates. When orchestration is integrated, its mutation queue, lifecycle, command-mode, cancellation, stable-status, prefix-stability, and generated-runtime requirements also apply. Verify these through source review, focused race/fault/lifecycle/UI tests, and Jiti/package-directory smokes rather than treating a typecheck as semantic evidence.

`docs/extension-settings.md` requires side-effect-free reads, invalid-file protection, unknown-field preservation, ordered durability, private atomic writes, and failure rollback. Verify settings reads and writes together, including cross-process mutations and disabling pending work.

`docs/readme-conventions.md` governs the eventual user guidance. Do not describe unimplemented features in the README. Published behavior changes require a Changeset; an unused internal primitive does not yet introduce published behavior.

## Verification of the current subset

- `npx vitest run packages/pi-sync/test/file-merge-planner.test.ts`: 35 tests pass.
- `npm run check`: workspace builds, Biome, package boundaries, and all workspace typechecks pass.
- `npm test`: 485 test files and 6,237 tests pass, including the existing generated Jiti/lazy-boundary tests.
- `npm --workspace @narumitw/pi-sync run build --if-present`: passes.
- `npm run package:pack -- sync`: passes. The plan's original `-- pi-sync` argument fails because the root workflow adds the `pi-` prefix; use the suffix `sync` instead.
- Actual packing to a temporary directory and tarball inspection confirms the license, README, manifest, generated entry, planner source, and this audit are present, with tests, dependencies, and private settings absent.
- A bounded package-directory RPC smoke loads `packages/pi-sync` through the installed Pi CLI, completes a `get_state` readiness handshake, finds the registered `sync` command, and shuts down successfully on stdin EOF. It uses an isolated agent directory and makes no provider request. Its operation deadline starts after readiness.

These checks verify the current subset, not the unimplemented plan requirements. No live backend transfers, new automatic scheduling, settings/exclusion merging, session merging, partial publication, or new recovery behavior have been exercised. The active runtime graph, command behavior, settings, and state schema are unchanged, so no Changeset is added for this internal preparation. No package publication, version tag, or release dispatch occurred.

## Plan tracking

Branch-local copies of the three requested plans remain under `docs/plans/`. The original files supplied from another checkout are unchanged. Only a task with passing acceptance evidence may be checked; dependency phases, repository gates, recovery, smokes, and final delivery criteria must remain open until verified. Do not delete incomplete plans.
