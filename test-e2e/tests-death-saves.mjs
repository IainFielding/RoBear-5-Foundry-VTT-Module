/**
 * End-to-end tests for death save requests, posted at the start of a dying creature's turn in combat.
 */

import { MODULE_ID } from "./config.mjs";
import {
  assert, assertEqual, forceDice, readCard, rollModifiers, test, waitFor, waitForCard, waitForRoll
} from "./lib/harness.mjs";

const d20 = n => [n, 20];

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
 * Change an actor as the GM. Its hit points as they were are kept, for resetWorld to put back.
 * @param {import("./lib/session.mjs").Session} gm
 * @param {string} name     The actor's name.
 * @param {object} changes  An update, e.g. `{ "system.attributes.hp.value": 0 }`.
 */
function updateActor(gm, name, changes) {
  return gm.eval(async ({ name, changes }) => {
    const actor = game.actors.getName(name);
    globalThis.__sttHP ??= {};
    globalThis.__sttHP[actor.id] ??= foundry.utils.deepClone(actor._source.system.attributes.hp);
    await actor.update(changes);
  }, { name, changes });
}

/**
 * Put an actor at 0 hit points, dying.
 * @param {import("./lib/session.mjs").Session} gm
 * @param {string} name
 * @param {object} [changes]  Anything else to change in the same update.
 */
function knockOut(gm, name, changes = {}) {
  return updateActor(gm, name, { "system.attributes.hp.max": 10, "system.attributes.hp.value": 0, ...changes });
}

/**
 * Start a combat as the GM, with each actor at the initiative given, highest first.
 * @param {import("./lib/session.mjs").Session} gm
 * @param {[string, number][]} combatants  Actor names and initiatives.
 */
function startCombat(gm, combatants) {
  return gm.eval(async combatants => {
    const combat = await Combat.create({ active: true });
    await combat.createEmbeddedDocuments("Combatant", combatants.map(([name, initiative]) => ({
      actorId: game.actors.getName(name).id, initiative
    })));
    await combat.startCombat();
  }, combatants);
}

/**
 * Move the combat on, or back, as the GM.
 * @param {import("./lib/session.mjs").Session} gm
 * @param {"nextTurn"|"previousTurn"|"nextRound"} step
 */
async function step(gm, step) {
  await gm.eval(step => game.combat[step](), step);
  await gm.page.waitForTimeout(300);
}

/**
 * The death save requests posted for an actor.
 * @param {import("./lib/session.mjs").Session} session
 * @param {string} uuid
 * @returns {Promise<string[]>}  Their message IDs.
 */
function deathSaveRequests(session, uuid) {
  return session.eval(({ moduleId, uuid }) => game.messages.contents
    .filter(m => m.getFlag(moduleId, "deathSave")?.actor === uuid).map(m => m.id), { moduleId: MODULE_ID, uuid });
}

/**
 * Wait until an actor has this many death save requests, and return their IDs.
 * @param {import("./lib/session.mjs").Session} session
 * @param {string} uuid
 * @param {number} count
 * @returns {Promise<string[]>}
 */
async function waitForDeathSaveRequests(session, uuid, count) {
  await waitFor(session, ({ moduleId, uuid, count }) => game.messages.contents
    .filter(m => m.getFlag(moduleId, "deathSave")?.actor === uuid).length === count,
  { moduleId: MODULE_ID, uuid, count }, `${count} death save request(s) for ${uuid}`);
  return deathSaveRequests(session, uuid);
}

/**
 * Check that an actor still has this many death save requests a moment later, so none was posted late.
 * @param {import("./lib/session.mjs").Session} session
 * @param {string} uuid
 * @param {number} count
 * @param {string} what
 */
async function assertDeathSaveRequests(session, uuid, count, what) {
  await session.page.waitForTimeout(1000);
  assertEqual((await deathSaveRequests(session, uuid)).length, count, what);
}

/**
 * @param {import("./lib/session.mjs").Session} session
 * @returns {import("playwright").Locator}  The user's roll request pop-up.
 */
function popup(session) {
  return session.page.locator(".stt-request-popup.application");
}

/**
 * Wait for a user's pop-up to open, and return the actors in it.
 * @param {import("./lib/session.mjs").Session} session
 * @returns {Promise<string[]>}
 */
async function waitForPopup(session) {
  await popup(session).waitFor({ timeout: 10_000 }).catch(() => {
    throw new Error(`No roll request pop-up opened for ${session.user}.`);
  });
  return popup(session).locator(".stt-request-name").allTextContents();
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
 * An actor's death save state, as the GM sees it.
 * @param {import("./lib/session.mjs").Session} gm
 * @param {string} name
 * @returns {Promise<{ success: number, failure: number, stable: boolean|null }>}
 */
function deathState(gm, name) {
  return gm.eval(({ moduleId, name }) => {
    const actor = game.actors.getName(name);
    const { success, failure } = actor.system.attributes.death;
    return { success, failure, stable: actor.getFlag(moduleId, "stable") ?? null };
  }, { moduleId: MODULE_ID, name });
}

/* -------------------------------------------- */

test("death saves: the setting is off by default, and asks for nothing while off", async ({ gm, ids }) => {
  const setting = await gm.eval(moduleId => {
    const s = game.settings.settings.get(`${moduleId}.deathSavePrompt`);
    return { scope: s?.scope, default: s?.default, value: game.settings.get(moduleId, "deathSavePrompt") };
  }, MODULE_ID);
  assertEqual(setting, { scope: "world", default: false, value: false }, "the deathSavePrompt setting");
  await knockOut(gm, "Aria");
  await startCombat(gm, [["Aria", 10]]);
  await assertDeathSaveRequests(gm, ids.aria, 0, "death save requests with the setting off");
});

test("death saves: a dying character is asked on their turn, and the player rolls from the pop-up", async (ctx) => {
  const { gm, player, ids } = ctx;
  await setSetting(gm, player, "deathSavePrompt", true);
  await setSetting(gm, player, "popupPlayers", true);
  await knockOut(gm, "Aria");
  await startCombat(gm, [["Borin", 20], ["Aria", 10]]);
  await assertDeathSaveRequests(gm, ids.aria, 0, "death save requests on Borin's turn");

  await step(gm, "nextTurn");
  const [id] = await waitForDeathSaveRequests(gm, ids.aria, 1);
  for ( const session of [gm, player] ) {
    const card = await waitForCard(session, id, c => c.rows.length === 1, "the death save request card");
    assertEqual([card.title, card.subtitle], ["Death Save", "Standard Roll · DC 10"], `the card's header (${session.user})`);
  }
  assertEqual(await waitForPopup(player), ["Aria"], "the actors in the player's pop-up");

  await forceDice(player, [d20(14)]);
  await popup(player).locator(".stt-request-roll").click({ modifiers: await rollModifiers(player, id, "Aria", true) });
  const roll = await waitForRoll(gm, id, ids.aria);
  assertEqual([roll.type, roll.total], ["save", 14], "the death save's roll message");
  // The outcome is on the sheet as soon as it is rolled, so the player sees it without the GM showing it.
  const card = await waitForCard(player, id, c => c.rows[0].results.length, "Aria's result on the player's card");
  assertEqual(card.rows[0].classes, ["success"], "Aria's row, as the player sees it");
  assertEqual(card.rows[0].results, [{ text: "14", classes: ["success"] }], "Aria's result, as the player sees it");
  await waitFor(gm, () => game.actors.getName("Aria").system.attributes.death.success === 1, null, "Aria's first success");
  await waitForPopupToClose(player);
});

test("death saves: no one standing, stable, defeated, or an NPC not marked Important is asked", async (ctx) => {
  const { gm, player, ids } = ctx;
  await setSetting(gm, player, "deathSavePrompt", true);
  await knockOut(gm, "Aria", { [`flags.${MODULE_ID}.stable`]: true });
  await updateActor(gm, "Borin", { "system.attributes.hp.max": 10, "system.attributes.hp.value": 5 });
  await knockOut(gm, "Goblin");
  await startCombat(gm, [["Aria", 30], ["Borin", 20], ["Goblin", 10]]);
  await step(gm, "nextTurn");
  await step(gm, "nextTurn");
  for ( const [name, uuid] of [["Aria", ids.aria], ["Borin", ids.borin], ["Goblin", ids.goblin]] ) {
    await assertDeathSaveRequests(gm, uuid, 0, `death save requests for ${name}`);
  }

  // No longer stable, but defeated in the combat tracker.
  await updateActor(gm, "Aria", { [`flags.${MODULE_ID}.stable`]: false });
  await gm.eval(() => game.combat.combatants.find(c => c.actor.name === "Aria").update({ defeated: true }));
  await step(gm, "nextRound");
  await assertDeathSaveRequests(gm, ids.aria, 0, "death save requests for Aria, defeated");
});

test("death saves: an NPC marked Important is asked, in the GM's pop-up", async (ctx) => {
  const { gm, player, ids } = ctx;
  await setSetting(gm, player, "deathSavePrompt", true);
  await setSetting(gm, player, "popupGM", true);
  await knockOut(gm, "Goblin", { "system.traits.important": true });
  await startCombat(gm, [["Goblin", 10]]);
  await waitForDeathSaveRequests(gm, ids.goblin, 1);
  assertEqual(await waitForPopup(gm), ["Goblin"], "the actors in the GM's pop-up");
});

test("death saves: asked once a round, even if the turn is started again", async (ctx) => {
  const { gm, player, ids } = ctx;
  await setSetting(gm, player, "deathSavePrompt", true);
  await knockOut(gm, "Aria");
  await updateActor(gm, "Borin", { "system.attributes.hp.max": 10, "system.attributes.hp.value": 5 });
  await startCombat(gm, [["Aria", 20], ["Borin", 10]]);
  await waitForDeathSaveRequests(gm, ids.aria, 1);

  await step(gm, "nextTurn");
  await step(gm, "previousTurn");
  await assertDeathSaveRequests(gm, ids.aria, 1, "death save requests after going back to Aria's turn");

  await step(gm, "nextTurn");
  await step(gm, "nextTurn");
  await waitForDeathSaveRequests(gm, ids.aria, 2);
});

test("death saves: a character who stabilizes is not asked again until they take a failure", async (ctx) => {
  const { gm, player, ids } = ctx;
  await setSetting(gm, player, "deathSavePrompt", true);
  await knockOut(gm, "Aria", { "system.attributes.death.success": 2 });
  await startCombat(gm, [["Aria", 10]]);
  const [id] = await waitForDeathSaveRequests(gm, ids.aria, 1);

  await forceDice(player, [d20(15)]);
  await player.page.locator(`#chat .chat-log [data-message-id="${id}"] .stt-request-roll`)
    .click({ modifiers: await rollModifiers(player, id, "Aria", true) });
  await waitForRoll(gm, id, ids.aria);
  await waitFor(gm, moduleId => game.actors.getName("Aria").getFlag(moduleId, "stable") === true, MODULE_ID,
    "Aria to be noted as stable");
  // dnd5e clears the successes of a creature that stabilizes.
  assertEqual(await deathState(gm, "Aria"), { success: 0, failure: 0, stable: true }, "Aria, stable");

  await step(gm, "nextRound");
  await assertDeathSaveRequests(gm, ids.aria, 1, "death save requests for Aria, stable");

  // Hurt at 0 hit points, she takes a failure, and is dying again.
  await updateActor(gm, "Aria", { "system.attributes.death.failure": 1 });
  assertEqual(await deathState(gm, "Aria"), { success: 0, failure: 1, stable: false }, "Aria, dying again");
  await step(gm, "nextRound");
  await waitForDeathSaveRequests(gm, ids.aria, 2);
});

test("death saves: a request not yet rolled is removed when the character is healed", async (ctx) => {
  const { gm, player, ids } = ctx;
  await setSetting(gm, player, "deathSavePrompt", true);
  await setSetting(gm, player, "popupPlayers", true);
  await knockOut(gm, "Aria");
  await startCombat(gm, [["Aria", 10]]);
  const [id] = await waitForDeathSaveRequests(gm, ids.aria, 1);
  await waitForPopup(player);

  await updateActor(gm, "Aria", { "system.attributes.hp.value": 4 });
  await waitForDeathSaveRequests(gm, ids.aria, 0);
  await waitForPopupToClose(player);
  assert(!(await readCard(player, id)), "The player still sees the death save request card.");
});
