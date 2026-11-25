import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateSetup,
  createFleet,
  shoot,
  allSunk,
  remainingShips,
  createOpponent,
  coordinate,
  neighbors,
} from "../scripts/engine.js";

function random(seed = 1) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}
const standard = { 2: 1, 3: 2, 4: 1, 5: 1 };
function assertLayout(fleet, size, lengths) {
  assert.ok(fleet);
  assert.equal(fleet.size, size);
  assert.deepEqual(
    fleet.ships.map((ship) => ship.cells.length).sort(),
    [...lengths].sort(),
  );
  const used = new Set();
  for (const ship of fleet.ships) {
    const rows = ship.cells.map((cell) => Math.floor(cell / size));
    const columns = ship.cells.map((cell) => cell % size);
    assert.ok(
      new Set(rows).size === 1 || new Set(columns).size === 1,
      "straight ship",
    );
    for (let i = 1; i < ship.cells.length; i++) {
      assert.ok(
        ship.cells[i] - ship.cells[i - 1] === 1 ||
          ship.cells[i] - ship.cells[i - 1] === size,
      );
    }
    for (const cell of ship.cells) {
      assert.ok(cell >= 0 && cell < size * size);
      assert.ok(!used.has(cell), "no overlap");
      used.add(cell);
    }
  }
  for (let a = 0; a < fleet.ships.length; a++) {
    for (let b = a + 1; b < fleet.ships.length; b++) {
      for (const x of fleet.ships[a].cells)
        for (const y of fleet.ships[b].cells) {
          const dr = Math.abs(Math.floor(x / size) - Math.floor(y / size));
          const dc = Math.abs((x % size) - (y % size));
          assert.ok(
            dr > 1 || dc > 1,
            "ships cannot touch, including diagonally",
          );
        }
    }
  }
}

test("setup accepts every supported grid and the standard fleet", () => {
  for (let size = 10; size <= 15; size++) {
    assert.deepEqual(validateSetup(size, standard).lengths, [2, 3, 3, 4, 5]);
  }
});
test("setup rejects missing, fractional or unsupported board sizes", () => {
  for (const size of [0, 9, 16, NaN, 10.5, Infinity])
    assert.equal(validateSetup(size, standard).valid, false);
});
test("setup rejects empty fleets, fractions, negative counts and nonfinite counts", () => {
  assert.equal(validateSetup(10, { 2: 0, 3: 0, 4: 0, 5: 0 }).valid, false);
  for (const count of [-1, 0.5, 31, NaN, Infinity, undefined]) {
    assert.equal(validateSetup(10, { ...standard, 2: count }).valid, false);
  }
});
test("setup rejects fleets larger than the board area", () => {
  assert.equal(validateSetup(10, { 2: 30, 3: 30, 4: 30, 5: 30 }).valid, false);
});
test("placement produces straight, separated fleets across all sizes and many seeds", () => {
  for (let size = 10; size <= 15; size++) {
    for (let seed = 1; seed <= 15; seed++) {
      assertLayout(
        createFleet(size, [2, 3, 3, 4, 5], random(seed)),
        size,
        [2, 3, 3, 4, 5],
      );
    }
  }
});
test("placement handles each individual ship size", () => {
  for (const length of [2, 3, 4, 5])
    assertLayout(createFleet(10, [length], random(length)), 10, [length]);
});
test("bounded placement fails cleanly for invalid and impossible arrangements", () => {
  assert.equal(createFleet(2, [2, 2], random(), 1000), null);
  assert.equal(createFleet(10, [2], random(), 0), null);
  assert.equal(createFleet(10, [], random()), null);
  assert.equal(createFleet(10, [6], random()), null);
});
test("generated fleets are independent mutable sessions", () => {
  const a = createFleet(10, [2], random());
  const b = createFleet(10, [2], random());
  shoot(a, a.ships[0].cells[0]);
  assert.equal(b.shots.size, 0);
  assert.equal(b.ships[0].hits.size, 0);
});
test("misses and hits are recorded once and repeats cannot add damage", () => {
  const fleet = createFleet(10, [3], random());
  const hit = fleet.ships[0].cells[0];
  const water = Array.from({ length: 100 }, (_, i) => i).find(
    (i) => !fleet.ships[0].cells.includes(i),
  );
  assert.equal(shoot(fleet, water).status, "miss");
  assert.equal(shoot(fleet, hit).status, "hit");
  assert.equal(shoot(fleet, hit).status, "repeat");
  assert.equal(fleet.shots.size, 2);
  assert.equal(fleet.ships[0].hits.size, 1);
});
test("invalid shots have no side effects", () => {
  const fleet = createFleet(10, [2], random());
  for (const index of [-1, 100, 0.5, NaN])
    assert.equal(shoot(fleet, index).status, "invalid");
  assert.equal(fleet.shots.size, 0);
});
test("sunk identity, ship counts and final victory are correct", () => {
  const fleet = createFleet(10, [2, 2, 3], random());
  assert.equal(allSunk(fleet), false);
  for (const ship of fleet.ships) {
    for (const cell of ship.cells.slice(0, -1))
      assert.equal(shoot(fleet, cell).status, "hit");
    const result = shoot(fleet, ship.cells.at(-1));
    assert.equal(result.status, "sunk");
    assert.deepEqual(result.cells, ship.cells);
    assert.equal(result.length, ship.cells.length);
  }
  assert.deepEqual(remainingShips(fleet), { 2: 0, 3: 0, 4: 0, 5: 0 });
  assert.equal(allSunk(fleet), true);
  assert.equal(shoot(fleet, fleet.ships[0].cells[0]).status, "repeat");
});
test("remaining counts change only when a full ship is sunk", () => {
  const fleet = createFleet(10, [2, 2], random());
  shoot(fleet, fleet.ships[0].cells[0]);
  assert.equal(remainingShips(fleet)[2], 2);
  shoot(fleet, fleet.ships[0].cells[1]);
  assert.equal(remainingShips(fleet)[2], 1);
});
test("opponent never repeats a shot and eventually exhausts an empty search", () => {
  const bot = createOpponent(10, random());
  const shots = new Set();
  for (let i = 0; i < 100; i++) {
    const index = bot.nextShot();
    assert.ok(index >= 0 && index < 100);
    assert.ok(!shots.has(index));
    shots.add(index);
    bot.observe({ status: "miss", index });
  }
  assert.equal(bot.nextShot(), null);
});
test("after a hit, the opponent searches an adjacent cell without row wrapping", () => {
  const bot = createOpponent(10, random());
  const hit = bot.nextShot();
  bot.observe({ status: "hit", index: hit });
  const next = bot.nextShot();
  const distance =
    Math.abs(Math.floor(next / 10) - Math.floor(hit / 10)) +
    Math.abs((next % 10) - (hit % 10));
  assert.equal(distance, 1);
});
test("opponent finishes real fleets without access to their positions", () => {
  for (let size = 10; size <= 15; size++) {
    for (let seed = 1; seed <= 5; seed++) {
      const fleet = createFleet(size, [2, 3, 3, 4, 5], random(seed));
      const bot = createOpponent(size, random(seed + 50));
      let attempts = 0;
      while (!allSunk(fleet) && attempts++ < size * size) {
        const index = bot.nextShot();
        assert.notEqual(index, null);
        const result = shoot(fleet, index);
        assert.ok(!["invalid", "repeat"].includes(result.status));
        bot.observe(result);
      }
      assert.equal(allSunk(fleet), true);
    }
  }
});

// --- Coordinates and neighbors ---
test("coordinates read as column letter and row number", () => {
  assert.equal(coordinate(0, 10), "A1");
  assert.equal(coordinate(9, 10), "J1");
  assert.equal(coordinate(99, 10), "J10");
  assert.equal(coordinate(224, 15), "O15");
});

test("neighbors stay on the board and never wrap to the next row", () => {
  assert.deepEqual(
    neighbors(9, 10).sort((a, b) => a - b),
    [8, 19],
  );
  assert.deepEqual(
    neighbors(10, 10).sort((a, b) => a - b),
    [0, 11, 20],
  );
  assert.equal(neighbors(55, 10, true).length, 8);
  assert.equal(neighbors(0, 10, true).length, 3);
});

// --- Difficulty levels ---
/** Plays one opponent against a fleet and returns the shots it needed. */
function shotsToWin(level, size, seed) {
  const fleet = createFleet(size, [2, 3, 3, 4, 5], random(seed));
  const bot = createOpponent(size, random(seed + 100), level);
  let shots = 0;
  while (!allSunk(fleet)) {
    bot.observe(shoot(fleet, bot.nextShot()));
    shots++;
  }
  return shots;
}

test("every level finishes real fleets without repeating a shot", () => {
  for (const level of ["easy", "normal", "hard"]) {
    for (let seed = 1; seed <= 10; seed++) {
      const shots = shotsToWin(level, 10, seed);
      assert.ok(shots <= 100, `${level} used ${shots} shots`);
    }
  }
});

test("easy ignores its hits: its shots are the same whatever it observes", () => {
  const blind = createOpponent(10, random(3), "easy");
  const told = createOpponent(10, random(3), "easy");
  for (let i = 0; i < 30; i++) {
    const a = blind.nextShot();
    const b = told.nextShot();
    assert.equal(a, b);
    told.observe({ status: "hit", index: b });
  }
});

test("normal fires next to a hit, like hard", () => {
  const bot = createOpponent(10, random(4), "normal");
  const hit = bot.nextShot();
  bot.observe({ status: "hit", index: hit });
  assert.ok(neighbors(hit, 10).includes(bot.nextShot()));
});

test("hard searches one checkerboard color before the other", () => {
  const bot = createOpponent(10, random(5), "hard");
  const color = (index) => (Math.floor(index / 10) + (index % 10)) % 2;
  const firstHalf = Array.from({ length: 50 }, () => bot.nextShot());
  assert.equal(new Set(firstHalf.map(color)).size, 1);
});

test("hard never fires next to a sunk ship, because ships cannot touch", () => {
  const bot = createOpponent(10, random(6), "hard");
  bot.observe({ status: "sunk", index: 45, length: 2, cells: [44, 45] });
  const shots = Array.from({ length: 80 }, () => bot.nextShot()).filter(
    (s) => s !== null,
  );
  const banned = new Set([44, 45].flatMap((cell) => neighbors(cell, 10, true)));
  assert.ok(shots.every((s) => !banned.has(s)));
});

test("on average, each level needs fewer shots than the one below it", () => {
  const average = (level) => {
    let total = 0;
    for (let seed = 1; seed <= 40; seed++) total += shotsToWin(level, 10, seed);
    return total / 40;
  };
  const easy = average("easy");
  const normal = average("normal");
  const hard = average("hard");
  assert.ok(normal < easy, `normal ${normal} should beat easy ${easy}`);
  assert.ok(hard < normal, `hard ${hard} should beat normal ${normal}`);
});
