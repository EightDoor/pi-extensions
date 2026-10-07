import assert from "node:assert/strict";
import { test } from "vitest";
import {
  createGoalContextContract,
  createInactiveGoalContextContract,
  reconcileGoalContextContract,
  reconcileInactiveGoalContextContract,
} from "../src/goal-contract.js";
import type { GoalPromptContext } from "../src/prompts.js";

const goal: GoalPromptContext = {
  id: "restored-goal",
  text: "Finish the retained work",
  status: "active",
  iteration: 1,
  tokensUsed: 0,
  startedAt: 0,
  updatedAt: 0,
  timeUsedSeconds: 0,
  baselineTokens: 0,
};

const states = [
  {
    name: "active",
    expected: createGoalContextContract(goal),
    reconcile: (messages: unknown[]) => reconcileGoalContextContract(messages, goal),
  },
  {
    name: "inactive",
    expected: createInactiveGoalContextContract(),
    reconcile: reconcileInactiveGoalContextContract,
  },
];

const summaries = [[], ["compactionSummary"], ["branchSummary"], ["compactionSummary", "branchSummary"]];

for (const state of states) {
  for (const roles of summaries) {
    for (const withSystem of [false, true]) {
      test(`${state.name} restoration appends after ${roles.join(" + ") || "ordinary history"}, system=${withSystem}`, () => {
        const messages = [
          ...(withSystem ? [{ role: "system", content: "Stable instructions" }] : []),
          ...roles.map((role) => ({ role, content: `${role} retained text` })),
          { role: "user", content: "Retained request" },
          { role: "assistant", content: [{ type: "text", text: "Retained response" }] },
        ];
        const original = structuredClone(messages);
        const restored = state.reconcile(messages);
        assert.deepEqual(restored, [...original, state.expected]);
        assert.deepEqual(messages, original);
        assert.deepEqual(state.reconcile(restored), restored);

        // Pi publishes the same content with runtime metadata at the transcript tail.
        const persisted = [...messages, { ...state.expected, timestamp: 123 }];
        assert.deepEqual(state.reconcile(persisted), persisted);
      });
    }
  }

  test(`${state.name} restoration appends to empty context`, () => {
    assert.deepEqual(state.reconcile([]), [state.expected]);
  });
}

test("only the latest contract controls active and inactive supersession", () => {
  const active = createGoalContextContract(goal);
  const inactive = createInactiveGoalContextContract();
  const changedGoal = { ...goal, id: "replacement-goal", text: "Finish the replacement work" };
  const replacement = createGoalContextContract(changedGoal);
  const history = [active, { role: "user", content: "Stop" }, inactive];

  const reactivated = reconcileGoalContextContract(history, goal);
  assert.deepEqual(reactivated, [...history, active]);
  assert.deepEqual(reconcileGoalContextContract(reactivated, goal), reactivated);
  const replaced = reconcileGoalContextContract(reactivated, changedGoal);
  assert.deepEqual(replaced, [...reactivated, replacement]);
  assert.deepEqual(reconcileGoalContextContract(replaced, changedGoal), replaced);
  const stopped = reconcileInactiveGoalContextContract(replaced);
  assert.deepEqual(stopped, [...replaced, inactive]);
  assert.deepEqual(reconcileInactiveGoalContextContract(stopped), stopped);
});
