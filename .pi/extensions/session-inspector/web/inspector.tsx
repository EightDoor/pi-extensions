import * as Collapsible from "@radix-ui/react-collapsible";
import { ChevronRightIcon, CubeIcon } from "@radix-ui/react-icons";
import { Badge, Button, Card, Flex, Heading, Tabs, Text } from "@radix-ui/themes";
import { useEffect, useMemo, useState } from "react";
import type { BranchView, Call, Capture, DetailView, EntrySummary, Json, Snapshot } from "../model.ts";
import { CallView, Copy, Data, Metadata, Status } from "./components.tsx";
import { entryCalls } from "./entry-calls.ts";
import { count, duration, eventName, output, promptDiff, record, scripts } from "./format.ts";

export function Inspector({
  selected,
  node,
  detail,
  detailError,
  retryDetails,
  call,
  branch,
  branchError,
  retryBranch,
  snapshot,
  tab,
  changeTab,
  select,
  selectCall,
}: {
  selected: string;
  node?: EntrySummary;
  detail?: DetailView;
  detailError: string;
  retryDetails(): void;
  call?: Call;
  branch?: BranchView;
  branchError: string;
  retryBranch(): void;
  snapshot?: Snapshot;
  tab: string;
  changeTab(tab: string): void;
  select(id: string): void;
  selectCall(id: string): void;
}) {
  const [format, setFormat] = useState("formatted");
  const raw = record(detail?.raw.value);
  const message = record(raw?.message);
  const payload = raw?.data ?? message?.content;
  const related = snapshot?.nodes.filter((entry) => entry.parentId === selected || entry.id === node?.parentId) ?? [];
  const recordedCall = snapshot?.calls.find(
    (item) => item.id === node?.toolCallId && item.branchAnchor === detail?.toolAnchor && !item.parentOccurrenceId,
  );
  const liveRaw: Capture | undefined = call
    ? {
        value: JSON.parse(JSON.stringify(call)) as Json,
        truncated: Boolean(call.args.truncated || call.result?.truncated),
      }
    : undefined;
  const activeRaw = liveRaw ?? detail?.raw;
  const captured = entryCalls(detail?.raw, snapshot?.calls ?? [], detail?.toolAnchor);
  const code = call ? (record(call.args.value)?.code as Json | undefined) : scripts(detail?.raw)?.value;
  const codemode = call?.name === "codemode" || Boolean(scripts(detail?.raw)) || message?.toolName === "codemode";
  const isCall = Boolean(call);
  const hasSkills = Boolean(
    snapshot?.skills.length || (Array.isArray(branch?.skillEvidence.value) && branch.skillEvidence.value.length),
  );
  const enabled = useMemo(
    () => [
      "raw",
      "prompt",
      "tools",
      ...(isCall ? [] : ["context"]),
      ...(hasSkills ? ["skills"] : []),
      ...(codemode ? ["codemode"] : []),
    ],
    [isCall, hasSkills, codemode],
  );
  useEffect(() => {
    if (!enabled.includes(tab)) changeTab("raw");
  }, [enabled, tab, changeTab]);
  return (
    <section className="panel inspector-panel">
      <div className="panel-heading">
        <Heading size="3">
          <CubeIcon />
          Event inspector
        </Heading>
        {activeRaw && <Copy key={selected} value={output(activeRaw.value)} />}
      </div>
      <div className="inspector-identity">
        <Heading size="4">
          {call ? "Captured execution" : node ? eventName(node.kind) : "Entry"} · {selected || "no selection"}
        </Heading>
        <Text size="2" color="gray">
          {call?.name ?? node?.name ?? "Session log entry"}
        </Text>
      </div>
      {detailError && (
        <div role="alert" className="detail-failure">
          {detailError}
          <Button size="1" variant="ghost" onClick={retryDetails}>
            Retry selected details
          </Button>
        </div>
      )}
      {branchError && (
        <div role="alert" className="branch-failure">
          {branchError}
          <Button size="1" variant="ghost" onClick={retryBranch}>
            Retry selected branch
          </Button>
        </div>
      )}
      {detail?.ancestryIssue && (
        <Text role="status" size="1" color="amber">
          Projection unavailable: {detail.ancestryIssue}. Raw entry retained.
        </Text>
      )}
      <Tabs.Root value={tab} onValueChange={changeTab} className="inspector-tabs">
        <Tabs.List wrap="nowrap" aria-label="Event detail views">
          {["raw", "prompt", "tools", "context", "skills", "codemode"].map((tab) => (
            <Tabs.Trigger key={tab} value={tab} disabled={!enabled.includes(tab)}>
              {tab}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <Tabs.Content value="raw">
          <div className="format-toolbar">
            <div className="view-switch">
              {["formatted", "json"].map((mode) => (
                <button type="button" key={mode} aria-pressed={format === mode} onClick={() => setFormat(mode)}>
                  {mode === "formatted" ? "Overview" : "Raw JSON"}
                </button>
              ))}
            </div>
          </div>
          {format === "formatted" && (
            <div className="inspector-metadata">
              <Metadata
                rows={(call
                  ? [
                      ["Source", "Observed tool execution"],
                      ["Tool", call.name],
                      ["ID", call.id],
                      ["Parent call", call.parentId],
                      ["Reported duration", call.durationMs === undefined ? undefined : duration(call.durationMs)],
                      [
                        "Start observed",
                        call.observedStartedAt === undefined
                          ? undefined
                          : new Date(call.observedStartedAt).toISOString(),
                      ],
                      [
                        "End observed",
                        call.observedEndedAt === undefined ? undefined : new Date(call.observedEndedAt).toISOString(),
                      ],
                      ["Anchor entry", call.branchAnchor ?? undefined],
                    ]
                  : [
                      ["Source", "Session log entry"],
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
                      [
                        "Indexed children",
                        count(snapshot?.nodes.filter((entry) => entry.parentId === selected).length),
                      ],
                      ["Tokens", node?.tokens === undefined ? undefined : count(node.tokens)],
                      [
                        "Reported tool duration",
                        recordedCall?.durationMs === undefined ? undefined : duration(recordedCall.durationMs),
                      ],
                    ]
                ).filter((row): row is [string, string] => typeof row[1] === "string")}
              />
              {(call?.status ?? node?.status) && <Status value={call?.status ?? node?.status} />}
            </div>
          )}
          {format === "formatted" && call ? (
            <>
              <Data label="Arguments · redacted display copy" data={call.args} scope={`${call.occurrenceId}-args`} />
              <Data label="Result · observed tool event" data={call.result} scope={`${call.occurrenceId}-result`} />
              {call.branchAnchor && (
                <Button variant="ghost" size="1" onClick={() => select(call.branchAnchor ?? "")}>
                  Inspect recorded anchor →
                </Button>
              )}
            </>
          ) : (
            <Data
              label="Raw selected entry · redacted display copy"
              data={
                format === "formatted" && payload !== undefined
                  ? { value: payload, truncated: Boolean(detail?.raw.truncated) }
                  : activeRaw
              }
              scope={`${selected}-raw`}
            />
          )}
          <Collapsible.Root className="related">
            <Collapsible.Trigger asChild>
              <Button variant="ghost" size="2">
                Related {call ? "calls" : "entries"}
                <ChevronRightIcon />
              </Button>
            </Collapsible.Trigger>
            <Collapsible.Content>
              {call
                ? snapshot?.calls
                    .filter(
                      (item) =>
                        item.parentOccurrenceId === call.occurrenceId || item.occurrenceId === call.parentOccurrenceId,
                    )
                    .map((item) => (
                      <button type="button" key={item.occurrenceId} onClick={() => selectCall(item.occurrenceId)}>
                        {item.name} · {item.id}
                      </button>
                    ))
                : related.map((entry) => (
                    <button type="button" key={entry.id} onClick={() => select(entry.id)}>
                      {eventName(entry.kind)} · {entry.id}
                    </button>
                  ))}
            </Collapsible.Content>
          </Collapsible.Root>
        </Tabs.Content>
        <Tabs.Content value="prompt">
          <Data label="Historical prompt · browser preview branch" data={branch?.prompt} scope={`${selected}-prompt`} />
          <Data
            label="Previous-node prompt · compare with selected branch"
            data={branch?.previousPrompt}
            scope={`${selected}-previousPrompt`}
          />
          <Data
            label="Prompt diff · removed / added lines"
            data={promptDiff(branch?.previousPrompt, branch?.prompt)}
            scope={`${selected}-prompt-diff`}
          />
          <Data label="Historical sections" data={branch?.sections} scope={`${selected}-sections`} />
          <Data label="Prompt updates on branch" data={branch?.promptUpdates} scope={`${selected}-promptUpdates`} />
          <Data label="Current runtime effective prompt · may not yet be sent" data={snapshot?.currentPrompt} />
        </Tabs.Content>
        <Tabs.Content value="tools">
          <Data
            label="Historical declared tools · preview branch"
            data={branch?.declaredTools}
            scope={`${selected}-declaredTools`}
          />
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
          <Data label="Evidence on preview branch" data={branch?.skillEvidence} scope={`${selected}-skillEvidence`} />
        </Tabs.Content>
        <Tabs.Content value="context">
          <Text as="p" size="2" color="gray">
            Pi projection applies compaction and context edits. Request-local hooks can still transform it; this is not
            the final provider HTTP request.
          </Text>
          <Data label="Projected branch entries" data={branch?.projection} scope={`${selected}-projection`} />
          <Data label="Selected entry contribution" data={detail?.projected} scope={`${selected}-projected`} />
        </Tabs.Content>
        <Tabs.Content value="codemode">
          <Text as="p" size="2" color="gray">
            Script source, output and historical nested metadata appear in the selected raw entry. Child results before
            activation are not captured. Sandbox variables, discovery-helper results and model-helper responses are
            unavailable unless the script printed them.
          </Text>
          <Data
            label="JavaScript source"
            data={
              typeof code === "string"
                ? { value: code, truncated: Boolean(call?.args.truncated || detail?.raw.truncated) }
                : undefined
            }
          />
          <Data label="Source / output / persisted nestedCalls" data={detail?.raw} />
          {captured.map((call) => (
            <CallView key={call.occurrenceId} call={call} all={captured} group="detail" />
          ))}
        </Tabs.Content>
      </Tabs.Root>
    </section>
  );
}
