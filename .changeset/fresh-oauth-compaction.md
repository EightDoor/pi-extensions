---
"@narumitw/pi-codex-compact": minor
---

Add experimental opt-in `context-management` compaction through the active Responses provider, including official ChatGPT OAuth on compatible backends. Persist the latest stream-completed checkpoint and its exact safe output suffix, preserving default routing and legacy checkpoint replay. Bound and cancel maintenance inference requests, reject partial or unsafe output, and retain native fallback without switching credentials or protocols. Prevent stale session cleanup from clearing replacement-owned status.
