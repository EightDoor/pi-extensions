import { describe, expect, it } from "vitest";
import { mainCIState } from "../scripts/wait-for-main-ci.mjs";

const sha = "a".repeat(40);
const run = { id: 1, head_sha: sha, head_branch: "main", event: "push", status: "completed", conclusion: "success" };
describe("release main-push CI gate", () => {
  it("requires an exact successful main push, not a PR, another branch or another SHA", () => {
    for (const change of [{ head_sha: "b".repeat(40) }, { head_branch: "other" }, { event: "pull_request" }])
      expect(mainCIState({ workflow_runs: [{ ...run, ...change }] }, sha)).toBe("waiting");
    expect(mainCIState({ workflow_runs: [run] }, sha)).toBe("success");
  });
  it("waits for readiness/registration and every recognized pending state", () => {
    expect(mainCIState({ workflow_runs: [] }, sha)).toBe("waiting");
    for (const status of ["queued", "in_progress", "waiting", "pending", "requested"])
      expect(mainCIState({ workflow_runs: [{ ...run, status, conclusion: null }] }, sha)).toBe("waiting");
  });
  it("fails closed on terminal failure and uses the newest matching run", () => {
    for (const conclusion of ["failure", "cancelled", "skipped", "timed_out", null])
      expect(mainCIState({ workflow_runs: [{ ...run, conclusion }] }, sha)).toBe("failed");
    expect(mainCIState({ workflow_runs: [run, { ...run, id: 2, conclusion: "failure" }] }, sha)).toBe("failed");
    expect(mainCIState({ workflow_runs: [{ ...run, id: 2, status: "in_progress", conclusion: null }, run] }, sha)).toBe(
      "waiting",
    );
  });
  it("rejects malformed responses/unknown states", () => {
    expect(() => mainCIState({}, sha)).toThrow();
    expect(() => mainCIState({ workflow_runs: [{ ...run, status: "unknown" }] }, sha)).toThrow();
  });
});
