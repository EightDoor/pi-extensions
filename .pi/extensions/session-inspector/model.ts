export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface Capture {
  value: Json;
  truncated: boolean;
}
export interface EntrySummary {
  id: string;
  parentId: string | null;
  kind: string;
  label: string;
  timestamp: string;
  name?: string;
  tokens?: number;
  status?: "success" | "error" | "cancelled";
  toolCallId?: string;
}
export interface Call {
  id: string;
  parentId?: string;
  name: string;
  status: "running" | "ok" | "error" | "unfinished";
  args: Capture;
  result?: Capture;
  durationMs?: number;
  branchAnchor: string | null;
}
export interface ToolView {
  name: string;
  description: string;
  exposure: string;
  active: boolean;
  callable: boolean;
  namespace?: string;
  schema: Capture;
}
export interface SkillView {
  name: string;
  path: string;
  description: string;
}
export interface Snapshot {
  protocol: 1;
  generation: string;
  revision: number;
  sessionId: string;
  name: string;
  leafId: string | null;
  totalEntries: number;
  nodes: EntrySummary[];
  incomplete: boolean;
  currentPrompt: Capture;
  tools: ToolView[];
  skills: SkillView[];
  calls: Call[];
  droppedCalls: number;
  captureStartedAt: number;
}
export interface BranchView {
  leafId: string;
  entries: EntrySummary[];
  total: number;
  offset: number;
  prompt: Capture;
  previousPrompt: Capture;
  sections: Capture;
  declaredTools: Capture;
  promptUpdates: Capture;
  projection: Capture;
  skillEvidence: Capture;
}
export interface DetailView {
  raw: Capture;
  projected: Capture;
  calls: Call[];
}
