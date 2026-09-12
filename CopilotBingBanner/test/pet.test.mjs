import assert from "node:assert/strict";
import test from "node:test";
import {
  DAILY_REWARD_LIMIT,
  careForPet,
  defaultPetState,
  normalizePetState,
  petProgress,
  petArt,
  petStage,
  rewardPet,
} from "../pet.mjs";

const TODAY = "2026-08-27";

test("rewarded offers add Sparks once and hatch the egg at ten", () => {
  let state = defaultPetState(TODAY);
  for (const offer of ["one", "two", "three"]) {
    state = rewardPet(state, offer, TODAY).state;
  }
  const hatch = rewardPet(state, "four", TODAY);

  assert.equal(hatch.state.sparks, 12);
  assert.equal(hatch.evolved, true);
  assert.equal(petStage(hatch.state.sparks).id, "hatchling");
});

test("BytePet is hidden by default until explicitly revealed", () => {
  const state = defaultPetState(TODAY);

  assert.equal(state.visible, false);
  assert.equal(normalizePetState({}, TODAY).visible, false);
});

test("the same offer cannot be rewarded twice in one day", () => {
  const first = rewardPet(defaultPetState(TODAY), "keyboard", TODAY);
  const second = rewardPet(first.state, "keyboard", TODAY);

  assert.equal(second.awarded, 0);
  assert.equal(second.reason, "already-rewarded");
  assert.equal(second.state.sparks, 3);
});

test("daily rewarded offers are capped", () => {
  let state = defaultPetState(TODAY);
  for (let index = 0; index < DAILY_REWARD_LIMIT; index += 1) {
    state = rewardPet(state, `offer-${index}`, TODAY).state;
  }
  const capped = rewardPet(state, "one-too-many", TODAY);

  assert.equal(capped.awarded, 0);
  assert.equal(capped.reason, "daily-limit");
});

test("a new day preserves Sparks and clears rewarded offers", () => {
  const rewarded = rewardPet(defaultPetState(TODAY), "monitor", TODAY).state;
  const tomorrow = normalizePetState(rewarded, "2026-08-28");

  assert.equal(tomorrow.sparks, 3);
  assert.deepEqual(tomorrow.rewardedOffers, []);
});

test("care costs Sparks and updates mood", () => {
  const state = { ...defaultPetState(TODAY), sparks: 5 };
  const fed = careForPet(state, "feed");

  assert.equal(fed.state.sparks, 3);
  assert.equal(fed.state.mood, "Content");
  assert.match(fed.message, /byte-cookie/);
});

test("progress is measured within the current evolution stage", () => {
  const progress = petProgress({ ...defaultPetState(TODAY), sparks: 15 });

  assert.equal(progress.stage.id, "hatchling");
  assert.equal(progress.current, 5);
  assert.equal(progress.required, 15);
  assert.equal(progress.percent, 33);
});

test("every BytePet art line is centered within a stable character grid", () => {
  for (const stage of ["egg", "hatchling", "explorer", "builder", "guardian"]) {
    const lines = petArt(stage).split("\n");
    const occupiedCenters = lines.map((line) => {
      const left = line.search(/\S/);
      const right = line.trimEnd().length - 1;
      return (left + right) / 2;
    });
    assert.ok(Math.max(...occupiedCenters) - Math.min(...occupiedCenters) <= 0.5);
  }
});
