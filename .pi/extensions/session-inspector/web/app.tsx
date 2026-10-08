import * as Collapsible from "@radix-ui/react-collapsible";
import { ChevronDownIcon, ChevronRightIcon, MoonIcon, SunIcon } from "@radix-ui/react-icons";
import {
  Badge,
  Button,
  Callout,
  Card,
  Flex,
  Heading,
  IconButton,
  Select,
  Tabs,
  Text,
  TextField,
  Theme,
} from "@radix-ui/themes";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "@radix-ui/themes/styles.css";
import "./style.css";
import type { BranchView, Call, Capture, DetailView, EntrySummary, Json, Snapshot } from "../model.ts";

const params = new URLSearchParams(location.hash.slice(1));
const token = params.get("token") ?? sessionStorage.getItem("inspector-token") ?? "";
const generation = params.get("generation") ?? sessionStorage.getItem("inspector-generation") ?? "";
if (token) sessionStorage.setItem("inspector-token", token);
if (generation) sessionStorage.setItem("inspector-generation", generation);
history.replaceState(null, "", location.pathname);
async function request<T>(route: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(
    `/api/${route}${route.includes("?") ? "&" : "?"}generation=${encodeURIComponent(generation)}`,
    { headers: { "X-Inspector-Token": token }, signal, cache: "no-store" },
  );
  if (!response.ok)
    throw new Error(
      response.status === 409 || response.status === 401
        ? "Session expired; open a new viewer from Pi."
        : "Viewer unavailable; reconnecting requires a running Pi session.",
    );
  return response.json() as Promise<T>;
}
function output(value: Json): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}
function images(value: Json, found: { data: string; mimeType: string }[] = []): { data: string; mimeType: string }[] {
  if (!value || typeof value !== "object" || found.length >= 4) return found;
  if (
    !Array.isArray(value) &&
    value.type === "image" &&
    typeof value.data === "string" &&
    typeof value.mimeType === "string" &&
    /^(image\/(png|jpeg|gif|webp))$/.test(value.mimeType) &&
    value.data.length <= 16384 &&
    /^[A-Za-z0-9+/]*={0,2}$/.test(value.data)
  ) {
    if (!found.some((image) => image.data === value.data && image.mimeType === value.mimeType))
      found.push({ data: value.data, mimeType: value.mimeType });
  } else for (const child of Object.values(value)) images(child, found);
  return found;
}
function Data({ data, label }: { data?: Capture; label: string }) {
  return (
    <section className="data">
      <Text as="div" weight="bold">
        {label}
      </Text>
      {data?.truncated && <Badge color="amber">truncated</Badge>}
      <pre>{data ? output(data.value) : "unavailable"}</pre>
      {data &&
        images(data.value).map((image) => (
          <img
            key={`${image.mimeType}-${image.data}`}
            className="preview-image"
            src={`data:${image.mimeType};base64,${image.data}`}
            alt="Captured raster tool output"
          />
        ))}
    </section>
  );
}
function promptDiff(before?: Capture, after?: Capture): Capture {
  const left = before ? output(before.value).split("\n") : [];
  const right = after ? output(after.value).split("\n") : [];
  let start = 0;
  let end = 0;
  while (start < left.length && start < right.length && left[start] === right[start]) start++;
  while (
    end < left.length - start &&
    end < right.length - start &&
    left[left.length - end - 1] === right[right.length - end - 1]
  )
    end++;
  return {
    value:
      [
        ...left.slice(start, left.length - end).map((line) => `- ${line}`),
        ...right.slice(start, right.length - end).map((line) => `+ ${line}`),
      ].join("\n") || "No prompt change",
    truncated: Boolean(before?.truncated || after?.truncated),
  };
}
function scripts(data?: Capture): Capture | undefined {
  if (!data?.value || typeof data.value !== "object" || Array.isArray(data.value)) return;
  const message = data.value.message;
  if (!message || typeof message !== "object" || Array.isArray(message) || !Array.isArray(message.content)) return;
  const code = message.content.flatMap((block) => {
    if (
      !block ||
      typeof block !== "object" ||
      Array.isArray(block) ||
      block.type !== "toolCall" ||
      block.name !== "codemode"
    )
      return [];
    const args = block.arguments;
    return args && typeof args === "object" && !Array.isArray(args) && typeof args.code === "string" ? [args.code] : [];
  });
  return code.length ? { value: code.join("\n\n"), truncated: data.truncated } : undefined;
}
function CallView({ call, all, group = "live" }: { call: Call; all: Call[]; group?: string }) {
  return (
    <Card className="call" id={group === "detail" ? `${group}-call-${call.id}` : undefined}>
      <Flex gap="2" align="center">
        <Text weight="bold">{call.name}</Text>
        <Badge color={call.status === "error" ? "red" : call.status === "running" ? "blue" : "gray"}>
          {call.status}
        </Badge>
        {call.durationMs !== undefined && <Text size="1">{call.durationMs} ms</Text>}
      </Flex>
      <Text as="div" size="1" color="gray">
        {call.id}
        {call.parentId &&
          (all.some((parent) => parent.id === call.parentId) ? (
            <a href={`#${group}-call-${encodeURIComponent(call.parentId)}`}> · Parent {call.parentId}</a>
          ) : (
            ` · parent ${call.parentId} (not captured)`
          ))}
      </Text>
      <Data label="Arguments" data={call.args} />
      <Data label={call.result ? "Result · tool_execution event" : "Result · not captured"} data={call.result} />
      <Text size="1" color="gray">
        {all.filter((c) => c.parentId === call.id).length} child calls
      </Text>
    </Card>
  );
}
function Tree({ nodes, selected, choose }: { nodes: EntrySummary[]; selected: string; choose(id: string): void }) {
  const [collapsed, setCollapsed] = useState(new Set<string>());
  const ids = new Set(nodes.map((n) => n.id));
  const children = new Map<string, EntrySummary[]>();
  for (const n of nodes) {
    const parent = n.parentId && ids.has(n.parentId) ? n.parentId : "";
    const list = children.get(parent) ?? [];
    list.push(n);
    children.set(parent, list);
  }
  // Iterative traversal avoids stack overflow on long linear sessions.
  const rows: { node: EntrySummary; depth: number }[] = [];
  const stack = (children.get("") ?? [])
    .slice()
    .reverse()
    .map((node) => ({ node, depth: 0 }));
  const visited = new Set<string>();
  while (stack.length) {
    const row = stack.pop();
    if (!row || visited.has(row.node.id)) continue;
    visited.add(row.node.id);
    rows.push(row);
    if (!collapsed.has(row.node.id))
      for (const node of (children.get(row.node.id) ?? []).slice().reverse())
        stack.push({ node, depth: row.depth + 1 });
  }
  return (
    <nav aria-label="Session branches">
      {rows.map(({ node, depth }) => (
        <Flex key={node.id} gap="1" className="tree-row" style={{ paddingLeft: Math.min(depth, 12) * 8 }}>
          {(children.get(node.id)?.length ?? 0) > 0 && (
            <Collapsible.Root
              open={!collapsed.has(node.id)}
              onOpenChange={(open) => {
                setCollapsed((previous) => {
                  const next = new Set(previous);
                  if (open) next.delete(node.id);
                  else next.add(node.id);
                  return next;
                });
              }}
            >
              <Collapsible.Trigger asChild>
                <IconButton variant="ghost" size="1" aria-label={`Toggle children of ${node.id}`}>
                  {collapsed.has(node.id) ? <ChevronRightIcon /> : <ChevronDownIcon />}
                </IconButton>
              </Collapsible.Trigger>
            </Collapsible.Root>
          )}
          <button
            type="button"
            className="node"
            data-entry-id={node.id}
            aria-current={selected === node.id ? "true" : undefined}
            onClick={() => choose(node.id)}
          >
            <Text size="1" color="gray">
              {node.kind} · {node.id}
            </Text>
            <span>{node.label}</span>
          </button>
        </Flex>
      ))}
    </nav>
  );
}

function App() {
  const [appearance, setAppearance] = useState<"dark" | "light">("dark");
  const [revision, setRevision] = useState(-1);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [branch, setBranch] = useState<BranchView>();
  const [detail, setDetail] = useState<DetailView>();
  const [leaf, setLeaf] = useState("");
  const [selected, setSelected] = useState("");
  const [offset, setOffset] = useState(0);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const [tab, setTab] = useState("raw");

  useEffect(() => {
    const controller = new AbortController();
    let retry: ReturnType<typeof setTimeout> | undefined;
    let refresh: ReturnType<typeof setTimeout> | undefined;
    const connect = async () => {
      try {
        const response = await fetch(`/api/events?generation=${encodeURIComponent(generation)}`, {
          headers: { "X-Inspector-Token": token },
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          setError("Session expired or unavailable; open the viewer again from Pi.");
          return;
        }
        setConnected(true);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        try {
          while (!controller.signal.aborted) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let end = buffer.indexOf("\n\n");
            while (end !== -1) {
              const frame = buffer.slice(0, end);
              buffer = buffer.slice(end + 2);
              const line = frame.split("\n").find((s) => s.startsWith("data: "));
              if (line) {
                const data = JSON.parse(line.slice(6)) as { protocol: number; generation: string; revision: number };
                if (data.protocol !== 1 || data.generation !== generation) throw new Error("Session changed");
                if (!refresh)
                  refresh = setTimeout(() => {
                    refresh = undefined;
                    setRevision((previous) => previous + 1);
                  }, 50);
              }
              end = buffer.indexOf("\n\n");
            }
          }
        } finally {
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
      } catch {
        /* Offline state is visible; reconnect uses a fresh snapshot, not stale replay. */
      }
      if (!controller.signal.aborted) {
        setConnected(false);
        retry = setTimeout(() => void connect(), 1000);
      }
    };
    void connect();
    return () => {
      controller.abort();
      clearTimeout(retry);
      clearTimeout(refresh);
    };
  }, []);
  useEffect(() => {
    if (revision < 0) return;
    const controller = new AbortController();
    void request<Snapshot>("snapshot", controller.signal)
      .then((s) => {
        if (controller.signal.aborted) return;
        setSnapshot(s);
        setError("");
        setLeaf((old) => old || s.leafId || s.nodes[0]?.id || "");
        setSelected((old) => old || s.leafId || s.nodes[0]?.id || "");
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(String(e.message));
      });
    return () => controller.abort();
  }, [revision]);
  useEffect(() => {
    if (!leaf || revision < 0) return;
    const controller = new AbortController();
    setBranch(undefined);
    void request<BranchView>(`branch?leaf=${encodeURIComponent(leaf)}&offset=${offset}`, controller.signal)
      .then((b) => {
        if (!controller.signal.aborted) setBranch(b);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(String(e.message));
      });
    return () => controller.abort();
  }, [leaf, offset, revision]);
  useEffect(() => {
    if (!selected || !leaf || revision < 0) return;
    const controller = new AbortController();
    setDetail(undefined);
    void request<DetailView>(
      `detail?id=${encodeURIComponent(selected)}&leaf=${encodeURIComponent(leaf)}`,
      controller.signal,
    )
      .then((d) => {
        if (!controller.signal.aborted) setDetail(d);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(String(e.message));
      });
    return () => controller.abort();
  }, [leaf, selected, revision]);

  const nodes =
    snapshot?.nodes.filter(
      (n) =>
        (kind === "all" || n.kind === kind) &&
        `${n.kind} ${n.label} ${n.id}`.toLowerCase().includes(query.toLowerCase()),
    ) ?? [];
  return (
    <Theme appearance={appearance} accentColor="indigo" grayColor="slate">
      <header>
        <Flex justify="between" align="center" gap="3" wrap="wrap">
          <Heading size="5">Pi Session Inspector</Heading>
          <Flex align="center" gap="2">
            <Badge color={connected ? "green" : "amber"}>{connected ? "Live" : "Disconnected"}</Badge>
            <Badge>Read-only</Badge>
            <IconButton
              aria-label="Toggle appearance"
              variant="soft"
              onClick={() => setAppearance(appearance === "dark" ? "light" : "dark")}
            >
              {appearance === "dark" ? <SunIcon /> : <MoonIcon />}
            </IconButton>
          </Flex>
        </Flex>
        <Text color="gray" size="2">
          {snapshot?.name ?? "Connecting"} · Pi leaf: {snapshot?.leafId ?? "none"} · Browser preview: {leaf || "none"}
        </Text>
      </header>
      {error && (
        <Callout.Root color="red">
          <Callout.Text>{error}</Callout.Text>
        </Callout.Root>
      )}
      {snapshot?.incomplete && (
        <Callout.Root color="amber">
          <Callout.Text>Inventory truncated; not all session entries or resources are shown.</Callout.Text>
        </Callout.Root>
      )}
      <main className="panes">
        <aside className="pane">
          <Heading size="3">Session tree</Heading>
          <TextField.Root
            aria-label="Search session"
            placeholder="Search entries"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Select.Root value={kind} onValueChange={setKind}>
            <Select.Trigger aria-label="Filter entry type" />
            <Select.Content>
              {["all", "user", "assistant", "toolResult", "system", "compaction", "branch_summary"].map((k) => (
                <Select.Item key={k} value={k}>
                  {k}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
          <Text size="1" color="gray">
            {nodes.length} shown / {snapshot?.totalEntries ?? 0} total
          </Text>
          <Tree
            nodes={nodes}
            selected={leaf}
            choose={(id) => {
              setLeaf(id);
              setSelected(id);
              setOffset(0);
            }}
          />
        </aside>
        <section className="pane">
          <Heading size="3">Branch transcript</Heading>
          <Text size="1" color="gray">
            Selecting a branch here never navigates Pi.
          </Text>
          <Flex gap="2">
            <Button size="1" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 50))}>
              Previous
            </Button>
            <Button size="1" disabled={!branch || offset + 50 >= branch.total} onClick={() => setOffset(offset + 50)}>
              Next
            </Button>
            <Text size="1">
              {offset + 1}–{Math.min(offset + 50, branch?.total ?? 0)} / {branch?.total ?? 0}
            </Text>
          </Flex>
          {branch?.entries.map((e) => (
            <button
              type="button"
              className="transcript-entry"
              key={e.id}
              onClick={() => setSelected(e.id)}
              aria-current={selected === e.id ? "true" : undefined}
            >
              <Badge>{e.kind}</Badge>
              <Text size="1" color="gray">
                {" "}
                {e.id} · {e.timestamp}
              </Text>
              <pre>{e.label}</pre>
            </button>
          ))}
          <Heading size="3">Live calls · session-wide</Heading>
          <Text size="1" color="gray">
            Capture starts on activation; {snapshot?.droppedCalls ?? 0} calls evicted. Events are not an exact Promise
            graph.
          </Text>
          {snapshot?.calls.map((call) => (
            <Collapsible.Root key={call.id} id={`live-call-${call.id}`}>
              <Collapsible.Trigger asChild>
                <Button variant="soft" className="call-trigger">
                  {call.name} · {call.status}
                </Button>
              </Collapsible.Trigger>
              <Collapsible.Content>
                <CallView call={call} all={snapshot.calls} />
              </Collapsible.Content>
            </Collapsible.Root>
          ))}
        </section>
        <section className="pane">
          <Heading size="3">Inspector · {selected || "no selection"}</Heading>
          <Tabs.Root value={tab} onValueChange={setTab}>
            <Tabs.List wrap="wrap">
              {["raw", "prompt", "tools", "skills", "context", "codemode"].map((t) => (
                <Tabs.Trigger key={t} value={t}>
                  {t}
                </Tabs.Trigger>
              ))}
            </Tabs.List>
            <Tabs.Content value="raw">
              <Data label="Raw selected entry · redacted display copy" data={detail?.raw} />
            </Tabs.Content>
            <Tabs.Content value="prompt">
              <Data label="Historical prompt · browser preview branch" data={branch?.prompt} />
              <Data label="Previous-node prompt · compare with selected branch" data={branch?.previousPrompt} />
              <Data
                label="Prompt diff · removed / added lines"
                data={promptDiff(branch?.previousPrompt, branch?.prompt)}
              />
              <Data label="Historical sections" data={branch?.sections} />
              <Data label="Prompt updates on branch" data={branch?.promptUpdates} />
              <Data label="Current runtime effective prompt · may not yet be sent" data={snapshot?.currentPrompt} />
            </Tabs.Content>
            <Tabs.Content value="tools">
              <Data label="Historical declared tools · preview branch" data={branch?.declaredTools} />
              <Text as="p" color="gray">
                Current active ≠ provider-visible. MCP connection status is unavailable.
              </Text>
              {snapshot?.tools.map((t) => (
                <Card key={t.name}>
                  <Text weight="bold">{t.name}</Text>
                  <Flex gap="1" wrap="wrap">
                    <Badge>{t.namespace ?? "tool"}</Badge>
                    <Badge>{t.exposure}</Badge>
                    <Badge>{t.active ? "active" : "inactive"}</Badge>
                    <Badge>{t.callable ? "callable" : "not callable"}</Badge>
                  </Flex>
                  <Text as="p">{t.description}</Text>
                  <Data label="Schema" data={t.schema} />
                </Card>
              ))}
            </Tabs.Content>
            <Tabs.Content value="skills">
              <Text as="p" color="gray">
                Advertised or read does not prove model compliance. Historical discovery may be unavailable.
              </Text>
              {snapshot?.skills.map((s) => (
                <Card key={s.path}>
                  <Text weight="bold">{s.name}</Text>
                  <Text as="p">{s.description}</Text>
                  <Text size="1">{s.path}</Text>
                </Card>
              ))}
              <Data label="Evidence on preview branch" data={branch?.skillEvidence} />
            </Tabs.Content>
            <Tabs.Content value="context">
              <Text as="p" color="gray">
                Pi projection applies compaction and context edits. Request-local hooks can still transform it; this is
                not the final provider HTTP request.
              </Text>
              <Data label="Projected branch entries" data={branch?.projection} />
              <Data label="Selected entry contribution" data={detail?.projected} />
            </Tabs.Content>
            <Tabs.Content value="codemode">
              <Text as="p" color="gray">
                Script source, output and historical nested metadata appear in the selected raw entry. Child results
                before activation are not captured. Sandbox variables, discovery-helper results and model-helper
                responses are unavailable unless the script printed them.
              </Text>
              <Data label="JavaScript source" data={scripts(detail?.raw)} />
              <Data label="Source / output / persisted nestedCalls" data={detail?.raw} />
              {detail?.calls.map((call) => (
                <CallView key={call.id} call={call} all={detail.calls} group="detail" />
              ))}
            </Tabs.Content>
          </Tabs.Root>
        </section>
      </main>
    </Theme>
  );
}
const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
