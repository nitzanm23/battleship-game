/**
 * Battleship Game: startup.
 *
 * Fills the setup form with the last saved setup, connects the form and buttons to the game
 * module, and sets the footer year. Kept separate from game.js so the match logic can be
 * imported by the tests without a browser.
 */

import { SHIP_SIZES } from "./engine.js";
import {
  init,
  startGame,
  togglePause,
  toggleMusic,
  toggleEffects,
  showBoard,
  backToMenu,
} from "./game.js";

const saved = init();
const form = document.getElementById("setup-form");

// --- Setup form ---
function fillForm({ level, board, fleet }) {
  form.elements.level.value = level;
  form.elements.board.value = String(board);
  for (const size of SHIP_SIZES)
    form.elements[`fleet-${size}`].value = String(fleet[size]);
}

function readForm() {
  return {
    level: form.elements.level.value,
    size: Number(form.elements.board.value),
    counts: Object.fromEntries(
      SHIP_SIZES.map((size) => [
        size,
        Number(form.elements[`fleet-${size}`].value),
      ]),
    ),
  };
}

fillForm(saved);
form.addEventListener("submit", (event) => {
  event.preventDefault();
  startGame(readForm());
});

// --- Game controls ---
const clicks = {
  "play-again-button": () => startGame(readForm()),
  "menu-button": backToMenu,
  "quit-button": backToMenu,
  "pause-button": togglePause,
  "music-button": toggleMusic,
  "effects-button": toggleEffects,
};
for (const [id, handler] of Object.entries(clicks)) {
  document.getElementById(id).addEventListener("click", handler);
}

for (const radio of document.querySelectorAll('input[name="board-view"]')) {
  radio.addEventListener("change", () => showBoard(radio.value));
}

// Escape on the result dialog goes back to the menu instead of leaving a finished board open.
document.getElementById("result-dialog").addEventListener("cancel", (event) => {
  event.preventDefault();
  backToMenu();
});

document.getElementById("footer-year").textContent = String(
  new Date().getFullYear(),
);
