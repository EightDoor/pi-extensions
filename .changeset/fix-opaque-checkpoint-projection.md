---
"@narumitw/pi-codex-compact": patch
---

Use Pi's finalized retained context for checkpoint fingerprints. Safely replay older raw-fingerprinted checkpoints by verifying their saved transcript snapshot before projecting preexisting context edits and nested compaction summaries. Preserve history and report actionable recovery when projection cannot be verified.
