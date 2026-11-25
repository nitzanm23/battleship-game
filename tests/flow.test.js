import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeDom, freshImport } from "./helpers/fake-dom.js";

// --- Scripted battles ---
/** A fleet in the same shape createFleet returns, from lists of ship squares. */
function fleet(size, ships) {
  return {
    size,
    ships: ships.map((cells, id) => ({ id, cells, hits: new Set() })),
    shots: new Map(),
  };
}

const STANDARD = {
  level: "normal",
  size: 10,
  counts: { 2: 1, 3: 2, 4: 1, 5: 1 },
};
// Small fleets make scripted battles short: one 2-square ship each.
const ONE_SHIP = { ...STANDARD, counts: { 2: 1, 3: 0, 4: 0, 5: 0 } };
const ENEMY_SHIP = [0, 1]; // A1 and B1
const PLAYER_SHIP = [99, 98]; // J10 and I10

/** A repeatable random source, so the computer's shots are the same on every run. */
function seeded(seed = 1) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

async function setup(context) {
  const env = installFakeDom(context);
  const game = await freshImport("scripts/game.js");
  game.init({ storage: env.storage });

  const squares = (id) =>
    env
      .el(id)
      .descendants()
      .filter((node) => node.dataset.index !== undefined);
  const square = (id, index) =>
    squares(id).find((n) => n.dataset.index === String(index));
  const fire = (index) => square("enemy-board", index).dispatch("click");
  const start = (settings = ONE_SHIP, scripted = {}) =>
    game.startGame(settings, {
      player: fleet(settings.size, [PLAYER_SHIP]),
      enemy: fleet(settings.size, [ENEMY_SHIP]),
      random: seeded(),
      ...scripted,
    });
  const saved = () => JSON.parse(env.storage.getItem("battleship-game:v1"));
  return { ...env, game, squares, square, fire, start, saved };
}

// --- Starting a battle ---
test("a new battle renders both boards and shows only the player's ships", async (t) => {
  const f = await setup(t);
  const scrolls = [];
  globalThis.scrollTo = (x, y) => scrolls.push([x, y]);
  t.after(() => delete globalThis.scrollTo);

  assert.equal(f.game.startGame(STANDARD, { random: seeded() }), true);
  const enemy = f.squares("enemy-board");
  const own = f.squares("own-board");
  assert.equal(enemy.length, 100);
  assert.ok(enemy.every((node) => node.tagName === "BUTTON"));
  assert.equal(
    enemy.filter((node) => node.classList.contains("is-ship")).length,
    0,
  );
  assert.equal(
    own.filter((node) => node.classList.contains("is-ship")).length,
    17,
  );
  assert.equal(f.el("enemy-left").textContent, "5");
  assert.equal(f.el("setup-screen").hidden, true);
  assert.equal(
    document.activeElement,
    f.square("enemy-board", 0),
    "ready to aim by keyboard",
  );
  assert.deepEqual(scrolls, [[0, 0]]);
  assert.deepEqual(f.saved().fleet, STANDARD.counts, "the setup is remembered");
});

test("every board size renders the right number of squares on both boards", async (t) => {
  const f = await setup(t);
  for (let size = 10; size <= 15; size++) {
    f.game.startGame({ ...STANDARD, size }, { random: seeded(size) });
    assert.equal(f.squares("enemy-board").length, size * size);
    assert.equal(f.squares("own-board").length, size * size);
    assert.equal(
      f.el("enemy-board").style.getPropertyValue("--board-size"),
      String(size),
    );
  }
});

test("an invalid setup stays on the menu with a message", async (t) => {
  const f = await setup(t);
  const started = f.game.startGame({
    ...STANDARD,
    counts: { 2: 0, 3: 0, 4: 0, 5: 0 },
  });
  assert.equal(started, false);
  assert.equal(f.el("setup-error").textContent, "Choose at least one ship.");
  assert.equal(document.activeElement, f.el("setup-error"));
  assert.equal(f.el("game-screen").hidden, true);
});

test("a fleet that cannot fit never opens a half-built battle", async (t) => {
  const f = await setup(t);
  const started = f.game.startGame({
    ...STANDARD,
    counts: { 2: 0, 3: 0, 4: 0, 5: 9 },
  });
  assert.equal(started, false);
  assert.match(f.el("setup-error").textContent, /does not fit/);
  assert.equal(f.el("game-screen").hidden, true);
  assert.equal(f.timers.size, 0);
});

// --- Turns ---
test("each player shot gives the computer exactly one shot", async (t) => {
  const f = await setup(t);
  f.start();
  f.fire(50);
  assert.equal(f.el("game-screen").dataset.turn, "computer");
  f.fire(51);
  f.fire(52);
  assert.match(f.el("game-message").textContent, /Hold fire/);
  assert.equal(
    f.el("player-shots").textContent,
    "1",
    "extra clicks do not fire",
  );
  f.advance(899);
  assert.equal(f.el("computer-shots").textContent, "0");
  f.advance(1);
  assert.equal(f.el("computer-shots").textContent, "1");
  assert.equal(f.el("game-screen").dataset.turn, "player");
});

test("a hit still passes the turn, and sinking the last ship wins at once", async (t) => {
  const f = await setup(t);
  f.start();
  f.fire(0);
  assert.ok(f.square("enemy-board", 0).classList.contains("is-hit"));
  assert.equal(f.el("game-screen").dataset.turn, "computer");
  f.advance(900);
  f.fire(1);
  assert.match(f.el("result-title").textContent, /Victory/);
  assert.equal(f.el("result-dialog").open, true);
  assert.equal(f.el("result-art").dataset.tone, "win");
  assert.ok(f.square("enemy-board", 1).classList.contains("is-sunk"));
  assert.equal(
    f.timers.size,
    0,
    "the computer does not fire after the battle ends",
  );
  assert.match(
    f.el("result-details").textContent,
    /Your shots: 2 · accuracy 100%/,
  );
  assert.deepEqual(f.saved().stats, {
    played: 1,
    wins: 1,
    losses: 0,
    bestWin: 2,
  });
  assert.equal(
    f.el("stats-summary").textContent,
    "Battles 1 · Wins 1 · Losses 0 · Best win: 2 shots",
  );
});

test("a sunk ship is drawn, shakes the board, and gives the computer more time", async (t) => {
  const f = await setup(t);
  f.start(
    { ...ONE_SHIP, counts: { 2: 2, 3: 0, 4: 0, 5: 0 } },
    {
      player: fleet(10, [PLAYER_SHIP, [80, 81]]),
      enemy: fleet(10, [ENEMY_SHIP, [30, 40]]),
    },
  );
  const parts = (cells) =>
    cells.map((i) => f.square("enemy-board", i).dataset.part);
  assert.deepEqual(
    parts([30, 40]),
    [undefined, undefined],
    "hidden ships stay hidden",
  );

  f.fire(30);
  f.advance(900);
  f.fire(40);
  assert.deepEqual(parts([30, 40]), ["bow", "stern"]);
  assert.equal(f.square("enemy-board", 40).dataset.axis, "column");
  assert.ok(f.square("enemy-board", 30).classList.contains("is-sinking"));
  assert.ok(f.el("enemy-board").classList.contains("is-shaking"));
  assert.equal(f.sound("sunk").playCount, 1);

  f.advance(900);
  assert.equal(
    f.el("computer-shots").textContent,
    "1",
    "no shot yet after the usual delay",
  );
  f.advance(900);
  assert.equal(f.el("computer-shots").textContent, "2");
  assert.equal(
    f.square("enemy-board", 30).classList.contains("is-sinking"),
    true,
    "the computer's shot does not touch the enemy board",
  );
  f.fire(55);
  assert.equal(
    f.square("enemy-board", 30).classList.contains("is-sinking"),
    false,
  );
});

test("firing at the same square twice keeps the turn and plays the error sound", async (t) => {
  const f = await setup(t);
  f.start();
  f.fire(50);
  f.advance(900);
  f.fire(50);
  assert.match(f.el("game-message").textContent, /already hit or missed/);
  assert.equal(f.el("game-screen").dataset.turn, "player");
  assert.equal(f.sound("error").playCount, 1);
});

test("accuracy counts hits out of all shots", async (t) => {
  const f = await setup(t);
  f.start();
  assert.equal(f.el("player-accuracy").textContent, "–");
  f.fire(0);
  f.advance(900);
  f.fire(50);
  assert.equal(f.el("player-accuracy").textContent, "50%");
});

test("the computer can win, and the enemy ships it never found are revealed", async (t) => {
  const f = await setup(t);
  f.start({ ...ONE_SHIP, level: "hard" });
  let target = 20; // the player keeps missing in the middle of the board
  for (
    let turn = 0;
    turn < 100 && f.el("result-dialog").open === false;
    turn++
  ) {
    f.fire(target++);
    f.advance(900);
  }
  assert.match(f.el("result-title").textContent, /Defeat/);
  assert.equal(f.el("result-art").dataset.tone, "lose");
  assert.ok(
    ENEMY_SHIP.every((i) =>
      f.square("enemy-board", i).classList.contains("is-revealed"),
    ),
  );
  assert.equal(f.saved().stats.losses, 1);
  const shots = f.el("computer-shots").textContent;
  f.advance(5000);
  assert.equal(
    f.el("computer-shots").textContent,
    shots,
    "no shots after the battle ends",
  );
});

// --- Pause, tabs, menu ---
test("pause stops the computer's clock and resume keeps the time it had left", async (t) => {
  const f = await setup(t);
  f.start();
  f.fire(50);
  f.advance(400);
  f.game.togglePause();
  assert.equal(f.el("pause-label").textContent, "Resume");
  assert.match(f.el("pause-icon").getAttribute("href"), /#play$/);
  assert.equal(f.el("enemy-board").inert, true);
  f.advance(10000);
  assert.equal(f.el("computer-shots").textContent, "0");
  f.game.togglePause();
  f.advance(499);
  assert.equal(f.el("computer-shots").textContent, "0");
  f.advance(1);
  assert.equal(f.el("computer-shots").textContent, "1");
});

test("shots are ignored while paused", async (t) => {
  const f = await setup(t);
  f.start();
  f.game.togglePause();
  f.fire(0);
  assert.equal(f.el("player-shots").textContent, "0");
});

test("switching tabs pauses the battle, and coming back does not resume it", async (t) => {
  const f = await setup(t);
  f.start();
  document.hidden = true;
  f.fireDocument("visibilitychange");
  document.hidden = false;
  f.fireDocument("visibilitychange");
  assert.equal(f.el("turn-banner").textContent, "Paused");
});

test("a computer shot scheduled before leaving never lands in the next battle", async (t) => {
  const f = await setup(t);
  f.start();
  f.fire(50);
  f.game.backToMenu();
  assert.equal(f.el("setup-screen").hidden, false);
  assert.equal(document.activeElement, f.el("start-button"));
  f.start();
  f.advance(5000);
  assert.equal(f.el("computer-shots").textContent, "0");
  assert.equal(f.el("game-screen").dataset.turn, "player");
});

test("play again starts a clean battle", async (t) => {
  const f = await setup(t);
  f.start();
  f.fire(0);
  f.game.togglePause();
  f.start();
  assert.equal(f.el("player-shots").textContent, "0");
  assert.equal(f.el("pause-label").textContent, "Pause");
  assert.equal(f.el("enemy-board").inert, false);
  assert.equal(
    f.squares("enemy-board").filter((n) => n.classList.contains("is-hit"))
      .length,
    0,
  );
});

// --- Boards and keyboard ---
test("narrow screens switch between the enemy board and your fleet", async (t) => {
  const f = await setup(t);
  f.start();
  assert.equal(f.el("game-screen").dataset.view, "enemy");
  f.game.showBoard("own");
  assert.equal(f.el("game-screen").dataset.view, "own");
  f.start();
  assert.equal(
    f.el("game-screen").dataset.view,
    "enemy",
    "each battle opens on the enemy board",
  );
});

test("arrow keys aim across the enemy board and stop at its edges", async (t) => {
  const f = await setup(t);
  f.start();
  const press = (index, key) =>
    f.square("enemy-board", index).dispatch("keydown", { key });
  press(0, "ArrowRight");
  assert.equal(document.activeElement, f.square("enemy-board", 1));
  assert.equal(
    f.square("enemy-board", 0).tabIndex,
    -1,
    "only one square is in the tab order",
  );
  press(1, "ArrowDown");
  assert.equal(document.activeElement, f.square("enemy-board", 11));
  press(11, "End");
  assert.equal(document.activeElement, f.square("enemy-board", 99));
  press(99, "ArrowRight");
  assert.equal(
    document.activeElement,
    f.square("enemy-board", 99),
    "no wrap past the edge",
  );
  press(99, "ArrowDown");
  assert.equal(document.activeElement, f.square("enemy-board", 99));
});

test("squares are labeled with their coordinate and what happened there", async (t) => {
  const f = await setup(t);
  f.start();
  assert.equal(
    f.square("enemy-board", 0).getAttribute("aria-label"),
    "A1, not fired at",
  );
  assert.equal(
    f.square("own-board", 99).getAttribute("aria-label"),
    "J10, your ship",
  );
  f.fire(0);
  assert.equal(
    f.square("enemy-board", 0).getAttribute("aria-label"),
    "A1, hit",
  );
});

// --- Audio ---
test("music follows pause and the Music switch, and the choice is saved", async (t) => {
  const f = await setup(t);
  f.start();
  const music = f.sound("background-music");
  assert.equal(music.paused, false);
  music.currentTime = 20;
  f.game.togglePause();
  assert.equal(music.paused, true);
  f.game.togglePause();
  assert.equal(music.currentTime, 20, "resumes where it stopped");
  f.game.toggleMusic();
  assert.equal(music.paused, true);
  assert.equal(f.saved().music, false);
  assert.equal(f.el("music-button").getAttribute("aria-pressed"), "false");
});

test("the Sounds switch silences effects and is saved", async (t) => {
  const f = await setup(t);
  f.game.toggleEffects();
  f.start();
  f.fire(50);
  assert.equal(f.sound("miss")?.playCount ?? 0, 0);
  assert.equal(f.saved().effects, false);
  assert.match(f.el("effects-icon").getAttribute("href"), /#volume-xmark$/);
});

test("the battle's sounds are downloaded at the start and the victory sound plays", async (t) => {
  const f = await setup(t);
  f.start();
  const victory = f.sound("victory");
  assert.equal(victory.preload, "auto");
  f.fire(0);
  f.advance(900);
  f.fire(1);
  assert.equal(victory.playCount, 1);
  assert.equal(
    f.sound("background-music").currentTime,
    0,
    "music rewinds after the battle",
  );
});
