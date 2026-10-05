# Pi Sync Phase 2: Settings Merge and Machine-Local Fields

## Goal

Automatically combine independent JSON setting changes and keep explicitly excluded machine-local values on their originating machines. Only incompatible changes to the same merge unit require review.

This phase depends on the planner, commit recovery, and opt-in policy from [Phase 1](2026-10-05_pi-sync-safe-automatic-sync-plan.md). [Phase 3](2026-10-05_pi-sync-content-merge-plan.md) extends the content pipeline to text and sessions. This document plans future behavior; it does not authorize implementation or publication.

## Context

`packages/pi-sync/src/snapshot/snapshot-types.ts` stores file contents and hashes in snapshots, while `state/state-types.ts` keeps only baseline hashes. A field-level three-way merge requires verified baseline contents. Remote history alone is insufficient because retention, accessibility, and identity are not guaranteed.

The Pi `settings.json` being synchronized is distinct from the extension-owned private `pi-sync.json`. Keep pi-sync policy and credentials in its existing settings store; never include its private file, operational state, baseline cache, or recovery files in a snapshot.

## Non-Goals

No generic merge for every JSON file, secret synchronization, automatic schema repair, array union, new project-settings scope, mutation of Pi's private settings implementation, or partial progress while another path is unresolved. Do not add a separate machine-local override file unless an authoritative Pi API can apply it; this phase preserves excluded fields in the existing local target instead.

## Touched Areas and Required Verification

| Area | Applicable requirements | Verification |
| --- | --- | --- |
| Baselines and managed files | Preserve Phase 1 mutation serialization, deny rules, backups, recoverability, hash verification, and safe commit ordering. | Review storage boundaries; Test restart, corruption, stale plans, pruning, and failures. |
| Extension settings and exclusions | MUST follow `../extension-settings.md`: validated explicit overrides, no side effects from absent-file reads, ordered/private atomic writes, invalid-file protection, unknown-field preservation, and failure rollback. | Test load/save/migration, exclusion rules, immediate runtime changes, and concurrent processes. |
| UI and commands | MUST preserve public routes and mode observability, TUI-only custom screens, owned cancellation, width bounds, and lifecycle cleanup under `../extension-conventions.md`. | Test TUI/RPC and unsupported modes; custom keys with non-default bindings; Review terminal sanitization. |
| Resource and prefix safety | Preserve ordinary-turn model-visible prefix; no automatic reload or extension activation. | Review apply/reload boundaries; Test unchanged active resources across background merge. |
| Documentation and release | MUST add deterministic behavior tests, pass both gates, and add a Changeset for published behavior; follow `../readme-conventions.md`. | Validator `npm run check`; Test `npm test`; loader Smoke when runtime graph changes. |

## Architecture

Extend the owning sync planner with format-specific merge strategies, not backend-specific policies. Keep parsing, three-way decisions, serialization, and file commit separate but within pi-sync.

Persist the last successfully accepted mergeable baseline locally under the denied state root, with private permissions, explicit schema, setup/backend/selection identity, and verified hashes. Bind its durability and pruning to Phase 1's commit journal. Cache only required baseline content; unavailable, mismatched, or corrupt baselines fall back to review without inventing an ancestor.

Merge recognized JSON object fields using baseline/local/remote presence and values. Preserve unknown fields through the same conservative three-way rules; do not drop them during serialization. Treat arrays as indivisible units initially. Different concurrent additions of the same field, deletion versus modification, and incompatible type changes are conflicts. Independent objects may merge recursively only where format semantics permit; verify cross-field invariants before accepting the result.

Discover supported files and actual parsers before choosing a merge allowlist. Candidates are `settings.json` and `keybindings.json`, not promises that all content in either file is safe to combine. Preserve the supported syntax, comments if accepted, encoding, and unaffected formatting; do not silently rewrite a JSONC file as plain JSON.

Machine-local exclusions are explicit path/field rules owned by pi-sync, not heuristic filtering. The remote portable projection omits excluded fields; apply overlays portable results onto the latest validated local document while preserving excluded values and absence. Detect rule changes separately from edits and require a migration review before removing previously uploaded data. Explain that excluding a secret now does not erase old remote history.

## Plan

- [ ] Complete Phase 1 and re-audit its baseline and recovery contracts; verify current parsers and runtime semantics for candidate JSON files through installed Pi implementation and public APIs. Acceptance: source-backed format/field compatibility table and a finite initial allowlist, including array and cross-field constraints.
- [ ] Design versioned baseline storage, identity binding, private permissions, retention, and older-state behavior; specify publication/apply/cache/state crash recovery before implementation. Acceptance: Review of schema and failure matrix; no dependence on permanent remote history.
- [ ] Implement verified baseline capture and retrieval only after accepted operations, with bounded storage and safe pruning. Acceptance: Tests cover restart, first sync, setup switch, history deletion, hash mismatch, corruption, interrupted cache write, and retention without deleting a needed ancestor.
- [ ] Add pure field-level three-way merge for the initial allowlist. Acceptance: table-driven Tests cover independent fields, equal edits, absent versus null, unknown fields, additions, deletions, delete/modify, type changes, nested object decisions, and atomic arrays; invalid inputs remain unchanged and require review.
- [ ] Add format-aware output and semantic validation; preserve unaffected bytes where supported and reject unsupported constructs rather than silently changing their meaning. Acceptance: parser-compatible fixtures cover formatting, encoding, duplicate-key handling, supported comments, dangerous object keys, and interdependent settings; deterministic output passes the authoritative parser.
- [ ] Integrate field merging after file-level conflict detection, scanning all newly publishable merged content for secrets and revalidating current local bytes before apply. Acceptance: Tests show different theme/model edits merge, same-field divergence remains review, and a stale merge never overwrites a newer local edit.
- [ ] Define and persist explicit machine-local exclusion rules through the existing pi-sync settings store. Acceptance: settings Tests cover invalid rules, unknown-field preservation, ordered saves, private publication, cross-process changes, and no implicit project scope or automatic sensitive-field discovery.
- [ ] Implement portable projection and local overlay without advancing baselines incorrectly for excluded values. Acceptance: two-machine Tests preserve different local paths/values, never upload excluded fields, retain local deletion, and avoid false conflict loops after restart or rule changes.
- [ ] Add a reviewed migration for exclusion additions/removals and existing remote projections. Acceptance: Tests ensure cancellation changes nothing, stale reviewed state is rejected, old remote history is not represented as erased, and removal cannot silently replace a local-only value.
- [ ] Extend review details to identify conflicted fields while retaining Phase 1 all-or-nothing transfer. Acceptance: TUI/RPC Tests display sanitized paths/field names without credential values, cancellation is mutation-free, and custom review rendering works non-interactively.
- [ ] Update package-owned settings guidance, README, and a pi-sync Changeset. Acceptance: Review documents supported formats, array policy, local baseline sensitivity, missing-baseline fallback, exclusions, history limitations, and compatibility without promising Phase 3.

## Rollback / Recovery

Disable field merging or remove an exclusion only through a reviewed policy change; disabling must not delete baseline or recovery evidence. Restore files using the existing backup/review flow against current local bytes and remote revision. A portable snapshot may omit machine-local fields, so whole-file restoration must preserve their latest local values or explicitly warn before replacement. Define tested upgrade/downgrade handling for the new baseline schema; refuse unsupported state rather than reinterpret it or recreate an ancestor from current data.

## Completion Checklist

- [ ] Supported formats and semantic equivalence classes are documented with authoritative parser evidence and passing merge tests; arrays remain atomic unless a later approved rule changes them.
- [ ] Baseline cache and exclusion projections pass crash, corruption, multi-process, rule-change, secret-leak, and restart audits without losing unknown or local-only fields.
- [ ] First sync, missing ancestors, unsupported syntax, and true conflicts retain conservative review; no partial publication is introduced in this phase.
- [ ] Run `npm run check` and `npm test` separately from the repository root; rebuild pi-tui-kit before consumer tests and keep root gates separate from Kit builds/checks.
- [ ] Build with `npm --workspace @narumitw/pi-sync run build --if-present`; test a representative generated lazy boundary through Jiti and run a bounded non-interactive package-directory `pi -e ./packages/pi-sync` Smoke when the runtime graph changes.
- [ ] If metadata or published contents change, run `npm run package:pack -- sync` and inspect the tarball; record any required but impractical smoke and its unverified behavior.
- [ ] Handoff records guides, semantic audits, passing checks, Changeset, recovery compatibility, deviations, and remaining manual cases; release actions remain separately approval-gated.
- [ ] Delete this plan only after every task and completion check passes, retaining durable format and recovery guidance elsewhere.
