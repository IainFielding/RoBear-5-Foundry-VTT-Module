/**
 * End-to-end tests for playing RoBear-E Cards on rolls already in chat, and from the character sheet.
 *
 * Rolls are made in the player's browser through dnd5e's own roll methods, fast-forwarded, so the player is
 * the author as they would be at the table. Cards are then played through the real chat button and chooser.
 */

import { MODULE_ID } from "./config.mjs";
import { assert, assertEqual, clickRoll, forceDice, postRequest, test, waitFor, waitForCard } from "./lib/harness.mjs";

const athletics = dc => ({ type: "skill", key: "ath", dc });

const d20 = n => [n, 20];

/**
 * Make a roll in a user's browser and return its chat message's ID.
 * @param {import("./lib/session.mjs").Session} session
 * @param {string} actor   The actor's name.
 * @param {string} kind    "skill", "save", "death", "attack", "damage" or "initiative".
 * @param {object} [options]
 * @param {object} [options.config]  Extra roll configuration, e.g. `{ target: 15 }` or `{ disadvantage: true }`.
 * @returns {Promise<string>}
 */
async function roll(session, actor, kind, { config = {} } = {}) {
  const id = await session.eval(async ({ actor: name, kind, config }) => {
    const actor = game.actors.getName(name);
    const before = new Set(game.messages.keys());
    const fast = { configure: false };
    const attack = () => actor.items.getName("Dagger").system.activities.find(a => a.type === "attack");
    switch ( kind ) {
      case "skill": await actor.rollSkill({ skill: "ath", ...config }, fast); break;
      case "save": await actor.rollSavingThrow({ ability: "wis", ...config }, fast); break;
      case "death": await actor.rollDeathSave({ ...config }, fast); break;
      case "attack": await attack().rollAttack({ ...config }, fast); break;
      case "damage": await attack().rollDamage({ ...config }, fast); break;
      case "initiative": await game.combat.rollInitiative(game.combat.combatants.map(c => c.id)); break;
    }
    await new Promise(r => setTimeout(r, 300));
    return game.messages.contents.find(m => !before.has(m.id) && m.rolls.length)?.id ?? null;
  }, { actor, kind, config });
  assert(id, `No ${kind} roll message was created for ${actor}.`);
  return id;
}

/**
 * The card button for a roll message, where the user sees it: on the message, or on its summary inside the
 * activity card that made it.
 * @param {import("./lib/session.mjs").Session} session
 * @param {string} id
 */
function cardButton(session, id) {
  return session.page.locator(`#chat .chat-log [data-message-id="${id}"] .robear-card-button:visible`);
}

/**
 * Open the card chooser for a roll and list what it offers. Plays `card` if given, otherwise cancels.
 * @param {import("./lib/session.mjs").Session} session
 * @param {string} id
 * @param {string} [card]
 * @returns {Promise<string[]>}  The cards offered, or an empty list if there was no card button.
 */
async function cardsOffered(session, id, card) {
  const button = cardButton(session, id);
  await session.page.waitForTimeout(300);
  if ( !(await button.count()) ) return [];
  await button.first().click();
  const dialog = session.page.locator(".robear-card-dialog.application").last();
  await dialog.locator(".robear-card-choice").first().waitFor({ timeout: 10_000 });
  const offered = (await dialog.locator(".robear-card-choice span").allTextContents()).map(t => t.trim());
  if ( card ) {
    const choice = dialog.locator(".robear-card-choice", { hasText: card });
    assert(await choice.count(), `${card} was not offered. Offered: ${offered.join(", ")}`);
    await choice.first().click();
  } else {
    await dialog.locator('button[data-action="cancel"]').click();
  }
  return offered;
}

/**
 * Wait for a roll message to record a card, and return its new total, its card notes, and its rolls' state.
 * @param {import("./lib/session.mjs").Session} session
 * @param {string} id
 * @param {number} [notes=1]  How many card notes to wait for.
 */
function afterCard(session, id, notes = 1) {
  return waitFor(session, ({ id, notes, moduleId }) => {
    const message = game.messages.get(id);
    const log = message?.getFlag(moduleId, "log") ?? [];
    if ( log.length < notes ) return null;
    const r = message.rolls[0];
    return {
      total: message.rolls.reduce((t, roll) => t + roll.total, 0), log: log.map(e => e.text ?? e),
      advantage: r.hasAdvantage ?? null, disadvantage: r.hasDisadvantage ?? null
    };
  }, { id, notes, moduleId: MODULE_ID }, "the card to be recorded on the roll");
}

/**
 * @param {import("./lib/session.mjs").Session} session
 * @param {string} card  The card activity's name.
 * @returns {Promise<number>}  Uses of the card left.
 */
function usesLeft(session, card) {
  return session.eval(card => game.actors.getName("Aria").items.getName("RoBear-E Cards").system.activities
    .getName(card).uses.value, card);
}

/* -------------------------------------------- */
/*  Who Can Play Cards                          */
/* -------------------------------------------- */

test("cards: offered on the player's own roll, and not on rolls by someone without cards", async ({ gm, player }) => {
  await forceDice(player, [d20(5)]);
  const aria = await roll(player, "Aria", "skill");
  assert(await cardButton(player, aria).count(), "Aria's check has no card button for the player.");
  assert(await cardButton(gm, aria).count(), "The GM cannot play Aria's card on her check.");

  await forceDice(player, [d20(5)]);
  const borin = await roll(player, "Borin", "skill");
  assertEqual(await cardButton(player, borin).count(), 0, "card buttons on Borin's check, who has no cards");

  await forceDice(gm, [d20(5)]);
  const goblin = await roll(gm, "Goblin", "skill");
  assertEqual(await cardButton(player, goblin).count(), 0, "card buttons for the player on the GM's roll");
});

test("cards: a double click opens one card chooser, so only one card is spent", async ({ player }) => {
  await forceDice(player, [d20(5)]);
  const id = await roll(player, "Aria", "skill");
  const before = await usesLeft(player, "Luck");
  // Both clicks land before the chooser opens, as a quick double click's would.
  await cardButton(player, id).first().evaluate(button => {
    button.click();
    button.click();
  });
  await player.page.waitForTimeout(500);
  const choosers = player.page.locator(".robear-card-dialog.application:has(.robear-card-choice)");
  assertEqual(await choosers.count(), 1, "card choosers open");

  await forceDice(player, [d20(14)]);
  await choosers.locator(".robear-card-choice", { hasText: "Luck" }).first().click();
  const after = await afterCard(player, id);
  assertEqual(after.log.length, 1, "cards noted on the roll");
  assertEqual(await usesLeft(player, "Luck"), before - 1, "Luck uses left");
});

test("cards: none on a death saving throw", async ({ player }) => {
  await forceDice(player, [d20(5)]);
  const id = await roll(player, "Aria", "death");
  assertEqual(await cardButton(player, id).count(), 0, "card buttons on a death save");
});

/* -------------------------------------------- */
/*  Inspiration                                 */
/* -------------------------------------------- */

test("inspiration: adds its die to the check, and is spent", async ({ player }) => {
  await forceDice(player, [d20(5)]);
  const id = await roll(player, "Aria", "skill");
  await forceDice(player, [[4, 6]]);
  const offered = await cardsOffered(player, id, "Inspiration + 1d6");
  for ( const card of ["Inspiration + 1d6", "Inspiration + 1d8", "Inspiration + 1d10", "Luck", "Advantage"] ) {
    assert(offered.includes(card), `${card} was not offered on a check. Offered: ${offered.join(", ")}`);
  }
  for ( const card of ["Indomitable", "Relentless"] ) {
    assert(!offered.includes(card), `${card} was offered on a check.`);
  }
  const result = await afterCard(player, id);
  assertEqual(result.total, 9, "total after Inspiration");
  assertEqual(result.log, ["Inspiration + 1d6: added 1d6 (4): 5 + 4 = 9"], "the card's note");
  assertEqual(await usesLeft(player, "Inspiration - 1d6"), 0, "Inspiration + 1d6 uses left");

  const again = await cardsOffered(player, id);
  assert(!again.includes("Inspiration + 1d6"), "A spent card was offered again.");
});

/* -------------------------------------------- */
/*  Luck                                        */
/* -------------------------------------------- */

// Dice So Nice takes a die's appearance from the speaker's actor, so the card's dice must carry the roll's speaker.
// A stand-in records the call: the e2e world doesn't run Dice So Nice.
test("dice so nice: a card's dice are shown with the roll's speaker and message", async ({ player }) => {
  await player.eval(() => {
    window.dsnCalls = [];
    game.dice3d = { showForRoll: async (...args) => { window.dsnCalls.push(args); return true; } };
  });
  try {
    await forceDice(player, [d20(5)]);
    const id = await roll(player, "Aria", "skill");
    await forceDice(player, [d20(13)]);
    await cardsOffered(player, id, "Luck");
    await afterCard(player, id);
    const calls = await player.eval(id => window.dsnCalls.map(([roll, user, , , , messageId, speaker]) => ({
      formula: roll.formula, user: user.id === game.user.id, messageId, actor: speaker?.actor,
      expected: game.messages.get(id).speaker.actor
    })), id);
    assertEqual(calls.length, 1, "Dice So Nice calls");
    const [call] = calls;
    assertEqual([call.formula, call.user, call.messageId, call.actor], ["1d20", true, id, call.expected],
      "the dice shown: formula, user, message and speaker's actor");
    assert(call.expected, "The roll has no speaker actor to compare with.");
  } finally {
    await player.eval(() => { delete game.dice3d; delete window.dsnCalls; });
  }
});

test("luck: rerolls the d20 of a check, and the new result stands", async ({ player }) => {
  await forceDice(player, [d20(5)]);
  const id = await roll(player, "Aria", "skill");
  await forceDice(player, [d20(3)]);
  await cardsOffered(player, id, "Luck");
  const result = await afterCard(player, id);
  assertEqual(result.total, 3, "total after Luck, even though it is lower");
  assertEqual(result.log, ["Luck: rerolled the d20 (5 → 3): 5 → 3"], "the card's note");
});

/**
 * Turn the "Natural 1s and 20s lock RoBear-E Cards" setting on or off, and wait for the player to see it.
 * @param {import("./lib/session.mjs").Session} gm
 * @param {import("./lib/session.mjs").Session} player
 * @param {boolean} value
 */
async function setLockNaturals(gm, player, value) {
  await gm.eval(({ moduleId, value }) => game.settings.set(moduleId, "lockNaturals", value), { moduleId: MODULE_ID, value });
  await waitFor(player, ({ moduleId, value }) => game.settings.get(moduleId, "lockNaturals") === value,
    { moduleId: MODULE_ID, value }, "the setting to reach the player");
}

test("natural 1s and 20s: by default no card can be played on them", async ({ gm, player }) => {
  const setting = await gm.eval(moduleId => {
    const s = game.settings.settings.get(`${moduleId}.lockNaturals`);
    return { config: s?.config, scope: s?.scope, default: s?.default, value: game.settings.get(moduleId, "lockNaturals") };
  }, MODULE_ID);
  assertEqual(setting, { config: true, scope: "world", default: true, value: true }, "the setting");

  for ( const natural of [1, 20] ) {
    await forceDice(player, [d20(natural)]);
    const id = await roll(player, "Aria", "skill");
    assertEqual(await cardButton(player, id).count(), 0, `card buttons on a natural ${natural}`);
  }
  // Any other d20 keeps its cards, and so do rolls with no d20 at all.
  await forceDice(player, [d20(2)]);
  assert(await cardButton(player, await roll(player, "Aria", "skill")).count(), "No card button on a natural 2.");
  await forceDice(player, [[1, 4]]);
  assert(await cardButton(player, await roll(player, "Aria", "damage")).count(), "No card button on damage.");
});

test("natural 1s and 20s: the lock applies on a request card too", async (ctx) => {
  const { player, ids } = ctx;
  const id = await postRequest(ctx, { mode: "standard", parts: [athletics(12)], actors: [ids.aria] });
  await forceDice(player, [d20(20)]);
  await clickRoll(player, id, "Aria", { fastForward: true });
  const card = await waitForCard(player, id, c => c.rows[0].results.length, "Aria's natural 20");
  assertEqual(card.rows[0].cardButton, false, "a card button beside a natural 20");
});

test("natural 1s and 20s: the total is ringed, in red or gold, and no other roll's is", async ({ player }) => {
  for ( const [natural, kind] of [[20, "save"], [20, "skill"], [1, "save"], [1, "skill"], [19, "save"], [2, "save"]] ) {
    await forceDice(player, [d20(natural)]);
    const id = await roll(player, "Aria", kind);
    const dice = player.page.locator(`#chat .chat-log [data-message-id="${id}"] .message-content .dice-roll`);
    await dice.waitFor({ timeout: 5000 });
    const marks = await dice.evaluate(el => [1, 20].filter(n => el.matches(`.robear-natural-${n}, :has(.robear-natural-${n})`)));
    assertEqual(marks, [1, 20].includes(natural) ? [natural] : [], `ring on a ${kind} showing a natural ${natural}`);
  }
});

// Luck is never playable on a natural 1 or 20. With the lock off, the other cards are.
test("luck: never offered on a natural 1 or 20, even with the lock setting off", async ({ gm, player }) => {
  await setLockNaturals(gm, player, false);
  for ( const natural of [1, 20] ) {
    await forceDice(player, [d20(natural)]);
    const id = await roll(player, "Aria", "skill");
    const offered = await cardsOffered(player, id);
    assert(!offered.includes("Luck"), `Luck was offered on a natural ${natural}.`);
    assert(offered.includes("Advantage"), `Advantage was not offered on a natural ${natural}.`);
  }
});

test("luck: rerolls every damage die", async ({ player }) => {
  await forceDice(player, [[1, 4]]);
  const id = await roll(player, "Aria", "damage");
  await forceDice(player, [[4, 4]]);
  const offered = await cardsOffered(player, id, "Luck");
  assert(!offered.includes("Advantage"), "Advantage was offered on damage.");
  const result = await afterCard(player, id);
  assert(result.log[0].startsWith("Luck: rerolled damage dice:"), `the card's note: ${result.log[0]}`);
  assertEqual(result.total - (await player.eval(id => game.messages.get(id).rolls[0].total, id)), 0, "damage recomputed");
  const [before, after] = result.log[0].match(/(\d+) → (\d+)/).slice(1).map(Number);
  assertEqual(after - before, 3, "damage after rerolling a 1 into a 4");
});

/* -------------------------------------------- */
/*  Advantage                                   */
/* -------------------------------------------- */

test("advantage: rolls a second d20 on a check and keeps the higher", async ({ player }) => {
  await forceDice(player, [d20(5)]);
  const id = await roll(player, "Aria", "skill");
  await forceDice(player, [d20(14)]);
  await cardsOffered(player, id, "Advantage");
  const result = await afterCard(player, id);
  assertEqual([result.total, result.advantage], [14, true], "total and mode after Advantage");
  assertEqual(result.log, ["Advantage: rolled with advantage (5 and 14): 5 → 14"], "the card's note");
});

test("advantage: on an attack roll, the higher d20 counts", async ({ player }) => {
  await forceDice(player, [d20(3)]);
  const id = await roll(player, "Aria", "attack");
  const before = await player.eval(id => game.messages.get(id).rolls[0].total, id);
  await forceDice(player, [d20(17)]);
  await cardsOffered(player, id, "Advantage");
  const result = await afterCard(player, id);
  assertEqual(result.total - before, 14, "attack total gained by keeping 17 over 3");
});

test("advantage: cancels disadvantage, leaving a straight roll of the first d20", async ({ player }) => {
  await forceDice(player, [d20(15), d20(3)]);
  const id = await roll(player, "Aria", "skill", { config: { disadvantage: true } });
  assertEqual(await player.eval(id => game.messages.get(id).rolls[0].total, id), 3, "total with disadvantage");
  await cardsOffered(player, id, "Advantage");
  const result = await afterCard(player, id);
  assertEqual([result.total, result.disadvantage], [15, false], "total and mode once cancelled");
  assertEqual(result.log, ["Advantage: cancelled disadvantage: 3 → 15"], "the card's note");
});

test("advantage: not offered on a roll that already has advantage", async ({ player }) => {
  await forceDice(player, [d20(4), d20(9)]);
  const id = await roll(player, "Aria", "skill", { config: { advantage: true } });
  const offered = await cardsOffered(player, id);
  assert(!offered.includes("Advantage"), "Advantage was offered on a roll with advantage.");
});

/* -------------------------------------------- */
/*  Indomitable                                 */
/* -------------------------------------------- */

test("indomitable: rerolls a failed saving throw only", async ({ player }) => {
  await forceDice(player, [d20(16)]);
  const passed = await roll(player, "Aria", "save", { config: { target: 15 } });
  assert(!(await cardsOffered(player, passed)).includes("Indomitable"), "Indomitable was offered on a passed save.");

  await forceDice(player, [d20(5)]);
  const failed = await roll(player, "Aria", "save", { config: { target: 15 } });
  await forceDice(player, [d20(18)]);
  await cardsOffered(player, failed, "Indomitable");
  const result = await afterCard(player, failed);
  assertEqual(result.total, 18, "save after Indomitable");
  assertEqual(await player.eval(id => game.messages.get(id).rolls[0].isSuccess, failed), true, "the save now passes");
});

// A natural 1 is fixed: with the lock off, cards that add to the roll can be played on it, but nothing rerolls it.
test("natural 1s: nothing rerolls one, even with the lock setting off", async ({ gm, player }) => {
  await setLockNaturals(gm, player, false);
  await forceDice(player, [d20(1)]);
  const save = await roll(player, "Aria", "save", { config: { target: 15 } });
  const offered = await cardsOffered(player, save);
  assert(offered.includes("Advantage"), `Advantage was not offered on a natural 1 save: ${offered.join(", ")}`);
  for ( const card of ["Luck", "Indomitable"] ) assert(!offered.includes(card), `${card} was offered on a natural 1 save.`);

  await startCombat(gm, 1);
  await waitFor(player, () => !!game.combat?.combatants.size, null, "the combat to reach the player");
  await forceDice(player, [d20(1)]);
  const initiative = await roll(player, "Aria", "initiative");
  assert(!(await cardsOffered(player, initiative)).includes("Relentless"), "Relentless was offered on a natural 1.");
});

// The natural 1s and 20s lock keeps Indomitable off a natural 1 too, with or without a DC.
test("indomitable: locked on a natural 1 save, as the other cards are", async ({ player }) => {
  for ( const config of [{ target: 15 }, {}] ) {
    await forceDice(player, [d20(1)]);
    const id = await roll(player, "Aria", "save", { config });
    assertEqual(await cardButton(player, id).count(), 0, `card buttons on a natural 1 save (DC ${config.target ?? "none"})`);
  }
});

/* -------------------------------------------- */
/*  Relentless                                  */
/* -------------------------------------------- */

/**
 * Start a combat with Aria in it, as the GM.
 * @param {import("./lib/session.mjs").Session} gm
 * @param {number} round
 */
function startCombat(gm, round) {
  return gm.eval(async round => {
    const combat = await Combat.create({ active: true, round });
    await combat.createEmbeddedDocuments("Combatant", [{ actorId: game.actors.getName("Aria").id }]);
    await combat.activate();
  }, round);
}

test("relentless: rerolls initiative in the first round and updates the tracker", async ({ gm, player }) => {
  await startCombat(gm, 1);
  await waitFor(player, () => !!game.combat?.combatants.size, null, "the combat to reach the player");
  await forceDice(player, [d20(3)]);
  const id = await roll(player, "Aria", "initiative");
  await forceDice(player, [d20(19)]);
  const offered = await cardsOffered(player, id, "Relentless");
  assert(!offered.includes("Indomitable"), "Indomitable was offered on initiative.");
  const result = await afterCard(player, id);
  const initiative = await waitFor(gm, total => {
    const value = game.combat.combatants.contents[0].initiative;
    return value === total ? value : null;
  }, result.total, "the tracker to show the new initiative");
  assertEqual(initiative, result.total, "combatant initiative");
  assert(result.log[0].startsWith("Relentless: rerolled the d20 (3 → 19)"), `the card's note: ${result.log[0]}`);
});

test("relentless: a lower reroll keeps the initiative it had", async ({ gm, player }) => {
  await startCombat(gm, 1);
  await waitFor(player, () => !!game.combat?.combatants.size, null, "the combat to reach the player");
  await forceDice(player, [d20(15)]);
  const id = await roll(player, "Aria", "initiative");
  const before = await player.eval(id => game.messages.get(id).rolls[0].total, id);
  const uses = await usesLeft(player, "Relentless");
  await forceDice(player, [d20(4)]);
  await cardsOffered(player, id, "Relentless");
  const result = await afterCard(player, id);
  assertEqual(result.total, before, "initiative after a lower reroll");
  assertEqual(result.log, [`Relentless: rerolled the d20 (15 → 4): ${before} or ${before - 11}, keeping ${before}`],
    "the card's note");
  assertEqual(await usesLeft(player, "Relentless"), uses - 1, "Relentless uses left, spent even though the reroll was lower");
});

test("relentless: not offered after the first round", async ({ gm, player }) => {
  await startCombat(gm, 2);
  await waitFor(player, () => game.combat?.round === 2, null, "round 2 to reach the player");
  await forceDice(player, [d20(3)]);
  const id = await roll(player, "Aria", "initiative");
  assert(!(await cardsOffered(player, id)).includes("Relentless"), "Relentless was offered in round 2.");
});

/* -------------------------------------------- */
/*  The Card Window on the Sheet                */
/* -------------------------------------------- */

/**
 * Use the RoBear-E Cards feature as the player, as clicking it on the sheet does.
 * @param {import("./lib/session.mjs").Session} player
 * @param {object} [event]  Modifier keys held.
 */
function useFeature(player, event = {}) {
  return player.eval(event => {
    game.actors.getName("Aria").items.getName("RoBear-E Cards").use({ event });
  }, event);
}

test("sheet: the card window shows every card left, with its art", async ({ player }) => {
  await useFeature(player);
  const dialog = player.page.locator(".robear-card-dialog.application").last();
  await dialog.locator(".robear-card-choice").first().waitFor({ timeout: 10_000 });
  const cards = await dialog.locator(".robear-card-choice").evaluateAll(els => els.map(el => ({
    label: el.querySelector("span").textContent.trim(), img: el.querySelector("img").getAttribute("src")
  })));
  assertEqual(cards.length, 12, "cards shown");
  for ( const { label, img } of cards ) {
    assert(img.startsWith("modules/sogrom-robear-e/assets/images/"), `${label} shows ${img} rather than its card art.`);
  }
  const broken = await dialog.locator(".robear-card-choice img").evaluateAll(imgs => imgs
    .filter(i => !i.complete || !i.naturalWidth).map(i => i.getAttribute("src")));
  assertEqual(broken, [], "card art that failed to load");
  await dialog.locator('button[data-action="cancel"]').click();
});

test("sheet: Advantage gives advantage on the next d20 roll, once", async ({ player }) => {
  await useFeature(player);
  const dialog = player.page.locator(".robear-card-dialog.application").last();
  await dialog.locator(".robear-card-choice", { hasText: "Advantage" }).click();
  // dnd5e then asks to confirm spending the card's use, as it does for any activity used from the sheet.
  await player.page.locator(".application.activity-usage button", { hasText: "Use Ability" }).click();
  await waitFor(player, () => game.actors.getName("Aria").getFlag("sogrom-robear-e", "advantage"), null,
    "the pending Advantage flag");
  assertEqual(await usesLeft(player, "Advantage"), 0, "Advantage uses left");

  await forceDice(player, [d20(4), d20(17)]);
  const first = await roll(player, "Aria", "skill");
  assertEqual(await player.eval(id => {
    const r = game.messages.get(id).rolls[0];
    return [r.hasAdvantage, r.total];
  }, first), [true, 17], "the next check");
  await waitFor(player, () => !game.actors.getName("Aria").getFlag("sogrom-robear-e", "advantage"), null,
    "the pending Advantage to clear");

  await forceDice(player, [d20(4)]);
  const second = await roll(player, "Aria", "skill");
  assertEqual(await player.eval(id => game.messages.get(id).rolls[0].hasAdvantage, second), false, "the check after");
});

test("sheet: a warning when every card is spent", async ({ gm, player }) => {
  await gm.eval(async () => {
    const item = game.actors.getName("Aria").items.getName("RoBear-E Cards");
    await item.update(Object.fromEntries(item.system.activities.map(a => [`system.activities.${a.id}.uses.spent`, 1])));
  });
  await waitFor(player, () => game.actors.getName("Aria").items.getName("RoBear-E Cards").system.activities
    .every(a => !a.uses.value), null, "the spent cards to reach the player");
  await useFeature(player);
  await player.page.locator("#notifications .notification", { hasText: "You have no RoBear-E Cards left" })
    .waitFor({ timeout: 5000 }).catch(() => { throw new Error("No warning that every card is spent."); });
  assertEqual(await player.page.locator(".robear-card-dialog.application").count(), 0, "card windows opened");
});

test("sheet: shift-click uses dnd5e's own activity list instead", async ({ player }) => {
  await useFeature(player, { shiftKey: true });
  await player.page.waitForTimeout(1500);
  assertEqual(await player.page.locator(".robear-card-dialog.application").count(), 0, "RoBear-E card windows");
  const apps = await player.eval(() => [...foundry.applications.instances.values()].filter(a => a.rendered)
    .map(a => a.constructor.name));
  assert(apps.some(n => /Activit/i.test(n)), `dnd5e's activity list did not open. Open: ${apps.join(", ")}`);
});

/* -------------------------------------------- */
/*  Showing a Played Card                       */
/* -------------------------------------------- */

/**
 * @param {import("./lib/session.mjs").Session} session
 * @returns {Promise<object|null>}  The played card on the user's screen, if one is showing.
 */
function playedCardOnScreen(session) {
  return session.eval(() => {
    const el = document.getElementById("robear-played-card");
    if ( !el ) return null;
    return {
      img: el.querySelector("img")?.getAttribute("src"),
      by: el.querySelector(".robear-played-card-by")?.textContent.trim(),
      name: el.querySelector(".robear-played-card-name")?.textContent.trim()
    };
  });
}

test("played cards: shown on everyone's screen, with no chat card pushing the roll up", async ({ gm, player }) => {
  const setting = await gm.eval(moduleId => {
    const s = game.settings.settings.get(`${moduleId}.showPlayedCards`);
    return { config: s?.config, scope: s?.scope, default: s?.default };
  }, MODULE_ID);
  assertEqual(setting, { config: true, scope: "world", default: true }, "the setting");

  await forceDice(player, [d20(5)]);
  const id = await roll(player, "Aria", "skill");
  const before = await gm.eval(() => game.messages.size);
  await forceDice(player, [d20(14)]);
  await cardsOffered(player, id, "Luck");
  await afterCard(player, id);

  for ( const session of [gm, player] ) {
    const shown = await waitFor(session, () => {
      const el = document.getElementById("robear-played-card");
      return el ? true : null;
    }, null, `the played card on ${session.user}'s screen`, 3000);
    assert(shown, "No played card.");
    assertEqual(await playedCardOnScreen(session), {
      img: "modules/sogrom-robear-e/assets/images/luckdc20.webp", by: "Aria plays", name: "Luck"
    }, `the played card (${session.user})`);
  }
  assertEqual(await gm.eval(() => game.messages.size), before, "chat messages after playing the card");
  assertEqual(await usesLeft(player, "Luck"), 0, "Luck uses left, spent without a chat card");

  await waitFor(player, () => !document.getElementById("robear-played-card"), null, "the played card to go", 6000);
});

test("played cards: clicking the card dismisses it early", async ({ player }) => {
  await forceDice(player, [d20(5)]);
  const id = await roll(player, "Aria", "skill");
  await forceDice(player, [d20(14)]);
  await cardsOffered(player, id, "Advantage");
  await player.page.locator("#robear-played-card img").click({ timeout: 3000 });
  await waitFor(player, () => !document.getElementById("robear-played-card"), null, "the played card to go", 1500);
});

test("played cards: up to three played together show side by side, and the rest wait their turn", async ({ gm, player }) => {
  const cards = ["Luck", "Advantage", "Charger", "Relentless"];
  const ids = await gm.eval(async n => {
    const messages = await ChatMessage.create(Array.from({ length: n }, (_, i) => ({ content: `Roll ${i}` })));
    return messages.map(m => m.id);
  }, cards.length);
  await waitFor(player, ids => ids.every(id => game.messages.has(id)), ids, "the messages to reach the player");
  // Every card is played at once, as players acting together would.
  await gm.eval(({ ids, cards, moduleId }) => Promise.all(ids.map((id, i) => game.messages.get(id).setFlag(moduleId, "log",
    [{ text: `${cards[i]}: played`, card: cards[i], img: `modules/${moduleId}/assets/images/luckdc20.webp`, by: "Aria" }]
  ))), { ids, cards, moduleId: MODULE_ID });

  // The updates may arrive in any order, so which card waits is whichever one was not shown first.
  let first;
  for ( const session of [gm, player] ) {
    await waitFor(session, () => document.querySelectorAll("#robear-played-card .robear-played-card-entry").length === 3,
      null, `three cards on ${session.user}'s screen`, 3000);
    await session.page.waitForTimeout(300);
    const shown = await session.eval(() => [...document.querySelectorAll("#robear-played-card .robear-played-card-entry")]
      .map(el => ({
        name: el.querySelector(".robear-played-card-name").textContent,
        top: Math.round(el.querySelector("img").getBoundingClientRect().top)
      })));
    assertEqual(shown.length, 3, `cards on ${session.user}'s screen, with one waiting`);
    assert(shown.every(c => cards.includes(c.name)), `Unexpected cards shown: ${shown.map(c => c.name).join(", ")}`);
    assertEqual(new Set(shown.map(c => c.top)).size, 1, `rows the cards sit in (${session.user})`);
    if ( session === player ) first = shown.map(c => c.name);
  }

  // Once the first three go, the fourth gets its turn.
  const waiting = cards.find(c => !first.includes(c));
  await waitFor(player, waiting => {
    const names = [...document.querySelectorAll("#robear-played-card .robear-played-card-entry:not(.leaving)")]
      .map(el => el.querySelector(".robear-played-card-name").textContent);
    return (names.length === 1) && (names[0] === waiting);
  }, waiting, "the waiting card to be shown", 5000);
  await waitFor(player, () => !document.getElementById("robear-played-card"), null, "every played card to go", 5000);
});

test("played cards: the roll's note carries a thumbnail of the card, full size on hover", async ({ player }) => {
  await forceDice(player, [d20(5)]);
  const id = await roll(player, "Aria", "skill");
  await forceDice(player, [[3, 8]]);
  await cardsOffered(player, id, "Inspiration + 1d8");
  await afterCard(player, id);
  const art = player.page.locator(`#chat .chat-log [data-message-id="${id}"] .robear-card-log .robear-card-log-art`);
  await art.waitFor({ timeout: 5000 });
  assertEqual(await art.getAttribute("src"), "modules/sogrom-robear-e/assets/images/inspiration-1d8-dc20.webp", "the thumbnail");
  assert((await art.getAttribute("data-tooltip-html")).includes("inspiration-1d8-dc20.webp"), "The thumbnail has no full-size art.");
  const loaded = await art.evaluate(img => img.complete && img.naturalWidth > 0);
  assert(loaded, "The thumbnail's art did not load.");
  const note = await player.page.locator(`#chat .chat-log [data-message-id="${id}"] .robear-card-log`).textContent();
  assertEqual(note.replace(/\s+/g, " ").trim(), "Inspiration + 1d8: added 1d8 (3): 5 + 3 = 8", "the note, with no RoBear-E label beside the thumbnail");
});

test("played cards: with the setting off, nothing is shown on screen, but the note keeps its thumbnail", async ({ gm, player }) => {
  await gm.eval(moduleId => game.settings.set(moduleId, "showPlayedCards", false), MODULE_ID);
  await waitFor(player, moduleId => game.settings.get(moduleId, "showPlayedCards") === false, MODULE_ID, "the setting");
  await forceDice(player, [d20(5)]);
  const id = await roll(player, "Aria", "skill");
  await forceDice(player, [d20(16)]);
  await cardsOffered(player, id, "Luck");
  await afterCard(player, id);
  await player.page.waitForTimeout(800);
  assertEqual(await playedCardOnScreen(player), null, "the played card on the player's screen");
  assertEqual(await playedCardOnScreen(gm), null, "the played card on the GM's screen");
  assertEqual(await player.page.locator(`#chat .chat-log [data-message-id="${id}"] .robear-card-log-art`).count(), 1,
    "the note's thumbnail");
});

test("played cards: a card played from the sheet is shown on screen, with a short record in chat", async ({ gm, player }) => {
  await useFeature(player);
  const dialog = player.page.locator(".robear-card-dialog.application").last();
  await dialog.locator(".robear-card-choice", { hasText: "Charger" }).click();
  await player.page.locator(".application.activity-usage button", { hasText: "Use Ability" }).click();

  for ( const session of [gm, player] ) {
    await waitFor(session, () => !!document.getElementById("robear-played-card"), null,
      `the played card on ${session.user}'s screen`, 5000);
    assertEqual(await playedCardOnScreen(session), {
      img: "modules/sogrom-robear-e/assets/images/chargerdc20.webp", by: "Aria plays", name: "Charger"
    }, `the played card (${session.user})`);
  }

  // The chat record: the description, which holds the full card art, starts collapsed.
  const record = player.page.locator("#chat .chat-log li.chat-message.robear-card-usage").last();
  await record.waitFor({ timeout: 5000 });
  const state = await record.evaluate(li => ({
    collapsed: li.querySelector(".card-description")?.classList.contains("collapsed"),
    descriptionHeight: li.querySelector(".card-description .collapsible-content")?.getBoundingClientRect().height,
    tags: li.querySelector(".icon-row:has(.fa-tag)") ? getComputedStyle(li.querySelector(".icon-row:has(.fa-tag)")).display : null,
    hoverArt: li.querySelector(".activity-icon img")?.dataset.tooltipHtml ?? null,
    height: li.getBoundingClientRect().height
  }));
  assertEqual(state.collapsed, true, "the description collapsed");
  assertEqual(state.tags, "none", "the tag row");
  assert(state.hoverArt?.includes("chargerdc20.webp"), `The header's art has no full-size hover: ${state.hoverArt}`);
  assert(state.height < 200, `The chat record is ${state.height}px tall.`);

  // Clicking the header still opens the description.
  await record.locator(".card-header").click();
  await waitFor(player, () => {
    const li = [...document.querySelectorAll("#chat .chat-log li.chat-message.robear-card-usage")].at(-1);
    return !li.querySelector(".card-description").classList.contains("collapsed");
  }, null, "the description to open");
});

test("cards: a roll keeps its note once no card is left to play on it", async ({ player }) => {
  await forceDice(player, [d20(5)]);
  const id = await roll(player, "Aria", "skill");
  // Luck rerolls into a natural 20, which locks every other card, so the card button goes.
  await forceDice(player, [d20(20)]);
  await cardsOffered(player, id, "Luck");
  await afterCard(player, id);
  await waitFor(player, id => !document.querySelector(`#chat .chat-log [data-message-id="${id}"] .robear-card-button`),
    id, "the card button to go");
  const note = await player.page.locator(`#chat .chat-log [data-message-id="${id}"] .robear-card-log`).count();
  assertEqual(note, 1, "notes on the roll");
});

/* -------------------------------------------- */

test("played cards: a note's art is never run as HTML, on the screen or in its tooltip", async ({ gm, player }) => {
  const id = await player.eval(async () => (await ChatMessage.create({ content: "A roll" })).id);
  await waitFor(gm, id => game.messages.has(id), id, "the message to reach the GM");
  // Written by hand, as only a player meddling from the console could.
  await player.eval(async ({ id, moduleId }) => {
    const img = 'x" onerror="window.__robearInjected = true';
    await game.messages.get(id).setFlag(moduleId, "log", [{ text: "Luck: rerolled", card: "<b>Luck</b>", img, by: "Aria" }]);
  }, { id, moduleId: MODULE_ID });
  await waitFor(gm, () => !!document.getElementById("robear-played-card"), null, "the played card on the GM's screen");
  await gm.page.waitForTimeout(500);
  const seen = await gm.eval(id => ({
    injected: !!window.__robearInjected,
    src: document.querySelector("#robear-played-card img")?.getAttribute("src"),
    name: document.querySelector("#robear-played-card .robear-played-card-name")?.textContent,
    tooltip: document.querySelector(`#chat .chat-log li[data-message-id="${id}"] .robear-card-log-art`)?.dataset.tooltipHtml
  }), id);
  assertEqual(seen.injected, false, "script run from the note's art");
  assertEqual(seen.src, 'x" onerror="window.__robearInjected = true', "the played card's art, kept as plain text");
  assertEqual(seen.name, "<b>Luck</b>", "the played card's name, kept as plain text");
  assert(seen.tooltip?.startsWith('<img src="x&quot; onerror'), `The note's tooltip wasn't escaped: ${seen.tooltip}`);
});

test("played cards: a card played on a roll the player can't see isn't shown to them", async ({ gm, player }) => {
  const id = await gm.eval(async () => {
    const roll = await new Roll("1d20").evaluate();
    return (await roll.toMessage({ flavor: "Secret" }, { rollMode: "gmroll" })).id;
  });
  await player.page.waitForTimeout(500);
  await gm.eval(async ({ id, moduleId }) => {
    const img = `modules/${moduleId}/assets/images/luckdc20.webp`;
    await game.messages.get(id).setFlag(moduleId, "log", [{ text: "Luck: rerolled", card: "Luck", img, by: "Goblin" }]);
  }, { id, moduleId: MODULE_ID });
  await waitFor(gm, () => !!document.getElementById("robear-played-card"), null, "the played card on the GM's screen");
  await player.page.waitForTimeout(500);
  assertEqual(await player.eval(() => !!document.getElementById("robear-played-card")), false, "the card on the player's screen");
});
