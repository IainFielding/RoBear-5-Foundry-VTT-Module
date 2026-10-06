/**
 * End-to-end tests for natural 1s and 20s on saves against a spell's damage: a natural 20 takes no damage, and a
 * natural 1 takes the damage as a critical hit, rolled with dnd5e's critical settings, ignoring resistances.
 *
 * The Goblin casts Sacred Flame at Aria and Borin, who have tokens on the scene for these tests. Aria resists radiant
 * damage. The player rolls their saves against the spell's card, as its Save button does, and the GM rolls its damage
 * as the Damage button does. What each target takes is read from dnd5e's damage tray, then applied through it.
 */

import { MODULE_ID } from "./config.mjs";
import { assert, assertEqual, forceDice, test, waitFor } from "./lib/harness.mjs";

const d20 = n => [n, 20];
const d8 = n => [n, 8];

/**
 * Put Aria and Borin on the scene with 50 hit points, Aria resisting radiant damage, and have the Goblin cast Sacred
 * Flame at them.
 * @param {import("./lib/session.mjs").Session} gm
 * @param {import("./lib/session.mjs").Session} player
 * @returns {Promise<{ usage: string, aria: string, borin: string }>}  The spell card's ID, and the targets' token UUIDs.
 */
async function castAtAriaAndBorin(gm, player) {
  const cast = await gm.eval(async () => {
    const scene = game.scenes.active;
    const tokens = {};
    for ( const [name, x] of [["Aria", 300], ["Borin", 500]] ) {
      const actor = game.actors.getName(name);
      await actor.update({
        "system.attributes.hp": { value: 50, max: 50 },
        "system.traits.dr.value": name === "Aria" ? ["radiant"] : []
      });
      const [token] = await scene.createEmbeddedDocuments("Token", [{ name, actorId: actor.id, actorLink: true, x, y: 100 }]);
      tokens[name] = token;
    }
    const goblin = game.actors.getName("Goblin");
    if ( !goblin.items.getName("Sacred Flame") ) {
      const spell = (await game.packs.get("dnd5e.spells").getDocuments({ name: "Sacred Flame" }))[0];
      await goblin.createEmbeddedDocuments("Item", [game.items.fromCompendium(spell)]);
    }
    const activity = goblin.items.getName("Sacred Flame").system.activities.find(a => a.type === "save");
    const targets = Object.values(tokens).map(t => ({ actor: t.actor.uuid, ac: 10, img: t.texture.src, name: t.name, token: t.uuid }));
    const { message } = await activity.use({}, { configure: false }, { data: { system: { targets } } });
    return { usage: message.id, aria: tokens.Aria.uuid, borin: tokens.Borin.uuid };
  });
  await waitFor(player, ({ usage, aria, borin }) => !!game.messages.get(usage) && !!fromUuidSync(aria) && !!fromUuidSync(borin),
    cast, "the spell card and tokens to reach the player");
  return cast;
}

/**
 * Take Aria's and Borin's tokens off the scene and put them back as they were.
 * @param {import("./lib/session.mjs").Session} gm
 */
async function cleanUp(gm) {
  await gm.eval(async moduleId => {
    const scene = game.scenes.active;
    // With the canvas off, Foundry throws once the tokens are deleted, but they are gone from the server by then.
    await scene.deleteEmbeddedDocuments("Token", scene.tokens.filter(t => t.name !== "Goblin").map(t => t.id)).catch(() => {});
    for ( const name of ["Aria", "Borin"] ) await game.actors.getName(name).update({ "system.traits.dr.value": [] });
    if ( !game.settings.get(moduleId, "naturalSaves") ) await game.settings.set(moduleId, "naturalSaves", true);
    if ( game.settings.get("dnd5e", "criticalDamageMaxDice") ) await game.settings.set("dnd5e", "criticalDamageMaxDice", false);
  }, MODULE_ID);
}

/**
 * Roll a save against the spell's card as the player, from the creature's token, and wait for the GM to see it.
 * @param {import("./lib/session.mjs").Session} gm
 * @param {import("./lib/session.mjs").Session} player
 * @param {string} usage  The spell card's ID.
 * @param {string} token  The token's UUID.
 * @param {number} natural
 * @param {number} [dc]
 */
async function rollSave(gm, player, usage, token, natural, dc = 15) {
  await forceDice(player, [d20(natural)]);
  const id = await player.eval(async ({ usage, token, dc }) => {
    const card = game.messages.get(usage);
    const activity = card.getAssociatedActivity();
    const document = fromUuidSync(token);
    const [roll] = await document.actor.rollSavingThrow({ ability: "dex", target: dc }, { configure: false }, {
      data: { speaker: ChatMessage.getSpeaker({ token: document }), system: { ...activity.messageSources, origin: usage } }
    });
    return roll.parent.id;
  }, { usage, token, dc });
  await waitFor(gm, id => !!game.messages.get(id), id, "the save to reach the GM");
  const shown = await gm.eval(id => game.messages.get(id).rolls[0].d20.results.find(r => r.active).result, id);
  assertEqual(shown, natural, "the save's natural");
}

/**
 * Roll the spell's damage as the GM, as the card's Damage button does.
 * @param {import("./lib/session.mjs").Session} gm
 * @param {string} usage
 * @param {number} face  What each d8 shows.
 * @returns {Promise<string>}  The damage message's ID.
 */
async function rollDamage(gm, usage, face) {
  await forceDice(gm, Array.from({ length: 12 }, () => d8(face)));
  return gm.eval(async usage => {
    const card = game.messages.get(usage);
    const [roll] = await card.getAssociatedActivity().rollDamage({}, { configure: false }, {
      data: { system: { origin: usage, targets: card.system.targets } }
    });
    return roll.parent.id;
  }, usage);
}

/**
 * The damage messages on the spell's card.
 * @param {import("./lib/session.mjs").Session} session
 * @param {string} usage
 * @returns {Promise<{ id: string, critical: boolean, flagged: boolean, dice: number, faces: number, total: number, targets: string[] }[]>}
 */
function damages(session, usage) {
  return session.eval(({ usage, moduleId }) => game.messages.get(usage).getAssociatedRolls("damage").map(m => ({
    id: m.id,
    critical: m.rolls[0].isCritical,
    flagged: !!m.getFlag(moduleId, "naturalOne"),
    dice: m.rolls[0].dice.reduce((n, d) => n + d.number, 0),
    faces: m.rolls[0].dice[0]?.faces,
    total: m.rolls.reduce((t, r) => t + r.total, 0),
    targets: m.system.targets.map(t => t.name)
  })), { usage, moduleId: MODULE_ID });
}

/**
 * What the damage tray of a damage message would do to each target, as the GM sees it. The harness runs with the canvas
 * off, so dnd5e can't list the tray's targets by token, which is how it lists them on the scene being viewed; the
 * tray is asked about each token instead.
 * @param {import("./lib/session.mjs").Session} session
 * @param {string} id  The damage message's ID.
 * @param {string[]} tokens  The targets' token UUIDs.
 * @returns {Promise<Record<string, { damage: number, ignoring: string[] }>>}  Keyed by target name.
 */
async function tray(session, id, tokens) {
  const selector = `#chat .chat-log [data-message-id="${id}"] damage-application`;
  await session.page.locator(selector).first().waitFor({ state: "attached", timeout: 10_000 });
  return session.page.locator(selector).first().evaluate((el, tokens) => Object.fromEntries(tokens.map(uuid => {
    const token = fromUuidSync(uuid);
    const options = el.getMergedOptions(uuid);
    return [token.name, { damage: el.calculateDamage(token.actor, options).total, ignoring: [...(options.ignore?.resistance ?? [])] }];
  })), tokens);
}

/**
 * Apply a damage message's tray to these targets as the GM, as its Apply button does.
 * @param {import("./lib/session.mjs").Session} session
 * @param {string} id
 * @param {string[]} tokens  The targets' token UUIDs.
 */
async function apply(session, id, tokens) {
  await session.page.locator(`#chat .chat-log [data-message-id="${id}"] damage-application`).first().evaluate(async (el, tokens) => {
    for ( const uuid of tokens ) {
      await fromUuidSync(uuid).actor.applyDamage(el.damages, { ...el.getMergedOptions(uuid), isDelta: true, origin: el.chatMessage });
    }
  }, tokens);
}

/**
 * @param {import("./lib/session.mjs").Session} session
 * @returns {Promise<{ Aria: number, Borin: number }>}  Their hit points.
 */
function hitPoints(session) {
  return session.eval(() => Object.fromEntries(["Aria", "Borin"].map(n => [n, game.actors.getName(n).system.attributes.hp.value])));
}

test("natural saves: a natural 1 takes critical damage past resistance, and a natural 20 takes none", async ({ gm, player }) => {
  try {
    const { usage, aria, borin } = await castAtAriaAndBorin(gm, player);
    // Aria's 1 beats DC 1 and Borin's 20 misses DC 25, so only the naturals decide their damage.
    await rollSave(gm, player, usage, aria, 1, 1);
    await rollSave(gm, player, usage, borin, 20, 25);
    const id = await rollDamage(gm, usage, 4);

    await waitFor(gm, ({ usage, moduleId }) => game.messages.get(usage).getAssociatedRolls("damage")
      .some(m => m.getFlag(moduleId, "naturalOne")), { usage, moduleId: MODULE_ID }, "the critical damage roll");
    const all = await damages(gm, usage);
    assertEqual(all.length, 2, "damage rolls on the card");
    const [normal, critical] = [all.find(d => d.id === id), all.find(d => d.flagged)];
    assert(!normal.critical, "The GM's own damage roll was made critical.");
    assertEqual({ critical: critical.critical, dice: critical.dice, faces: critical.faces, targets: critical.targets },
      { critical: true, dice: normal.dice * 2, faces: 8, targets: ["Aria"] }, "the critical roll");
    assertEqual(critical.total, normal.dice * 2 * 4, "the critical roll's total, every d8 showing 4");

    assertEqual(await tray(gm, id, [aria, borin]), {
      Aria: { damage: 0, ignoring: [] }, Borin: { damage: 0, ignoring: [] }
    }, "the ordinary roll's tray");
    assertEqual(await tray(gm, critical.id, [aria]), { Aria: { damage: critical.total, ignoring: ["radiant"] } },
      "the critical roll's tray");

    await apply(gm, id, [aria, borin]);
    await apply(gm, critical.id, [aria]);
    assertEqual(await hitPoints(gm), { Aria: 50 - critical.total, Borin: 50 }, "hit points once both trays are applied");
  } finally {
    await cleanUp(gm);
  }
});

test("natural saves: a natural 1 rolled after the damage gets its critical roll then", async ({ gm, player }) => {
  try {
    const { usage, aria, borin } = await castAtAriaAndBorin(gm, player);
    await rollSave(gm, player, usage, borin, 9);
    const id = await rollDamage(gm, usage, 4);
    await gm.page.waitForTimeout(500);
    assertEqual((await damages(gm, usage)).length, 1, "damage rolls before any natural 1");

    await forceDice(gm, Array.from({ length: 12 }, () => d8(3)));
    await rollSave(gm, player, usage, aria, 1);
    await waitFor(gm, ({ usage, moduleId }) => game.messages.get(usage).getAssociatedRolls("damage")
      .some(m => m.getFlag(moduleId, "naturalOne")), { usage, moduleId: MODULE_ID }, "the critical damage roll");
    const all = await damages(gm, usage);
    const normal = all.find(d => d.id === id);
    const critical = all.find(d => d.flagged);
    assertEqual(critical.targets, ["Aria"], "the critical roll's targets");
    assertEqual(await tray(gm, id, [aria, borin]), {
      Aria: { damage: 0, ignoring: [] }, Borin: { damage: normal.total, ignoring: [] }
    }, "the ordinary roll's tray, Borin failing with a 9");

    // Another save shown to the GM doesn't roll the critical damage again.
    await rollSave(gm, player, usage, borin, 5);
    await gm.page.waitForTimeout(800);
    assertEqual((await damages(gm, usage)).filter(d => d.flagged).length, 1, "critical rolls after another save");
  } finally {
    await cleanUp(gm);
  }
});

test("natural saves: the critical roll follows dnd5e's maximise critical dice setting", async ({ gm, player }) => {
  try {
    await gm.eval(() => game.settings.set("dnd5e", "criticalDamageMaxDice", true));
    const { usage, aria } = await castAtAriaAndBorin(gm, player);
    await rollSave(gm, player, usage, aria, 1);
    const id = await rollDamage(gm, usage, 2);
    await waitFor(gm, ({ usage, moduleId }) => game.messages.get(usage).getAssociatedRolls("damage")
      .some(m => m.getFlag(moduleId, "naturalOne")), { usage, moduleId: MODULE_ID }, "the critical damage roll");
    const all = await damages(gm, usage);
    const normal = all.find(d => d.id === id);
    const critical = all.find(d => d.flagged);
    assertEqual({ dice: critical.dice, total: critical.total }, { dice: normal.dice, total: normal.dice * (2 + 8) },
      "the critical roll: the dice rolled once more, plus their maximum");
  } finally {
    await cleanUp(gm);
  }
});

test("natural saves: with the setting off, a natural 1 or 20 changes no damage", async ({ gm, player }) => {
  try {
    const setting = await gm.eval(moduleId => {
      const s = game.settings.settings.get(`${moduleId}.naturalSaves`);
      return { config: s?.config, scope: s?.scope, default: s?.default };
    }, MODULE_ID);
    assertEqual(setting, { config: true, scope: "world", default: true }, "the setting");
    await gm.eval(moduleId => game.settings.set(moduleId, "naturalSaves", false), MODULE_ID);
    await waitFor(player, moduleId => game.settings.get(moduleId, "naturalSaves") === false, MODULE_ID,
      "the setting to reach the player");

    const { usage, aria, borin } = await castAtAriaAndBorin(gm, player);
    await rollSave(gm, player, usage, aria, 1);
    await rollSave(gm, player, usage, borin, 20, 25);
    const id = await rollDamage(gm, usage, 4);
    await gm.page.waitForTimeout(800);
    const all = await damages(gm, usage);
    assertEqual(all.length, 1, "damage rolls with the setting off");
    const total = all[0].total;
    assertEqual(await tray(gm, id, [aria, borin]), {
      Aria: { damage: Math.trunc(total / 2), ignoring: [] }, Borin: { damage: total, ignoring: [] }
    }, "the tray with the setting off");
  } finally {
    await cleanUp(gm);
  }
});
