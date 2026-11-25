import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../scripts/storage.js";

function memoryStorage(initial) {
  const data = new Map(initial ? [["battleship-game:v1", initial]] : []);
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
  };
}

const FRESH = {
  level: "normal",
  board: 10,
  fleet: { 2: 1, 3: 2, 4: 1, 5: 1 },
  music: true,
  effects: true,
  stats: { played: 0, wins: 0, losses: 0, bestWin: null },
};

test("starts from the defaults when nothing is saved or storage is unavailable", () => {
  assert.deepEqual(createStore(memoryStorage()).get(), FRESH);
  assert.deepEqual(createStore(null).get(), FRESH);
});

test("the last setup, switches, and record survive a reload", () => {
  const storage = memoryStorage();
  const first = createStore(storage);
  first.update({
    level: "hard",
    board: 13,
    fleet: { 2: 3, 3: 0, 4: 2, 5: 1 },
    effects: false,
  });
  first.recordResult(true, 40);
  first.recordResult(true, 33);
  first.recordResult(false, 60);
  assert.deepEqual(createStore(storage).get(), {
    ...FRESH,
    level: "hard",
    board: 13,
    fleet: { 2: 3, 3: 0, 4: 2, 5: 1 },
    effects: false,
    stats: { played: 3, wins: 2, losses: 1, bestWin: 33 },
  });
});

test("a loss never sets the best win", () => {
  const store = createStore(memoryStorage());
  store.recordResult(false, 5);
  assert.equal(store.get().stats.bestWin, null);
});

test("corrupted or tampered data falls back to safe values", () => {
  assert.deepEqual(createStore(memoryStorage("{not json")).get(), FRESH);
  const tampered = JSON.stringify({
    level: "impossible",
    board: 99,
    fleet: { 2: -1, 3: 4, 5: 2.5 },
    stats: { played: "lots", wins: 2, bestWin: 0 },
  });
  assert.deepEqual(createStore(memoryStorage(tampered)).get(), {
    ...FRESH,
    fleet: { ...FRESH.fleet, 3: 4 },
    stats: { ...FRESH.stats, wins: 2 },
  });
});

test("a storage that throws on write does not break the game", () => {
  const store = createStore({
    getItem: () => null,
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
  });
  assert.doesNotThrow(() => store.recordResult(true, 30));
  assert.equal(
    store.get().stats.wins,
    1,
    "the result still counts for this visit",
  );
});
