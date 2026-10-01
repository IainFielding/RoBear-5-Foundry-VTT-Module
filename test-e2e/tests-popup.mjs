/**
 * End-to-end tests for roll request pop-ups, which the GM can turn on for players and for themself.
 */

import { MODULE_ID } from "./config.mjs";
import { assert, assertEqual, forceDice, postRequest, test, waitFor, waitForRoll } from "./lib/harness.mjs";

const d20 = n => [n, 20];
const athletics = dc => ({ type: "skill", key: "ath", dc });

/**
 * Set a module setting as the GM and wait for the other user to see it.
 * @param {import("./lib/session.mjs").Session} gm
 * @param {import("./lib/session.mjs").Session} player
 * @param {string} key
 * @param {*} value
 */
async function setSetting(gm, player, key, value) {
  await gm.eval(({ moduleId, key, value }) => game.settings.set(moduleId, key, value), { moduleId: MODULE_ID, key, value });
  await waitFor(player, ({ moduleId, key, value }) => game.settings.get(moduleId, key) === value,
    { moduleId: MODULE_ID, key, value }, `${key} to reach the player`);
}

/**
 * @param {import("./lib/session.mjs").Session} session
 * @returns {import("playwright").Locator}  The user's roll request pop-up.
 */
function popup(session) {
  return session.page.locator(".robear-request-popup.application");
}

/**
 * The names of the actors in a user's pop-up, or null if it is not open.
 * @param {import("./lib/session.mjs").Session} session
 */
async function popupActors(session) {
  if ( !(await popup(session).count()) ) return null;
  return popup(session).locator(".robear-request-name").allTextContents();
}

/**
 * Wait for a user's pop-up to open, and return the actors in it.
 * @param {import("./lib/session.mjs").Session} session
 */
async function waitForPopup(session) {
  await popup(session).waitFor({ timeout: 10_000 }).catch(() => {
    throw new Error(`No roll request pop-up opened for ${session.user}.`);
  });
  return popupActors(session);
}

/**
 * Wait for a user's pop-up to close.
 * @param {import("./lib/session.mjs").Session} session
 */
function waitForPopupToClose(session) {
  return popup(session).waitFor({ state: "detached", timeout: 10_000 }).catch(() => {
    throw new Error(`The roll request pop-up stayed open for ${session.user}.`);
  });
}

/**
 * @param {import("./lib/session.mjs").Session} session
 * @param {string} name
 * @returns {import("playwright").Locator}  An actor's Roll button in the user's pop-up.
 */
function popupRollButton(session, name) {
  return popup(session).locator(`li.robear-request-actor:has(.robear-request-name:text-is("${name}")) .robear-request-roll`);
}

/* -------------------------------------------- */

test("pop-ups: both settings exist, and are off by default", async (ctx) => {
  const { gm, player, ids } = ctx;
  const settings = await gm.eval(moduleId => ["popupPlayers", "popupGM"].map(key => {
    const s = game.settings.settings.get(`${moduleId}.${key}`);
    return { key, config: s?.config, scope: s?.scope, default: s?.default, value: game.settings.get(moduleId, key) };
  }), MODULE_ID);
  for ( const s of settings ) {
    assertEqual([s.config, s.scope, s.default, s.value], [true, "world", false, false], `the ${s.key} setting`);
  }
  await postRequest(ctx, { mode: "standard", parts: [athletics(12)], actors: [ids.aria, ids.goblin] });
  await player.page.waitForTimeout(1000);
  assertEqual(await popupActors(player), null, "the player's pop-up with the setting off");
  assertEqual(await popupActors(gm), null, "the GM's pop-up with the setting off");
});

test("pop-ups: a player gets their own characters, rolls from the pop-up, and it closes when done", async (ctx) => {
  const { gm, player, ids } = ctx;
  await setSetting(gm, player, "popupPlayers", true);
  const id = await postRequest(ctx, { mode: "standard", parts: [athletics(12)], actors: [ids.aria, ids.borin, ids.goblin] });
  assertEqual(await waitForPopup(player), ["Aria", "Borin"], "the actors in the player's pop-up");
  assertEqual(await popupActors(gm), null, "the GM's pop-up, with only the player setting on");
  assertEqual(await popup(player).locator(".robear-request-header h3").textContent(), "Athletics Check", "the pop-up's title");

  await forceDice(player, [d20(14), d20(6)]);
  await popupRollButton(player, "Aria").click({ modifiers: ["Shift"] });
  await waitForRoll(gm, id, ids.aria);
  await popup(player).locator('li:has(.robear-request-name:text-is("Aria")) .robear-request-result').waitFor({ timeout: 10_000 });
  assert(await popup(player).isVisible(), "The pop-up closed with Borin still to roll.");
  assertEqual(await popupRollButton(player, "Aria").count(), 0, "Aria's Roll button once rolled");

  await popupRollButton(player, "Borin").click({ modifiers: ["Shift"] });
  await waitForRoll(gm, id, ids.borin);
  await waitForPopupToClose(player);
});

test("pop-ups: the roll window opens from the pop-up as it does from the chat card", async (ctx) => {
  const { gm, player, ids } = ctx;
  await setSetting(gm, player, "popupPlayers", true);
  const id = await postRequest(ctx, { mode: "standard", parts: [athletics(12)], actors: [ids.aria] });
  await waitForPopup(player);
  await forceDice(player, [d20(11)]);
  await popupRollButton(player, "Aria").click();
  const normal = player.page.locator(".application.roll-configuration button", { hasText: "Normal" });
  await normal.waitFor({ timeout: 10_000 });
  await normal.click();
  const aria = await waitForRoll(gm, id, ids.aria);
  assertEqual(aria.total, 11, "Aria's roll");
  await waitForPopupToClose(player);
});

test("pop-ups: a skill challenge's pop-up stays open until the challenge is settled", async (ctx) => {
  const { gm, player, ids } = ctx;
  await setSetting(gm, player, "popupPlayers", true);
  const id = await postRequest(ctx, {
    mode: "challenge", parts: [athletics(10), athletics(10), athletics(10)], actors: [ids.aria], successes: 2
  });
  await waitForPopup(player);
  await forceDice(player, [d20(15), d20(15)]);
  await popupRollButton(player, "Aria").click({ modifiers: ["Shift"] });
  await waitForRoll(gm, id, ids.aria, 0);
  await popupRollButton(player, "Aria").waitFor({ timeout: 10_000 });
  assert(await popup(player).isVisible(), "The pop-up closed after the first of three rolls.");
  await popupRollButton(player, "Aria").click({ modifiers: ["Shift"] });
  await waitForRoll(gm, id, ids.aria, 1);
  // Two successes settle it, so there is no third roll to wait for.
  await waitForPopupToClose(player);
});

test("pop-ups: a player with nothing to roll gets none", async (ctx) => {
  const { gm, player, ids } = ctx;
  await setSetting(gm, player, "popupPlayers", true);
  await postRequest(ctx, { mode: "standard", parts: [athletics(12)], actors: [ids.goblin] });
  await player.page.waitForTimeout(1000);
  assertEqual(await popupActors(player), null, "the player's pop-up");
});

test("pop-ups: the GM's pop-up holds only the actors no player owns", async (ctx) => {
  const { gm, player, ids } = ctx;
  await setSetting(gm, player, "popupGM", true);
  const id = await postRequest(ctx, {
    mode: "rolloff", parts: [{ type: "d20", key: null, dc: null }, { type: "d20", key: null, dc: null }],
    sides: [[ids.aria], [ids.goblin]], actors: [ids.aria, ids.goblin]
  });
  assertEqual(await waitForPopup(gm), ["Goblin"], "the actors in the GM's pop-up");
  assertEqual(await popupActors(player), null, "the player's pop-up, with only the GM setting on");
  await forceDice(gm, [d20(13)]);
  await popupRollButton(gm, "Goblin").click({ modifiers: ["Shift"] });
  const goblin = await waitForRoll(gm, id, ids.goblin, 1);
  assertEqual(goblin.total, 13, "the Goblin's roll, for the Opponent's side");
  await waitForPopupToClose(gm);
});

test("pop-ups: divine intervention's number picker opens from the pop-up", async (ctx) => {
  const { gm, player, ids } = ctx;
  await setSetting(gm, player, "popupPlayers", true);
  const id = await postRequest(ctx, {
    mode: "divine", range: 16, parts: [{ type: "d100", key: null, dc: null }], actors: [ids.aria]
  });
  await waitForPopup(player);
  await forceDice(player, [[50, 100]]);
  await popupRollButton(player, "Aria").click();
  const picker = player.page.locator(".robear-divine-dialog.application");
  await picker.waitFor({ timeout: 10_000 });
  await picker.locator('.robear-divine-number[data-number="45"]').click();
  await picker.locator('button[data-action="roll"]').click();
  const roll = await waitForRoll(gm, id, ids.aria);
  assertEqual([roll.total, roll.flag.range], [50, { start: 45, end: 60 }], "the d100 and its range");
  await waitForPopupToClose(player);
});

test("pop-ups: a player who reloads mid-request gets the pop-up back", async (ctx) => {
  const { gm, player, ids } = ctx;
  await setSetting(gm, player, "popupPlayers", true);
  await postRequest(ctx, { mode: "standard", parts: [athletics(12)], actors: [ids.aria] });
  await waitForPopup(player);
  await player.reload();
  await player.eval(() => { ui.sidebar.expand(); ui.sidebar.changeTab("chat", "primary"); });
  assertEqual(await waitForPopup(player), ["Aria"], "the pop-up after reloading");
});

test("pop-ups: an open pop-up redraws when the GM shows the result, and a closed one stays closed", async (ctx) => {
  const { gm, player, ids } = ctx;
  await setSetting(gm, player, "popupPlayers", true);
  const id = await postRequest(ctx, { mode: "standard", parts: [athletics(12)], actors: [ids.aria, ids.borin] });
  await waitForPopup(player);
  await forceDice(player, [d20(14)]);
  await popupRollButton(player, "Aria").click({ modifiers: ["Shift"] });
  await waitForRoll(gm, id, ids.aria);
  const aria = popup(player).locator('li.robear-request-actor:has(.robear-request-name:text-is("Aria"))');
  await aria.locator(".robear-request-result").waitFor({ timeout: 10_000 });
  assertEqual(await aria.evaluate(li => li.classList.contains("success")), false, "Aria's pass, before the GM shows it");

  const reveal = revealed => gm.eval(({ id, moduleId, revealed }) => game.messages.get(id).setFlag(moduleId, "revealed", revealed),
    { id, moduleId: MODULE_ID, revealed });
  await reveal(true);
  await waitFor(player, () => !!document.querySelector(".robear-request-popup li.robear-request-actor.success"), null,
    "the pop-up to show Aria's pass");

  await player.eval(id => foundry.applications.instances.get(`robear-request-popup-${id}`)?.close(), id);
  await waitForPopupToClose(player);
  await reveal(false);
  await player.page.waitForTimeout(1000);
  assertEqual(await popupActors(player), null, "the pop-up after the player closed it and the request changed");
});
