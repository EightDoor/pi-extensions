---
"@narumitw/pi-goal": patch
---

Preserve `goal_wait` deadline wake-ups after backward wall-clock corrections by re-arming early timers against their original absolute deadline. Apply the same protection to the bounded deadline-delivery retry while preserving cancellation and settled-idle continuation gates.
