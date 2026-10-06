---
"@narumitw/pi-sync": minor
---

Add all-or-nothing, file-level three-way merging for **Sync now** with an established baseline. Independent changes merge automatically; initial-source choices, true conflicts, legacy selection policies, and session-root changes still require review. Explicit push/pull remain directional, and existing automatic defaults are unchanged.

Add an opt-in automatic startup transfer at idle in TUI/RPC for conditional or lease-protected backends. Transfers protect the current session, revalidate local content and settings, and never reload resources automatically. Cancellation clears owned progress without publishing stale attention or affecting a replacement session.

Harden interrupted-transfer recovery with durable private backups and journals, guarded file installation, case-only replacement handling, and verified settings/root-transition evidence, including settings deletion and canonical tilde expansion. Reject unsafe target aliases and newer or ambiguous filesystem states; preserve evidence for manual review rather than blindly restoring older content. Completed journals resume cleanup without rolling back accepted files. Do not downgrade while recovery evidence is pending.

Preserve supported native POSIX filenames, escape path controls in review output, and index transaction planning and recovery checks to avoid repeated full scans.
