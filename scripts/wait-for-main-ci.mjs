import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

// Only the newest matching push run may authorize this exact revision.
export function mainCIState(payload, sha) {
  if (!Array.isArray(payload?.workflow_runs)) throw new Error("Invalid CI run response.");
  const runs = payload.workflow_runs.filter(
    (run) => run?.head_sha === sha && run.event === "push" && run.head_branch === "main",
  );
  runs.sort((a, b) => b.id - a.id);
  const run = runs[0];
  if (!run) return "waiting";
  if (run.status === "completed") return run.conclusion === "success" ? "success" : "failed";
  if (["queued", "in_progress", "waiting", "pending", "requested"].includes(run.status)) return "waiting";
  throw new Error("Unknown CI run status.");
}

async function main() {
  const repository = process.env.GITHUB_REPOSITORY;
  const sha = process.env.GITHUB_SHA;
  const token = process.env.GH_TOKEN;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? "") || !/^[a-f0-9]{40}$/.test(sha ?? "") || !token)
    throw new Error("Missing release CI-gate identity or credentials.");
  const url = `https://api.github.com/repos/${repository}/actions/workflows/ci.yml/runs?branch=main&event=push&head_sha=${sha}&per_page=100`;
  for (let attempt = 0; attempt < 60; attempt++) {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`CI gate HTTP ${response.status}; publication refused.`);
    const state = mainCIState(await response.json(), sha);
    if (state === "success") {
      console.log(`Successful main push CI verified for ${sha}.`);
      return;
    }
    if (state === "failed") throw new Error("Main push CI did not succeed; publication refused.");
    await delay(15000);
  }
  throw new Error("Timed out waiting for main push CI; publication refused.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
