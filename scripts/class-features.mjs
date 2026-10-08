/**
 * Class features that change a roll already in chat. dnd5e tracks their uses but leaves the roll to the player, so they
 * are applied here as a Hero Card would be: the roll is rewritten in place and noted.
 *
 * Fighter's Indomitable rerolls a failed saving throw, and the new roll must be used. Under the 2024 rules the reroll
 * also adds the Fighter's level. A natural 1 is fixed in Sogrom's Table Tools, so Indomitable can't reroll one.
 */

import {
  MODULE_ID, describeD20s, finalize, getNatural, getRollKind, getRollTarget, isKnownFailure, localize, rerollD20,
  reportError
} from "./hero-cards.mjs";

/**
 * Rolls Indomitable is being used on from this client, so a second click cannot spend another use on the same roll.
 * Each entry is removed once its use finishes, however it ends.
 * @type {Set<string>}
 */
const using = new Set();

/* -------------------------------------------- */
/*  Hooks                                       */
/* -------------------------------------------- */

Hooks.on("getChatMessageContextOptions", onGetContextOptions);
Hooks.on("dnd5e.renderChatMessage", onRenderChatMessage);

/**
 * Offer Use Indomitable on a failed saving throw.
 * @param {ChatLog} _app
 * @param {ContextMenuEntry[]} options
 */
function onGetContextOptions(_app, options) {
  options.push({
    label: localize("STT.Indomitable.MenuLabel"),
    icon: "fa-solid fa-shield-halved",
    visible: li => !!getIndomitable(game.messages.get(li.dataset.messageId)),
    onClick: (_event, li) => useIndomitable(game.messages.get(li.dataset.messageId)).catch(reportError)
  });
}

/* -------------------------------------------- */

/**
 * Add a Use Indomitable button to a failed saving throw's message.
 * @param {ChatMessage5e} message
 * @param {HTMLElement} html
 */
function onRenderChatMessage(message, html) {
  const button = createIndomitableButton(message);
  if ( button ) html.querySelector(".message-content")?.append(button);
}

/* -------------------------------------------- */
/*  Indomitable                                 */
/* -------------------------------------------- */

/**
 * @param {Actor5e} actor
 * @returns {Item5e|void}  The actor's Indomitable class feature, as dnd5e builds it under either set of rules. The
 *   Hero Card of the same name is an activity of the Hero Cards feature, not this.
 */
function findIndomitable(actor) {
  return actor?.items.find(i => (i.type === "feat") && (i.system.identifier === "indomitable"));
}

/* -------------------------------------------- */

/**
 * The Indomitable feature that could be used on this roll right now, if any: the roll is a saving throw this user can
 * see failed, not on a natural 1, they may change it, and its actor has a use of Indomitable left.
 * @param {ChatMessage5e|void} message
 * @returns {Item5e|void}
 */
export function getIndomitable(message) {
  if ( !message || (getRollKind(message) !== "save") || !message.isContentVisible ) return;
  // A natural 1 is fixed in Sogrom's Table Tools: nothing rerolls it.
  if ( getNatural(message.rolls[0]) === 1 ) return;
  if ( !message.canUserModify(game.user, "update") ) return;
  const actor = message.getAssociatedActor();
  const item = findIndomitable(actor);
  if ( !item?.isOwner || !(item.system.uses?.value > 0) ) return;
  // Only once the person can see the save failed: offering it any sooner would tell them.
  if ( !isKnownFailure(message) ) return;
  return item;
}

/* -------------------------------------------- */

/**
 * @param {Item5e} item
 * @returns {number}  The bonus Indomitable adds to its reroll: the Fighter's level under the 2024 rules, otherwise 0.
 */
function getIndomitableBonus(item) {
  if ( item.system.source?.rules !== "2024" ) return 0;
  return item.actor.classes?.fighter?.system.levels ?? 0;
}

/* -------------------------------------------- */

/**
 * Spend a use of Indomitable to reroll a failed saving throw, noting it on the roll. A save with no DC can't be known
 * to have failed, so the player is asked to confirm first rather than lose a use to a stray click.
 * @param {ChatMessage5e} message
 */
export async function useIndomitable(message) {
  const item = getIndomitable(message);
  if ( !item || using.has(message.id) ) return;
  using.add(message.id);
  try {
    if ( !Number.isNumeric(getRollTarget(message, message.rolls[0])) && !(await confirmIndomitable(item)) ) return;
    await rerollWithIndomitable(message, item);
  } finally {
    using.delete(message.id);
  }
}

/* -------------------------------------------- */

/**
 * @param {Item5e} item  The Indomitable feature.
 * @returns {Promise<boolean>}  Whether the player confirmed spending a use on a save with no DC.
 */
async function confirmIndomitable(item) {
  return foundry.applications.api.DialogV2.confirm({
    window: { title: item.name, icon: "fa-solid fa-shield-halved" },
    content: `<p>${foundry.utils.escapeHTML(localize("STT.Indomitable.ConfirmNoDC", {
      name: item.name, uses: item.system.uses.value
    }))}</p>`,
    rejectClose: false
  });
}

/* -------------------------------------------- */

/**
 * Reroll the save and spend the use. The use is spent before the roll is saved, and given back if saving the roll
 * fails, so the player never loses a use without getting the reroll.
 *
 * If two clients use it on the same roll at the same moment, both write the same `spent` count, so one use is spent,
 * and the roll ends as whichever reroll was saved last.
 * @param {ChatMessage5e} message
 * @param {Item5e} item  The Indomitable feature.
 */
async function rerollWithIndomitable(message, item) {
  const rolls = message.rolls.map(r => Roll.fromData(r.toJSON()));
  const before = rolls[0].total;
  const [old, values] = await rerollD20(rolls[0], message);
  let bonusText = "";
  const bonus = getIndomitableBonus(item);
  if ( bonus ) {
    const { NumericTerm, OperatorTerm } = foundry.dice.terms;
    rolls[0].terms.push(
      OperatorTerm.fromData({ class: "OperatorTerm", operator: "+", evaluated: true }),
      NumericTerm.fromData({
        class: "NumericTerm", number: bonus, options: { flavor: localize("STT.Indomitable.FighterLevel") }, evaluated: true
      })
    );
    finalize(rolls[0]);
    bonusText = localize("STT.Indomitable.LevelBonus", { bonus });
  }

  const detail = localize("STT.Indomitable.Log", {
    dice: describeD20s(values), old: old.join(", "), new: values.join(", "), bonus: bonusText, before,
    after: rolls[0].total
  });
  const entry = {
    text: localize("STT.Cards.Log.Entry", { card: item.name, detail }),
    card: item.name,
    icon: "fa-solid fa-shield-halved",
    by: item.actor.name
  };
  const log = [...(message.getFlag(MODULE_ID, "log") ?? []), entry];
  const spent = item.system.uses.spent ?? 0;
  await item.update({ "system.uses.spent": spent + 1 });
  try {
    await message.update({ rolls: rolls.map(r => r.toJSON()), [`flags.${MODULE_ID}.log`]: log });
  } catch(err) {
    await item.update({ "system.uses.spent": spent });
    throw err;
  }
}

/* -------------------------------------------- */

/**
 * @param {ChatMessage5e} message  A roll message.
 * @param {object} [options]
 * @param {boolean} [options.compact]  Render as an icon-only button, as on a request card's row.
 * @returns {HTMLButtonElement|void}  A button to use Indomitable on the roll, if it can be.
 */
export function createIndomitableButton(message, { compact=false }={}) {
  const item = getIndomitable(message);
  if ( !item ) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = compact ? "stt-feature-button icon" : "stt-feature-button";
  const label = localize("STT.Indomitable.Button", { name: item.name });
  button.dataset.tooltipText = localize("STT.Indomitable.ButtonTooltip", { name: item.name, uses: item.system.uses.value });
  button.setAttribute("aria-label", label);
  button.innerHTML = '<i class="fa-solid fa-shield-halved" inert></i>';
  if ( !compact ) button.append(` ${label}`);
  button.addEventListener("click", async event => {
    event.preventDefault();
    event.stopPropagation();
    button.disabled = true;
    try {
      await useIndomitable(message);
    } catch(err) {
      reportError(err);
    } finally {
      button.disabled = false;
    }
  });
  return button;
}
