import { ChevronDownIcon, ChevronRightIcon } from "@radix-ui/react-icons";
import { Button, Text } from "@radix-ui/themes";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Call, EntrySummary } from "../model.ts";
import { CallView, Status } from "./components.tsx";
import { duration, type Filters, matchesCall } from "./format.ts";
import { flatten, hierarchy, reveal, withAncestors } from "./hierarchy.ts";
import { TimelineMark } from "./timeline.tsx";
import { axis } from "./timing.ts";

export function LiveDrawer({
  calls,
  entries,
  selected,
  select,
  open,
  changeOpen,
  view,
  dropped,
  filters,
}: {
  calls: Call[];
  entries: EntrySummary[];
  selected?: string;
  select(id: string): void;
  open: boolean;
  changeOpen(open: boolean): void;
  view: string;
  dropped: number;
  filters: Filters;
}) {
  const tree = useMemo(() => hierarchy(calls.map((call) => ({ ...call, parentId: call.parentId ?? null }))), [calls]);
  const keep = useMemo(
    () => withAncestors(tree, new Set(calls.filter((call) => matchesCall(call, filters)).map((call) => call.id))),
    [tree, calls, filters],
  );
  const [expanded, setExpanded] = useState(new Set<string>());
  const previous = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (selected && selected !== previous.current && tree.nodes.has(selected)) {
      previous.current = selected;
      setExpanded((old) => reveal(tree, old, selected));
    }
  }, [selected, tree]);
  const rows = flatten(tree, expanded, keep);
  const range = axis(entries, calls);
  return (
    <section className={`live-drawer ${open ? "drawer-open" : ""}`}>
      <button type="button" className="live-drawer-toggle" aria-expanded={open} onClick={() => changeOpen(!open)}>
        {open ? <ChevronDownIcon /> : <ChevronRightIcon />}
        <strong>Live calls</strong>
        <span>
          {calls.length} captured · {calls.filter((call) => call.status === "error").length} errors · {dropped} evicted
        </span>
        <span className="drawer-scope">Session-wide · observed events</span>
      </button>
      {open && (
        <div className="live-drawer-body">
          <div className="live-controls">
            <Text size="1" color="gray">
              Reported durations are monotonic execute() timings; bars are observed callback intervals.
            </Text>
            <Button size="1" variant="ghost" disabled={!keep.size} onClick={() => setExpanded(new Set(keep))}>
              Expand calls
            </Button>
            <Button size="1" variant="ghost" onClick={() => setExpanded(new Set())}>
              Collapse calls
            </Button>
          </div>
          {!rows.length && <div className="empty-state">No captured executions match these filters.</div>}
          {rows.map(({ node: call, depth }) => (
            <div
              key={call.id}
              id={`live-call-${call.id}`}
              className="live-trace-item"
              data-parent-id={call.parentId ?? ""}
              style={{ marginLeft: depth * 12 }}
            >
              <div className={`live-call-row ${selected === call.id ? "selected" : ""}`}>
                <button
                  type="button"
                  className="expand-button"
                  aria-label={`Expand call ${call.id}`}
                  aria-expanded={expanded.has(call.id)}
                  onClick={() =>
                    setExpanded((old) => {
                      const next = new Set(old);
                      if (next.has(call.id)) next.delete(call.id);
                      else next.add(call.id);
                      return next;
                    })
                  }
                >
                  {expanded.has(call.id) ? <ChevronDownIcon /> : <ChevronRightIcon />}
                </button>
                <button
                  type="button"
                  className="call-trigger"
                  aria-label={`${call.name} · ${call.status}`}
                  onClick={() => select(call.id)}
                >
                  <strong title={call.name}>{call.name}</strong>
                  <code>{call.id}</code>
                  <Status value={call.status} />
                  <span>{duration(call.durationMs)}</span>
                </button>
                {view === "timeline" && (
                  <TimelineMark range={range} call={{ ...call, parentId: call.parentId ?? undefined }} />
                )}
              </div>
              {expanded.has(call.id) && (
                <CallView call={{ ...call, parentId: call.parentId ?? undefined }} all={calls} />
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
