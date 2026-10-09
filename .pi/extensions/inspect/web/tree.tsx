import * as Collapsible from "@radix-ui/react-collapsible";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  MagnifyingGlassIcon,
  MixerHorizontalIcon,
  Share2Icon,
} from "@radix-ui/react-icons";
import { Checkbox, Flex, Heading, IconButton, Select, Text, TextField } from "@radix-ui/themes";
import { useEffect, useMemo, useRef, useState } from "react";
import type { EntrySummary } from "../model.ts";
import { Glyph } from "./components.tsx";
import { eventName, type Filters } from "./format.ts";
import { flatten, hierarchy, label, reveal, withAncestors } from "./hierarchy.ts";
import { scrollWithin } from "./trace.tsx";

function Tree({
  nodes,
  matches,
  selected,
  serial,
  revealSelected,
  choose,
}: {
  nodes: EntrySummary[];
  matches: Set<string>;
  selected: string;
  serial: number;
  revealSelected: boolean;
  choose(id: string): void;
}) {
  const tree = useMemo(() => hierarchy(nodes), [nodes]);
  const keep = useMemo(
    () => withAncestors(tree, new Set([...matches, ...(revealSelected && selected ? [selected] : [])])),
    [tree, matches, revealSelected, selected],
  );
  const [expanded, setExpanded] = useState(new Set<string>());
  const [offset, setOffset] = useState(0);
  const previous = useRef<{ selected: string; serial: number; revealSelected: boolean } | undefined>(undefined);
  const nav = useRef<HTMLElement>(null);
  const rows = flatten(tree, expanded, keep);
  useEffect(() => {
    const old = previous.current;
    if (
      !tree.nodes.has(selected) ||
      (old?.selected === selected && old.serial === serial && old.revealSelected === revealSelected)
    )
      return;
    previous.current = { selected, serial, revealSelected };
    const next = reveal(tree, expanded, selected);
    setExpanded(next);
    const index = flatten(tree, next, keep).findIndex((row) => row.node.id === selected);
    if (index >= 0) setOffset(Math.floor(index / 100) * 100);
  }, [selected, serial, revealSelected, tree, expanded, keep]);
  const selectedVisible = rows.slice(offset, offset + 100).some((row) => row.node.id === selected);
  const lastScroll = useRef<{ selected: string; offset: number; element: HTMLElement } | undefined>(undefined);
  useEffect(() => {
    const element = nav.current?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!selectedVisible || !nav.current || !element || element.dataset.entryId !== selected) return;
    const last = lastScroll.current;
    if (last?.selected === selected && last.offset === offset && last.element === element) return;
    lastScroll.current = { selected, offset, element };
    scrollWithin(nav.current, element);
  }, [selected, offset, selectedVisible]);
  useEffect(() => {
    if (offset >= rows.length && offset) setOffset(0);
  }, [offset, rows.length]);
  const pageRows = rows.slice(offset, offset + 100);
  const base = pageRows.length ? Math.min(...pageRows.map((row) => row.depth)) : 0;
  const rail = Math.min(8, 64 / Math.max(1, ...pageRows.map((row) => row.depth - base)));
  return (
    <>
      <nav ref={nav} className="tree-scroll" aria-label="Session branches">
        {pageRows.map(({ node, depth, childCount }) => (
          <div key={node.id} className="tree-row" style={{ paddingLeft: (depth - base) * rail }}>
            {childCount ? (
              <IconButton
                variant="ghost"
                size="1"
                aria-label={`Toggle children of ${node.id}`}
                aria-expanded={expanded.has(node.id)}
                onClick={() =>
                  setExpanded((previous) => {
                    const next = new Set(previous);
                    if (next.has(node.id)) next.delete(node.id);
                    else next.add(node.id);
                    return next;
                  })
                }
              >
                {expanded.has(node.id) ? <ChevronDownIcon /> : <ChevronRightIcon />}
              </IconButton>
            ) : (
              <span className="tree-spacer" />
            )}
            <button
              type="button"
              className="node"
              data-entry-id={node.id}
              data-match={matches.has(node.id)}
              aria-current={selected === node.id ? "true" : undefined}
              onClick={() => choose(node.id)}
              title={`${node.kind} · ${node.id}\n${label(node)}${node.nameTruncated ? " [truncated; inspect Raw for the complete captured value]" : ""}`}
            >
              <Glyph kind={node.kind} />
              <span className="node-copy">
                <span className="node-title">
                  <strong>{eventName(node.kind)}</strong>
                  <small>{node.id.slice(0, 8)}</small>
                </span>
                <span className="node-description">{label(node)}</span>
              </span>
            </button>
          </div>
        ))}
      </nav>
      {rows.length > 100 && (
        <div className="nav-pagination">
          <button type="button" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 100))}>
            Previous nodes
          </button>
          <span>
            {offset + 1}–{Math.min(offset + 100, rows.length)}
          </span>
          <button type="button" disabled={offset + 100 >= rows.length} onClick={() => setOffset(offset + 100)}>
            Next nodes
          </button>
        </div>
      )}
    </>
  );
}
export function Sidebar({
  nodes,
  matches,
  total,
  selected,
  serial,
  revealSelected,
  choose,
  filters,
  change,
}: {
  nodes: EntrySummary[];
  matches: Set<string>;
  total: number;
  selected: string;
  serial: number;
  revealSelected: boolean;
  choose(id: string): void;
  filters: Filters;
  change(filters: Filters): void;
}) {
  const toggleGroup = (group: string) =>
    change({
      ...filters,
      groups: filters.groups.includes(group)
        ? filters.groups.filter((item) => item !== group)
        : [...filters.groups, group],
    });
  return (
    <aside className="sidebar">
      <section className="panel tree-panel">
        <div className="panel-heading">
          <Heading size="3">
            <Share2Icon />
            Session tree
          </Heading>
          <Text size="1" color="gray">
            {total} entries
          </Text>
        </div>
        <div className="tree-controls">
          <TextField.Root
            aria-label="Search session"
            placeholder="Search entries or content…"
            value={filters.query}
            onChange={(event) => change({ ...filters, query: event.target.value })}
          >
            <TextField.Slot>
              <MagnifyingGlassIcon />
            </TextField.Slot>
          </TextField.Root>
          <div className="filter-pills">
            {["All", "Model", "Tool", "Custom"].map((group) => (
              <button
                type="button"
                key={group}
                aria-pressed={
                  group === "All" ? !filters.groups.length : filters.groups.length === 1 && filters.groups[0] === group
                }
                onClick={() => change({ ...filters, kind: "all", groups: group === "All" ? [] : [group] })}
              >
                {group}
              </button>
            ))}
          </div>
        </div>
        <Tree
          nodes={nodes}
          matches={matches}
          selected={selected}
          serial={serial}
          revealSelected={revealSelected}
          choose={choose}
        />
        <div className="tree-count">
          {matches.size} matches / {total} entries
        </div>
      </section>
      <Collapsible.Root className="panel filter-panel" defaultOpen={false}>
        <Collapsible.Trigger asChild>
          <button className="filters-toggle" type="button">
            <MixerHorizontalIcon />
            Filters
            <ChevronDownIcon />
          </button>
        </Collapsible.Trigger>
        <Collapsible.Content>
          <label className="filter-check" htmlFor="filter-errors">
            <span>Errors only</span>
            <Checkbox
              id="filter-errors"
              checked={filters.errorsOnly}
              onCheckedChange={(checked) => change({ ...filters, errorsOnly: checked === true })}
            />
          </label>
          <label className="filter-check" htmlFor="filter-slow">
            <span>Slow tool calls (&gt; 10s)</span>
            <Checkbox
              id="filter-slow"
              checked={filters.slowOnly}
              onCheckedChange={(checked) => change({ ...filters, slowOnly: checked === true })}
            />
          </label>
          {[
            ["Tool", "Tool events"],
            ["Model", "Model events"],
            ["Custom", "Custom events"],
          ].map(([group, label]) => (
            <label className="filter-check" key={group} htmlFor={`filter-${group}`}>
              <span>{label}</span>
              <Checkbox
                id={`filter-${group}`}
                checked={filters.groups.includes(group)}
                onCheckedChange={() => toggleGroup(group)}
              />
            </label>
          ))}
          <Flex justify="between" align="center" gap="2">
            <Text size="1" color="gray">
              Entry type
            </Text>
            <Select.Root value={filters.kind} onValueChange={(kind) => change({ ...filters, kind })}>
              <Select.Trigger aria-label="Filter entry type" variant="soft" />
              <Select.Content>
                {[
                  "all",
                  "user",
                  "assistant",
                  "toolResult",
                  "system",
                  "custom",
                  "compaction",
                  "branch_summary",
                  "model_change",
                  "thinking_level_change",
                  "context_edit",
                ].map((kind) => (
                  <Select.Item key={kind} value={kind}>
                    {kind}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </Flex>
        </Collapsible.Content>
      </Collapsible.Root>
    </aside>
  );
}
