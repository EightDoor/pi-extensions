---
"@narumitw/pi-sync": minor
---

Add opt-in conservative settings field merging with verified private ancestors and explicit machine-local field projection. Portable policies use settings version 4 and snapshot version 2 so older clients refuse them; policy changes require directional migration confirmation and do not erase remote history. Support portable snapshots across S3, WebDAV and Git, retain version-4 setup management, capture initial accepted ancestors, prune completed cache history, and preview effective local images. Preserve per-setup policy absence, require explicit empty-policy migration, recheck force-push policies after remote refresh, clear cancelled migration status, and allow validated settings deletion when no excluded field is present. Bind recovery journals to policy presence, refuse pull policy rewrites until the authoritative remote matches, and preserve unsafe ancestor records during pruning.
