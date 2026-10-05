import path from "node:path";
export const TEXT_LIMIT = 1024 * 1024;
export function isMergeTextPath(filePath: string) {
  return (
    filePath === "AGENTS.md" ||
    (/\.(?:md|txt)$/u.test(filePath) &&
      ["prompts", "skills"].includes(filePath.split("/")[0] ?? "") &&
      path.posix.basename(filePath) !== "keybindings.json")
  );
}
export function text(bytes: Buffer) {
  if (bytes.length > TEXT_LIMIT) throw new Error("Text merge bound exceeded.");
  const decoded = bytes.toString("utf8");
  if (
    !Buffer.from(decoded).equals(bytes) ||
    bytes.some((byte) => (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) || byte === 127)
  )
    throw new Error("Unsupported text encoding.");
  return decoded;
}
type Hunk = { start: number; end: number; lines: string[] };
function lines(value: string) {
  return value.match(/[^\n]*\n|[^\n]+$/gu) ?? [];
}
function edits(base: string[], next: string[]): Hunk[] {
  const width = next.length + 1;
  if ((base.length + 1) * width > 4_000_000) throw new Error("Text merge complexity bound exceeded.");
  const grid = new Uint32Array((base.length + 1) * width);
  for (let i = base.length - 1; i >= 0; i--)
    for (let j = next.length - 1; j >= 0; j--)
      grid[i * width + j] =
        base[i] === next[j]
          ? 1 + (grid[(i + 1) * width + j + 1] ?? 0)
          : Math.max(grid[(i + 1) * width + j] ?? 0, grid[i * width + j + 1] ?? 0);
  const result: Hunk[] = [];
  let i = 0;
  let j = 0;
  let active: Hunk | undefined;
  while (i < base.length || j < next.length) {
    if (i < base.length && j < next.length && base[i] === next[j]) {
      if (active) {
        result.push(active);
        active = undefined;
      }
      i++;
      j++;
      continue;
    }
    active ??= { start: i, end: i, lines: [] };
    if (j < next.length && (i === base.length || (grid[i * width + j + 1] ?? 0) >= (grid[(i + 1) * width + j] ?? 0)))
      active.lines.push(next[j++] ?? "");
    else active.end = ++i;
  }
  if (active) result.push(active);
  return result;
}
export function mergeText(baseBytes: Buffer, localBytes: Buffer, remoteBytes: Buffer): Buffer | undefined {
  try {
    const base = lines(text(baseBytes));
    const local = edits(base, lines(text(localBytes)));
    const remote = edits(base, lines(text(remoteBytes)));
    const combined = [...local];
    for (const right of remote) {
      let same = false;
      for (const left of local) {
        if (left.start === right.start && left.end === right.end && left.lines.join("") === right.lines.join("")) {
          same = true;
          continue;
        }
        const overlap =
          left.start === left.end || right.start === right.end
            ? left.start <= right.end && right.start <= left.end
            : left.start < right.end && right.start < left.end;
        if (overlap) return;
      }
      if (!same) combined.push(right);
    }
    combined.sort((left, right) => left.start - right.start || left.end - right.end);
    let cursor = 0;
    const output: string[] = [];
    for (const edit of combined) {
      output.push(...base.slice(cursor, edit.start), ...edit.lines);
      cursor = edit.end;
    }
    output.push(...base.slice(cursor));
    const result = Buffer.from(output.join(""));
    text(result);
    return result;
  } catch {
    return;
  }
}
