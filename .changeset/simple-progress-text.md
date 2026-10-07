---
"@narumitw/pi-progress": minor
---

Simplify progress steps to `{ text, status }`, retaining blocked status and asking the model to describe its unblock condition in text. This is a breaking result/schema change for consumers of the separate reason field; use a minor bump for this pre-1.0 package.

Write version 5 state, strictly decode historical versions, and losslessly merge valid blocked reasons into text. Keep legacy tool-call tolerance and established compaction boundaries. Raise the text limit to 503 characters to accommodate the old 300-character text, separator, and 200-character reason; older packages do not restore version 5 results.
