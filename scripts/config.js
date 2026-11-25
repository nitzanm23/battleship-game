/**
 * Battleship Game: settings.
 *
 * Every timing, limit, and default in one place. The default fleet is the classic one:
 * one 5-square, one 4-square, two 3-square, and one 2-square ship on a 10 × 10 board.
 */

export const CONFIG = Object.freeze({
  OPPONENT_DELAY_MS: 900, // the computer "thinks" this long before each shot
  SINK_DELAY_MS: 1800, // longer after you sink a ship, so its sound and animation can finish
  PLACEMENT_BUDGET: 50000, // attempts allowed when placing a fleet
  STORAGE_KEY: "battleship-game:v1", // name:version; bump v1 if the saved shape changes
  DEFAULT_LEVEL: "normal",
  DEFAULT_BOARD: 10,
  DEFAULT_FLEET: Object.freeze({ 2: 1, 3: 2, 4: 1, 5: 1 }),
});

export const LEVELS = Object.freeze({
  easy: Object.freeze({ label: "Easy", hint: "Random shots" }),
  normal: Object.freeze({ label: "Normal", hint: "Hunts after a hit" }),
  hard: Object.freeze({ label: "Hard", hint: "Searches and reads lines" }),
});
