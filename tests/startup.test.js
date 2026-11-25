import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeDom, freshImport } from "./helpers/fake-dom.js";

async function startup(context, saved) {
  const env = installFakeDom(context);
  globalThis.localStorage = env.storage;
  context.after(() => delete globalThis.localStorage);
  if (saved) env.storage.setItem("battleship-game:v1", JSON.stringify(saved));
  await freshImport("scripts/index.js");
  return env;
}

test("startup fills the form with the saved setup and wires every control", async (t) => {
  const env = await startup(t, {
    level: "hard",
    board: 12,
    fleet: { 2: 2, 3: 1, 4: 0, 5: 1 },
  });
  assert.equal(env.fields.level.value, "hard");
  assert.equal(env.fields.board.value, "12");
  assert.deepEqual(
    ["fleet-2", "fleet-3", "fleet-4", "fleet-5"].map(
      (name) => env.fields[name].value,
    ),
    ["2", "1", "0", "1"],
  );
  assert.equal(env.el("setup-form").listeners.submit?.length, 1);
  for (const id of [
    "play-again-button",
    "menu-button",
    "quit-button",
    "pause-button",
    "music-button",
    "effects-button",
  ]) {
    assert.equal(
      env.el(id).listeners.click?.length,
      1,
      `${id} has one click handler`,
    );
  }
  assert.equal(
    env.el("footer-year").textContent,
    String(new Date().getFullYear()),
  );
});

test("submitting the form starts a battle with the chosen setup", async (t) => {
  const env = await startup(t);
  env.fields.board.value = "11";
  let prevented = false;
  env
    .el("setup-form")
    .dispatch("submit", { preventDefault: () => (prevented = true) });
  assert.equal(prevented, true, "the page does not reload");
  assert.equal(env.el("game-screen").hidden, false);
  assert.equal(
    env.el("enemy-board").style.getPropertyValue("--board-size"),
    "11",
  );

  env.viewRadios[1].dispatch("change");
  assert.equal(env.el("game-screen").dataset.view, "own");
});

test("Escape on the result dialog returns to the menu instead of just closing it", async (t) => {
  const env = await startup(t);
  env.el("setup-form").dispatch("submit");
  const event = env.el("result-dialog").dispatch("cancel", {
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  });
  assert.equal(event.defaultPrevented, true);
  assert.equal(env.el("setup-screen").hidden, false);
});
