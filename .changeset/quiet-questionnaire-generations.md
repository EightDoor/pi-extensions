---
"@narumitw/pi-tui-kit": patch
---

Request a render after deferred custom-answer submission, and isolate answer and note editor generations so earlier asynchronous callbacks cannot overwrite a later edit. Preserve pending key-release delivery to its owning editor and dispose retired editor instances after their key cycles drain.
