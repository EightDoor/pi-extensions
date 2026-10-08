---
"@narumitw/pi-sync": patch
---

Keep History rollback cancellation reachable after snapshot selection and confirmation restore the normal editor. Release the temporary terminal listener when the operation settles or its owner closes, and preserve the existing non-cancellable commit boundary. Ignore Kitty key-release events before matching cancellation so releasing a key does not abort History. Preserve focused dialogs' key priorities, and distinguish aborted or stale rollback confirmations from explicit rejection before notifying.
