import {
  BarChartIcon,
  ClockIcon,
  CubeIcon,
  ExclamationTriangleIcon,
  LightningBoltIcon,
  ListBulletIcon,
} from "@radix-ui/react-icons";
import { Heading } from "@radix-ui/themes";
import type { Snapshot } from "../model.ts";
import { count, duration } from "./format.ts";

export function Overview({ snapshot }: { snapshot?: Snapshot }) {
  const nodes = snapshot?.nodes ?? [];
  const partial = (snapshot?.totalEntries ?? 0) > nodes.length;
  const timed = (snapshot?.calls ?? []).filter((call) => call.durationMs !== undefined);
  const stamps = nodes.map((node) => Date.parse(node.timestamp)).filter(Number.isFinite);
  const span = stamps.length ? Math.max(...stamps) - Math.min(...stamps) : undefined;
  const tokens = nodes.filter((node) => node.tokens !== undefined);
  const timings = timed.slice(-16);
  const max = Math.max(1, ...timings.map((call) => call.durationMs ?? 0));
  const metrics = [
    {
      name: "Total entries",
      value: count(snapshot?.totalEntries),
      icon: ListBulletIcon,
      hint: "All persisted session entries, across branches.",
    },
    {
      name: "Recorded span",
      value: duration(span),
      icon: ClockIcon,
      hint: "Time between the first and last indexed entry; not execution time.",
    },
    {
      name: "Model messages",
      value: snapshot ? `${nodes.filter((node) => node.kind === "assistant").length}${partial ? "+" : ""}` : "—",
      icon: CubeIcon,
      hint: "Indexed assistant messages, not provider request count.",
    },
    {
      name: "Captured calls",
      value: count(snapshot?.calls.length),
      icon: LightningBoltIcon,
      hint: "Live execution records captured since consent; evictions are reported below.",
    },
    {
      name: "Tokens (recorded)",
      value: tokens.length
        ? `${count(tokens.reduce((sum, node) => sum + (node.tokens ?? 0), 0))}${partial ? "+" : ""}`
        : "—",
      icon: BarChartIcon,
      hint: "Persisted assistant totalTokens only; excludes compaction and auxiliary usage.",
    },
    {
      name: "Captured errors",
      value: count(snapshot?.calls.filter((call) => call.status === "error").length),
      icon: ExclamationTriangleIcon,
      hint: "Errors in the bounded live collector; not all historical errors.",
    },
  ];
  return (
    <section className="panel overview">
      <div className="panel-heading">
        <Heading size="3">
          <BarChartIcon />
          Session overview
        </Heading>
      </div>
      <div className="overview-metrics">
        {metrics.map((metric) => (
          <div className="metric" key={metric.name} title={metric.hint}>
            <span className="metric-icon">
              <metric.icon />
            </span>
            <div>
              <span className="metric-label">{metric.name}</span>
              <strong>{metric.value}</strong>
            </div>
          </div>
        ))}
        <div className="mini-chart" role="img" aria-label="Captured tool durations">
          <div className="chart-bars">
            {timings.map((call) => (
              <span
                key={call.id}
                title={`${call.name}: ${duration(call.durationMs)}`}
                style={{ height: `${Math.max(4, ((call.durationMs ?? 0) / max) * 100)}%` }}
              />
            ))}
            {!timings.length && <span className="chart-empty">No captured timings</span>}
          </div>
          <span>Tool timings · {timings.length} samples</span>
        </div>
      </div>
    </section>
  );
}
