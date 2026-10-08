import * as Collapsible from "@radix-ui/react-collapsible";
import { ChevronDownIcon, ChevronRightIcon, ListBulletIcon, RowsIcon, Share2Icon } from "@radix-ui/react-icons";
import { Button, Flex, Heading, Tabs, Text } from "@radix-ui/themes";
import { useState } from "react";
import type { BranchView, Call, DetailView, EntrySummary } from "../model.ts";
import { CallView, Data, Glyph, Metadata, Status } from "./components.tsx";
import { count, duration, eventName, time } from "./format.ts";

function EntryOverview({
  entry,
  call,
  detail,
  branch,
  prompt,
}: {
  entry: EntrySummary;
  call?: Call;
  detail?: DetailView;
  branch?: BranchView;
  prompt(): void;
}) {
  return (
    <Tabs.Root defaultValue="overview" className="inline-tabs">
      <Tabs.List>
        <Tabs.Trigger value="overview">Overview</Tabs.Trigger>
        <Tabs.Trigger value="content">Content</Tabs.Trigger>
        <Tabs.Trigger value="context">Context</Tabs.Trigger>
      </Tabs.List>
      <Tabs.Content value="overview">
        <div className="event-overview-grid">
          <div className="detail-box">
            <Metadata
              rows={[
                ["Type", eventName(entry.kind)],
                ["Name", entry.name],
                ["Tokens", count(entry.tokens)],
                ["Parent", entry.parentId ?? "root"],
              ]}
            />
          </div>
          <div className="detail-box">
            <div className="detail-status">
              <Text size="1" color="gray">
                Status
              </Text>
              <Status value={entry.status} />
            </div>
            <Metadata
              rows={[
                ["Duration", duration(call?.durationMs)],
                ["Timestamp", time(entry.timestamp)],
                ["Source", "Persisted session entry"],
              ]}
            />
          </div>
          <div className="detail-box prompt-preview">
            <strong>Preview branch prompt</strong>
            <pre>{typeof branch?.prompt.value === "string" ? branch.prompt.value.slice(0, 220) : "unavailable"}</pre>
            <button type="button" onClick={prompt}>
              View full prompt →
            </button>
          </div>
        </div>
      </Tabs.Content>
      <Tabs.Content value="content">
        <Data
          label={
            detail ? "Recorded content · redacted display copy" : "Entry summary · select row to load full details"
          }
          data={detail?.raw ?? { value: entry.label, truncated: true }}
        />
      </Tabs.Content>
      <Tabs.Content value="context">
        <Data label="Selected entry contribution" data={detail?.projected} />
      </Tabs.Content>
    </Tabs.Root>
  );
}
function depth(call: Call, all: Call[]): number {
  let current = call;
  let result = 0;
  const seen = new Set([call.id]);
  while (current.parentId && result < 6) {
    const parent = all.find((item) => item.id === current.parentId);
    if (!parent || seen.has(parent.id)) break;
    seen.add(parent.id);
    current = parent;
    result++;
  }
  return result;
}
export function Trace({
  view,
  changeView,
  entries,
  branch,
  selected,
  select,
  detail,
  calls,
  allCalls,
  dropped,
  offset,
  page,
  prompt,
}: {
  view: string;
  changeView(view: string): void;
  entries: EntrySummary[];
  branch?: BranchView;
  selected: string;
  select(id: string): void;
  detail?: DetailView;
  calls: Call[];
  allCalls: Call[];
  dropped: number;
  offset: number;
  page(offset: number): void;
  prompt(): void;
}) {
  const [expanded, setExpanded] = useState(new Set<string>());
  const toggle = (id: string, open: boolean) =>
    setExpanded((previous) => {
      const next = new Set(previous);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
  const longest = Math.max(1, ...allCalls.map((call) => call.durationMs ?? 0));
  return (
    <section className="panel trace-panel">
      <div className="trace-toolbar">
        <Heading size="3">
          <Share2Icon />
          Trace explorer
        </Heading>
        <Text size="1" color="gray">
          Ordered branch entries
        </Text>
        <div className="trace-actions">
          <Button
            size="1"
            variant="soft"
            disabled={!entries.length}
            onClick={() => setExpanded(new Set(entries.map((entry) => entry.id)))}
          >
            Expand all
          </Button>
          <Button size="1" variant="soft" disabled={!expanded.size} onClick={() => setExpanded(new Set())}>
            Collapse all
          </Button>
          <div className="view-switch">
            {["timeline", "list"].map((mode) => (
              <button type="button" key={mode} aria-pressed={view === mode} onClick={() => changeView(mode)}>
                {mode === "timeline" ? <RowsIcon /> : <ListBulletIcon />}
                {mode === "timeline" ? "Timeline" : "List"}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="trace-columns">
        <span>Event</span>
        <span>Status</span>
        <span>Duration</span>
        <span>Tokens</span>
        <span>Timestamp</span>
      </div>
      <div className={`trace-scroll trace-${view}`}>
        <div className="trace-stack">
          {!entries.length && <div className="empty-state">No branch entries match these filters.</div>}
          {entries.map((entry) => {
            const call = allCalls.find((call) => call.id === entry.toolCallId);
            const open = expanded.has(entry.id);
            return (
              <Collapsible.Root
                className="trace-item"
                key={entry.id}
                open={open}
                onOpenChange={(open) => toggle(entry.id, open)}
              >
                <div className={`trace-row ${selected === entry.id ? "selected" : ""}`}>
                  <div className="trace-event">
                    <Collapsible.Trigger asChild>
                      <button className="expand-button" type="button" aria-label={`Expand event ${entry.id}`}>
                        {open ? <ChevronDownIcon /> : <ChevronRightIcon />}
                      </button>
                    </Collapsible.Trigger>
                    <button
                      type="button"
                      className="transcript-entry"
                      aria-current={selected === entry.id ? "true" : undefined}
                      onClick={() => {
                        select(entry.id);
                        toggle(entry.id, true);
                      }}
                    >
                      <Glyph kind={entry.kind} />
                      <strong>{eventName(entry.kind)}</strong>
                      <span className="event-name">{entry.name ?? entry.label}</span>
                      <small>{entry.id}</small>
                    </button>
                  </div>
                  <Status value={entry.status} />
                  <span title="Only captured tool-result duration is available">{duration(call?.durationMs)}</span>
                  <span>{count(entry.tokens)}</span>
                  <span>{time(entry.timestamp)}</span>
                </div>
                <Collapsible.Content className="entry-expanded">
                  <EntryOverview
                    entry={entry}
                    call={call}
                    detail={selected === entry.id ? detail : undefined}
                    branch={branch}
                    prompt={prompt}
                  />
                </Collapsible.Content>
              </Collapsible.Root>
            );
          })}
        </div>
        <div className="live-section-heading">
          <Heading size="2">Live calls · session-wide</Heading>
          <Text size="1" color="gray">
            {dropped} evicted · since activation · not a Promise graph
          </Text>
        </div>
        {calls.length === 0 && <div className="empty-state">No captured tool executions match these filters.</div>}
        {calls.map((call) => (
          <Collapsible.Root
            key={call.id}
            id={`live-call-${call.id}`}
            className="live-trace-item"
            style={{ marginLeft: view === "timeline" ? depth(call, allCalls) * 14 : 0 }}
          >
            <Collapsible.Trigger asChild>
              <button type="button" className="call-trigger trace-row" aria-label={`${call.name} · ${call.status}`}>
                <span className="trace-event">
                  <ChevronRightIcon className="call-chevron" />
                  <Glyph kind="toolResult" />
                  <strong>{call.name}</strong>
                  <small>{call.id}</small>
                </span>
                <Status value={call.status} />
                <span className="duration-cell">
                  {duration(call.durationMs)}
                  {call.durationMs !== undefined && (
                    <span
                      className="duration-bar"
                      style={{ width: `${Math.max(4, (call.durationMs / longest) * 100)}%` }}
                    />
                  )}
                </span>
                <span title="Token usage is not part of the execution event">—</span>
                <span>Live</span>
              </button>
            </Collapsible.Trigger>
            <Collapsible.Content>
              <CallView call={call} all={allCalls} />
            </Collapsible.Content>
          </Collapsible.Root>
        ))}
      </div>
      <div className="trace-pagination">
        <Text size="1" color="gray">
          Browser preview only · Pi is not navigated
        </Text>
        <Flex align="center" gap="2">
          <Button size="1" variant="ghost" disabled={!offset} onClick={() => page(Math.max(0, offset - 50))}>
            Previous
          </Button>
          <Text size="1">
            {branch?.total ? offset + 1 : 0}–{Math.min(offset + 50, branch?.total ?? 0)} / {branch?.total ?? 0}
          </Text>
          <Button
            size="1"
            variant="ghost"
            disabled={!branch || offset + 50 >= branch.total}
            onClick={() => page(offset + 50)}
          >
            Next
          </Button>
        </Flex>
      </div>
    </section>
  );
}
