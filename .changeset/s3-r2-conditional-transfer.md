---
"@narumitw/pi-sync": minor
---

Support automatic transfer for R2/S3 using verified ETag conditional publication. Verify conditional-write behavior with an isolated temporary object before publication, protect active-pointer and history writes against concurrent writers, and preserve unknown-outcome recovery for transport failures. Credentials now require delete access for probe cleanup; unsupported conditional writes fail closed.
