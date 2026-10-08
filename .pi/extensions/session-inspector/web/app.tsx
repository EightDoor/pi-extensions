import { MoonIcon, SunIcon } from "@radix-ui/react-icons";
import { Badge, Callout, Heading, IconButton, Text, Theme } from "@radix-ui/themes";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "@radix-ui/themes/styles.css";
import "./style.css";
import type { BranchView, DetailView, Snapshot } from "../model.ts";
import { type Filters, matches, matchesCall } from "./format.ts";
import { Inspector } from "./inspector.tsx";
import { Overview } from "./overview.tsx";
import { Trace } from "./trace.tsx";
import { Sidebar } from "./tree.tsx";

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

function App() {
  const [appearance, setAppearance] = useState<"dark" | "light">("dark");
  const [revision, setRevision] = useState(-1);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [branch, setBranch] = useState<BranchView>();
  const [detail, setDetail] = useState<DetailView>();
  const [leaf, setLeaf] = useState("");
  const [selected, setSelected] = useState("");
  const [offset, setOffset] = useState(0);
  const [view, setView] = useState("timeline");
  const [filters, setFilters] = useState<Filters>({
    query: "",
    kind: "all",
    groups: [],
    errorsOnly: false,
    slowOnly: false,
  });
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
        if (controller.signal.aborted) return;
        if (!response.ok || !response.body) {
          setConnected(false);
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
            if (done || controller.signal.aborted) break;
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

  const calls = snapshot?.calls ?? [];
  const nodes = snapshot?.nodes.filter((node) => matches(node, filters, calls)) ?? [];
  const selectedNode = snapshot?.nodes.find((node) => node.id === selected);
  return (
    <Theme
      className="inspector-app"
      appearance={appearance}
      accentColor="blue"
      grayColor="slate"
      radius="medium"
      scaling="90%"
    >
      <header className="app-header">
        <div className="brand">
          <div className="brand-logo" aria-hidden="true">
            π
          </div>
          <div>
            <Heading size="5">Pi Session Inspector</Heading>
            <Text size="2" color="gray">
              Inspect and explore Pi agent sessions in real time
            </Text>
          </div>
        </div>
        <div className="header-context">
          <span>{snapshot?.name ?? "Connecting"}</span>
          <span>
            Pi leaf: <strong>{snapshot?.leafId ?? "none"}</strong>
          </span>
          <span>Capture: {snapshot ? new Date(snapshot.captureStartedAt).toISOString().slice(0, 19) : "—"}</span>
          <span>
            Browser preview: <strong>{leaf || "none"}</strong>
          </span>
        </div>
        <div className="header-actions">
          <Badge color={connected ? "green" : "amber"} className="connection-badge">
            <span className="status-dot" />
            {connected ? "Live" : "Disconnected"}
          </Badge>
          <Badge>Read-only</Badge>
          <IconButton
            aria-label="Toggle appearance"
            variant="ghost"
            onClick={() => setAppearance(appearance === "dark" ? "light" : "dark")}
          >
            {appearance === "dark" ? <SunIcon /> : <MoonIcon />}
          </IconButton>
          <span className="brand-avatar" aria-hidden="true">
            P
          </span>
        </div>
      </header>
      {(error || snapshot?.incomplete) && (
        <div className="app-notices">
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
        </div>
      )}
      <main className="app-grid">
        <Sidebar
          nodes={nodes}
          total={snapshot?.totalEntries ?? 0}
          selected={leaf}
          filters={filters}
          change={setFilters}
          choose={(id) => {
            setLeaf(id);
            setSelected(id);
            setOffset(0);
          }}
        />
        <div className="center-column">
          <Overview snapshot={snapshot} />
          <Trace
            view={view}
            changeView={setView}
            key={`${leaf}-${offset}`}
            entries={branch?.entries.filter((entry) => matches(entry, filters, calls)) ?? []}
            branch={branch}
            selected={selected}
            select={setSelected}
            detail={detail}
            calls={calls.filter((call) => matchesCall(call, filters))}
            allCalls={calls}
            dropped={snapshot?.droppedCalls ?? 0}
            offset={offset}
            page={setOffset}
            prompt={() => setTab("prompt")}
          />
        </div>
        <Inspector
          selected={selected}
          node={selectedNode}
          detail={detail}
          branch={branch}
          snapshot={snapshot}
          tab={tab}
          changeTab={setTab}
          select={setSelected}
        />
      </main>
      <footer className="app-footer">
        <div>
          <span className={`footer-status ${connected ? "online" : ""}`}>
            <span className="status-dot" />
            {connected ? "Live session" : "Session disconnected"}
          </span>
          <span>Real-time event streaming</span>
          <span>Authenticated loopback</span>
          <span>Capture in memory</span>
        </div>
        <span>{connected ? "Connected · watching for new events" : "Disconnected · reopen from Pi"}</span>
      </footer>
    </Theme>
  );
}
const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
