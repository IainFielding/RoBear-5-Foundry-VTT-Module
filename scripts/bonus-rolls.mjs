/**
 * Bonus rolls: a die rolled by another feature, such as Bardic Inspiration or Cutting Words, can be added to or
 * subtracted from a roll already in chat. Right-click the bonus roll's message and choose the roll to change.
 *
 * The roll changed is rewritten in place, as a RoBear-E Card's Inspiration does, so its total, hit or miss, and any
 * roll request's result are worked out again. The bonus roll is marked as used, so it can only be spent once.
 */

import { MODULE_ID, findCombatant, finalize, getRollKind } from "./robear-cards.mjs";

/**
 * How many of the latest chat messages are offered as rolls to change.
 */
const RECENT_MESSAGES = 30;

/* -------------------------------------------- */
/*  Hooks                                       */
/* -------------------------------------------- */

Hooks.on("getChatMessageContextOptions", onGetContextOptions);
Hooks.on("dnd5e.renderChatMessage", onRenderChatMessage);
Hooks.once("ready", () => game.socket.on(`module.${MODULE_ID}`, onSocketMessage));

/**
 * Offer Add to a roll and Subtract from a roll on a bonus roll's message.
 * @param {ChatLog} _app
 * @param {ContextMenuEntry[]} options
 */
function onGetContextOptions(_app, options) {
  for ( const sign of [1, -1] ) {
    options.push({
      label: sign > 0 ? "Add to a roll…" : "Subtract from a roll…",
      icon: sign > 0 ? "fa-solid fa-plus" : "fa-solid fa-minus",
      visible: li => isBonusRoll(game.messages.get(li.dataset.messageId)),
      onClick: (_event, li) => chooseTarget(game.messages.get(li.dataset.messageId), sign)
    });
  }
}

/* -------------------------------------------- */

/**
 * Note on a bonus roll which roll it was spent on.
 * @param {ChatMessage5e} message
 * @param {HTMLElement} html
 */
function onRenderChatMessage(message, html) {
  const used = message.getFlag(MODULE_ID, "bonusUsed");
  if ( !used ) return;
  const note = document.createElement("p");
  note.className = "supplement robear-card-log robear-bonus-used";
  note.innerHTML = `<i class="fa-solid ${used.sign > 0 ? "fa-plus" : "fa-minus"}" inert></i>`;
  note.append(`${used.sign > 0 ? "Added to" : "Subtracted from"} ${used.target}`);
  html.querySelector(".message-content")?.append(note);
}

/* -------------------------------------------- */

/**
 * The active GM applies bonuses for users who may not change the rolls involved themselves.
 * @param {object} data
 */
function onSocketMessage(data) {
  if ( (data?.action !== "applyBonus") || (game.user !== game.users.activeGM) ) return;
  applyBonus(game.messages.get(data.source), game.messages.get(data.target), data.sign);
}

/* -------------------------------------------- */
/*  Choosing                                    */
/* -------------------------------------------- */

/**
 * @param {ChatMessage5e|void} message
 * @returns {boolean}  Whether this message is a bonus roll that can still be spent: a plain roll, such as a feature's
 *   die, rather than a check, save, attack or damage roll, and not one made for a roll request.
 */
export function isBonusRoll(message) {
  if ( !message?.rolls.length || !message.isContentVisible ) return false;
  if ( message.getFlag(MODULE_ID, "bonusUsed") || message.getFlag(MODULE_ID, "requestRoll") ) return false;
  return getRollKind(message) === null;
}

/* -------------------------------------------- */

/**
 * @param {ChatMessage5e} source  The bonus roll.
 * @returns {ChatMessage5e[]}  The latest rolls this user could change with it, newest first.
 */
export function getTargets(source) {
  const canAsk = !!game.users.activeGM;
  return game.messages.contents.slice(-RECENT_MESSAGES).reverse().filter(message => {
    if ( (message === source) || !message.isContentVisible || !getRollKind(message) ) return false;
    return canAsk || message.canUserModify(game.user, "update");
  });
}

/* -------------------------------------------- */

/**
 * @param {ChatMessage5e} message  A roll to change.
 * @param {object} [options]
 * @param {boolean} [options.total=true]  Include the roll's current total.
 * @returns {string}  How it is listed, e.g. "Sefris · Dexterity Saving Throw · 12".
 */
function describeTarget(message, { total=true }={}) {
  const who = message.getAssociatedActor()?.name ?? message.speaker.alias;
  const sum = total ? message.rolls.reduce((t, r) => t + r.total, 0) : null;
  return [who, message.flavor || getRollKind(message).capitalize(), sum].filterJoin(" · ");
}

/* -------------------------------------------- */

/**
 * @param {ChatMessage5e} source
 * @returns {string}  The bonus's name: its feature's, or the message's flavor.
 */
function getBonusLabel(source) {
  return source.getAssociatedActivity?.()?.item?.name || source.flavor || "Bonus roll";
}

/* -------------------------------------------- */

/**
 * Ask which roll to change, then change it.
 * @param {ChatMessage5e} source
 * @param {1|-1} sign  Add or subtract.
 */
async function chooseTarget(source, sign) {
  const targets = getTargets(source);
  if ( !targets.length ) {
    ui.notifications.warn("There is no roll in chat this can be added to.");
    return;
  }
  const verb = sign > 0 ? "Add" : "Subtract";
  const buttons = targets.map((m, i) => `
    <button type="button" class="robear-bonus-choice" data-index="${i}">
      <span>${foundry.utils.escapeHTML(describeTarget(m))}</span>
    </button>
  `).join("");

  let chosen;
  await foundry.applications.api.DialogV2.wait({
    classes: ["robear-card-dialog", "robear-bonus-dialog"],
    window: { title: `${verb} ${getBonusLabel(source)}`, icon: `fa-solid ${sign > 0 ? "fa-plus" : "fa-minus"}` },
    position: { width: 420 },
    content: `
      <p class="robear-card-hint">${verb} ${source.rolls[0].formula} (${source.rolls[0].total})
        ${sign > 0 ? "to" : "from"} which roll?</p>
      <div class="robear-bonus-list">${buttons}</div>
    `,
    buttons: [{ action: "cancel", label: "Cancel", icon: "fa-solid fa-xmark" }],
    render: (_event, dialog) => {
      for ( const el of dialog.element.querySelectorAll(".robear-bonus-choice") ) {
        el.addEventListener("click", () => {
          chosen = Number(el.dataset.index);
          dialog.close();
        });
      }
    },
    close: () => chosen,
    rejectClose: false
  });
  const target = targets[chosen];
  if ( !target ) return;

  // Rolls this user may not change are changed by the GM.
  const allowed = target.canUserModify(game.user, "update") && source.canUserModify(game.user, "update");
  if ( allowed ) return applyBonus(source, target, sign);
  game.socket.emit(`module.${MODULE_ID}`, { action: "applyBonus", source: source.id, target: target.id, sign });
  ui.notifications.info("Sent to the GM to apply.");
}

/* -------------------------------------------- */
/*  Applying                                    */
/* -------------------------------------------- */

/**
 * Add a bonus roll's total to another roll, or subtract it, noting it on both.
 * @param {ChatMessage5e|void} source  The bonus roll.
 * @param {ChatMessage5e|void} target  The roll to change.
 * @param {1|-1} sign
 */
export async function applyBonus(source, target, sign) {
  if ( !source || !target || source.getFlag(MODULE_ID, "bonusUsed") ) return;
  const bonus = source.rolls[0];
  const rolls = target.rolls.map(r => Roll.fromData(r.toJSON()));
  const before = rolls[0].total;
  const description = describeTarget(target, { total: false });

  // A single die keeps its dice in the roll's breakdown; anything longer is added as its total.
  const { NumericTerm, OperatorTerm } = foundry.dice.terms;
  const terms = Roll.fromData(bonus.toJSON()).terms;
  rolls[0].terms.push(OperatorTerm.fromData({ class: "OperatorTerm", operator: sign > 0 ? "+" : "-", evaluated: true }));
  if ( terms.length === 1 ) rolls[0].terms.push(terms[0]);
  else rolls[0].terms.push(NumericTerm.fromData({
    class: "NumericTerm", number: bonus.total, options: { flavor: bonus.formula }, evaluated: true
  }));
  finalize(rolls[0]);

  const label = getBonusLabel(source);
  const verb = sign > 0 ? "added" : "subtracted";
  const entry = {
    text: `${label}: ${verb} ${bonus.formula} (${bonus.total}): ${before} → ${rolls[0].total}`,
    card: label,
    icon: sign > 0 ? "fa-solid fa-plus" : "fa-solid fa-minus",
    by: source.getAssociatedActor()?.name ?? source.speaker.alias ?? ""
  };
  const log = [...(target.getFlag(MODULE_ID, "log") ?? []), entry];
  await target.update({ rolls: rolls.map(r => r.toJSON()), [`flags.${MODULE_ID}.log`]: log });
  await source.setFlag(MODULE_ID, "bonusUsed", { target: description, sign });

  if ( getRollKind(target) === "initiative" ) await findCombatant(target)?.update({ initiative: rolls[0].total });
}
