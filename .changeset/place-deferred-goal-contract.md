---
"@narumitw/pi-goal": patch
---

Show a Goal contract that Pi persisted after newer output, because it was sent while the agent was streaming, at the turn boundary where it was sent. Mid-run compaction now keeps the restored contract's request position once the persisted copy arrives, so the next request reuses the retained prefix.
