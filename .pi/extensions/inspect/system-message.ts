// Validate the fields consumed by Pi AI's system-prompt/tool replay. Checkpoints
// are injected directly; ordinary session messages are normalized by the caller.
export function systemMessageIssue(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "malformed system-message envelope";
  const m = value as Record<string, unknown>;
  if (m.role !== "system") return "malformed system-message role";
  if (
    typeof m.content !== "string" &&
    (!Array.isArray(m.content) ||
      m.content.some(
        (block) =>
          !block ||
          typeof block !== "object" ||
          Array.isArray(block) ||
          (block.type === "text" && typeof block.text !== "string"),
      ))
  )
    return "malformed system-message content";
  if (
    m.sections != null &&
    (typeof m.sections !== "object" ||
      Array.isArray(m.sections) ||
      Object.values(m.sections).some((part) => part !== null && typeof part !== "string"))
  )
    return "malformed system-message sections";
  for (const delta of [m.toolsAdded, m.toolsRemoved]) {
    if (
      delta != null &&
      (!Array.isArray(delta) ||
        delta.some(
          (tool) =>
            !tool ||
            typeof tool !== "object" ||
            Array.isArray(tool) ||
            typeof tool.name !== "string" ||
            !tool.name.length ||
            tool.name.length > 512,
        ))
    )
      return "malformed system-message tool delta";
  }
  return undefined;
}
