/**
 * Battleship Game: saved settings and statistics.
 *
 * The last setup (board, fleet, difficulty), the music and sound choices, and the win/loss record
 * are kept in localStorage between visits. Storage can be blocked (private mode, strict settings),
 * so every read and write is guarded and the game falls back to the defaults.
 */

import { CONFIG, LEVELS } from "./config.js";
import { SHIP_SIZES, MIN_BOARD, MAX_BOARD, MAX_PER_SIZE } from "./engine.js";

const DEFAULTS = Object.freeze({
  level: CONFIG.DEFAULT_LEVEL,
  board: CONFIG.DEFAULT_BOARD,
  fleet: CONFIG.DEFAULT_FLEET,
  music: true,
  effects: true,
  stats: Object.freeze({ played: 0, wins: 0, losses: 0, bestWin: null }),
});

function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // some browsers throw just for reading localStorage when it is blocked
  }
}

const isCount = (value, max) =>
  Number.isInteger(value) && value >= 0 && value <= max;

/**
 * @param {Pick<Storage, "getItem" | "setItem"> | null} [storage]
 */
export function createStore(storage = defaultStorage()) {
  let data = load();

  function load() {
    try {
      const saved =
        JSON.parse(storage?.getItem(CONFIG.STORAGE_KEY) ?? "null") ?? {};
      const fleet = { ...DEFAULTS.fleet };
      for (const size of SHIP_SIZES) {
        if (isCount(saved.fleet?.[size], MAX_PER_SIZE))
          fleet[size] = saved.fleet[size];
      }
      const stats = { ...DEFAULTS.stats };
      for (const key of ["played", "wins", "losses"]) {
        if (isCount(saved.stats?.[key], Number.MAX_SAFE_INTEGER))
          stats[key] = saved.stats[key];
      }
      if (Number.isInteger(saved.stats?.bestWin) && saved.stats.bestWin > 0) {
        stats.bestWin = saved.stats.bestWin;
      }
      const board = saved.board;
      return {
        level: saved.level in LEVELS ? saved.level : DEFAULTS.level,
        board:
          Number.isInteger(board) && board >= MIN_BOARD && board <= MAX_BOARD
            ? board
            : DEFAULTS.board,
        fleet,
        music: typeof saved.music === "boolean" ? saved.music : DEFAULTS.music,
        effects:
          typeof saved.effects === "boolean" ? saved.effects : DEFAULTS.effects,
        stats,
      };
    } catch {
      return structuredClone(DEFAULTS); // corrupted JSON: start fresh
    }
  }

  function persist() {
    try {
      storage?.setItem(CONFIG.STORAGE_KEY, JSON.stringify(data));
    } catch {
      // Saving is a convenience; the game works without it.
    }
  }

  return {
    get: () => structuredClone(data),
    update(patch) {
      data = { ...data, ...patch };
      persist();
    },
    /**
     * @param {boolean} won
     * @param {number} shots - the player's shots in the match
     */
    recordResult(won, shots) {
      data.stats.played += 1;
      data.stats[won ? "wins" : "losses"] += 1;
      if (won && (data.stats.bestWin === null || shots < data.stats.bestWin)) {
        data.stats.bestWin = shots;
      }
      persist();
    },
  };
}
