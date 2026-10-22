import { test } from "node:test";
import assert from "node:assert/strict";
import { ratingStats } from "../public/shared.js";

const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
const raters = [
  { id: "r1", name: "Lauren" },
  { id: "r2", name: "Lee" },
  { id: "r3", name: "Yannick" },
];

test("counts who has rated and how many ratings in all", () => {
  const s = ratingStats(items, raters, [
    { rater_id: "r1", item_id: "a", tier: "S" },
    { rater_id: "r1", item_id: "b", tier: "S" },
    { rater_id: "r1", item_id: "c", tier: "F" },
    { rater_id: "r2", item_id: "a", tier: "B" },
  ]);
  assert.equal(s.people, 3);
  assert.equal(s.rated, 2);
  assert.equal(s.ratings, 4);
  assert.equal(s.possible, 9);
  assert.equal(s.ranked.get("r1"), 3);
  assert.equal(s.ranked.get("r3"), 0);
  assert.deepEqual(s.byRater.get("r1"), { S: 2, A: 0, B: 0, C: 0, D: 0, F: 1 });
});

test("ignores deleted items, unknown people and anything not in a tier", () => {
  const s = ratingStats(items, raters, [
    { rater_id: "r1", item_id: "gone", tier: "S" },
    { rater_id: "stranger", item_id: "a", tier: "S" },
    { rater_id: "r2", item_id: "a", tier: "unsorted" },
  ]);
  assert.equal(s.rated, 0);
  assert.equal(s.ratings, 0);
});

test("an empty grade has nothing to count", () => {
  const s = ratingStats([], [], []);
  assert.deepEqual([s.people, s.rated, s.ratings, s.possible], [0, 0, 0, 0]);
});
