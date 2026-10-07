---
"@narumitw/pi-sync": patch
---

Request identity representations for S3 reads so transfer compression does not weaken R2 JSON ETags and block safe conditional publication. Weak or missing ETags still fail closed. Reconcile inactive journals recorded with compression-weakened revisions only when the current strong ETag and exact pointer reproduce the recorded revision and local content and baseline are unchanged; this equivalence never authorizes publication or apply.

Show bounded, terminal-safe, credential-redacted failure details for interrupted merged transfers while preserving journals, backups, and existing recovery behavior.
