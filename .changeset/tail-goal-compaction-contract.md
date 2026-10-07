---
"@narumitw/pi-goal": patch
---

Append missing Goal contracts after retained history following compaction so transient restoration and immediately persisted contracts use the same message position, preserving the retained request prefix. Persist missing inactive contracts at the compaction boundary instead of repeatedly restoring them at a moving tail.
