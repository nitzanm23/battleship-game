/**
 * Battleship Game: match flow and screen updates.
 *
 * Owns one match at a time: both fleets, whose turn it is, the computer's delayed shot, and the
 * result. Rules and the opponent's strategy come from engine.js, so this file only turns them into
 * state changes and DOM updates. Each match gets a new generation number, so a computer shot that
 * was scheduled for an earlier match can never land in a new one.
 */

import { CONFIG, LEVELS } from "./config.js";
import {
  SHIP_SIZES,
  validateSetup,
  createFleet,
  createOpponent,
  shoot,
  allSunk,
  isSunk,
  remainingShips,
  coordinate,
} from "./engine.js";
import { createAudioController } from "./audio.js";
import { createStore } from "./storage.js";

// --- State ---
let dom = null;
let store = null;
let audio = null;
let match = null;
let paused = false;
let generation = 0;
let computerTimer = null;
let computerDue = 0; // performance.now() time of the scheduled computer shot
let computerLeft = CONFIG.OPPONENT_DELAY_MS; // time still to wait after a pause
let focusIndex = 0; // enemy square that receives focus when tabbing into the board

const $ = (id) => document.getElementById(id);

// --- Setup ---
/**
 * Connects the game to the page. Call once after the DOM is ready.
 * @param {{ storage?: Pick<Storage, "getItem" | "setItem"> | null }} [options]
 * @returns the saved setup, so the form can be filled in
 */
export function init({ storage } = {}) {
  dom = {
    setupScreen: $("setup-screen"),
    setupError: $("setup-error"),
    statsSummary: $("stats-summary"),
    startButton: $("start-button"),
    gameScreen: $("game-screen"),
    turnBanner: $("turn-banner"),
    message: $("game-message"),
    pauseButton: $("pause-button"),
    pauseLabel: $("pause-label"),
    pauseIcon: $("pause-icon"),
    musicButton: $("music-button"),
    effectsButton: $("effects-button"),
    effectsIcon: $("effects-icon"),
    enemyBoard: $("enemy-board"),
    ownBoard: $("own-board"),
    enemyFleet: $("enemy-fleet"),
    ownFleet: $("own-fleet"),
    enemyLeft: $("enemy-left"),
    ownLeft: $("own-left"),
    playerShots: $("player-shots"),
    playerAccuracy: $("player-accuracy"),
    computerShots: $("computer-shots"),
    resultDialog: $("result-dialog"),
    resultArt: $("result-art"),
    resultTitle: $("result-title"),
    resultDetails: $("result-details"),
    playAgainButton: $("play-again-button"),
  };

  store = storage === undefined ? createStore() : createStore(storage);
  const saved = store.get();
  audio = createAudioController({
    isActive: () => Boolean(match?.active),
    isPaused: () => paused,
    onBlocked: () =>
      message("The browser blocked the music. Turn Music off and on to retry."),
    music: saved.music,
    effects: saved.effects,
  });

  renderToggle(dom.musicButton, saved.music);
  renderToggle(dom.effectsButton, saved.effects);
  setIcon(dom.effectsIcon, saved.effects ? "volume-high" : "volume-xmark");
  renderStats();

  // A match in a background tab would let the computer fire while nobody is watching.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && match?.active && !paused) togglePause();
  });

  return { level: saved.level, board: saved.board, fleet: saved.fleet };
}

// --- Rendering helpers ---
function message(text) {
  dom.message.textContent = text;
}

function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function renderToggle(button, on) {
  button.setAttribute("aria-pressed", String(on));
}

function setIcon(use, name) {
  use.setAttribute("href", `./assets/icons/icons.svg#${name}`);
}

function renderStats() {
  const { played, wins, losses, bestWin } = store.get().stats;
  if (played === 0) {
    dom.statsSummary.textContent = "No battles fought yet.";
    return;
  }
  const best =
    bestWin === null ? "" : ` · Best win: ${plural(bestWin, "shot")}`;
  dom.statsSummary.textContent = `Battles ${played} · Wins ${wins} · Losses ${losses}${best}`;
}

/** Hits as a share of shots, e.g. "42%". */
function accuracy(fleet) {
  const shots = fleet.shots.size;
  if (shots === 0) return "–";
  const hits = [...fleet.shots.values()].filter(
    (result) => result === "hit",
  ).length;
  return `${Math.round((hits / shots) * 100)}%`;
}

// --- Boards ---
/**
 * Builds a board as a table with lettered columns and numbered rows.
 * The enemy board's squares are buttons; the player's own board is read-only.
 * @returns {Map<number, HTMLElement>} index → square
 */
function renderBoard(table, fleet, { own }) {
  const size = fleet.size;
  const shipSquares = new Set(fleet.ships.flatMap((ship) => ship.cells));
  table.replaceChildren();
  table.style.setProperty("--board-size", String(size));

  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  headRow.append(document.createElement("td"));
  for (let column = 0; column < size; column++) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = String.fromCharCode(65 + column);
    headRow.append(th);
  }
  head.append(headRow);

  const body = document.createElement("tbody");
  const squares = new Map();
  for (let row = 0; row < size; row++) {
    const tr = document.createElement("tr");
    const th = document.createElement("th");
    th.scope = "row";
    th.textContent = String(row + 1);
    tr.append(th);
    for (let column = 0; column < size; column++) {
      const index = row * size + column;
      const td = document.createElement("td");
      td.className = "board__cell";
      const square = document.createElement(own ? "span" : "button");
      square.className = "board__square";
      square.dataset.index = String(index);
      if (own) {
        square.setAttribute("role", "img"); // a picture of the square, described by its label
        square.setAttribute(
          "aria-label",
          `${coordinate(index, size)}, ${shipSquares.has(index) ? "your ship" : "water"}`,
        );
      } else {
        square.type = "button";
        square.tabIndex = index === focusIndex ? 0 : -1;
        square.setAttribute(
          "aria-label",
          `${coordinate(index, size)}, not fired at`,
        );
        square.addEventListener("click", () => fire(index));
        square.addEventListener("keydown", (event) => moveFocus(event, index));
      }
      squares.set(index, square);
      td.append(square);
      tr.append(td);
    }
    body.append(tr);
  }
  table.append(head, body);
  if (own) fleet.ships.forEach((ship) => drawShip(squares, ship, "is-ship"));
  return squares;
}

/**
 * Draws a ship as one hull across its squares: each square learns whether it is the bow, the
 * middle, or the stern, and which way the ship lies. Enemy ships are drawn only once sunk (or
 * revealed after a loss), so the page never shows where a hidden ship is.
 */
function drawShip(squares, ship, className) {
  const cells = [...ship.cells].sort((a, b) => a - b);
  const axis = cells.length > 1 && cells[1] - cells[0] === 1 ? "row" : "column";
  cells.forEach((cell, order) => {
    const square = squares.get(cell);
    square.classList.add(className);
    square.dataset.axis = axis;
    square.dataset.part =
      order === 0 ? "bow" : order === cells.length - 1 ? "stern" : "middle";
    square.style.setProperty("--order", String(order));
  });
  return cells;
}

/** Updates shot marks on a board; `lastShot` gets a ring so each turn's shot is easy to find. */
function updateBoard(table, squares, fleet, lastShot, { own }) {
  const sunk = new Set(
    fleet.ships.filter(isSunk).flatMap((ship) => ship.cells),
  );
  for (const square of squares.values()) square.classList.remove("is-sinking");

  // A ship sunk by this shot goes down square by square, and the board shakes.
  const justSunk = fleet.ships.find(
    (ship) => ship.cells.includes(lastShot) && isSunk(ship),
  );
  if (justSunk) {
    drawShip(squares, justSunk, "is-sinking");
    table.classList.remove("is-shaking");
    void table.offsetWidth; // restarts the animation when two ships sink in a row
    table.classList.add("is-shaking");
  }
  const shipSquares = own
    ? new Set(fleet.ships.flatMap((ship) => ship.cells))
    : null;
  for (const [index, square] of squares) {
    square.classList.toggle("is-last", index === lastShot);
    const result = fleet.shots.get(index);
    if (!result) continue;
    square.classList.add(result === "hit" ? "is-hit" : "is-miss");
    square.classList.toggle("is-sunk", sunk.has(index));
    const state = sunk.has(index) ? "sunk" : result;
    const what = own
      ? `${shipSquares.has(index) ? "your ship" : "water"}, `
      : "";
    square.setAttribute(
      "aria-label",
      `${coordinate(index, fleet.size)}, ${what}${state}`,
    );
  }
}

/** One line per ship length: a ship drawing and how many are still afloat. */
function renderFleet(list, fleet) {
  const left = remainingShips(fleet);
  const total = Object.fromEntries(SHIP_SIZES.map((size) => [size, 0]));
  fleet.ships.forEach((ship) => (total[ship.cells.length] += 1));
  list.replaceChildren();
  for (const size of SHIP_SIZES) {
    if (total[size] === 0) continue;
    const item = document.createElement("li");
    item.className = "fleet-list__item";
    item.classList.toggle("is-sunk", left[size] === 0);
    const ship = document.createElement("span");
    ship.className = "fleet-list__ship";
    ship.style.setProperty("--length", String(size));
    ship.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.textContent = `${size}-square: ${left[size]} of ${total[size]} afloat`;
    item.append(ship, label);
    list.append(item);
  }
}

function renderStatus() {
  const count = (fleet) =>
    Object.values(remainingShips(fleet)).reduce((a, b) => a + b, 0);
  renderFleet(dom.enemyFleet, match.enemy);
  renderFleet(dom.ownFleet, match.player);
  dom.enemyLeft.textContent = String(count(match.enemy));
  dom.ownLeft.textContent = String(count(match.player));
  dom.playerShots.textContent = String(match.enemy.shots.size);
  dom.playerAccuracy.textContent = accuracy(match.enemy);
  dom.computerShots.textContent = String(match.player.shots.size);

  let banner = "Your turn: fire at the enemy board";
  if (!match.active) banner = "Battle over";
  else if (paused) banner = "Paused";
  else if (match.turn === "computer") banner = "The computer is aiming…";
  dom.turnBanner.textContent = banner;
  dom.gameScreen.dataset.turn = match.active ? match.turn : "over";
  dom.enemyBoard.inert = paused || !match.active;
}

// --- Keyboard navigation on the enemy board ---
/** Arrow keys move one square, Home and End jump to the corners. */
function moveFocus(event, index) {
  const size = match.size;
  const row = Math.floor(index / size);
  const column = index % size;
  const moves = {
    ArrowUp: row > 0 ? index - size : null,
    ArrowDown: row < size - 1 ? index + size : null,
    ArrowLeft: column > 0 ? index - 1 : null,
    ArrowRight: column < size - 1 ? index + 1 : null,
    Home: 0,
    End: size * size - 1,
  };
  if (!(event.key in moves)) return;
  event.preventDefault();
  const next = moves[event.key];
  if (next === null) return;
  match.enemySquares.get(focusIndex).tabIndex = -1;
  focusIndex = next;
  const target = match.enemySquares.get(next);
  target.tabIndex = 0;
  target.focus();
}

// --- Match ---
/**
 * Reads the setup form, validates it, and starts a match.
 * Fleets can be passed in so tests can play scripted battles.
 * @param {{ size: number, counts: Record<number, number>, level: string }} settings
 * @param {{ player?: object, enemy?: object, random?: () => number }} [setup]
 * @returns {boolean} true if the match started
 */
export function startGame(settings, setup = {}) {
  const checked = validateSetup(settings.size, settings.counts);
  dom.setupError.textContent = "";
  if (!checked.valid) return setupFailed(checked.message);

  // Both fleets are placed before anything changes on screen, so a failure leaves no half-game.
  const random = setup.random ?? Math.random;
  const player =
    setup.player ??
    createFleet(
      settings.size,
      checked.lengths,
      random,
      CONFIG.PLACEMENT_BUDGET,
    );
  const enemy =
    setup.enemy ??
    createFleet(
      settings.size,
      checked.lengths,
      random,
      CONFIG.PLACEMENT_BUDGET,
    );
  if (!player || !enemy) {
    return setupFailed(
      "This fleet does not fit with a gap between ships. Try fewer ships or a larger board.",
    );
  }

  store.update({
    level: settings.level,
    board: settings.size,
    fleet: settings.counts,
  });
  generation++;
  clearComputerTimer();
  audio.stopEffects();
  audio.prepare(["hit", "miss", "sunk", "error", "victory", "defeat"]);
  paused = false;
  focusIndex = 0;
  match = {
    size: settings.size,
    level: settings.level,
    player,
    enemy,
    opponent: createOpponent(settings.size, random, settings.level),
    active: true,
    turn: "player",
  };

  closeResult();
  dom.setupScreen.hidden = true;
  dom.gameScreen.hidden = false;
  dom.gameScreen.dataset.view = "enemy";
  match.enemySquares = renderBoard(dom.enemyBoard, enemy, { own: false });
  match.ownSquares = renderBoard(dom.ownBoard, player, { own: true });
  renderPauseButton();
  renderStatus();
  audio.syncMusic();
  message(
    `Battle stations! ${LEVELS[settings.level].label} opponent. You fire first.`,
  );
  window.scrollTo?.(0, 0);
  match.enemySquares.get(0).focus({ preventScroll: true });
  return true;
}

function setupFailed(text) {
  dom.setupError.textContent = text;
  dom.setupError.focus();
  return false;
}

function shotMessage(result, shooter) {
  const where = coordinate(result.index, match.size);
  if (result.status === "sunk") {
    const owner = shooter === "You" ? "an enemy" : "your";
    return `${shooter} sank ${owner} ${result.length}-square ship at ${where}!`;
  }
  return `${shooter} fired at ${where}: ${result.status}.`;
}

/** The player's shot at an enemy square. */
export function fire(index) {
  if (!match?.active || paused) return;
  if (match.turn !== "player") {
    message("Hold fire: it is the computer's turn.");
    return;
  }
  const result = shoot(match.enemy, index);
  if (result.status === "invalid") return;
  if (result.status === "repeat") {
    audio.play("error");
    message(
      `${coordinate(index, match.size)} was already hit or missed. Pick another square.`,
    );
    return;
  }
  updateBoard(dom.enemyBoard, match.enemySquares, match.enemy, index, {
    own: false,
  });
  message(shotMessage(result, "You"));
  if (allSunk(match.enemy)) return finish(true);
  audio.play(result.status);
  match.turn = "computer";
  renderStatus();
  scheduleComputer(
    result.status === "sunk" ? CONFIG.SINK_DELAY_MS : CONFIG.OPPONENT_DELAY_MS,
  );
}

function clearComputerTimer() {
  clearTimeout(computerTimer);
  computerTimer = null;
}

function scheduleComputer(delay = CONFIG.OPPONENT_DELAY_MS) {
  clearComputerTimer();
  const scheduledFor = generation;
  computerLeft = delay;
  computerDue = performance.now() + delay;
  computerTimer = setTimeout(() => {
    computerTimer = null;
    if (scheduledFor !== generation) return; // left over from an earlier match
    computerTurn();
  }, delay);
}

function computerTurn() {
  if (!match?.active || paused || match.turn !== "computer") return;
  const index = match.opponent.nextShot();
  if (index === null) return;
  const result = shoot(match.player, index);
  match.opponent.observe(result);
  updateBoard(dom.ownBoard, match.ownSquares, match.player, index, {
    own: true,
  });
  message(shotMessage(result, "The computer"));
  if (allSunk(match.player)) return finish(false);
  audio.play(result.status);
  match.turn = "player";
  renderStatus();
}

function finish(won) {
  match.active = false;
  clearComputerTimer();
  audio.rewindMusic();
  audio.stopEffects();
  audio.play(won ? "victory" : "defeat");
  const shots = match.enemy.shots.size;
  store.recordResult(won, shots);
  renderStats();
  renderStatus();

  // Reveal the enemy fleet that survived, so a loss still shows where the ships were.
  if (!won) {
    for (const ship of match.enemy.ships) {
      if (!isSunk(ship)) drawShip(match.enemySquares, ship, "is-revealed");
    }
  }
  dom.resultArt.dataset.tone = won ? "win" : "lose";
  dom.resultTitle.textContent = won
    ? "Victory! You sank the enemy fleet."
    : "Defeat. The computer sank your fleet.";
  dom.resultDetails.textContent = [
    `Your shots: ${shots}`,
    `accuracy ${accuracy(match.enemy)}`,
    `computer shots: ${match.player.shots.size}`,
    LEVELS[match.level].label,
  ].join(" · ");
  dom.resultDialog.showModal();
  dom.playAgainButton.focus();
}

function closeResult() {
  if (dom.resultDialog.open) dom.resultDialog.close();
}

// --- Controls ---
function renderPauseButton() {
  dom.pauseButton.setAttribute("aria-pressed", String(paused));
  dom.pauseLabel.textContent = paused ? "Resume" : "Pause";
  setIcon(dom.pauseIcon, paused ? "play" : "pause");
}

export function togglePause() {
  if (!match?.active) return;
  paused = !paused;
  if (paused) {
    // Remember how long the computer still had to wait, and stop its clock.
    if (computerTimer !== null)
      computerLeft = Math.max(0, computerDue - performance.now());
    clearComputerTimer();
    audio.stopEffects();
  } else if (match.turn === "computer") {
    scheduleComputer(computerLeft);
  }
  audio.syncMusic();
  renderPauseButton();
  renderStatus();
  message(paused ? "Paused. Nobody can fire until you resume." : "Resumed.");
}

/** Narrow screens show one board at a time. */
export function showBoard(view) {
  if (!match) return;
  dom.gameScreen.dataset.view = view === "own" ? "own" : "enemy";
}

export function toggleMusic() {
  const on = !audio.isMusicOn();
  audio.setMusic(on);
  renderToggle(dom.musicButton, on);
  store.update({ music: on });
}

export function toggleEffects() {
  const on = !audio.isEffectsOn();
  audio.setEffects(on);
  renderToggle(dom.effectsButton, on);
  setIcon(dom.effectsIcon, on ? "volume-high" : "volume-xmark");
  store.update({ effects: on });
}

/** Leaves the match (or the result dialog) and returns to the setup screen. */
export function backToMenu() {
  generation++;
  clearComputerTimer();
  audio.stopEffects();
  if (match) match.active = false;
  paused = false;
  audio.rewindMusic();
  closeResult();
  dom.gameScreen.hidden = true;
  dom.setupScreen.hidden = false;
  dom.setupError.textContent = "";
  dom.startButton.focus();
}
