/**
 * Run the end-to-end tests against a real Foundry.
 *
 *   npm run test:e2e                  # every test
 *   npm run test:e2e -- divine        # only tests whose name contains "divine"
 *   HEADED=1 npm run test:e2e         # watch the browsers
 *
 * Starts the harness's own Foundry on the configured port with the test world, joins as the GM and as a
 * player in two browsers, and runs tests.mjs, tests-cards.mjs, tests-popup.mjs and tests-bonus.mjs.
 */

import { GM_USER, MODULE_ID, PLAYER_USER, WORLD } from "./config.mjs";
import { runTests } from "./lib/harness.mjs";
import { startFoundry } from "./lib/server.mjs";
import { Session } from "./lib/session.mjs";
import { enableModules, ensureWorld, resetFixtures } from "./lib/world.mjs";
import "./tests.mjs";
import "./tests-cards.mjs";
import "./tests-popup.mjs";
import "./tests-bonus.mjs";
import "./tests-features.mjs";

const filter = process.argv.slice(2).find(a => !a.startsWith("--"));

ensureWorld();
console.log(`Starting Foundry with "${WORLD.title}"…`);
const server = await startFoundry(WORLD.id);
let gm;
let player;
let result;
try {
  gm = await Session.open(GM_USER);
  await enableModules(gm);
  const ids = await resetFixtures(gm);
  player = await Session.open(PLAYER_USER);
  for ( const session of [gm, player] ) {
    await session.eval(() => { ui.sidebar.expand(); ui.sidebar.changeTab("chat", "primary"); });
  }
  const versions = await gm.eval(moduleId => ({
    foundry: game.version, dnd5e: game.system.version, module: game.modules.get(moduleId).version
  }), MODULE_ID);
  console.log(`Foundry ${versions.foundry}, dnd5e ${versions.dnd5e}. Running tests:`);

  result = await runTests({ gm, player, ids }, { filter, beforeEach: () => resetBetweenTests(gm, player) });
} catch ( err ) {
  console.error(err);
  if ( gm ) console.error(`--- GM console ---\n${gm.tail(30)}`);
  if ( player ) console.error(`--- Player console ---\n${player.tail(30)}`);
  process.exitCode = 1;
} finally {
  await player?.close();
  await gm?.close({ shutDownWorld: true });
  await server.stop();
}

if ( result ) {
  console.log(`\n${result.passed} passed, ${result.failed.length} failed.`);
  for ( const { name, error } of result.failed ) console.log(`\n--- ${name} ---\n${error}`);
  if ( result.failed.length ) process.exitCode = 1;
}

/* -------------------------------------------- */

/**
 * Put the world back to the fixtures' starting state: no chat, no combat, every card use restored, no
 * pending Advantage, no forced dice, no stray windows or notifications.
 * @param {Session} gm
 * @param {Session} player
 */
async function resetBetweenTests(gm, player) {
  await gm.eval(async moduleId => {
    await ChatMessage.deleteDocuments(game.messages.map(m => m.id));
    await Combat.deleteDocuments(game.combats.map(c => c.id));
    if ( !game.settings.get(moduleId, "lockNaturals") ) await game.settings.set(moduleId, "lockNaturals", true);
    if ( !game.settings.get(moduleId, "attachRolls") ) await game.settings.set(moduleId, "attachRolls", true);
    if ( !game.settings.get(moduleId, "showPlayedCards") ) await game.settings.set(moduleId, "showPlayedCards", true);
    for ( const key of ["popupPlayers", "popupGM"] ) {
      if ( game.settings.get(moduleId, key) ) await game.settings.set(moduleId, key, false);
    }
    for ( const actor of game.actors ) {
      if ( actor.getFlag(moduleId, "advantage") ) await actor.unsetFlag(moduleId, "advantage");
      for ( const item of actor.items ) {
        const updates = {};
        for ( const activity of item.system.activities ?? [] ) {
          if ( activity.uses?.spent ) updates[`system.activities.${activity.id}.uses.spent`] = 0;
        }
        if ( item.system.uses?.spent ) updates["system.uses.spent"] = 0;
        if ( Object.keys(updates).length ) await item.update(updates);
      }
    }
  }, MODULE_ID);
  for ( const session of [gm, player] ) {
    await session.eval(async () => {
      if ( globalThis.__robearDice ) globalThis.__robearDice.length = 0;
      document.getElementById("robear-played-card")?.remove();
      if ( ui.menu?.rendered ) await ui.menu.close();
      ui.context?.close?.();
      for ( const app of foundry.applications.instances.values() ) {
        if ( app.rendered && (app.options.window?.frame !== false) && app.id !== "sidebar" && app.hasFrame ) await app.close();
      }
      ui.notifications.clear?.();
    });
  }
  await gm.page.waitForTimeout(300);
}
