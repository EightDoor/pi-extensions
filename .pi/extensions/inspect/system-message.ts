// Native historical replay is allowed only within this cumulative input budget.
export const SYSTEM_REPLAY_CHARACTERS = 1_048_576;

export function systemReplayIssue(messages: readonly unknown[]): string | undefined {
  let remaining = SYSTEM_REPLAY_CHARACTERS;
  for (const value of messages) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const m = value as Record<string, unknown>;
    if (m.role !== "system") continue;
    remaining -= 2; // Bound join separators even for empty fragments.
    if (typeof m.content === "string") remaining -= m.content.length;
    else if (Array.isArray(m.content)) {
      remaining -= m.content.length; // Also bound native filter/map work and block separators.
      if (remaining < 0) return "system replay exceeds 1,048,576-character input budget";
      for (const block of m.content) {
        if (block?.type === "text" && typeof block.text === "string") remaining -= block.text.length;
        if (remaining < 0) return "system replay exceeds 1,048,576-character input budget";
      }
    }
    if (remaining < 0) return "system replay exceeds 1,048,576-character input budget";
    if (m.sections && typeof m.sections === "object") {
      for (const [key, part] of Object.entries(m.sections)) {
        remaining -= key.length + 2 + (typeof part === "string" ? part.length : 0);
        if (remaining < 0) return "system replay exceeds 1,048,576-character input budget";
      }
    }
  }
  return undefined;
}

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
