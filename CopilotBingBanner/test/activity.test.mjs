import assert from "node:assert/strict";
import test from "node:test";
import { ActivityTracker, cleanTerminalText } from "../activity.mjs";

test("cleanTerminalText removes ANSI control sequences", () => {
  assert.equal(cleanTerminalText("\u001b[32mThinking\u001b[0m\r"), "Thinking\n");
});

test("submission displays the banner and active output updates its label", () => {
  const changes = [];
  const tracker = new ActivityTracker((state) => changes.push(state), 10_000);

  tracker.submitted();
  tracker.observed("\u001b[36mSearching\u001b[0m the repository");

  assert.deepEqual(changes, [
    { active: true, label: "Working" },
    { active: true, label: "Searching" },
  ]);
  tracker.dispose();
});

test("an input request hides the banner", () => {
  const changes = [];
  const tracker = new ActivityTracker((state) => changes.push(state), 10_000);

  tracker.submitted();
  tracker.observed("Do you want to allow this action? [y/N]");

  assert.deepEqual(changes.at(-1), { active: false, label: "Working" });
  tracker.dispose();
});

test("quiet output settles the activity state", async () => {
  const changes = [];
  const tracker = new ActivityTracker((state) => changes.push(state), 5);

  tracker.submitted();
  tracker.observed("Done.");
  await new Promise((resolve) => setTimeout(resolve, 15));

  assert.deepEqual(changes.at(-1), { active: false, label: "Working" });
  tracker.dispose();
});
