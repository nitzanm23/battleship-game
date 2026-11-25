/**
 * Battleship Game: game rules and the computer opponent.
 *
 * Pure functions with no DOM, timers, or audio, so the rules run the same in the browser and in
 * the Node test suite. Boards are square grids stored as flat arrays
 * (index = row × size + column). Ships are straight and never touch, not even diagonally. The
 * opponent only ever sees the results of its own shots, never the player's fleet.
 */

export const SHIP_SIZES = Object.freeze([2, 3, 4, 5]);
export const MIN_BOARD = 10;
export const MAX_BOARD = 15;
export const MAX_PER_SIZE = 30;

// --- Setup ---
/**
 * Checks a board size and ship counts from the setup form.
 * @param {number} size - board width and height
 * @param {Record<number, number>} counts - how many ships of each length
 * @returns {{ valid: true, lengths: number[] } | { valid: false, message: string }}
 */
export function validateSetup(size, counts) {
  if (!Number.isInteger(size) || size < MIN_BOARD || size > MAX_BOARD) {
    return {
      valid: false,
      message: `Choose a board size from ${MIN_BOARD} to ${MAX_BOARD}.`,
    };
  }
  const lengths = [];
  for (const length of SHIP_SIZES) {
    const count = counts[length];
    if (!Number.isInteger(count) || count < 0 || count > MAX_PER_SIZE) {
      return {
        valid: false,
        message: `Ship counts must be whole numbers from 0 to ${MAX_PER_SIZE}.`,
      };
    }
    for (let i = 0; i < count; i++) lengths.push(length);
  }
  if (lengths.length === 0)
    return { valid: false, message: "Choose at least one ship." };
  if (lengths.reduce((sum, length) => sum + length, 0) > size * size) {
    return {
      valid: false,
      message: "The fleet has more ship squares than the board.",
    };
  }
  return { valid: true, lengths };
}

// --- Board helpers ---
/**
 * Returns a shuffled copy of the given values (Fisher–Yates).
 * @param {() => number} random - returns a number in [0, 1), like Math.random
 */
export function shuffle(values, random = Math.random) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/** Board coordinate as players say it: column letter, then row number (e.g. "B7"). */
export function coordinate(index, size) {
  return `${String.fromCharCode(65 + (index % size))}${Math.floor(index / size) + 1}`;
}

/** Squares around `index` that are on the board: 4 sides, or all 8 with `diagonal`. */
export function neighbors(index, size, diagonal = false) {
  const row = Math.floor(index / size);
  const column = index % size;
  const result = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      if (!diagonal && Math.abs(dr) + Math.abs(dc) !== 1) continue;
      const r = row + dr;
      const c = column + dc;
      if (r >= 0 && r < size && c >= 0 && c < size) result.push(r * size + c);
    }
  }
  return result;
}

// --- Fleet placement ---
/**
 * Places a whole fleet by randomized backtracking, longest ships first.
 * The search is capped by `budget` attempts, so an impossible fleet fails fast instead of
 * freezing the page. Returns null in that case; a partial fleet is never returned.
 * @param {number} size
 * @param {number[]} lengths - one entry per ship
 * @param {() => number} [random]
 * @param {number} [budget]
 */
export function createFleet(
  size,
  lengths,
  random = Math.random,
  budget = 50000,
) {
  const invalid =
    !Number.isInteger(size) ||
    size < 2 ||
    size > MAX_BOARD ||
    lengths.length === 0 ||
    lengths.some((length) => !SHIP_SIZES.includes(length) || length > size);
  if (invalid) return null;
  if (lengths.reduce((sum, length) => sum + length, 0) > size * size)
    return null;

  const ordered = [...lengths].sort((a, b) => b - a);
  const candidates = new Map();
  for (const length of new Set(ordered)) {
    const choices = [];
    for (let row = 0; row < size; row++) {
      for (let column = 0; column < size; column++) {
        for (const vertical of [false, true]) {
          if ((vertical ? row : column) + length > size) continue;
          choices.push(
            Array.from({ length }, (_, offset) =>
              vertical
                ? (row + offset) * size + column
                : row * size + column + offset,
            ),
          );
        }
      }
    }
    candidates.set(length, shuffle(choices, random));
  }

  const occupied = new Set();
  const placements = [];
  let work = 0;
  const blocked = (cell) =>
    occupied.has(cell) ||
    neighbors(cell, size, true).some((n) => occupied.has(n));

  function search(depth) {
    if (depth === ordered.length) return true;
    for (const cells of candidates.get(ordered[depth])) {
      if (++work > budget) return false;
      if (cells.some(blocked)) continue;
      cells.forEach((cell) => occupied.add(cell));
      placements.push(cells);
      if (search(depth + 1)) return true;
      placements.pop();
      cells.forEach((cell) => occupied.delete(cell));
    }
    return false;
  }

  if (!search(0)) return null;
  return {
    size,
    ships: placements.map((cells, id) => ({
      id,
      cells: [...cells],
      hits: new Set(),
    })),
    shots: new Map(), // index → "hit" | "miss"
  };
}

// --- Shooting ---
/**
 * Fires at one square of a fleet and records the result.
 * @returns {{ status: "invalid" | "repeat" | "miss" | "hit", index: number }
 *   | { status: "sunk", index: number, length: number, cells: number[] }}
 */
export function shoot(fleet, index) {
  if (!Number.isInteger(index) || index < 0 || index >= fleet.size ** 2) {
    return { status: "invalid", index };
  }
  if (fleet.shots.has(index)) return { status: "repeat", index };
  const ship = fleet.ships.find((candidate) => candidate.cells.includes(index));
  fleet.shots.set(index, ship ? "hit" : "miss");
  if (!ship) return { status: "miss", index };
  ship.hits.add(index);
  if (ship.hits.size === ship.cells.length) {
    return {
      status: "sunk",
      index,
      length: ship.cells.length,
      cells: [...ship.cells],
    };
  }
  return { status: "hit", index };
}

export function isSunk(ship) {
  return ship.hits.size === ship.cells.length;
}

export function allSunk(fleet) {
  return fleet.ships.length > 0 && fleet.ships.every(isSunk);
}

/** Ships still afloat, counted by length. */
export function remainingShips(fleet) {
  const counts = Object.fromEntries(SHIP_SIZES.map((size) => [size, 0]));
  for (const ship of fleet.ships) {
    if (!isSunk(ship)) counts[ship.cells.length]++;
  }
  return counts;
}

// --- Computer opponent ---
/**
 * How each level plays:
 * - easy:   fires at random squares and ignores its hits.
 * - normal: fires at random until it hits, then tries the squares around the hit.
 * - hard:   searches in a checkerboard pattern (every ship covers both colors), follows the line
 *           of two hits, and skips squares next to sunk ships, which cannot hold another ship.
 */
export const OPPONENT_LEVELS = Object.freeze(["easy", "normal", "hard"]);

/**
 * Creates a computer opponent. It receives only its own shot results, never a fleet.
 * @param {number} size
 * @param {() => number} [random]
 * @param {"easy" | "normal" | "hard"} [level]
 */
export function createOpponent(size, random = Math.random, level = "hard") {
  const smart = level !== "easy";
  const unavailable = new Set();
  let targets = [];
  let hits = [];
  const search = shuffle(
    Array.from({ length: size * size }, (_, index) => index),
    random,
  );
  if (level === "hard") {
    const color = (index) => (Math.floor(index / size) + (index % size)) % 2;
    search.sort((a, b) => color(a) - color(b)); // stable sort keeps the random order per color
  }

  return {
    nextShot() {
      const index =
        targets.find((cell) => !unavailable.has(cell)) ??
        search.find((cell) => !unavailable.has(cell));
      if (index === undefined) return null;
      unavailable.add(index);
      return index;
    },

    observe(result) {
      if (!smart) return;
      if (result.status === "sunk") {
        if (level === "hard") {
          for (const cell of result.cells) {
            neighbors(cell, size, true).forEach((n) => unavailable.add(n));
          }
        }
        hits = hits.filter((cell) => !result.cells.includes(cell));
        targets = hits.flatMap((cell) => neighbors(cell, size));
      } else if (result.status === "hit") {
        hits.push(result.index);
        targets = [...neighbors(result.index, size), ...targets];
        if (level === "hard" && hits.length >= 2) {
          const row = Math.floor(hits[0] / size);
          const column = hits[0] % size;
          if (hits.every((cell) => Math.floor(cell / size) === row)) {
            targets = targets.filter((cell) => Math.floor(cell / size) === row);
          } else if (hits.every((cell) => cell % size === column)) {
            targets = targets.filter((cell) => cell % size === column);
          }
        }
      }
    },
  };
}
