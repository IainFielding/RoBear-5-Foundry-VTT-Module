/**
 * The test world: its manifest on disk, its module configuration, and the documents every run starts from.
 *
 * A world is a directory holding `world.json`. Foundry builds its database on first launch and, finding no
 * GM, creates a passwordless "Gamemaster", which is the account the harness joins as.
 */

import fs from "node:fs";
import path from "node:path";
import { CORE_VERSION, DATA_DIR, MODULE_ID, PLAYER_USER, SYSTEM, SYSTEM_VERSION, WORLD } from "../config.mjs";

/** Write the world's manifest if it is missing. */
export function ensureWorld() {
  const dir = path.join(DATA_DIR, "worlds", WORLD.id);
  const manifest = path.join(dir, "world.json");
  fs.mkdirSync(dir, { recursive: true });
  if ( fs.existsSync(manifest) ) return;
  fs.writeFileSync(manifest, `${JSON.stringify({
    id: WORLD.id,
    title: WORLD.title,
    description: WORLD.description,
    system: SYSTEM,
    systemVersion: SYSTEM_VERSION,
    coreVersion: CORE_VERSION,
    compatibility: { minimum: String(Math.trunc(Number(CORE_VERSION))), verified: CORE_VERSION },
    playtime: 0,
    flags: {}
  }, null, 2)}\n`, "utf8");
}

/* -------------------------------------------- */

/**
 * Turn on exactly the world's modules, reloading if that changed anything, and check they came up.
 * @param {import("./session.mjs").Session} gm
 */
export async function enableModules(gm) {
  const changed = await gm.eval(async wanted => {
    const want = new Set(wanted);
    const current = game.settings.get("core", "moduleConfiguration") ?? {};
    const next = Object.fromEntries([...game.modules.keys()].map(id => [id, want.has(id)]));
    const changed = Object.keys(next).some(id => (current[id] ?? false) !== next[id]);
    if ( changed ) await game.settings.set("core", "moduleConfiguration", next);
    return changed;
  }, WORLD.modules);
  if ( changed ) await gm.reload();
  const inactive = await gm.eval(wanted => wanted.filter(id => !game.modules.get(id)?.active), WORLD.modules);
  if ( inactive.length ) throw new Error(`Modules did not activate: ${inactive.join(", ")}\n${gm.tail()}`);
}

/* -------------------------------------------- */

/**
 * Clear out the last run and create the documents every test starts from:
 * - a Player user, who owns Aria and Borin;
 * - Aria, a character holding the RoBear-E Cards from this module's compendium, and a Dagger from dnd5e's;
 * - Borin, a character with no cards;
 * - a Goblin NPC, owned by no player, with a linked token on the active scene.
 * @param {import("./session.mjs").Session} gm
 * @returns {Promise<{ player: string, aria: string, borin: string, goblin: string }>}  User ID and actor UUIDs.
 */
export async function resetFixtures(gm) {
  return gm.eval(async ({ moduleId, playerName }) => {
    await ChatMessage.deleteDocuments(game.messages.map(m => m.id));
    await Actor.deleteDocuments(game.actors.map(a => a.id));

    const player = game.users.getName(playerName)
      ?? await User.create({ name: playerName, role: CONST.USER_ROLES.PLAYER });

    const owned = { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE, [player.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER };
    const [aria, borin, goblin] = await Actor.createDocuments([
      { name: "Aria", type: "character", ownership: owned },
      { name: "Borin", type: "character", ownership: owned },
      { name: "Goblin", type: "npc" }
    ]);

    const pack = game.packs.get(`${moduleId}.items`);
    const cards = (await pack.getDocuments()).find(i => i.system.identifier === "robear-e" || i.name === "RoBear-E Cards");
    if ( !cards ) throw new Error("The RoBear-E Cards item is missing from the items compendium.");
    const dagger = (await game.packs.get("dnd5e.items").getDocuments({ name: "Dagger" }))[0];
    if ( !dagger ) throw new Error("dnd5e's Dagger is missing from its items compendium.");
    await aria.createEmbeddedDocuments("Item", [game.items.fromCompendium(cards), game.items.fromCompendium(dagger)]);

    await player.update({ character: aria.id });

    // The Goblin stands on the active scene, which is where the request window finds NPCs.
    await Scene.deleteDocuments(game.scenes.map(s => s.id));
    const scene = await Scene.create({ name: "Arena", active: true, width: 1000, height: 1000 });
    await scene.createEmbeddedDocuments("Token", [{ name: "Goblin", actorId: goblin.id, actorLink: true, x: 100, y: 100 }]);
    return { player: player.id, aria: aria.uuid, borin: borin.uuid, goblin: goblin.uuid };
  }, { moduleId: MODULE_ID, playerName: PLAYER_USER });
}
