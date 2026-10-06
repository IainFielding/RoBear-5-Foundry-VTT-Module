/**
 * Natural 1s and 20s on a saving throw against an activity's damage. A creature whose save shows a natural 20 takes no
 * damage. One whose save shows a natural 1 takes the damage as a critical hit, ignoring its resistances.
 *
 * dnd5e rolls a save activity's damage once for every target, and its damage tray works out what each target takes
 * from that roll. So when a target's save shows a natural 1, the damage is rolled again as a critical hit, with the
 * game system's critical settings, for that target alone. In the trays these start that target at no damage from the
 * ordinary roll, and at the critical roll's full damage, past its resistances, from the critical one. A natural 20
 * starts at no damage in every tray. The GM can still change any of them in the tray before applying it.
 */

import { MODULE_ID, getNatural, localize } from "./robear-cards.mjs";

/**
 * Checks for a missing critical roll, run one after another so two messages arriving together can't roll it twice.
 * @type {Promise<void>}
 */
let queue = Promise.resolve();

/**
 * Damage tray options already given their starting values, so a change the GM makes isn't overwritten.
 * @type {WeakSet<object>}
 */
const seeded = new WeakSet();

/* -------------------------------------------- */
/*  Hooks                                       */
/* -------------------------------------------- */

Hooks.once("setup", wrapDamageTray);
Hooks.on("createChatMessage", onChangeMessage);
Hooks.on("updateChatMessage", (message, changes) => {
  if ( "rolls" in changes ) onChangeMessage(message);
});

/**
 * A save or damage roll joined, or changed on, a save activity's card: roll any critical damage now owed, and redraw
 * the card's damage trays.
 * @param {ChatMessage5e} message
 */
function onChangeMessage(message) {
  if ( !game.settings.get(MODULE_ID, "naturalSaves") || !["save", "damage"].includes(message.type) ) return;
  const usage = getSaveUsage(message);
  if ( !usage ) return;
  for ( const damage of usage.getAssociatedRolls("damage") ) {
    if ( damage !== message ) ui.chat?.updateMessage(damage);
  }
  queue = queue.then(() => rollOwedCritical(usage)).catch(err => console.error(`${MODULE_ID} |`, err));
}

/* -------------------------------------------- */
/*  Saves                                       */
/* -------------------------------------------- */

/**
 * @param {ChatMessage5e} message  A roll made from an activity's card.
 * @returns {ChatMessage5e|null}   The card, if its activity is a save.
 */
function getSaveUsage(message) {
  const usage = message.system?.origin;
  return (usage?.type === "usage") && (usage.system.activity?.type === "save") ? usage : null;
}

/**
 * The natural 1s and 20s rolled on the saves made against a save activity's card. Each save is found by its token, and
 * by its actor too, as dnd5e's damage tray names a target by its actor when its token isn't on the scene being viewed.
 * A creature's later save stands over an earlier one, as it does for dnd5e's own outcomes.
 * @param {ChatMessage5e} usage
 * @returns {Map<string, { natural: 1|20, token: TokenDocument5e|null }>}  Keyed by token and actor UUID.
 */
export function getSaveNaturals(usage) {
  const naturals = new Map();
  for ( const save of usage.getAssociatedRolls("save") ) {
    const natural = getNatural(save.rolls[0]);
    const token = save.getAssociatedToken() ?? null;
    for ( const uuid of [token?.uuid, save.getAssociatedActor()?.uuid] ) {
      if ( !uuid ) continue;
      if ( [1, 20].includes(natural) ) naturals.set(uuid, { natural, token });
      else naturals.delete(uuid);
    }
  }
  return naturals;
}

/* -------------------------------------------- */
/*  Critical damage                             */
/* -------------------------------------------- */

/**
 * @param {ChatMessage5e} damage
 * @returns {boolean}
 */
function isCritical(damage) {
  return damage.rolls[0]?.isCritical === true;
}

/**
 * Whether a critical damage roll is for this target. The one rolled here for natural 1s is for the targets it was
 * rolled for; one the caster rolled as critical is for everyone.
 * @param {ChatMessage5e} damage
 * @param {string} uuid  A token or actor UUID.
 * @returns {boolean}
 */
function isCriticalFor(damage, uuid) {
  if ( !isCritical(damage) ) return false;
  if ( !damage.getFlag(MODULE_ID, "naturalOne") ) return true;
  return damage.system.targets.some(t => (t.token === uuid) || (t.actor === uuid));
}

/**
 * Roll critical damage for every target whose save on this card shows a natural 1 and who has none yet. It waits for
 * the card's damage to be rolled, and is rolled by whoever rolled it, or by a GM if they have left.
 * @param {ChatMessage5e} usage
 */
async function rollOwedCritical(usage) {
  const damages = usage.getAssociatedRolls("damage");
  const rolled = damages.findLast(m => !isCritical(m));
  if ( !rolled ) return;
  const roller = rolled.author?.active ? rolled.author : game.users.activeGM;
  if ( roller !== game.user ) return;

  const owed = new Map();
  for ( const { natural, token } of getSaveNaturals(usage).values() ) {
    if ( (natural !== 1) || !token?.actor || damages.some(m => isCriticalFor(m, token.uuid)) ) continue;
    owed.set(token.uuid, token);
  }
  if ( owed.size ) await rollCritical(usage, rolled, [...owed.values()]);
}

/**
 * Roll a card's damage again as a critical hit, for the targets given. The rolls are rebuilt from those already made,
 * so the spell's level and anything added in the damage window carry over, then doubled by the game system's own
 * critical rules and its current settings for them.
 * @param {ChatMessage5e} usage
 * @param {ChatMessage5e} rolled  The card's damage roll.
 * @param {TokenDocument5e[]} tokens
 * @returns {Promise<ChatMessage5e>}
 */
async function rollCritical(usage, rolled, tokens) {
  const rolls = rolled.rolls.map(roll => {
    // eslint-disable-next-line no-unused-vars
    const { configured, preprocessed, isCritical, ...options } = roll.options;
    options.critical = {
      ...options.critical,
      multiplyNumeric: game.settings.get("dnd5e", "criticalDamageModifiers"),
      powerfulCritical: game.settings.get("dnd5e", "criticalDamageMaxDice")
    };
    return new CONFIG.Dice.DamageRoll(roll.formula, roll.data, { ...options, isCritical: true });
  });
  const names = tokens.map(t => t.name);
  const mode = rolled.blind ? "blind" : rolled.whisper.length ? "gm" : "public";
  return CONFIG.Dice.DamageRoll.toMessage(rolls, {
    flavor: localize("ROBEAR.NaturalSaves.Flavor", {
      flavor: rolled.flavor, names: game.i18n.getListFormatter().format(names)
    }),
    speaker: rolled.speaker,
    type: "damage",
    whisper: rolled.whisper,
    system: {
      ...rolled.system.toObject(),
      origin: usage.id,
      targets: tokens.map(token => ({
        actor: token.actor.uuid,
        ac: token.actor.statuses.has("coverTotal") ? null : (token.actor.system.attributes?.ac?.value ?? null),
        img: token.texture?.src,
        name: token.name,
        token: token.uuid
      }))
    },
    flags: { [MODULE_ID]: { naturalOne: true } }
  }, { rollMode: mode });
}

/* -------------------------------------------- */
/*  Damage tray                                 */
/* -------------------------------------------- */

/**
 * dnd5e's damage tray keeps each target's options to itself, so give each target its starting options as the tray
 * first asks for them.
 */
function wrapDamageTray() {
  const Tray = customElements.get("damage-application");
  const getTargetOptions = Tray?.prototype.getTargetOptions;
  if ( !getTargetOptions ) {
    console.warn(`${MODULE_ID} | dnd5e's damage tray has changed: natural 1s and 20s on saves won't change damage.`);
    return;
  }
  Tray.prototype.getTargetOptions = function(uuid) {
    const options = getTargetOptions.call(this, uuid);
    if ( !seeded.has(options) ) {
      seeded.add(options);
      try {
        seedTargetOptions(this, uuid, options);
      } catch(err) {
        console.error(`${MODULE_ID} |`, err);
      }
    }
    return options;
  };
}

/**
 * Start a target of a save activity's damage at what its natural 1 or 20 calls for.
 * @param {DamageApplicationElement} tray
 * @param {string} uuid                       The target's token or actor UUID.
 * @param {DamageApplicationOptions} options  The target's options, changed in place.
 */
export function seedTargetOptions(tray, uuid, options) {
  const damage = tray.chatMessage;
  if ( !game.settings.get(MODULE_ID, "naturalSaves") || (damage?.type !== "damage") ) return;
  const usage = getSaveUsage(damage);
  const natural = usage && getSaveNaturals(usage).get(uuid)?.natural;
  if ( natural === 20 ) options.multiplier = 0;
  if ( natural !== 1 ) return;

  if ( isCriticalFor(damage, uuid) ) {
    options.multiplier = 1;
    const actor = fromUuidSync(uuid)?.actor ?? fromUuidSync(uuid);
    const resistances = getResistances(actor, tray.damages);
    if ( resistances.size ) {
      options.ignore ??= {};
      options.ignore.resistance = resistances.union(options.ignore.resistance ?? new Set());
    }
  }
  // The critical roll is this target's damage, so the ordinary one is set aside once that is rolled.
  else if ( usage.getAssociatedRolls("damage").some(m => isCriticalFor(m, uuid)) ) options.multiplier = 0;
}

/**
 * The resistances that would lessen this damage, as the damage tray names them: a damage type, or "ALL". dnd5e names
 * only the first resistance it finds for each damage, so one to fire under one to all damage only shows once "ALL" is
 * ignored.
 * @param {Actor5e} actor
 * @param {DamageDescription[]} damages
 * @returns {Set<string>}
 */
function getResistances(actor, damages) {
  const resistances = new Set();
  for ( let size = -1; size !== resistances.size; ) {
    size = resistances.size;
    const calculated = actor?.calculateDamage?.(damages, { ignore: { resistance: resistances } });
    for ( const d of calculated || [] ) {
      if ( d.active?.all?.resistance ) resistances.add("ALL");
      if ( d.active?.type?.resistance ) resistances.add(d.type);
    }
  }
  return resistances;
}
