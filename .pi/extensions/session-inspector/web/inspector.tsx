import * as Collapsible from "@radix-ui/react-collapsible";
import { ChevronRightIcon, CubeIcon } from "@radix-ui/react-icons";
import { Badge, Button, Card, Flex, Heading, Tabs, Text } from "@radix-ui/themes";
import { useState } from "react";
import type { BranchView, DetailView, EntrySummary, Snapshot } from "../model.ts";
import { CallView, Copy, Data, Metadata, Status } from "./components.tsx";
import { count, duration, eventName, output, promptDiff, record, scripts } from "./format.ts";

export function Inspector({
  selected,
  node,
  detail,
  branch,
  snapshot,
  tab,
  changeTab,
  select,
}: {
  selected: string;
  node?: EntrySummary;
  detail?: DetailView;
  branch?: BranchView;
  snapshot?: Snapshot;
  tab: string;
  changeTab(tab: string): void;
  select(id: string): void;
}) {
  const [format, setFormat] = useState("formatted");
  const raw = record(detail?.raw.value);
  const message = record(raw?.message);
  const payload = raw?.data ?? message?.content;
  const related = snapshot?.nodes.filter((entry) => entry.parentId === selected || entry.id === node?.parentId) ?? [];
  const call = snapshot?.calls.find((call) => call.id === node?.toolCallId);
  return (
    <section className="panel inspector-panel">
      <div className="panel-heading">
        <Heading size="3">
          <CubeIcon />
          Event inspector
        </Heading>
        {detail && <Copy key={selected} value={output(detail.raw.value)} />}
      </div>
      <div className="inspector-identity">
        <Heading size="4">
          {node ? eventName(node.kind) : "Entry"} · {selected || "no selection"}
        </Heading>
        <Text size="2" color="gray">
          {node?.name ?? "Persisted session data"}
        </Text>
      </div>
      <Tabs.Root value={tab} onValueChange={changeTab} className="inspector-tabs">
        <Tabs.List wrap="wrap">
          {["raw", "prompt", "tools", "context", "skills", "codemode"].map((tab) => (
            <Tabs.Trigger key={tab} value={tab}>
              {tab}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <Tabs.Content value="raw">
          <div className="format-toolbar">
            <div className="view-switch">
              {["formatted", "json"].map((mode) => (
                <button type="button" key={mode} aria-pressed={format === mode} onClick={() => setFormat(mode)}>
                  {mode === "formatted" ? "Formatted" : "JSON"}
                </button>
              ))}
            </div>
          </div>
          {format === "formatted" && (
            <div className="detail-box inspector-metadata">
              <Metadata
                rows={[
                  ["Type", node?.kind ?? (typeof raw?.type === "string" ? raw.type : undefined)],
                  [
                    node?.kind === "custom" || node?.kind === "custom_message"
                      ? "Custom type"
                      : node?.kind === "assistant"
                        ? "Model"
                        : "Name",
                    node?.name,
                  ],
                  ["ID", selected],
                  ["Parent ID", node?.parentId ?? "root"],
                  ["Timestamp", node?.timestamp],
                  ["Duration", duration(call?.durationMs)],
                  ["Indexed children", count(snapshot?.nodes.filter((entry) => entry.parentId === selected).length)],
                  ["Tokens", count(node?.tokens)],
                ]}
              />
              <div className="detail-status">
                <Text size="2" color="gray">
                  Status
                </Text>
                <Status value={node?.status} />
              </div>
            </div>
          )}
          <Data
            label="Raw selected entry · redacted display copy"
            data={
              format === "formatted" && payload !== undefined
                ? { value: payload, truncated: Boolean(detail?.raw.truncated) }
                : detail?.raw
            }
          />
          <Collapsible.Root className="related">
            <Collapsible.Trigger asChild>
              <Button variant="ghost" size="2">
                Related entries ({related.length})<ChevronRightIcon />
              </Button>
            </Collapsible.Trigger>
            <Collapsible.Content>
              {related.map((entry) => (
                <button type="button" key={entry.id} onClick={() => select(entry.id)}>
                  {eventName(entry.kind)} · {entry.id}
                </button>
              ))}
            </Collapsible.Content>
          </Collapsible.Root>
        </Tabs.Content>
        <Tabs.Content value="prompt">
          <Data label="Historical prompt · browser preview branch" data={branch?.prompt} />
          <Data label="Previous-node prompt · compare with selected branch" data={branch?.previousPrompt} />
          <Data label="Prompt diff · removed / added lines" data={promptDiff(branch?.previousPrompt, branch?.prompt)} />
          <Data label="Historical sections" data={branch?.sections} />
          <Data label="Prompt updates on branch" data={branch?.promptUpdates} />
          <Data label="Current runtime effective prompt · may not yet be sent" data={snapshot?.currentPrompt} />
        </Tabs.Content>
        <Tabs.Content value="tools">
          <Data label="Historical declared tools · preview branch" data={branch?.declaredTools} />
          <Text as="p" size="2" color="gray">
            Current active ≠ provider-visible. MCP connection status is unavailable.
          </Text>
          {snapshot?.tools.map((tool) => (
            <Card key={tool.name} className="inventory-card">
              <Text weight="bold">{tool.name}</Text>
              <Flex gap="1" wrap="wrap">
                <Badge>{tool.namespace ?? "tool"}</Badge>
                <Badge>{tool.exposure}</Badge>
                <Badge>{tool.active ? "active" : "inactive"}</Badge>
                <Badge>{tool.callable ? "callable" : "not callable"}</Badge>
              </Flex>
              <Text as="p" size="2" color="gray">
                {tool.description}
              </Text>
              <Collapsible.Root>
                <Collapsible.Trigger asChild>
                  <Button size="1" variant="ghost">
                    Schema · {tool.name}
                  </Button>
                </Collapsible.Trigger>
                <Collapsible.Content>
                  <Data label="Schema" data={tool.schema} />
                </Collapsible.Content>
              </Collapsible.Root>
            </Card>
          ))}
        </Tabs.Content>
        <Tabs.Content value="skills">
          <Text as="p" size="2" color="gray">
            Advertised or read does not prove model compliance. Historical discovery may be unavailable.
          </Text>
          {snapshot?.skills.map((skill) => (
            <Card key={skill.path} className="inventory-card">
              <Flex gap="2">
                <Text weight="bold">{skill.name}</Text>
                <Badge>advertised</Badge>
              </Flex>
              <Text as="p" size="2">
                {skill.description}
              </Text>
              <Text size="1" color="gray">
                {skill.path}
              </Text>
            </Card>
          ))}
          <Data label="Evidence on preview branch" data={branch?.skillEvidence} />
        </Tabs.Content>
        <Tabs.Content value="context">
          <Text as="p" size="2" color="gray">
            Pi projection applies compaction and context edits. Request-local hooks can still transform it; this is not
            the final provider HTTP request.
          </Text>
          <Data label="Projected branch entries" data={branch?.projection} />
          <Data label="Selected entry contribution" data={detail?.projected} />
        </Tabs.Content>
        <Tabs.Content value="codemode">
          <Text as="p" size="2" color="gray">
            Script source, output and historical nested metadata appear in the selected raw entry. Child results before
            activation are not captured. Sandbox variables, discovery-helper results and model-helper responses are
            unavailable unless the script printed them.
          </Text>
          <Data label="JavaScript source" data={scripts(detail?.raw)} />
          <Data label="Source / output / persisted nestedCalls" data={detail?.raw} />
          {detail?.calls.map((call) => (
            <CallView key={call.id} call={call} all={detail.calls} group="detail" />
          ))}
        </Tabs.Content>
      </Tabs.Root>
    </section>
  );
}
