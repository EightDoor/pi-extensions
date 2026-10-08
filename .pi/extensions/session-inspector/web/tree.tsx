import * as Collapsible from "@radix-ui/react-collapsible";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  MagnifyingGlassIcon,
  MixerHorizontalIcon,
  Share2Icon,
} from "@radix-ui/react-icons";
import { Checkbox, Flex, Heading, IconButton, Select, Text, TextField } from "@radix-ui/themes";
import { useEffect, useRef, useState } from "react";
import type { EntrySummary } from "../model.ts";
import { Glyph } from "./components.tsx";
import { eventName, type Filters } from "./format.ts";

function Tree({ nodes, selected, choose }: { nodes: EntrySummary[]; selected: string; choose(id: string): void }) {
  const [collapsed, setCollapsed] = useState(new Set<string>());
  const nav = useRef<HTMLElement>(null);
  const hasSelection = nodes.some((node) => node.id === selected);
  useEffect(() => {
    if (hasSelection && selected)
      nav.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: "nearest" });
  }, [hasSelection, selected]);
  const ids = new Set(nodes.map((n) => n.id));
  const children = new Map<string, EntrySummary[]>();
  for (const node of nodes) {
    const parent = node.parentId && ids.has(node.parentId) ? node.parentId : "";
    const list = children.get(parent) ?? [];
    list.push(node);
    children.set(parent, list);
  }
  const rows: { node: EntrySummary; depth: number }[] = [];
  const visited = new Set<string>();
  const stack = (children.get("") ?? [])
    .slice()
    .reverse()
    .map((node) => ({ node, depth: 0 }));
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
    <nav ref={nav} className="tree-scroll" aria-label="Session branches">
      {rows.map(({ node, depth }) => (
        <div key={node.id} className="tree-row" style={{ paddingLeft: Math.min(depth, 5) * 6 }}>
          {depth > 0 && (
            <span className="tree-connector" aria-hidden="true" style={{ left: Math.min(depth, 5) * 6 + 9 }} />
          )}
          {(children.get(node.id)?.length ?? 0) > 0 ? (
            <Collapsible.Root
              open={!collapsed.has(node.id)}
              onOpenChange={(open) =>
                setCollapsed((previous) => {
                  const next = new Set(previous);
                  if (open) next.delete(node.id);
                  else next.add(node.id);
                  return next;
                })
              }
            >
              <Collapsible.Trigger asChild>
                <IconButton variant="ghost" size="1" aria-label={`Toggle children of ${node.id}`}>
                  {collapsed.has(node.id) ? <ChevronRightIcon /> : <ChevronDownIcon />}
                </IconButton>
              </Collapsible.Trigger>
            </Collapsible.Root>
          ) : (
            <span className="tree-spacer" />
          )}
          <button
            type="button"
            className="node"
            data-entry-id={node.id}
            aria-current={selected === node.id ? "true" : undefined}
            onClick={() => choose(node.id)}
          >
            <Glyph kind={node.kind} />
            <span className="node-copy">
              <span className="node-title">
                <strong>{eventName(node.kind)}</strong>
                <small>{node.id}</small>
              </span>
              <span className="node-description">{node.name ?? node.label}</span>
            </span>
          </button>
        </div>
      ))}
    </nav>
  );
}
export function Sidebar({
  nodes,
  total,
  selected,
  choose,
  filters,
  change,
}: {
  nodes: EntrySummary[];
  total: number;
  selected: string;
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
        <Tree nodes={nodes} selected={selected} choose={choose} />
        <div className="tree-count">
          {nodes.length} shown / {total} total
        </div>
      </section>
      <section className="panel filter-panel">
        <div className="panel-heading">
          <Heading size="3">
            <MixerHorizontalIcon />
            Filters
          </Heading>
        </div>
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
      </section>
    </aside>
  );
}
