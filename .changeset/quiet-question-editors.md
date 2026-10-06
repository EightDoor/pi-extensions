---
"@narumitw/pi-tui-kit": patch
"@narumitw/pi-plan-mode": patch
---

Use Pi's publicly configured custom editor factory for TUI questionnaire answers and notes. Custom editors own editing and submission keys, while Ctrl+C remains hard cancellation and the main prompt editor stays untouched. Preserve raw expanded drafts, fragmented paste safety, default-editor and non-TUI behavior, and release questionnaire-owned editor instances when the interaction ends.

Raise Plan mode's Kit dependency floor to the published release used by the integration tests.
