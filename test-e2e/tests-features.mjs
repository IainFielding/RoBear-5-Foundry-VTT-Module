/**
 * End-to-end tests for class features applied to rolls already in chat: Fighter's Indomitable, from dnd5e's own
 * compendiums under both sets of rules.
 */

import { MODULE_ID } from "./config.mjs";
import {
  assert, assertEqual, clickRoll, forceDice, postRequest, test, waitFor, waitForCard, waitForRoll
} from "./lib/harness.mjs";

const d20 = n => [n, 20];
const row = (card, name) => card.rows.find(r => r.name === name);

/**
 * Give Borin the 2024 Indomitable and nine Fighter levels, and Aria the 2014 Indomitable, each with two uses, from
 * dnd5e's compendiums.
 * @param {import("./lib/session.mjs").Session} gm
 */
function giveIndomitable(gm) {
  return gm.eval(async () => {
    const borin = game.actors.getName("Borin");
    const aria = game.actors.getName("Aria");
    for ( const actor of [borin, aria] ) {
      const old = actor.items.filter(i => (i.system.identifier === "indomitable") || (i.type === "class"));
      await actor.deleteEmbeddedDocuments("Item", old.map(i => i.id));
    }
    const from = async uuid => game.items.fromCompendium(await fromUuid(uuid));
    const fighter = (await game.packs.get("dnd5e.classes24").getDocuments({ name: "Fighter", type: "class" }))[0];
    const fighterData = game.items.fromCompendium(fighter);
    fighterData.system.levels = 9;
    const modern = await from("Compendium.dnd5e.classes24.Item.phbftrIndomitabl");
    const legacy = await from("Compendium.dnd5e.classfeatures.Item.653ZHbNcmm7ZGXbw");
    for ( const item of [modern, legacy] ) foundry.utils.setProperty(item, "system.uses", { max: "2", spent: 0 });
    await borin.createEmbeddedDocuments("Item", [fighterData, modern]);
    await aria.createEmbeddedDocuments("Item", [legacy]);
  });
}

/**
 * @param {import("./lib/session.mjs").Session} session
 * @param {string} name  The actor's name.
 * @returns {Promise<number>}  Uses of the actor's Indomitable left.
 */
function usesLeft(session, name) {
  return session.eval(name => game.actors.getName(name).items.find(i => i.system.identifier === "indomitable")
    .system.uses.value, name);
}

/**
 * Roll a Constitution saving throw against a DC in a user's browser, and return its message's ID.
 * @param {import("./lib/session.mjs").Session} session
 * @param {string} name
 * @param {number} dc
 */
async function save(session, name, dc) {
  return session.eval(async ({ name, dc }) => {
    const before = new Set(game.messages.keys());
    await game.actors.getName(name).rollSavingThrow({ ability: "con", target: dc }, { configure: false });
    await new Promise(r => setTimeout(r, 300));
    return game.messages.contents.find(m => !before.has(m.id) && m.rolls.length)?.id;
  }, { name, dc });
}

/**
 * @param {import("./lib/session.mjs").Session} session
 * @param {string} id
 * @returns {Promise<string[]>}  The right-click menu's entries for a chat message.
 */
async function contextEntries(session, id) {
  await session.page.locator(`#chat .chat-log li.chat-message[data-message-id="${id}"]`).click({ button: "right" });
  await session.page.locator("#context-menu").waitFor({ timeout: 5000 });
  return (await session.page.locator("#context-menu .context-item").allTextContents()).map(t => t.trim());
}

/**
 * Close the right-click menu by clicking an empty part of the screen. Escape would open Foundry's main menu instead.
 * @param {import("./lib/session.mjs").Session} session
 */
async function closeContextMenu(session) {
  await session.page.mouse.click(700, 200);
  await session.page.locator("#context-menu").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
}

/* -------------------------------------------- */

test("indomitable (2024): offered once the GM shows a failed requested save, and adds the Fighter level", async (ctx) => {
  const { gm, player, ids } = ctx;
  await giveIndomitable(gm);
  const id = await postRequest(ctx, { mode: "standard", parts: [{ type: "save", key: "con", dc: 15 }], actors: [ids.borin] });
  await forceDice(player, [d20(6)]);
  await clickRoll(player, id, "Borin", { fastForward: true });
  const roll = await waitForRoll(gm, id, ids.borin);

  const button = player.page.locator(`#chat .chat-log [data-message-id="${id}"] `
    + `li:has(.robear-request-name:text-is("Borin")) .robear-feature-button`);
  // Not until the GM shows the result: before then, offering it would tell the player they failed.
  await waitForCard(player, id, c => row(c, "Borin").results.length, "Borin's save");
  assertEqual(await button.count(), 0, "Use Indomitable buttons before the result is shown");
  assert(await gm.page.locator(`#chat .chat-log [data-message-id="${id}"] .robear-feature-button`).count(),
    "The GM is not offered Indomitable on Borin's failed save.");
  await gm.page.locator(`#chat .chat-log [data-message-id="${id}"] .robear-request-reveal`).click();
  await button.waitFor({ timeout: 5000 });
  assertEqual(await button.getAttribute("data-tooltip-text"), "Use Indomitable (2 left)", "the button's tooltip");
  await forceDice(player, [d20(8)]);
  await button.click();

  const card = await waitForCard(gm, id, c => row(c, "Borin").results[0]?.text === "17", "the reroll on the request card");
  assertEqual(row(card, "Borin").results[0].classes, ["success"], "Borin's save after Indomitable, for the GM");
  const log = await gm.eval(({ id, moduleId }) => game.messages.get(id).getFlag(moduleId, "log").map(e => e.text),
    { id: roll.id, moduleId: MODULE_ID });
  assertEqual(log, ["Indomitable: rerolled the d20 (6 → 8) + 9 (Fighter level): 6 → 17"], "the note on the save");
  assertEqual(await usesLeft(player, "Borin"), 1, "Indomitable uses left");
  await waitFor(player, id => !document.querySelector(`#chat .chat-log [data-message-id="${id}"] .robear-feature-button`),
    id, "the button to go once the save passes");
});

test("indomitable (2014): rerolls a failed save from the right-click menu, with no bonus", async ({ gm, player }) => {
  await giveIndomitable(gm);
  await forceDice(player, [d20(5)]);
  const id = await save(player, "Aria", 15);
  const entries = await contextEntries(player, id);
  assert(entries.includes("Use Indomitable"), `Use Indomitable is not in the menu: ${entries.join(", ")}`);
  await forceDice(player, [d20(12)]);
  await player.page.locator("#context-menu .context-item", { hasText: "Use Indomitable" }).click();
  const log = await waitFor(player, ({ id, moduleId }) => game.messages.get(id).getFlag(moduleId, "log")?.map(e => e.text),
    { id, moduleId: MODULE_ID }, "the reroll");
  assertEqual(log, ["Indomitable: rerolled the d20 (5 → 12): 5 → 12"], "the note on the save");
  assertEqual(await usesLeft(player, "Aria"), 1, "Indomitable uses left");
  // The save still failed, so Indomitable can be used again, from a button on the save itself.
  await player.page.locator(`#chat .chat-log li[data-message-id="${id}"] .robear-feature-button`)
    .waitFor({ timeout: 5000 });
});

// A natural 1 is fixed in RoBear-E, so the feature can't reroll one, though the save failed.
test("indomitable: not offered on a natural 1", async ({ gm, player }) => {
  await giveIndomitable(gm);
  await forceDice(player, [d20(1)]);
  const id = await save(player, "Aria", 15);
  assert(!(await contextEntries(player, id)).includes("Use Indomitable"), "Offered on a natural 1.");
  await closeContextMenu(player);
  assertEqual(await player.page.locator(`#chat .chat-log li[data-message-id="${id}"] .robear-feature-button`).count(), 0,
    "Use Indomitable buttons on a natural 1");
});

test("indomitable: offered only on a failed save, with uses left", async ({ gm, player }) => {
  await giveIndomitable(gm);
  await forceDice(player, [d20(16)]);
  const passed = await save(player, "Borin", 15);
  assert(!(await contextEntries(player, passed)).includes("Use Indomitable"), "Offered on a passed save.");
  await closeContextMenu(player);

  await forceDice(player, [d20(4)]);
  const check = await player.eval(async () => {
    const before = new Set(game.messages.keys());
    await game.actors.getName("Borin").rollSkill({ skill: "ath", target: 15 }, { configure: false });
    await new Promise(r => setTimeout(r, 300));
    return game.messages.contents.find(m => !before.has(m.id))?.id;
  });
  assert(!(await contextEntries(player, check)).includes("Use Indomitable"), "Offered on a failed check.");
  await closeContextMenu(player);

  await gm.eval(() => game.actors.getName("Borin").items.find(i => i.system.identifier === "indomitable")
    .update({ "system.uses.spent": 2 }));
  await waitFor(player, () => game.actors.getName("Borin").items.find(i => i.system.identifier === "indomitable")
    .system.uses.value === 0, null, "the spent uses to reach the player");
  await forceDice(player, [d20(4)]);
  const spent = await save(player, "Borin", 15);
  assert(!(await contextEntries(player, spent)).includes("Use Indomitable"), "Offered with no uses left.");
  await closeContextMenu(player);
  assertEqual(await player.page.locator(`#chat .chat-log li[data-message-id="${spent}"] .robear-feature-button`).count(), 0,
    "Use Indomitable buttons with no uses left");
});
