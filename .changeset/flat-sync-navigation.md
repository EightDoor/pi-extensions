---
"@narumitw/pi-sync": minor
"@narumitw/pi-tui-kit": patch
---

Flatten the sync manager: expose reviewed Pull, Push, History, and Diagnostics directly, move destination and catalog management into searchable Settings, and show conflict/access recovery only when applicable. Preserve existing commands, automation policies, and safety confirmations.

Require the TUI Kit patch that preserves Settings search and cursor across refreshes, including queries that match printable keybindings.

Preserve Settings search and cursor across successful refreshes in TUI Kit, and restore Settings and Choice queries as sanitized pasted content without dispatching printable keybindings.
