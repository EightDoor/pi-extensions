---
"@narumitw/pi-sync": minor
"@narumitw/pi-tui-kit": patch
---

Flatten the sync manager: expose reviewed Pull, Push, History, and Diagnostics directly, move destination and catalog management into searchable Settings, and show conflict/access recovery only when applicable. Preserve existing commands, automation policies, and safety confirmations.

Preserve Settings search and cursor through successful save refreshes in TUI Kit without changing its public API.
