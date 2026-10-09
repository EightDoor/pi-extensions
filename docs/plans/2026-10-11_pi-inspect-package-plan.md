# Pi Inspector package migration

## Goal

Move `.pi/extensions/inspect/` to independently installable `packages/pi-inspect/` without changing commands, consent, privacy, model-visible inputs, or lifecycle behavior.

## Plan

- [x] Inspect source imports, assets, tests and repository package conventions; use a source entrypoint with prebuilt browser assets and package-owned build dependencies.
- [x] Move implementation to `src/`, tests to `test/`, helpers to `scripts/`, and detailed guidance to `docs/`; update relative paths and preserve behavior.
- [x] Add package metadata, license, root registration, workspace check integration and standard README; review dependencies and published contents.
- [ ] Run root checks and tests, browser tests, package pack inspection, and non-interactive Pi package loading/reload/replacement smoke. Check, 306 Inspector tests, 47 browser tests, package and extracted-tarball smokes pass; root tests remain blocked by the unchanged release-workflow mismatch (7,979 pass, one fail, two skips).

## Applicable rules and evidence

- `docs/extension-conventions.md`: package layout, thin source entrypoint, independent dependencies and Pi peers (Review, boundaries Validator); published files and licenses (pack Smoke); registration and lifecycle preservation (Test, Pi Smoke); both root gates (Validator, Test).
- `docs/readme-conventions.md`: English standard sections, badges, installation trust/privacy warnings and accessible detailed guidance (Review, fenced-code-aware heading audit).
- Settings guide reviewed; no owned settings or persistence changes are planned.
- This is a repository path/package migration; no published behavior change or Changeset is required, and no publication is authorized.

## Completion Checklist

- [x] No implementation remains at the project-local entrypoint; source and package entrypoints resolve assets independently.
- [x] Metadata, README headings, docs links, dependency declarations and tarball contents pass review.
- [ ] `npm run check`, `npm test`, Chromium tests and Pi smoke pass, or external blockers are explicitly recorded for handoff.
- [x] Final touched-area audit confirms command, lifecycle, cancellation, privacy and prompt-prefix behavior are preserved.

## Rollback / Recovery

Restore the original tracked paths and manifests through Git if migration validation fails; no session data, settings, tags or registry state is changed.
