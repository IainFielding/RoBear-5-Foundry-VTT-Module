/**
 * End-to-end tests for roll requests and RoBear-E Cards, run against a real Foundry world.
 *
 * The fixtures (see lib/world.mjs): the Player owns Aria and Borin, Aria holds the RoBear-E Cards, and the
 * Goblin belongs to the GM. Every actor has 10 in each ability and no proficiencies, so a roll's total is
 * exactly the die forced for it.
 */

import { MODULE_ID } from "./config.mjs";
import {
  assert, assertEqual, cardsOnRow, clickRoll, forceDice, playCard, postRequest, readCard, rollButton, test, unusedDice,
  waitFor, waitForCard, waitForRoll
} from "./lib/harness.mjs";

const d20 = n => [n, 20];
const d100 = n => [n, 100];
const athletics = dc => ({ type: "skill", key: "ath", dc });
const row = (card, name) => card.rows.find(r => r.name === name);

/* -------------------------------------------- */
/*  Entry Points                                */
/* -------------------------------------------- */

test("the GM's chat controls have the request button, and the player's do not", async ({ gm, player }) => {
  const count = s => s.eval(() => document.querySelectorAll("#chat-controls .robear-request-control").length);
  assertEqual(await count(gm), 1, "GM request buttons");
  assertEqual(await count(player), 0, "player request buttons");
});

test("the token controls have the request button, rotated like the card button", async ({ gm, player }) => {
  const tool = s => s.eval(() => ui.controls.controls.tokens?.tools.robearRequest ?? null);
  const gmTool = await tool(gm);
  assert(gmTool, "The GM has no Request RoBear-E Rolls tool.");
  assertEqual(gmTool.icon, "fa-solid fa-anchor fa-rotate-90", "tool icon");
  assertEqual(gmTool.button, true, "tool is a button");
  assertEqual(await tool(player), null, "the player's tool");
});

test("the API opens the request window for the GM only", async ({ gm, player }) => {
  const open = s => s.eval(async moduleId => {
    const app = game.modules.get(moduleId).api.requestRolls();
    await new Promise(r => setTimeout(r, 500));
    const rendered = !!document.getElementById("robear-roll-request");
    await app?.close();
    return rendered;
  }, MODULE_ID);
  assertEqual(await open(gm), true, "GM window rendered");
  assertEqual(await open(player), false, "player window rendered");
});

/* -------------------------------------------- */
/*  Request Window                              */
/* -------------------------------------------- */

/**
 * Open the request window through its chat control button, as the GM would.
 * @param {import("./lib/session.mjs").Session} gm
 */
async function openWindow(gm) {
  await gm.page.locator("#chat-controls .robear-request-control").click();
  const app = gm.page.locator("#robear-roll-request");
  await app.waitFor({ timeout: 10_000 });
  return app;
}

/**
 * @param {import("playwright").Locator} app
 * @param {string} mode
 */
async function chooseMode(app, mode) {
  await app.locator(`.robear-request-mode:has(input[value="${mode}"])`).click();
  await app.locator(`.robear-request-mode:has(input[value="${mode}"]:checked)`).waitFor({ timeout: 5000 });
  await app.page().waitForTimeout(300);
}

/**
 * What the window currently shows.
 * @param {import("playwright").Locator} app
 */
function readWindow(app) {
  return app.evaluate(el => ({
    modes: [...el.querySelectorAll(".robear-request-mode input")].map(i => i.value),
    checkedMode: el.querySelector(".robear-request-mode input:checked")?.value,
    rollSelects: [...el.querySelectorAll('select[name$=".roll"]')].map(s => s.name),
    rollValues: [...el.querySelectorAll('select[name$=".roll"]')].map(s => s.value),
    dcInputs: [...el.querySelectorAll('input[name$=".dc"]')].map(i => i.value),
    dice: [...(el.querySelector('select[name$=".roll"]')?.options ?? [])].map(o => o.value).filter(v => !v.includes(".")),
    successes: !!el.querySelector('select[name="successes"]'),
    actors: [...el.querySelectorAll('input[name^="actors."]')].map(i => ({
      name: i.closest("label").textContent.trim(), checked: i.checked
    })),
    sides: [...el.querySelectorAll(".robear-request-side")].map(s => ({
      label: s.querySelector("legend").textContent.trim(),
      inputs: [...s.querySelectorAll("input")].map(i => i.type)
    })),
    range: (() => {
      const r = el.querySelector('range-picker[name="range"]');
      return r ? { value: Number(r.value), min: Number(r.getAttribute("min")), max: Number(r.getAttribute("max")) } : null;
    })(),
    showDC: !!el.querySelector('input[name="showDC"]'),
    showDCChecked: !!el.querySelector('input[name="showDC"]')?.checked
  }));
}

test("the request window shows each mode's own fields", async ({ gm }) => {
  const app = await openWindow(gm);
  try {
    let form = await readWindow(app);
    assertEqual(form.modes, ["standard", "team", "challenge", "rolloff", "versus", "divine"], "modes");
    assertEqual(form.checkedMode, "standard", "starting mode");
    assertEqual(form.rollSelects.length, 1, "standard roll pickers");
    assertEqual(form.rollValues, ["d20"], "standard roll to start with");
    assertEqual(form.dice, ["d20", "d6", "d8", "d10", "d12", "d100"], "standard dice");
    assertEqual(form.dcInputs, ["15"], "standard DC");
    assertEqual(form.actors.map(a => `${a.name}:${a.checked}`), ["Aria:true", "Borin:true", "Goblin:false"],
      "who rolls, with the player characters ticked");
    assertEqual(form.showDC, true, "Show DC option");
    assertEqual(form.showDCChecked, false, "Show DC to Players, which the default setting leaves unticked");

    await chooseMode(app, "challenge");
    form = await readWindow(app);
    assertEqual(form.rollSelects.length, 3, "skill challenge roll pickers");
    assertEqual(form.dcInputs.length, 3, "skill challenge DCs");
    assertEqual(form.successes, true, "successes needed");

    await chooseMode(app, "rolloff");
    form = await readWindow(app);
    assertEqual(form.rollSelects.length, 2, "roll-off roll pickers");
    assertEqual(form.rollValues, ["d20", "d20"], "roll-off rolls to start with");
    assertEqual(form.dcInputs.length, 0, "roll-off DCs");
    assertEqual(form.dice, ["d20", "d6", "d8", "d10", "d12", "d100"], "roll-off dice");
    assertEqual(form.sides.map(s => s.label), ["Challenger", "Opponent"], "roll-off sides");
    assert(form.sides.every(s => s.inputs.every(t => t === "radio")), "A roll-off side picks one actor.");
    assertEqual(form.showDC, false, "Show DC option in a roll-off");

    await chooseMode(app, "versus");
    form = await readWindow(app);
    assertEqual(form.dice, ["d20"], "team vs team dice");
    assertEqual(form.sides.map(s => s.label.replace(/\s+/g, " ")), ["Players", "NPCs"], "team vs team sides");
    assert(form.sides.every(s => s.inputs.every(t => t === "checkbox")), "A team picks several actors.");

    await chooseMode(app, "divine");
    form = await readWindow(app);
    assertEqual(form.rollSelects.length, 0, "divine intervention roll pickers");
    assertEqual(form.range, { value: 16, min: 1, max: 50 }, "divine intervention range");
    assertEqual(form.showDC, false, "Show DC option in divine intervention");
  } finally {
    await gm.eval(() => foundry.applications.instances.get("robear-roll-request")?.close());
  }
});

test("the request window keeps what was filled in when the mode changes", async ({ gm }) => {
  const app = await openWindow(gm);
  try {
    await app.locator('input[name="standard.dc"]').fill("17");
    await app.locator('select[name="standard.roll"]').selectOption("save.dex");
    await chooseMode(app, "challenge");
    await chooseMode(app, "standard");
    assertEqual(await app.locator('input[name="standard.dc"]').inputValue(), "17", "DC after switching back");
    assertEqual(await app.locator('select[name="standard.roll"]').inputValue(), "save.dex", "roll after switching back");

    // A roll-off keeps its own rolls, d20 against d20, rather than taking the standard roll's.
    await chooseMode(app, "rolloff");
    assertEqual((await readWindow(app)).rollValues, ["d20", "d20"], "roll-off rolls after setting a standard roll");
    await app.locator('select[name="sideRolls.1.roll"]').selectOption("d100");
    await chooseMode(app, "standard");
    await chooseMode(app, "rolloff");
    assertEqual((await readWindow(app)).rollValues, ["d20", "d100"], "roll-off rolls after switching back");

    // Team vs Team has its own rolls, d20 against d20, which a roll-off's choices leave alone.
    await chooseMode(app, "versus");
    assertEqual((await readWindow(app)).rollValues, ["d20", "d20"], "team vs team rolls after setting a roll-off");
    await chooseMode(app, "rolloff");
    assertEqual((await readWindow(app)).rollValues, ["d20", "d100"], "roll-off rolls after visiting team vs team");
  } finally {
    await gm.eval(() => foundry.applications.instances.get("robear-roll-request")?.close());
  }
});

test("sending a standard request posts it to chat and closes the window", async ({ gm, ids }) => {
  const app = await openWindow(gm);
  await chooseMode(app, "standard");
  await app.locator('select[name="standard.roll"]').selectOption("skill.acr");
  await app.locator('input[name="standard.dc"]').fill("13");
  await app.locator('input[name="actors.2"]').evaluate(el => { el.checked = true; });
  await app.locator('button[type="submit"]').click();
  const request = await waitFor(gm, moduleId => game.messages.contents.at(-1)?.getFlag(moduleId, "request") ?? null,
    MODULE_ID, "the request message");
  assertEqual(request.mode, "standard", "mode");
  assertEqual(request.parts, [{ type: "skill", key: "acr", dc: 13 }], "parts");
  assertEqual(request.actors, [ids.aria, ids.borin, ids.goblin], "actors");
  await waitFor(gm, () => !document.getElementById("robear-roll-request"), null, "the window to close");
});

test("the Show DC to Players box starts from the GM's setting", async ({ gm }) => {
  const setting = await gm.eval(moduleId => {
    const s = game.settings.settings.get(`${moduleId}.showDCDefault`);
    return { config: s?.config, scope: s?.scope, default: s?.default };
  }, MODULE_ID);
  assertEqual(setting, { config: true, scope: "world", default: false }, "the setting");
  await gm.eval(moduleId => game.settings.set(moduleId, "showDCDefault", true), MODULE_ID);
  try {
    const app = await openWindow(gm);
    assertEqual((await readWindow(app)).showDCChecked, true, "Show DC to Players with the setting on");
  } finally {
    await gm.eval(async moduleId => {
      await foundry.applications.instances.get("robear-roll-request")?.close();
      await game.settings.set(moduleId, "showDCDefault", false);
    }, MODULE_ID);
  }
});

test("sending a roll-off asks for a d20 from each side by default", async ({ gm, ids }) => {
  const app = await openWindow(gm);
  await chooseMode(app, "rolloff");
  await app.locator('input[name="rivals.0"][value="0"]').check({ force: true });
  await app.locator('input[name="rivals.1"][value="2"]').check({ force: true });
  await app.locator('button[type="submit"]').click();
  const request = await waitFor(gm, moduleId => game.messages.contents.at(-1)?.getFlag(moduleId, "request") ?? null,
    MODULE_ID, "the request message");
  assertEqual(request.mode, "rolloff", "mode");
  assertEqual(request.parts, [{ type: "d20", key: null, dc: null }, { type: "d20", key: null, dc: null }], "parts");
  assertEqual(request.sides, [[ids.aria], [ids.goblin]], "sides");
});

test("the request window refuses requests it cannot run", async ({ gm }) => {
  const attempt = async (setup, expected) => {
    const app = await openWindow(gm);
    try {
      await setup(app);
      const before = await gm.eval(() => game.messages.size);
      await app.locator('button[type="submit"]').click();
      await gm.page.locator("#notifications .notification.error", { hasText: expected }).waitFor({ timeout: 5000 })
        .catch(() => { throw new Error(`No "${expected}" error.`); });
      assertEqual(await gm.eval(() => game.messages.size), before, `messages after "${expected}"`);
      assert(await app.isVisible(), `The window closed after "${expected}".`);
    } finally {
      await gm.eval(() => foundry.applications.instances.get("robear-roll-request")?.close());
      await gm.eval(() => ui.notifications.clear?.());
    }
  };

  await attempt(async app => {
    await chooseMode(app, "standard");
    for ( const box of await app.locator('input[name^="actors."]').all() ) await box.evaluate(el => { el.checked = false; });
  }, "Choose at least one actor to roll.");

  await attempt(async app => {
    await chooseMode(app, "challenge");
    await app.locator('input[name="parts.1.dc"]').fill("");
  }, "Each roll in a skill challenge needs a DC.");

  await attempt(async app => {
    await chooseMode(app, "rolloff");
    await app.locator('input[name="rivals.0"][value="0"]').check({ force: true });
    await app.locator('input[name="rivals.1"][value="0"]').check({ force: true });
  }, "No one can be on both sides.");

  await attempt(async app => {
    await chooseMode(app, "versus");
    for ( const box of await app.locator('input[name^="teams.1."]').all() ) await box.evaluate(el => { el.checked = false; });
  }, "Choose who rolls for the NPCs.");
});

/* -------------------------------------------- */
/*  Standard Roll                               */
/* -------------------------------------------- */

test("standard roll: the player rolls through dnd5e's roll window and the GM fast-forwards", async (ctx) => {
  const { gm, player, ids } = ctx;
  const id = await postRequest(ctx, { mode: "standard", parts: [athletics(12)], actors: [ids.aria, ids.goblin] });

  let card = await readCard(player, id);
  assertEqual(row(card, "Aria").rollButtons, 1, "the player's Roll button for Aria");
  assertEqual(row(card, "Goblin").rollButtons, 0, "the player's Roll button for the GM's Goblin");
  card = await readCard(gm, id);
  assertEqual(card.rows.map(r => r.rollButtons), [1, 1], "the GM's Roll buttons");

  await forceDice(player, [d20(5)]);
  await clickRoll(player, id, "Aria");
  const aria = await waitForRoll(gm, id, ids.aria);
  // The DC stays off the roll, so dnd5e's own message does not tell the player they failed.
  assertEqual([aria.type, aria.total, aria.target, aria.author], ["check", 5, null, "Player"], "Aria's roll message");
  assertEqual(aria.flavor, "Strength (Athletics) Check", "Aria's roll flavor");

  await forceDice(gm, [d20(15)]);
  await clickRoll(gm, id, "Goblin", { fastForward: true });
  await waitForRoll(gm, id, ids.goblin);

  for ( const session of [gm, player] ) {
    card = await waitForCard(session, id, c => c.rows.every(r => r.results.length), "both results");
    assertEqual(card.rows.map(r => r.rollButtons), [0, 0], `Roll buttons once rolled (${session.user})`);
  }
  card = await readCard(gm, id);
  assertEqual(row(card, "Aria").results, [{ text: "5", classes: ["failure"] }], "Aria's result, for the GM");
  assertEqual(row(card, "Goblin").results, [{ text: "15", classes: ["success"] }], "Goblin's result, for the GM");
  assertEqual(await unusedDice(player), 0, "the player's forced dice all used");
});

test("standard roll: players see no pass or fail, on the card or the roll, until the GM shows the result", async (ctx) => {
  const { gm, player, ids } = ctx;
  const id = await postRequest(ctx, { mode: "standard", parts: [{ type: "save", key: "dex", dc: 15 }], actors: [ids.aria, ids.borin] });
  await forceDice(player, [d20(5), d20(17)]);
  await clickRoll(player, id, "Aria", { fastForward: true });
  await clickRoll(player, id, "Borin", { fastForward: true });

  let card = await waitForCard(player, id, c => c.rows.every(r => r.results.length), "both saves");
  assertEqual(card.rows.map(r => [r.name, r.classes, r.results]),
    [["Aria", [], [{ text: "5", classes: [] }]], ["Borin", [], [{ text: "17", classes: [] }]]],
    "the player's rows before the result is shown");
  const marked = await player.eval(() => [...document.querySelectorAll("#chat .chat-log li.chat-message:not([hidden])")]
    .flatMap(li => [...li.querySelectorAll(".dice-roll.success, .dice-roll.failure")]).length);
  assertEqual(marked, 0, "rolls in the player's chat marked as passing or failing");

  card = await readCard(gm, id);
  assertEqual(card.rows.map(r => r.classes), [["failure"], ["success"]], "the GM's rows");

  await gm.page.locator(`#chat .chat-log [data-message-id="${id}"] .robear-request-reveal`).click();
  card = await waitForCard(player, id, c => c.summary, "the result to be shown");
  assertEqual(card.rows.map(r => r.classes), [["failure"], ["success"]], "the player's rows once shown");
  assertEqual(card.rows.map(r => r.results[0].classes), [["failure"], ["success"]], "the player's results once shown");
});

test("standard roll: the summary is hidden from players until the GM shows it", async (ctx) => {
  const { gm, player, ids } = ctx;
  const id = await postRequest(ctx, { mode: "standard", parts: [athletics(12)], actors: [ids.goblin] });
  await forceDice(gm, [d20(14)]);
  await clickRoll(gm, id, "Goblin", { fastForward: true });

  let card = await waitForCard(gm, id, c => c.summary, "the GM's summary");
  assertEqual(card.summary, "1 of 1 succeeded Show to players", "the GM's summary");
  card = await waitForCard(player, id, c => c.rows[0].results.length, "the player's result");
  assertEqual(card.summary, null, "the player's summary before it is shown");

  await gm.page.locator(`#chat .chat-log [data-message-id="${id}"] .robear-request-reveal`).click();
  card = await waitForCard(player, id, c => c.summary, "the player's summary");
  assertEqual(card.summary, "1 of 1 succeeded", "the player's summary once shown");
  assertEqual(card.reveal, null, "a reveal button for the player");
  card = await waitForCard(gm, id, c => c.reveal === "Shown", "the GM's Shown button");

  await gm.page.locator(`#chat .chat-log [data-message-id="${id}"] .robear-request-reveal`).click();
  await waitForCard(player, id, c => !c.summary, "the summary to be hidden again");
});

test("standard roll: a hidden DC stays off the card and off the player's roll", async (ctx) => {
  const { gm, player, ids } = ctx;
  const id = await postRequest(ctx, { mode: "standard", parts: [athletics(12)], actors: [ids.aria], showDC: false });
  assertEqual((await readCard(player, id)).subtitle, "Standard Roll · DC ?", "the player's subtitle");
  assertEqual((await readCard(gm, id)).subtitle, "Standard Roll · DC 12", "the GM's subtitle");
  await forceDice(player, [d20(13)]);
  await clickRoll(player, id, "Aria", { fastForward: true });
  const aria = await waitForRoll(gm, id, ids.aria);
  assertEqual(aria.target, null, "the roll's target");
  await waitForCard(gm, id, c => row(c, "Aria").results[0]?.classes.includes("success"), "Aria scored against the DC");
});

test("standard roll: deleting a roll brings the Roll button back", async (ctx) => {
  const { gm, player, ids } = ctx;
  const id = await postRequest(ctx, { mode: "standard", parts: [athletics(12)], actors: [ids.aria] });
  await forceDice(player, [d20(3)]);
  await clickRoll(player, id, "Aria", { fastForward: true });
  const roll = await waitForRoll(gm, id, ids.aria);
  await waitForCard(player, id, c => row(c, "Aria").rollButtons === 0, "the Roll button to go");
  await gm.eval(id => game.messages.get(id).delete(), roll.id);
  await waitForCard(player, id, c => row(c, "Aria").rollButtons === 1, "the Roll button to come back");
});

test("standard roll: a double click makes one roll", async (ctx) => {
  const { gm, player, ids } = ctx;
  const id = await postRequest(ctx, { mode: "standard", parts: [athletics(12)], actors: [ids.aria] });
  await forceDice(player, [d20(7), d20(8)]);
  await rollButton(player, id, "Aria").dblclick({ modifiers: ["Shift"] });
  await waitForRoll(gm, id, ids.aria);
  await player.page.waitForTimeout(1500);
  const rolls = await gm.eval(({ id, moduleId }) => game.messages.filter(m => m.getFlag(moduleId, "requestRoll")?.request === id).length,
    { id, moduleId: MODULE_ID });
  assertEqual(rolls, 1, "roll messages after a double click");
  await player.eval(() => { globalThis.__robearDice.length = 0; });
});

test("standard roll: a plain d6 is rolled straight away and scored against the DC", async (ctx) => {
  const { gm, player, ids } = ctx;
  const id = await postRequest(ctx, { mode: "standard", parts: [{ type: "d6", key: null, dc: 4 }], actors: [ids.aria, ids.borin] });
  let card = await readCard(player, id);
  assertEqual([card.title, card.subtitle], ["d6 Roll", "Standard Roll · DC 4"], "heading");

  // No dnd5e roll window for a plain die: a plain click rolls it.
  await forceDice(player, [[5, 6], [2, 6]]);
  await rollButton(player, id, "Aria").click();
  const aria = await waitForRoll(gm, id, ids.aria);
  assertEqual([aria.total, aria.formula, aria.isD20, aria.flavor], [5, "1d6", false, "Standard Roll: d6"], "Aria's d6");
  await rollButton(player, id, "Borin").click();
  await waitForRoll(gm, id, ids.borin);

  await waitForCard(player, id, c => c.rows.every(r => r.results.length), "both results");
  card = await waitForCard(gm, id, c => c.rows.every(r => r.results.length), "both results, for the GM");
  assertEqual(row(card, "Aria").results, [{ text: "5", classes: ["success"] }], "Aria's result");
  assertEqual(row(card, "Borin").results, [{ text: "2", classes: ["failure"] }], "Borin's result");
  assertEqual(row(await readCard(player, id), "Aria").cardButton, false, "a card button on a d6");
});

test("roll-off: other dice can be set against each other, such as a d8 against a d12", async (ctx) => {
  const { gm, player, ids } = ctx;
  const id = await postRequest(ctx, {
    mode: "rolloff", parts: [{ type: "d8", key: null, dc: null }, { type: "d12", key: null, dc: null }],
    sides: [[ids.aria], [ids.borin]], actors: [ids.aria, ids.borin]
  });
  assertEqual((await readCard(player, id)).subtitle, "d8 vs d12", "subtitle");
  await forceDice(player, [[7, 8], [3, 12]]);
  await rollButton(player, id, "Aria").click();
  await waitForRoll(gm, id, ids.aria, 0);
  await rollButton(player, id, "Borin").click();
  const borin = await waitForRoll(gm, id, ids.borin, 1);
  assertEqual([borin.total, borin.formula], [3, "1d12"], "Borin's d12");
  const card = await waitForCard(player, id, c => c.summary, "the winner");
  assertEqual(card.summary, "Aria 7 · Borin 3 Aria wins", "summary, with no NPC to hide");
});

/* -------------------------------------------- */
/*  Skill Challenge                             */
/* -------------------------------------------- */

test("skill challenge: rolls come one at a time and stop once settled", async (ctx) => {
  const { gm, player, ids } = ctx;
  const parts = [athletics(10), { type: "skill", key: "acr", dc: 10 }, { type: "save", key: "wis", dc: 10 }];
  const id = await postRequest(ctx, { mode: "challenge", parts, actors: [ids.aria, ids.borin], successes: 2 });

  let card = await readCard(player, id);
  assertEqual(card.title, "Skill Challenge", "title");
  assertEqual(card.subtitle, "2 of 3 to succeed", "subtitle");
  assertEqual(row(card, "Aria").rollButtons, 1, "one Roll button to start");

  await forceDice(player, [d20(15)]);
  await clickRoll(player, id, "Aria", { fastForward: true });
  await waitForCard(player, id, c => row(c, "Aria").results.length === 1, "Aria's first roll");
  card = await waitForCard(gm, id, c => row(c, "Aria").results.length === 1, "Aria's first roll, for the GM");
  assertEqual(row(card, "Aria").badge, "1/2", "Aria's badge after one success, for the GM");

  await forceDice(player, [d20(12)]);
  await clickRoll(player, id, "Aria", { fastForward: true });
  const second = await waitForRoll(gm, id, ids.aria, 1);
  assertEqual([second.flavor, second.target], ["Dexterity (Acrobatics) Check", null], "Aria's second roll, without its DC");
  card = await waitForCard(gm, id, c => row(c, "Aria").classes.includes("success"), "Aria to pass after two");
  assertEqual(row(card, "Aria").badge, "2/2", "Aria's badge, for the GM");
  card = await waitForCard(player, id, c => row(c, "Aria").results.length === 2, "Aria's second roll, for the player");
  assertEqual(row(card, "Aria").rollButtons + row(card, "Aria").pending, 0, "Aria's third roll offered");

  await forceDice(player, [d20(4), d20(9)]);
  await clickRoll(player, id, "Borin", { fastForward: true });
  await waitForCard(player, id, c => row(c, "Borin").results.length === 1, "Borin's first roll");
  await clickRoll(player, id, "Borin", { fastForward: true });
  card = await waitForCard(gm, id, c => row(c, "Borin").classes.includes("failure"), "Borin to fail after two");
  assertEqual(card.summary, "1 of 2 passed the challenge Show to players", "the GM's summary");
});

test("skill challenge: players see no outcome until the GM shows it", async (ctx) => {
  const { gm, player, ids } = ctx;
  const parts = [athletics(10), athletics(10), athletics(10)];
  const id = await postRequest(ctx, { mode: "challenge", parts, actors: [ids.aria], successes: 2 });
  await forceDice(player, [d20(15), d20(3)]);
  await clickRoll(player, id, "Aria", { fastForward: true });
  await waitForCard(player, id, c => row(c, "Aria").results.length === 1, "Aria's first roll");
  let card = await readCard(player, id);
  assertEqual([row(card, "Aria").classes, row(card, "Aria").results, row(card, "Aria").badge],
    [[], [{ text: "15", classes: [] }], ""], "Aria's row, for the player, part way through");

  await clickRoll(player, id, "Aria", { fastForward: true });
  await waitForCard(player, id, c => row(c, "Aria").results.length === 2, "Aria's second roll");
  await forceDice(player, [d20(11)]);
  await clickRoll(player, id, "Aria", { fastForward: true });
  card = await waitForCard(player, id, c => row(c, "Aria").badge === "Done", "Aria to finish");
  assertEqual(row(card, "Aria").classes, [], "Aria's row, for the player, once finished");
  assertEqual(row(card, "Aria").results.map(r => r.classes), [[], [], []], "Aria's results, for the player");
  assertEqual(card.summary, null, "the player's summary before it is shown");
  const marked = await player.eval(() => [...document.querySelectorAll("#chat .chat-log li.chat-message:not([hidden])")]
    .flatMap(li => [...li.querySelectorAll(".dice-roll.success, .dice-roll.failure")]).length);
  assertEqual(marked, 0, "rolls in the player's chat marked as passing or failing");

  await gm.page.locator(`#chat .chat-log [data-message-id="${id}"] .robear-request-reveal`).click();
  card = await waitForCard(player, id, c => c.summary, "the outcome to be shown");
  assertEqual(card.summary, "1 of 1 passed the challenge", "the player's summary once shown");
  assertEqual([row(card, "Aria").classes, row(card, "Aria").badge], [["success"], "2/2"], "Aria's row once shown");
  assertEqual(row(card, "Aria").results.map(r => r.classes[0]), ["success", "failure", "success"], "each roll once shown");
});

test("skill challenge: the third roll decides it", async (ctx) => {
  const { gm, player, ids } = ctx;
  const parts = [athletics(10), athletics(10), { type: "save", key: "wis", dc: 10 }];
  const id = await postRequest(ctx, { mode: "challenge", parts, actors: [ids.aria], successes: 2 });
  await forceDice(player, [d20(15), d20(3), d20(10)]);
  for ( const n of [1, 2, 3] ) {
    await clickRoll(player, id, "Aria", { fastForward: true });
    await waitForCard(player, id, c => row(c, "Aria").results.length === n, `roll ${n}`);
  }
  const card = await waitForCard(gm, id, c => row(c, "Aria").classes.includes("success"), "the challenge to pass");
  assertEqual(row(card, "Aria").results.map(r => r.classes[0]), ["success", "failure", "success"], "each roll");
});

/* -------------------------------------------- */
/*  Team Challenge                              */
/* -------------------------------------------- */

test("team challenge: a natural 1 takes the highest roll out of the average", async (ctx) => {
  const { gm, player, ids } = ctx;
  const id = await postRequest(ctx, { mode: "team", parts: [athletics(10)], actors: [ids.aria, ids.borin, ids.goblin] });
  await forceDice(player, [d20(1), d20(15)]);
  await clickRoll(player, id, "Aria", { fastForward: true });
  await clickRoll(player, id, "Borin", { fastForward: true });
  await forceDice(gm, [d20(10)]);
  await clickRoll(gm, id, "Goblin", { fastForward: true });

  let card = await waitForCard(gm, id, c => c.summary, "the GM's team result");
  assertEqual(card.summary, "Team average 5 · 1 removed Failure Show to players", "the GM's summary");
  assertEqual(row(card, "Borin").classes, ["removed"], "Borin's row, for the GM");

  // Players see the rolls, but not the result or which roll was removed, until the GM shows it.
  card = await waitForCard(player, id, c => c.rows.every(r => r.results.length), "the player to see every roll");
  assertEqual(card.summary, null, "the player's summary before it is shown");
  assertEqual([row(card, "Borin").classes, row(card, "Borin").tooltip], [[], null], "Borin's row before it is shown");

  await revealSummary(gm, id);
  for ( const session of [gm, player] ) {
    card = await waitForCard(session, id, c => c.summary?.startsWith("Team average"), `the team result (${session.user})`);
    assertEqual(row(card, "Borin").classes, ["removed"], "Borin's row");
    assertEqual(row(card, "Borin").tooltip, "Highest roll, removed by Aria's natural 1", "why Borin was removed");
    assertEqual(row(card, "Aria").results[0].classes, ["fumble"], "Aria's natural 1, with no pass or fail mark");
  }
  assertEqual(card.summary, "Team average 5 · 1 removed Failure", "the player's summary once shown");
});

/**
 * Click the GM's Show to players button on a request's summary.
 * @param {import("./lib/session.mjs").Session} gm
 * @param {string} id
 */
async function revealSummary(gm, id) {
  await waitForCard(gm, id, c => c.reveal === "Show to players", "the GM's Show to players button");
  await gm.page.locator(`#chat .chat-log [data-message-id="${id}"] .robear-request-reveal`).click();
}

test("team challenge: a natural 20 takes the lowest roll out of the average", async (ctx) => {
  const { gm, player, ids } = ctx;
  const id = await postRequest(ctx, { mode: "team", parts: [athletics(15)], actors: [ids.aria, ids.borin, ids.goblin] });
  await forceDice(player, [d20(20), d20(2)]);
  await clickRoll(player, id, "Aria", { fastForward: true });
  await clickRoll(player, id, "Borin", { fastForward: true });
  await forceDice(gm, [d20(11)]);
  await clickRoll(gm, id, "Goblin", { fastForward: true });
  await revealSummary(gm, id);
  const card = await waitForCard(player, id, c => c.summary, "the team result");
  assertEqual(card.summary, "Team average 15 · 1 removed Success", "summary");
  assertEqual(row(card, "Borin").classes, ["removed"], "Borin's row");
  assertEqual(row(card, "Aria").results[0].classes, ["critical"], "Aria's natural 20");
});

/* -------------------------------------------- */
/*  Roll-Off                                    */
/* -------------------------------------------- */

test("roll-off: a d100 against a skill check, the higher total winning", async (ctx) => {
  const { gm, player, ids } = ctx;
  const id = await postRequest(ctx, {
    mode: "rolloff", parts: [{ type: "d100", key: null, dc: null }, athletics(null)],
    sides: [[ids.aria], [ids.goblin]], actors: [ids.aria, ids.goblin]
  });
  let card = await readCard(player, id);
  assertEqual([card.title, card.subtitle], ["Roll-Off", "d100 vs Athletics Check"], "heading");
  assertEqual(card.sides.map(s => s.name), ["Challenger", "Opponent"], "sides");

  // A d100 has no dnd5e roll window: a plain click rolls it.
  await forceDice(player, [d100(73)]);
  await rollButton(player, id, "Aria").click();
  const aria = await waitForRoll(gm, id, ids.aria, 0);
  assertEqual([aria.total, aria.isD20, aria.flavor], [73, false, "Roll-Off: d100"], "Aria's d100");

  await forceDice(gm, [d20(12)]);
  await clickRoll(gm, id, "Goblin", { fastForward: true });
  const goblin = await waitForRoll(gm, id, ids.goblin, 1);
  assertEqual(goblin.flavor, "Strength (Athletics) Check", "the Goblin's check");
  await revealRival(gm, player, id);

  for ( const session of [gm, player] ) {
    card = await waitForCard(session, id, c => c.summary?.startsWith("Aria 73"), `the winner (${session.user})`);
    assertEqual(card.sides.map(s => s.classes[0]), ["success", "failure"], "sides");
  }
  assertEqual(card.summary, "Aria 73 · Goblin 12 Aria wins", "the player's summary");
  assertEqual(row(card, "Aria").cardButton, false, "a card button on a d100 roll-off");
});

/**
 * Show the NPC's hidden roll-off roll to players from the GM's request card, and wait for the player to see it.
 * @param {import("./lib/session.mjs").Session} gm
 * @param {import("./lib/session.mjs").Session} player
 * @param {string} id
 */
async function revealRival(gm, player, id) {
  await waitForCard(gm, id, c => c.reveal === "Show NPC roll", "the GM's Show NPC roll button");
  await gm.page.locator(`#chat .chat-log [data-message-id="${id}"] .robear-request-reveal`).click();
  await waitForCard(player, id, c => c.rows.every(r => r.results.every(p => p.text !== "?")), "the NPC roll to be shown");
}

test("roll-off: the NPC's roll is private to the GM until the GM shows it", async (ctx) => {
  const { gm, player, ids } = ctx;
  const id = await postRequest(ctx, {
    mode: "rolloff", parts: [athletics(null), athletics(null)],
    sides: [[ids.aria], [ids.goblin]], actors: [ids.aria, ids.goblin]
  });

  await forceDice(gm, [d20(16)]);
  await clickRoll(gm, id, "Goblin", { fastForward: true });
  await waitForRoll(gm, id, ids.goblin, 1);
  const whisper = await gm.eval(({ id, moduleId }) => {
    const roll = game.messages.find(m => m.getFlag(moduleId, "requestRoll")?.request === id);
    return { whisper: roll.whisper, gms: game.users.filter(u => u.isGM).map(u => u.id) };
  }, { id, moduleId: MODULE_ID });
  assertEqual(whisper.whisper, whisper.gms, "the Goblin's roll whispered to the GM");
  assertEqual(await player.eval(({ id, moduleId }) => game.messages.find(m => m.getFlag(moduleId, "requestRoll")?.request === id)
    .isContentVisible, { id, moduleId: MODULE_ID }), false, "the Goblin's roll content, for the player");

  let card = await waitForCard(player, id, c => row(c, "Goblin").results.length, "the player to see the Goblin rolled");
  assertEqual(row(card, "Goblin").results, [{ text: "?", classes: [] }], "the Goblin's result, for the player");
  card = await waitForCard(gm, id, c => c.reveal, "the GM's reveal button");
  assertEqual([row(card, "Goblin").results[0].text, card.reveal], ["16", "Show NPC roll"], "the GM's card");

  // The player's own roll stays public.
  await forceDice(player, [d20(11)]);
  await clickRoll(player, id, "Aria", { fastForward: true });
  const aria = await waitForRoll(gm, id, ids.aria, 0);
  assertEqual(await gm.eval(id => game.messages.get(id).whisper, aria.id), [], "Aria's roll whisper");

  card = await waitForCard(player, id, c => c.summary, "the player's summary");
  assertEqual(card.summary, "The result is hidden.", "the player's summary before the GM shows the NPC roll");
  card = await waitForCard(gm, id, c => c.summary?.includes("wins"), "the GM's summary");
  assertEqual(card.summary, "Aria 11 · Goblin 16 Goblin wins Show NPC roll", "the GM's summary");

  await revealRival(gm, player, id);
  card = await waitForCard(player, id, c => c.summary?.includes("wins"), "the player's winner");
  assertEqual(card.summary, "Aria 11 · Goblin 16 Goblin wins", "the player's summary once shown");
  assertEqual(row(card, "Goblin").results[0].text, "16", "the Goblin's result once shown");
  await waitForCard(gm, id, c => c.reveal === "NPC roll shown", "the GM's button to show it is shown");

  await gm.page.locator(`#chat .chat-log [data-message-id="${id}"] .robear-request-reveal`).click();
  card = await waitForCard(player, id, c => row(c, "Goblin").results[0].text === "?", "the NPC roll to be hidden again");
  assertEqual(card.summary, "The result is hidden.", "the player's summary once hidden again");
});

test("roll-off: equal d20s tie, and a card can be played on a plain d20", async (ctx) => {
  const { gm, player, ids } = ctx;
  const id = await postRequest(ctx, {
    mode: "rolloff", parts: [{ type: "d20", key: null, dc: null }, { type: "d20", key: null, dc: null }],
    sides: [[ids.aria], [ids.goblin]], actors: [ids.aria, ids.goblin]
  });
  await forceDice(player, [d20(9)]);
  await clickRoll(player, id, "Aria");
  const aria = await waitForRoll(gm, id, ids.aria, 0);
  assertEqual([aria.isD20, aria.flavor, aria.total], [true, "Roll-Off: d20", 9], "Aria's d20");
  await forceDice(gm, [d20(9)]);
  await clickRoll(gm, id, "Goblin", { fastForward: true });
  await waitForRoll(gm, id, ids.goblin, 1);
  await revealRival(gm, player, id);

  let card = await waitForCard(player, id, c => c.summary?.includes("Tie"), "the tie");
  assertEqual(card.summary, "Aria 9 · Goblin 9 Tie", "summary");
  assertEqual(card.summaryClasses, ["tie"], "summary style");
  assertEqual(row(card, "Aria").cardButton, true, "a card button on Aria's plain d20");

  await forceDice(player, [d20(17)]);
  const offered = await playCard(player, id, "Aria", "Advantage");
  assert(offered.includes("Luck"), `Luck was not offered on a plain d20: ${offered.join(", ")}`);
  card = await waitForCard(player, id, c => c.summary?.includes("Aria wins"), "Advantage to win it");
  assertEqual(card.summary, "Aria 17 · Goblin 9 Aria wins", "summary after Advantage");
});

/* -------------------------------------------- */
/*  Team vs Team                                */
/* -------------------------------------------- */

test("team vs team: each team pooled with the 1 and 20 rule, the higher average winning", async (ctx) => {
  const { gm, player, ids } = ctx;
  const id = await postRequest(ctx, {
    mode: "versus", parts: [{ type: "d20", key: null, dc: null }, athletics(null)],
    sides: [[ids.aria, ids.borin], [ids.goblin]], actors: [ids.aria, ids.borin, ids.goblin]
  });
  await forceDice(player, [d20(20), d20(5)]);
  await clickRoll(player, id, "Aria", { fastForward: true });
  await clickRoll(player, id, "Borin", { fastForward: true });
  await forceDice(gm, [d20(12)]);
  await clickRoll(gm, id, "Goblin", { fastForward: true });

  const card = await waitForCard(player, id, c => c.summary, "the winner");
  assertEqual(card.sides.map(s => [s.name, s.score, s.classes[0]]), [["Players", "20", "success"], ["NPCs", "12", "failure"]],
    "sides");
  assertEqual(card.summary, "Players 20 · NPCs 12 Players win", "summary");
  assertEqual(row(card, "Borin").classes, ["removed"], "Borin's low roll, removed by Aria's natural 20");
});

/* -------------------------------------------- */
/*  Divine Intervention                         */
/* -------------------------------------------- */

/**
 * Click Roll, pick a run of numbers in the grid, and roll the d100.
 * @param {import("./lib/session.mjs").Session} session
 * @param {string} id
 * @param {string} name
 * @param {number} number  The number clicked in the grid.
 * @returns {Promise<string>}  The picker's "You need …" line.
 */
async function pickAndRoll(session, id, name, number) {
  await rollButton(session, id, name).click();
  const dialog = session.page.locator(".robear-divine-dialog.application");
  await dialog.waitFor({ timeout: 10_000 });
  const roll = dialog.locator('button[data-action="roll"]');
  assertEqual(await roll.isDisabled(), true, "Roll d100 before picking");
  await dialog.locator(`.robear-divine-number[data-number="${number}"]`).click();
  const choice = (await dialog.locator(".robear-divine-choice").textContent()).trim();
  await roll.click();
  return choice;
}

test("divine intervention: the player picks 16 numbers, then rolls the d100 into them", async (ctx) => {
  const { gm, player, ids } = ctx;
  const id = await postRequest(ctx, {
    mode: "divine", range: 16, parts: [{ type: "d100", key: null, dc: null }], actors: [ids.aria]
  });
  let card = await readCard(player, id);
  assertEqual([card.title, card.subtitle], ["Divine Intervention", "16 numbers in a row on a d100"], "heading");

  await forceDice(player, [d100(90)]);
  // Near the top the run is moved down so it still ends at 100.
  assertEqual(await pickAndRoll(player, id, "Aria", 95), "You need 85–100.", "the picked range");
  const roll = await waitForRoll(gm, id, ids.aria);
  assertEqual([roll.total, roll.flag.range], [90, { start: 85, end: 100 }], "the d100 and its range");
  assertEqual(roll.flavor, "Divine Intervention: d100, needing 85–100", "the roll's flavor");

  card = await waitForCard(player, id, c => c.summary, "the answer");
  assertEqual(row(card, "Aria").range, "85–100", "the range on the card");
  assertEqual(row(card, "Aria").results[0], { text: "90", classes: ["success"] }, "the result");
  assertEqual(card.summary, "1 of 1 answered The gods answer", "summary");
});

test("divine intervention: cancelling the picker rolls nothing", async (ctx) => {
  const { gm, player, ids } = ctx;
  const id = await postRequest(ctx, {
    mode: "divine", range: 16, parts: [{ type: "d100", key: null, dc: null }], actors: [ids.aria]
  });
  await rollButton(player, id, "Aria").click();
  const dialog = player.page.locator(".robear-divine-dialog.application");
  await dialog.waitFor({ timeout: 10_000 });
  await dialog.locator('button[data-action="cancel"]').click();
  await player.page.waitForTimeout(1000);
  assertEqual(await gm.eval(() => game.messages.contents.filter(m => m.rolls.length).length), 0, "roll messages");
  assertEqual(row(await readCard(player, id), "Aria").rollButtons, 1, "Aria's Roll button");
});

test("divine intervention: Luck rerolls a miss, and only Advantage and Luck are offered", async (ctx) => {
  const { gm, player, ids } = ctx;
  const id = await postRequest(ctx, {
    mode: "divine", range: 16, parts: [{ type: "d100", key: null, dc: null }], actors: [ids.aria]
  });
  await forceDice(player, [d100(10)]);
  await pickAndRoll(player, id, "Aria", 40);
  await waitForCard(player, id, c => row(c, "Aria").results[0]?.classes.includes("failure"), "the miss");

  await forceDice(player, [d100(45)]);
  const offered = await playCard(player, id, "Aria", "Luck");
  assertEqual([...offered].sort(), ["Advantage", "Luck"], "cards offered on the d100");
  const card = await waitForCard(player, id, c => c.summary?.includes("answer") && row(c, "Aria").results[0].text === "45",
    "the reroll");
  assertEqual(card.summary, "1 of 1 answered The gods answer", "summary after Luck");
  const log = await gm.eval(({ id, moduleId }) => game.messages.find(m => m.getFlag(moduleId, "requestRoll")?.request === id)
    .getFlag(moduleId, "log").map(e => e.text), { id, moduleId: MODULE_ID });
  assertEqual(log, ["Luck: rerolled the d100: 10 → 45"], "the card's note on the roll");
});

test("divine intervention: Advantage keeps a second d100 that lands in range", async (ctx) => {
  const { player, ids } = ctx;
  const id = await postRequest(ctx, {
    mode: "divine", range: 16, parts: [{ type: "d100", key: null, dc: null }], actors: [ids.aria]
  });
  await forceDice(player, [d100(10)]);
  await pickAndRoll(player, id, "Aria", 40);
  await waitForCard(player, id, c => row(c, "Aria").results.length, "the miss");
  await forceDice(player, [d100(50)]);
  await playCard(player, id, "Aria", "Advantage");
  let card = await waitForCard(player, id, c => row(c, "Aria").results[0].text === "50", "Advantage");
  assertEqual(card.summary, "1 of 1 answered The gods answer", "summary after Advantage");
  card = await readCard(player, id);
  const offered = await player.eval(({ id }) => document.querySelector(`#chat .chat-log [data-message-id="${id}"] .robear-card-button`)
    ? "button" : "none", { id });
  assert(offered === "button", "Luck should still be playable after Advantage.");
});

test("divine intervention: Advantage keeps the first d100 when the second misses", async (ctx) => {
  const { gm, player, ids } = ctx;
  const id = await postRequest(ctx, {
    mode: "divine", range: 16, parts: [{ type: "d100", key: null, dc: null }], actors: [ids.aria]
  });
  await forceDice(player, [d100(45)]);
  await pickAndRoll(player, id, "Aria", 40);
  await waitForCard(player, id, c => row(c, "Aria").results.length, "the hit");
  await forceDice(player, [d100(99)]);
  await playCard(player, id, "Aria", "Advantage");
  await waitFor(gm, ({ id, moduleId }) => game.messages.find(m => m.getFlag(moduleId, "requestRoll")?.request === id)
    ?.getFlag(moduleId, "log")?.length, { id, moduleId: MODULE_ID }, "the card's note");
  const card = await readCard(player, id);
  assertEqual(row(card, "Aria").results[0].text, "45", "the kept d100");
});

/* -------------------------------------------- */
/*  RoBear-E Cards on Requested Rolls           */
/* -------------------------------------------- */

test("cards: Advantage on a failed check updates the request card", async (ctx) => {
  const { gm, player, ids } = ctx;
  const id = await postRequest(ctx, { mode: "standard", parts: [athletics(12)], actors: [ids.aria, ids.borin] });
  await forceDice(player, [d20(4), d20(6)]);
  await clickRoll(player, id, "Aria", { fastForward: true });
  await clickRoll(player, id, "Borin", { fastForward: true });
  let card = await waitForCard(player, id, c => c.rows.every(r => r.results.length), "both results");
  assertEqual(row(card, "Aria").cardButton, true, "Aria's card button");
  assertEqual(row(card, "Borin").cardButton, false, "Borin, who has no cards");

  await forceDice(player, [d20(18)]);
  await playCard(player, id, "Aria", "Advantage");
  await waitForCard(player, id, c => row(c, "Aria").results[0].text === "18", "Advantage");
  card = await waitForCard(gm, id, c => row(c, "Aria").results[0].text === "18", "Advantage, for the GM");
  assertEqual(row(card, "Aria").results[0].classes, ["success"], "Aria's result after Advantage");
});

test("cards: Indomitable is offered on a failed requested save once the GM shows the result, and never on a pass", async (ctx) => {
  const { gm, player, ids } = ctx;
  const id = await postRequest(ctx, { mode: "standard", parts: [{ type: "save", key: "wis", dc: 15 }], actors: [ids.aria] });
  await forceDice(player, [d20(16)]);
  await clickRoll(player, id, "Aria", { fastForward: true });
  await waitForCard(player, id, c => row(c, "Aria").results.length, "the passed save");
  // Advantage's second d20 is forced too, and waited for, so it cannot take a die meant for the next roll.
  await forceDice(player, [d20(3)]);
  const offered = await playCard(player, id, "Aria", "Advantage");
  assert(!offered.includes("Indomitable"), `Indomitable was offered on a passed save: ${offered.join(", ")}`);
  await waitFor(player, ({ id, moduleId }) => game.messages.find(m => m.getFlag(moduleId, "requestRoll")?.request === id)
    ?.getFlag(moduleId, "log")?.length, { id, moduleId: MODULE_ID }, "Advantage to be recorded");

  const failed = await postRequest(ctx, { mode: "standard", parts: [{ type: "save", key: "wis", dc: 15 }], actors: [ids.aria] });
  await forceDice(player, [d20(6)]);
  await clickRoll(player, failed, "Aria", { fastForward: true });
  await waitForCard(player, failed, c => row(c, "Aria").results.length, "the failed save");

  // Before the GM shows the result, offering Indomitable would tell the player they failed.
  const notYet = await cardsOnRow(player, failed, "Aria");
  assert(notYet.includes("Luck"), `The card chooser did not open: ${notYet.join(", ")}`);
  assert(!notYet.includes("Indomitable"), `Indomitable was offered before the result was shown: ${notYet.join(", ")}`);

  await gm.page.locator(`#chat .chat-log [data-message-id="${failed}"] .robear-request-reveal`).click();
  await waitForCard(player, failed, c => c.summary, "the result to be shown");
  await forceDice(player, [d20(19)]);
  await playCard(player, failed, "Aria", "Indomitable");
  await waitForCard(player, failed, c => row(c, "Aria").results[0].text === "19", "Indomitable's reroll");
});

/* -------------------------------------------- */
/*  Attached Rolls                              */
/* -------------------------------------------- */

/**
 * @param {import("./lib/session.mjs").Session} session
 * @param {string} id  A roll message's ID.
 * @returns {Promise<boolean>}  Whether the roll's own message shows in the user's chat log.
 */
function rollMessageShown(session, id) {
  return session.eval(id => {
    const li = document.querySelector(`#chat .chat-log li.chat-message[data-message-id="${id}"]`);
    return !!li && !li.hidden;
  }, id);
}

test("attached rolls: on by default, the rolls are hidden from chat and shown on the request card", async (ctx) => {
  const { gm, player, ids } = ctx;
  const setting = await gm.eval(moduleId => {
    const s = game.settings.settings.get(`${moduleId}.attachRolls`);
    return { config: s?.config, scope: s?.scope, default: s?.default, value: game.settings.get(moduleId, "attachRolls") };
  }, MODULE_ID);
  assertEqual(setting, { config: true, scope: "world", default: true, value: true }, "the setting");

  const id = await postRequest(ctx, { mode: "standard", parts: [athletics(12)], actors: [ids.aria] });
  await forceDice(player, [d20(4)]);
  await clickRoll(player, id, "Aria", { fastForward: true });
  const roll = await waitForRoll(gm, id, ids.aria);
  await waitForCard(player, id, c => row(c, "Aria").results.length, "Aria's result");
  for ( const session of [gm, player] ) {
    assertEqual(await rollMessageShown(session, roll.id), false, `Aria's roll message in chat (${session.user})`);
  }

  // Clicking the result opens its dice under the row.
  await player.page.locator(`#chat .chat-log [data-message-id="${id}"] .robear-request-result.expandable`).click();
  const detail = player.page.locator(`#chat .chat-log [data-message-id="${id}"] .robear-request-roll-detail`);
  await detail.locator(".dice-tooltip").waitFor({ timeout: 5000 });
  assertEqual((await detail.locator(".robear-request-roll-formula").textContent()).trim(), "1d20 + 0 = 4", "the formula");

  // A card played on the roll is noted under the row, and the open dice stay open through the redraw.
  await forceDice(player, [d20(13)]);
  await playCard(player, id, "Aria", "Luck");
  const card = await waitForCard(player, id, c => row(c, "Aria").results[0].text === "13", "Luck's reroll");
  assert(card, "The card did not update.");
  const note = await player.page.locator(`#chat .chat-log [data-message-id="${id}"] .robear-request-details .robear-card-log`)
    .textContent();
  assertEqual(note.replace(/\s+/g, " ").trim(), "Luck: rerolled the d20 (4 → 13): 4 → 13", "the card's note, with no RoBear-E label");
  assertEqual(await detail.count(), 1, "the dice breakdown after the redraw");
});

test("attached rolls: turned off, each roll keeps its own chat message", async (ctx) => {
  const { gm, player, ids } = ctx;
  await gm.eval(moduleId => game.settings.set(moduleId, "attachRolls", false), MODULE_ID);
  await waitFor(player, moduleId => game.settings.get(moduleId, "attachRolls") === false, MODULE_ID, "the setting");
  const id = await postRequest(ctx, { mode: "standard", parts: [athletics(12)], actors: [ids.aria] });
  await forceDice(player, [d20(9)]);
  await clickRoll(player, id, "Aria", { fastForward: true });
  const roll = await waitForRoll(gm, id, ids.aria);
  await waitForCard(player, id, c => row(c, "Aria").results.length, "Aria's result");
  for ( const session of [gm, player] ) {
    assertEqual(await rollMessageShown(session, roll.id), true, `Aria's roll message in chat (${session.user})`);
  }
  const expandable = await player.page.locator(`#chat .chat-log [data-message-id="${id}"] .robear-request-result.expandable`).count();
  assertEqual(expandable, 0, "results that open their dice");
});
