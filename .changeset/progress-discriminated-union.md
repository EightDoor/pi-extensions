---
"@narumitw/pi-progress": patch
---

Express progress steps as a discriminated union in the tool schema so only blocked steps expose and require a reason. Preserve redundant-reason input normalization and recognize normalized call/result pairs during compaction without changing stored state or historical result validation.
