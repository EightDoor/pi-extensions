---
"@narumitw/pi-firecrawl": minor
---

Default to five codemode-exposed Firecrawl capabilities without `firecrawl_load`. Existing settings without `toolMode` also adopt this default while preserving the saved tool selection. Enable Pi's codemode, or choose `lazy` in `/firecrawl settings` and `/reload` to restore the previous model-dependent lazy/eager behavior; `direct` declares the five tools without a loader.

Add a SettingsList screen for mode and capability availability. Mode edits save immediately and apply at the next session start; availability edits apply immediately without overwriting a pending mode. Disabled capabilities are unreachable in every mode. Status distinguishes running and saved mode, effective exposure, and callable versus declared tools. Preserve existing commands, legacy settings precedence, and native-deferred fallback behavior.
