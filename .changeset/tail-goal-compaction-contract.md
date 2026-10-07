---
"@narumitw/pi-goal": patch
---

Append missing Goal contracts after retained history following compaction so transient restoration and persisted contracts use the same message position, preserving the retained request prefix.
