/**
 * Natural 1s and 20s on a saving throw against an activity's damage. A creature whose save shows a natural 20 takes no
 * damage. One whose save shows a natural 1 takes the damage's maximum, every die at its highest, ignoring its
 * resistances and immunities.
 *
 * dnd5e rolls a save activity's damage once for every target, and its damage tray works out what each target takes
 * from that roll. So each target starts in the tray at what its natural calls for, and the GM can still change it there
 * before applying it.
 */

import { MODULE_ID, getNatural } from "./hero-cards.mjs";

/**
 * Damage tray options already given their starting values, so a change the GM makes isn't overwritten.
 * @type {WeakSet<object>}
 */
const seeded = new WeakSet();

/* -------------------------------------------- */
/*  Hooks                                       */
/* -------------------------------------------- */

Hooks.once("setup", wrapDamageTray);
Hooks.on("dnd5e.preCalculateDamage", onPreCalculateDamage);

/**
 * A target the tray marked for maximum damage takes each damage at its maximum.
 * @param {Actor5e} _actor
 * @param {DamageDescription[]} damages       The damage to apply, changed in place.
 * @param {DamageApplicationOptions} options
 */
function onPreCalculateDamage(_actor, damages, options) {
  if ( !options[MODULE_ID]?.maximize ) return;
  const maximum = getMaximumDamage(options.originatingMessage);
  if ( maximum?.length !== damages.length ) return;
  damages.forEach((d, i) => {
    if ( maximum[i].type === d.type ) d.value = maximum[i].value;
  });
}

/* -------------------------------------------- */
/*  Saves                                       */
/* -------------------------------------------- */

/**
 * @param {ChatMessage5e} message  A roll made from an activity's card.
 * @returns {ChatMessage5e|null}   The card, if its activity is a save.
 */
function getSaveUsage(message) {
  const usage = message?.system?.origin;
  return (usage?.type === "usage") && (usage.system.activity?.type === "save") ? usage : null;
}

/**
 * The natural 1s and 20s rolled on the saves made against a save activity's card. Each save is found by its token, and
 * by its actor too, as dnd5e's damage tray names a target by its actor when its token isn't on the scene being viewed.
 * A creature's later save stands over an earlier one, as it does for dnd5e's own outcomes.
 * @param {ChatMessage5e} usage
 * @returns {Map<string, 1|20>}  Keyed by token and actor UUID.
 */
export function getSaveNaturals(usage) {
  const naturals = new Map();
  for ( const save of usage.getAssociatedRolls("save") ) {
    const natural = getNatural(save.rolls[0]);
    for ( const uuid of [save.getAssociatedToken()?.uuid, save.getAssociatedActor()?.uuid] ) {
      if ( !uuid ) continue;
      if ( [1, 20].includes(natural) ) naturals.set(uuid, natural);
      else naturals.delete(uuid);
    }
  }
  return naturals;
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
  const natural = usage && getSaveNaturals(usage).get(uuid);
  if ( natural === 20 ) options.multiplier = 0;
  if ( natural !== 1 ) return;

  options.multiplier = 1;
  options[MODULE_ID] = { maximize: true };
  const actor = fromUuidSync(uuid)?.actor ?? fromUuidSync(uuid);
  for ( const [change, types] of Object.entries(getDefences(actor, tray.damages)) ) {
    if ( !types.size ) continue;
    options.ignore ??= {};
    options.ignore[change] = types.union(options.ignore[change] ?? new Set());
  }
}

/**
 * The damage a damage message would do with every die at its highest, grouped as its damage tray groups it.
 * @param {ChatMessage5e} message
 * @returns {{ type: string, value: number }[]|void}
 */
export function getMaximumDamage(message) {
  const rolls = message?.rolls.filter(r => r instanceof CONFIG.Dice.DamageRoll);
  if ( !rolls?.length ) return;
  const maximised = rolls.map(roll => roll.clone().evaluateSync({ maximize: true }));
  return dnd5e.dice.aggregateDamageRolls(maximised, { respectProperties: true })
    .map(roll => ({ type: roll.options.type, value: Math.max(0, roll.total) }));
}

/**
 * The resistances and immunities that would lessen this damage, as the damage tray names them: a damage type, or "ALL".
 * dnd5e names only the first it finds for each damage, so one to fire under one to all damage only shows once "ALL" is
 * ignored.
 * @param {Actor5e} actor
 * @param {DamageDescription[]} damages
 * @returns {{ resistance: Set<string>, immunity: Set<string> }}
 */
function getDefences(actor, damages) {
  const found = { resistance: new Set(), immunity: new Set() };
  for ( let size = -1; size !== (found.resistance.size + found.immunity.size); ) {
    size = found.resistance.size + found.immunity.size;
    const calculated = actor?.calculateDamage?.(damages, { ignore: { ...found } });
    for ( const d of calculated || [] ) {
      for ( const change of ["resistance", "immunity"] ) {
        if ( d.active?.all?.[change] ) found[change].add("ALL");
        if ( d.active?.type?.[change] ) found[change].add(d.type);
      }
    }
  }
  return found;
}
