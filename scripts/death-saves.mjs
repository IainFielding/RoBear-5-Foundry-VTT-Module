/**
 * Death save requests: at the start of a dying creature's turn in combat, the GM's client posts a roll request for its
 * death save. It is an ordinary request, so the card, the pop-ups and their settings work as they do for any other.
 * dnd5e does not prompt for death saves itself; it only rolls one from the sheet.
 */

import { MODULE_ID, reportError } from "./hero-cards.mjs";
import { getRequest, getResults, postRequest } from "./roll-requests.mjs";

/**
 * How many of the latest chat messages are searched for an earlier death save request.
 */
const RECENT_MESSAGES = 100;

/**
 * The DC of a death save, as dnd5e rolls it.
 */
const DEATH_SAVE_DC = 10;

/* -------------------------------------------- */
/*  Hooks                                       */
/* -------------------------------------------- */

Hooks.once("init", registerSettings);
Hooks.on("combatTurnChange", onCombatTurnChange);
Hooks.on("dnd5e.rollDeathSave", onRollDeathSave);
Hooks.on("preUpdateActor", onPreUpdateActor);
Hooks.on("updateActor", onUpdateActor);

/**
 * Register the setting that turns death save requests on.
 */
function registerSettings() {
  game.settings.register(MODULE_ID, "deathSavePrompt", {
    name: "STT.Settings.DeathSavePrompt.Name",
    hint: "STT.Settings.DeathSavePrompt.Hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: false
  });
}

/* -------------------------------------------- */

/**
 * @returns {boolean}  Whether death save requests are on, and this client is the one GM that posts them.
 */
function isPoster() {
  return game.settings.get(MODULE_ID, "deathSavePrompt") && game.user.isActiveGM;
}

/* -------------------------------------------- */

/**
 * Post a death save request for the creature whose turn has started, if it is dying.
 * Every client sees this hook, so only the active GM acts on it.
 * @param {Combat} combat
 * @param {CombatHistoryData} _previous
 * @param {CombatHistoryData} current
 */
async function onCombatTurnChange(combat, _previous, current) {
  if ( !isPoster() || !combat.started || (current.round < 1) ) return;
  const combatant = combat.combatant;
  const actor = combatant?.actor;
  if ( !actor || combatant.isDefeated || !needsDeathSave(actor) ) return;
  // Going back a turn and forward again starts the same turn a second time, which needs no second save.
  if ( findDeathSaveRequests(actor.uuid).some(m => isSameTurn(m, combat.id, current.round)) ) return;
  try {
    await postRequest({
      mode: "standard",
      parts: [{ type: "death", dc: DEATH_SAVE_DC }],
      actors: [actor.uuid],
      showDC: true,
      rollMode: "public"
    }, {
      // A death save's outcome is applied to the sheet as soon as it is rolled, so there is nothing to hold back.
      revealed: true,
      deathSave: { actor: actor.uuid, combat: combat.id, round: current.round }
    });
  } catch(err) {
    reportError(err);
  }
}

/* -------------------------------------------- */

/**
 * dnd5e clears a creature's successes once it is stable, leaving it at 0 hit points with nothing to show it no longer
 * needs to save. Note it on the actor, in the same update as the save's own result.
 * @param {D20Roll[]} _rolls
 * @param {{ outcome: string|null, updates: object, subject: Actor5e }} details
 */
function onRollDeathSave(_rolls, details) {
  if ( details.outcome === "stable" ) details.updates[`flags.${MODULE_ID}.stable`] = true;
}

/* -------------------------------------------- */

/**
 * A stable creature is dying again once it takes a failure, from damage at 0 hit points, and no longer stable once it
 * is healed.
 * @param {Actor5e} actor
 * @param {object} changes
 */
function onPreUpdateActor(actor, changes) {
  if ( !actor.getFlag(MODULE_ID, "stable") ) return;
  const { getProperty, setProperty } = foundry.utils;
  const hp = getProperty(changes, "system.attributes.hp.value");
  const failure = getProperty(changes, "system.attributes.death.failure");
  if ( (hp > 0) || (failure > 0) ) setProperty(changes, `flags.${MODULE_ID}.stable`, false);
}

/* -------------------------------------------- */

/**
 * Remove a creature's death save requests that have not been rolled once it is healed, so its pop-up closes. dnd5e
 * would refuse the roll anyway.
 * @param {Actor5e} actor
 * @param {object} changes
 */
async function onUpdateActor(actor, changes) {
  if ( !isPoster() || !(foundry.utils.getProperty(changes, "system.attributes.hp.value") > 0) ) return;
  const unrolled = findDeathSaveRequests(actor.uuid).filter(m => !getResults(m).get(actor.uuid)?.[0]);
  if ( !unrolled.length ) return;
  try {
    await ChatMessage.deleteDocuments(unrolled.map(m => m.id));
  } catch(err) {
    reportError(err);
  }
}

/* -------------------------------------------- */
/*  Who Saves                                   */
/* -------------------------------------------- */

/**
 * Whether a creature must make a death save at the start of its turn: it is at 0 hit points, neither stable nor dead,
 * and either a character or an NPC marked Important, as dnd5e shows death saves on the sheets of.
 * @param {Actor5e} actor
 * @returns {boolean}
 */
export function needsDeathSave(actor) {
  const { hp, death } = actor?.system?.attributes ?? {};
  if ( !hp || !death ) return false;
  if ( (actor.type !== "character") && !actor.system.traits?.important ) return false;
  if ( !(hp.max > 0) || (hp.value > 0) || (death.success >= 3) || (death.failure >= 3) ) return false;
  if ( actor.statuses?.has("dead") || actor.statuses?.has("stable") ) return false;
  return !actor.getFlag(MODULE_ID, "stable");
}

/* -------------------------------------------- */

/**
 * @param {string} uuid  An actor's UUID.
 * @returns {ChatMessage5e[]}  The latest death save requests posted for the actor.
 */
export function findDeathSaveRequests(uuid) {
  return game.messages.contents.slice(-RECENT_MESSAGES).filter(m => {
    return getRequest(m) && (m.getFlag(MODULE_ID, "deathSave")?.actor === uuid);
  });
}

/* -------------------------------------------- */

/**
 * @param {ChatMessage5e} message  A death save request.
 * @param {string} combatId
 * @param {number} round
 * @returns {boolean}  Whether the request was posted for this round of this combat. A creature has one turn a round.
 */
function isSameTurn(message, combatId, round) {
  const { combat, round: posted } = message.getFlag(MODULE_ID, "deathSave");
  return (combat === combatId) && (posted === round);
}
