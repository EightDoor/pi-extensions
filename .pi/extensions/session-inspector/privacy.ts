import { stripVTControlCharacters } from "node:util";
import type { Capture, Json } from "./model.ts";

const secretKey =
  /^(authorization|proxy.authorization|cookie|set.cookie|password|passwd|secret|client[_-]?secret|secret[_-]?key|private[_-]?key|token|api[_-]?key|access[_-]?token|refresh[_-]?token|session[_-]?token|credentials|env|headers)$/i;

// Display-only: original session entries and event objects are never modified.
export function displayText(text: string): string {
  return Array.from(stripVTControlCharacters(text))
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code === 9 || code === 10 || (code >= 32 && (code < 127 || code > 159));
    })
    .join("")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+/gi, "Bearer [redacted]");
}

// Bound traversal before serialization: huge strings, arrays, cycles and deep objects are safe.
export function capture(input: unknown, maxChars = 32768): Capture {
  let budget = maxChars;
  let nodes = 0;
  let truncated = false;
  const seen = new WeakSet<object>();
  function text(value: string): string {
    const length = Math.min(value.length, Math.max(0, budget));
    budget -= length;
    if (length < value.length) truncated = true;
    return displayText(value.slice(0, length));
  }
  function visit(value: unknown, depth: number): Json {
    if (++nodes > 2048 || depth > 12 || budget <= 0) {
      truncated = true;
      return "[truncated]";
    }
    budget -= 8;
    if (value === null || value === undefined) return null;
    if (typeof value === "string") return text(value);
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
    if (typeof value !== "object") {
      truncated = true;
      return `[unsupported ${typeof value}]`;
    }
    if (seen.has(value)) {
      truncated = true;
      return "[circular]";
    }
    seen.add(value);
    if (Array.isArray(value)) {
      const result: Json[] = [];
      for (let index = 0; index < value.length; index++) {
        if (budget <= 0 || nodes >= 2048) {
          truncated = true;
          break;
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (descriptor?.get || descriptor?.set) {
          truncated = true;
          result.push("[accessor omitted]");
        } else result.push(visit(descriptor?.value, depth + 1));
      }
      seen.delete(value);
      return result;
    }
    const record = value as Record<string, unknown>;
    const type = Object.getOwnPropertyDescriptor(record, "type")?.value;
    const mimeType = Object.getOwnPropertyDescriptor(record, "mimeType")?.value;
    const data = Object.getOwnPropertyDescriptor(record, "data")?.value;
    const raster =
      type === "image" &&
      typeof mimeType === "string" &&
      /^(image\/(png|jpeg|gif|webp))$/.test(mimeType) &&
      typeof data === "string" &&
      data.length <= Math.min(16384, Math.max(0, budget / 2)) &&
      /^[A-Za-z0-9+/]*={0,2}$/.test(data);
    const result: Record<string, Json> = Object.create(null);
    for (const key in record) {
      if (!Object.hasOwn(record, key)) continue;
      if (budget <= 0 || nodes >= 2048) {
        truncated = true;
        break;
      }
      // Image bytes and opaque provider replay signatures are not useful as raw JSON.
      const name = text(key.slice(0, 256));
      if (key.length > 256) truncated = true;
      const descriptor = Object.getOwnPropertyDescriptor(record, key);
      if (descriptor?.get || descriptor?.set) {
        truncated = true;
        result[name] = "[accessor omitted]";
        continue;
      }
      result[name] = secretKey.test(key)
        ? "[redacted]"
        : key === "data" && type === "image"
          ? raster
            ? text(data as string)
            : "[opaque or oversized data omitted]"
          : /^(thinkingSignature|thoughtSignature|textSignature)$/.test(key)
            ? "[opaque data omitted]"
            : visit(descriptor?.value, depth + 1);
    }
    seen.delete(value);
    return result;
  }
  return { value: visit(input, 0), truncated };
}
