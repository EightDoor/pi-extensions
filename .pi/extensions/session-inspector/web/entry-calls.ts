import type { Call, Capture } from "../model.ts";
import { record } from "./format.ts";
export function entryCalls(raw: Capture | undefined, calls: Call[]): Call[] {
  const message = record(record(raw?.value)?.message);
  const ids = new Set<string>();
  if (message?.role === "toolResult" && typeof message.toolCallId === "string") ids.add(message.toolCallId);
  if (message?.role === "assistant" && Array.isArray(message.content))
    for (const block of message.content) {
      const item = record(block);
      if (item?.type === "toolCall" && typeof item.id === "string") ids.add(item.id);
    }
  for (let i = 0; i < calls.length; i++)
    for (const call of calls) if (call.parentId && ids.has(call.parentId)) ids.add(call.id);
  return calls.filter((call) => ids.has(call.id));
}
