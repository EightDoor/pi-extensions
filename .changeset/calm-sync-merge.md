---
"@narumitw/pi-sync": minor
---

Merge independent file changes with recovery-safe publication/apply journaling and add an explicit automatic startup transfer opt-in at idle for conditional or lease-protected backends. Keep initial-source/conflict review, current-session protection, existing automatic defaults, and directional push/pull semantics. Require directional review for session-root transitions, bind merge recovery to its effective session root, and recheck local bytes immediately before publication. Make transaction backups directory-durable, persist removal intent, and stage directory restoration so interrupted recovery remains retryable without overwriting newer bytes. Protect active sessions using the pinned merge root and reject physical target aliases before merged publication or recovery apply. Index transaction recovery evidence by target and ancestor, and propagate cancellation and ownership guards through directory-creating preflight.
