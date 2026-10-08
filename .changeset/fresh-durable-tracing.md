---
"@narumitw/pi-langfuse": minor
---

Add an experimental public `/durable` integration for pi-durable 1.0.4, reusing the existing Langfuse runtime and tracing core without loading coding-agent registration. Trace committed submission outcomes, generation content and usage, and tool activity with isolated host correlation, fail-open observer cleanup and explicit snapshot/resynchronization semantics. Preserve existing coding-agent exports and behavior, and make shared-runtime shutdown idempotent under reentrant host callbacks.
