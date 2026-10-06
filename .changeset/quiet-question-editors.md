---
"@narumitw/pi-tui-kit": patch
"@narumitw/pi-plan-mode": patch
---

Use Pi's publicly configured custom editor factory for TUI questionnaire answers and notes. Custom editors own editing and submission keys, while Ctrl+C remains hard cancellation and the main prompt editor stays untouched. Preserve raw expanded drafts, fragmented paste safety, default-editor and non-TUI behavior, and release questionnaire-owned editor instances when the interaction ends.

Honor custom editor submission values without replacing intentional normalization with the original draft, and retain editor-owned key-release cycles across answer and note transitions.
