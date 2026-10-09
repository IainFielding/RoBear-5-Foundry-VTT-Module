/**
 * End-to-end tests for bonus rolls: a die rolled by another feature, added to or subtracted from a roll in chat
 * through the chat message's right-click menu.
 */

import { MODULE_ID } from "./config.mjs";
import {
  assert, assertEqual, clickRoll, forceDice, postRequest, test, waitFor, waitForCard, waitForRoll
} from "./lib/harness.mjs";

const d20 = n => [n, 20];
const d6 = n => [n, 6];
const row = (card, name) => card.rows.find(r => r.name === name);

/**
 * Give Borin a Bardic Inspiration feature, as dnd5e builds one: a utility activity that rolls 1d6.
 * @param {import("./lib/session.mjs").Session} gm
 */
function giveBardicInspiration(gm) {
  return gm.eval(async () => {
    const borin = game.actors.getName("Borin");
    if ( borin.items.getName("Bardic Inspiration") ) return;
    await borin.createEmbeddedDocuments("Item", [{
      name: "Bardic Inspiration",
      type: "feat",
      system: {
        activities: {
          bardicInspire001: {
            _id: "bardicInspire001", type: "utility", name: "Inspire",
            roll: { formula: "1d6", name: "Bardic Inspiration", prompt: false, visible: true }
          }
        }
      }
    }]);
  });
}

/**
 * Roll a bonus die in a user's browser and return its message's ID. The message is found by its flavor, since other
 * rolls made just before may still be reaching this user's chat.
 * @param {import("./lib/session.mjs").Session} session
 * @param {string} flavor  Text the bonus roll's flavor starts with.
 * @param {() => Promise<void>} fn  Makes the roll, in the page.
 */
async function rollBonus(session, flavor, fn) {
  await session.eval(fn);
  return waitFor(session, flavor => game.messages.contents.findLast(m => m.flavor?.startsWith(flavor))?.id ?? null,
    flavor, `the "${flavor}" roll`);
}

/**
 * Right-click a chat message and list the entries the menu offers.
 * @param {import("./lib/session.mjs").Session} session
 * @param {string} id
 * @returns {Promise<string[]>}
 */
async function contextEntries(session, id) {
  await session.page.locator(`#chat .chat-log li.chat-message[data-message-id="${id}"]`).click({ button: "right" });
  const menu = session.page.locator("#context-menu");
  await menu.waitFor({ timeout: 5000 });
  return (await menu.locator(".context-item").allTextContents()).map(t => t.trim());
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

/**
 * Add a bonus roll to, or subtract it from, a roll through the right-click menu and the roll chooser.
 * @param {import("./lib/session.mjs").Session} session
 * @param {string} id      The bonus roll's message.
 * @param {"Add to a roll…"|"Subtract from a roll…"} entry
 * @param {string} target  Text identifying the roll to change in the chooser.
 * @returns {Promise<string[]>}  Every roll the chooser offered.
 */
async function spendBonus(session, id, entry, target) {
  const entries = await contextEntries(session, id);
  assert(entries.includes(entry), `"${entry}" is not in the menu: ${entries.join(", ")}`);
  await session.page.locator("#context-menu .context-item", { hasText: entry }).click();
  const dialog = session.page.locator(".stt-bonus-dialog.application");
  await dialog.locator(".stt-bonus-choice").first().waitFor({ timeout: 5000 });
  const offered = (await dialog.locator(".stt-bonus-choice").allTextContents()).map(t => t.replace(/\s+/g, " ").trim());
  const choice = dialog.locator(".stt-bonus-choice", { hasText: target });
  assert(await choice.count(), `"${target}" was not offered. Offered: ${offered.join(" | ")}`);
  await choice.first().click();
  return offered;
}

/* -------------------------------------------- */

test("bonus rolls: a feature's die is added to a requested roll from the right-click menu", async (ctx) => {
  const { gm, player, ids } = ctx;
  await giveBardicInspiration(gm);
  const id = await postRequest(ctx, { mode: "standard", parts: [{ type: "skill", key: "ath", dc: 12 }], actors: [ids.aria] });
  await forceDice(player, [d20(9)]);
  await clickRoll(player, id, "Aria", { fastForward: true });
  const aria = await waitForRoll(gm, id, ids.aria);

  await forceDice(player, [d6(4)]);
  const bonus = await rollBonus(player, "Bardic Inspiration", async () => {
    await game.actors.getName("Borin").items.getName("Bardic Inspiration").system.activities.contents[0]
      .rollFormula({}, { configure: false });
  });
  const offered = await spendBonus(player, bonus, "Add to a roll…", "Aria");
  assertEqual(offered[0], "Aria · Strength (Athletics) Check · 9", "the newest roll offered first");

  const card = await waitForCard(gm, id, c => row(c, "Aria").results[0]?.text === "13", "the bonus on the request card");
  assertEqual(row(card, "Aria").results[0].classes, ["success"], "Aria's result after the bonus, for the GM");
  const notes = await gm.eval(({ aria, bonus, moduleId }) => ({
    target: game.messages.get(aria).getFlag(moduleId, "log").map(e => e.text),
    used: game.messages.get(bonus).getFlag(moduleId, "bonusUsed")
  }), { aria: aria.id, bonus, moduleId: MODULE_ID });
  assert(/^Bardic Inspiration.*: added 1d6 \(4\): 9 → 13$/.test(notes.target[0]), `the roll's note: ${notes.target[0]}`);
  assertEqual(notes.used, { target: "Aria · Strength (Athletics) Check", sign: 1 }, "the bonus roll marked as spent");

  // The note shows on the request card, and the spent bonus says where it went.
  await waitForCard(player, id, c => row(c, "Aria").results[0]?.text === "13", "the bonus, for the player");
  const rowNote = await player.page.locator(`#chat .chat-log [data-message-id="${id}"] .stt-request-details .stt-card-log`)
    .textContent();
  assert(rowNote.includes("added 1d6 (4): 9 → 13"), `the note on the request card: ${rowNote}`);
  const used = await player.page.locator(`#chat .chat-log li[data-message-id="${bonus}"] .stt-bonus-used`).textContent();
  assertEqual(used.trim(), "Added to Aria · Strength (Athletics) Check", "the note on the bonus roll");

  // A spent bonus cannot be spent again.
  await closeContextMenu(player);
  const entries = await contextEntries(player, bonus);
  assert(!entries.some(e => /to a roll|from a roll/.test(e)), `A spent bonus is still offered: ${entries.join(", ")}`);
}, { skip: { midi: "Midi-QOL runs a workflow for a plain roll and keeps its die on the feature's card; see the compatibility tests." } });

test("bonus rolls: a player subtracts from the GM's roll, and the GM applies it", async ({ gm, player }) => {
  await forceDice(gm, [d20(15)]);
  const goblin = await gm.eval(async () => {
    const before = new Set(game.messages.keys());
    await game.actors.getName("Goblin").rollSkill({ skill: "ath" }, { configure: false });
    return game.messages.contents.find(m => !before.has(m.id))?.id;
  });
  await waitFor(player, id => !!document.querySelector(`#chat .chat-log li[data-message-id="${id}"]`), goblin,
    "the Goblin's roll to reach the player");

  await forceDice(player, [d6(5)]);
  const bonus = await rollBonus(player, "Cutting Words", async () => {
    await new Roll("1d6").toMessage({
      flavor: "Cutting Words", speaker: ChatMessage.getSpeaker({ actor: game.actors.getName("Borin") })
    });
  });
  await spendBonus(player, bonus, "Subtract from a roll…", "Goblin");
  await player.page.locator("#notifications .notification", { hasText: "Sent to the GM" }).waitFor({ timeout: 5000 });

  const total = await waitFor(gm, ({ goblin, moduleId }) => {
    const m = game.messages.get(goblin);
    return m.getFlag(moduleId, "log")?.length ? m.rolls[0].total : null;
  }, { goblin, moduleId: MODULE_ID }, "the GM to apply the bonus");
  assertEqual(total, 10, "the Goblin's roll after Cutting Words");
  const log = await gm.eval(({ goblin, moduleId }) => game.messages.get(goblin).getFlag(moduleId, "log")[0].text,
    { goblin, moduleId: MODULE_ID });
  assertEqual(log, "Cutting Words: subtracted 1d6 (5): 15 → 10", "the note on the Goblin's roll");
  await waitFor(player, ({ bonus, moduleId }) => game.messages.get(bonus).getFlag(moduleId, "bonusUsed")?.sign === -1,
    { bonus, moduleId: MODULE_ID }, "the bonus to be marked as spent");
});

test("bonus rolls: a player can't spend someone else's die, even by asking the GM directly", async ({ gm, player }) => {
  await forceDice(gm, [d6(6)]);
  const bonus = await rollBonus(gm, "GM's Inspiration", async () => {
    await new Roll("1d6").toMessage({ flavor: "GM's Inspiration" });
  });
  await waitFor(player, id => !!document.querySelector(`#chat .chat-log li.chat-message[data-message-id="${id}"]`), bonus,
    "the GM's die to reach the player");
  await forceDice(player, [d20(8)]);
  const aria = await player.eval(async () => {
    const before = new Set(game.messages.keys());
    await game.actors.getName("Aria").rollSkill({ skill: "ath" }, { configure: false });
    return game.messages.contents.find(m => !before.has(m.id))?.id;
  });

  const entries = await contextEntries(player, bonus);
  assert(!entries.some(e => /to a roll|from a roll/.test(e)), `The GM's die is offered to the player: ${entries.join(", ")}`);
  await closeContextMenu(player);

  // The socket request the menu would have sent, made by hand.
  await player.eval(({ bonus, aria, moduleId }) => {
    game.socket.emit(`module.${moduleId}`, { action: "applyBonus", source: bonus, target: aria, sign: 1 });
  }, { bonus, aria, moduleId: MODULE_ID });
  // The GM refuses it, and says so.
  await player.page.locator("#notifications .notification", { hasText: "The GM couldn't apply your bonus roll" })
    .waitFor({ timeout: 5000 });
  const after = await gm.eval(({ bonus, aria, moduleId }) => ({
    used: game.messages.get(bonus).getFlag(moduleId, "bonusUsed") ?? null,
    total: game.messages.get(aria).rolls[0].total,
    log: game.messages.get(aria).getFlag(moduleId, "log") ?? null
  }), { bonus, aria, moduleId: MODULE_ID });
  assertEqual(after, { used: null, total: 8, log: null }, "the GM's die and Aria's roll after the forged request");
});

test("bonus rolls: a die is spent once, however quickly it is used twice", async ({ gm, player }) => {
  await forceDice(player, [d20(8), d20(9)]);
  const [first, second] = await player.eval(async () => {
    const ids = [];
    for ( const skill of ["ath", "acr"] ) {
      const before = new Set(game.messages.keys());
      await game.actors.getName("Aria").rollSkill({ skill }, { configure: false });
      ids.push(game.messages.contents.find(m => !before.has(m.id))?.id);
    }
    return ids;
  });
  await forceDice(player, [d6(3)]);
  const bonus = await rollBonus(player, "Song of Rest", async () => {
    await new Roll("1d6").toMessage({ flavor: "Song of Rest" });
  });
  await player.eval(async ({ bonus, first, second, moduleId }) => {
    const { applyBonus } = await import(`/modules/${moduleId}/scripts/bonus-rolls.mjs`);
    const [source, a, b] = [bonus, first, second].map(id => game.messages.get(id));
    await Promise.all([applyBonus(source, a, 1), applyBonus(source, b, 1)]);
  }, { bonus, first, second, moduleId: MODULE_ID });
  const totals = await gm.eval(ids => ids.map(id => game.messages.get(id).rolls[0].total), [first, second]);
  assertEqual(totals.filter((t, i) => t !== [8, 9][i]).length, 1, `rolls the die went on (totals ${totals.join(", ")})`);
});

test("bonus rolls: checks, saves and attacks are not offered as bonuses", async ({ player }) => {
  for ( const kind of ["skill", "save", "attack"] ) {
    await forceDice(player, [d20(8)]);
    const id = await player.eval(async kind => {
      const aria = game.actors.getName("Aria");
      const before = new Set(game.messages.keys());
      if ( kind === "skill" ) await aria.rollSkill({ skill: "ath" }, { configure: false });
      if ( kind === "save" ) await aria.rollSavingThrow({ ability: "dex" }, { configure: false });
      if ( kind === "attack" ) {
        await aria.items.getName("Dagger").system.activities.find(a => a.type === "attack").rollAttack({}, { configure: false });
      }
      await new Promise(r => setTimeout(r, 300));
      return game.messages.contents.find(m => !before.has(m.id) && m.rolls.length)?.id;
    }, kind);
    const entries = await contextEntries(player, id);
    assert(!entries.some(e => /to a roll|from a roll/.test(e)), `A ${kind} is offered as a bonus: ${entries.join(", ")}`);
    await closeContextMenu(player);
  }
});

test("bonus rolls: the chooser lists only rolls that can take a bonus, newest first", async ({ gm, player }) => {
  await forceDice(player, [d20(6), d20(11)]);
  await player.eval(async () => {
    await game.actors.getName("Aria").rollSkill({ skill: "ath" }, { configure: false });
    await game.actors.getName("Borin").rollSavingThrow({ ability: "wis" }, { configure: false });
  });
  await forceDice(player, [d6(2)]);
  const bonus = await rollBonus(player, "Inspiring Word", async () => {
    await new Roll("1d6").toMessage({ flavor: "Inspiring Word" });
  });
  const offered = await spendBonus(player, bonus, "Add to a roll…", "Borin");
  assertEqual(offered, ["Borin · Wisdom Saving Throw · 11", "Aria · Strength (Athletics) Check · 6"], "the rolls offered");
  const borin = await waitFor(gm, moduleId => {
    const m = game.messages.contents.find(m => m.getFlag(moduleId, "log")?.length);
    return m ? m.rolls[0].total : null;
  }, MODULE_ID, "the bonus on Borin's save");
  assertEqual(borin, 13, "Borin's save after the bonus");
});
