/**
 * RoBear-E Cards: let a player spend a card from the "RoBear-E Cards" feature on a roll that is already in chat.
 * The chat message's rolls are rewritten in place, so dnd5e re-evaluates hit/miss and save success on re-render.
 */

const MODULE_ID = "sogrom-robear-e";
const CARDS_ITEM_ID = "xFVsPIjSASjXaqUO";
const CARDS_IDENTIFIER = "robear-e";
const IMAGE_PATH = `modules/${MODULE_ID}/assets/images`;

/**
 * Card activities that can change a roll, keyed by activity ID with the activity name as a fallback.
 * `appliesTo` lists the roll kinds (see getRollKind) the card may be spent on.
 */
const CARDS = {
  inspiration: {
    ids: ["iE0w9Rp70zne6zuJ", "na7uWxkaPiGn00ZK", "l1s90u72J3Q34HFN"],
    names: ["inspiration - 1d6", "inspiration - 1d8", "inspiration - 1d10"],
    appliesTo: ["attack", "damage", "check", "save", "initiative"]
  },
  luck: {
    ids: ["uPqHABvpmYZr0ASg"],
    names: ["luck"],
    appliesTo: ["attack", "damage", "check", "save", "initiative"]
  },
  advantage: {
    ids: ["OkUWoFMxuyT5TxX7"],
    names: ["advantage"],
    appliesTo: ["attack", "check", "save", "initiative"]
  },
  indomitable: {
    ids: ["aE8dyIQUgvXfcu3M"],
    names: ["indomitable"],
    appliesTo: ["save"]
  },
  relentless: {
    ids: ["28kjjOyF9Suf3hkq"],
    names: ["relentless"],
    appliesTo: ["initiative"]
  }
};

/**
 * Card art in IMAGE_PATH for every card, keyed by lower-case activity name.
 */
const CARD_ART = {
  "advantage": "advantagedc20.webp",
  "charger": "chargerdc20.webp",
  "divine intervention": "divineintervention.webp",
  "extra strike": "extrastrikedc20.webp",
  "indomitable": "indomitabledc20.webp",
  "inspiration - 1d6": "inspiration-1d6-dc20.webp",
  "inspiration - 1d8": "inspiration-1d8-dc20.webp",
  "inspiration - 1d10": "inspiration-1d10-dc20.webp",
  "luck": "luckdc20.webp",
  "minds eye": "mindseye.webp",
  "reaction surge": "reactionsurge.webp",
  "relentless": "relentlessdc20.webp"
};

/**
 * Activity UUIDs currently being spent from a chat card, so the "Advantage on next roll" handler can ignore them.
 * @type {Set<string>}
 */
const retroactiveUses = new Set();

/* -------------------------------------------- */
/*  Hooks                                       */
/* -------------------------------------------- */

Hooks.once("setup", wrapItemUse);
Hooks.on("dnd5e.renderChatMessage", onRenderChatMessage);
Hooks.on("updateChatMessage", onUpdateChatMessage);
Hooks.on("dnd5e.postUseActivity", onPostUseActivity);
Hooks.on("dnd5e.preRollD20TestV2", onPreRollD20Test);
Hooks.on("dnd5e.postD20TestRollConfiguration", onPostD20TestRollConfiguration);

/**
 * dnd5e offers no hook before its activity choice list, so wrap Item#use to show the card picker instead for the
 * RoBear-E Cards feature. Shift-click still uses dnd5e's own behaviour.
 */
function wrapItemUse() {
  const proto = CONFIG.Item.documentClass.prototype;
  const use = proto.use;
  proto.use = async function(config={}, dialog={}, message={}) {
    if ( !isCardItem(this) || !this.actor || config.event?.shiftKey ) return use.call(this, config, dialog, message);
    const options = this.system.activities
      .filter(a => a.canUse && hasUsesLeft(a))
      .map(activity => ({ activity, label: getCardLabel(activity), img: getCardArt(activity) }));
    if ( !options.length ) {
      ui.notifications.warn("You have no RoBear-E Cards left until your next long rest.");
      return;
    }
    const option = await chooseCard(options, "Choose a card to play. It will be spent until your next long rest.");
    if ( option ) return option.activity.use(config, dialog, message);
  };
}

/* -------------------------------------------- */

/**
 * Add a card button to eligible roll messages, and to eligible roll summaries shown inside activity cards.
 * @param {ChatMessage5e} message
 * @param {HTMLElement} html
 */
function onRenderChatMessage(message, html) {
  if ( getCardOptions(message).length ) {
    const content = html.querySelector(".message-content");
    content?.append(...renderLog(message), createCardButton(message));
  }

  for ( const summary of html.querySelectorAll(".card-summary[data-message-id]") ) {
    const child = game.messages.get(summary.dataset.messageId);
    if ( !child || !getCardOptions(child).length ) continue;
    const row = summary.querySelector(".icon-row") ?? summary;
    row.append(createCardButton(child, { compact: true }));
    summary.append(...renderLog(child));
  }
}

/* -------------------------------------------- */

/**
 * Summarised rolls are drawn inside their originating activity card, which dnd5e only refreshes on system changes.
 * @param {ChatMessage5e} message
 * @param {object} changes
 */
async function onUpdateChatMessage(message, changes) {
  if ( !("rolls" in changes) ) return;
  const origin = message.system?.origin;
  if ( !origin ) return;
  await origin.system?.onDescendentRefresh?.(message);
  ui.chat?.updateMessage(origin);
}

/* -------------------------------------------- */

/**
 * Using the Advantage card from the sheet grants advantage on the next d20 test.
 * @param {Activity} activity
 */
async function onPostUseActivity(activity) {
  if ( (getCardKey(activity) !== "advantage") || retroactiveUses.has(activity.uuid) ) return;
  const actor = activity.actor;
  if ( !actor ) return;
  await actor.setFlag(MODULE_ID, "advantage", true);
  ui.notifications.info(`${actor.name}'s next attack roll, ability check, or saving throw will be made with advantage.`);
}

/* -------------------------------------------- */

/**
 * Apply a pending Advantage card to the roll before its dialog opens.
 * @param {object} config  Roll process configuration.
 */
function onPreRollD20Test(config) {
  if ( !getSubjectActor(config.subject)?.getFlag(MODULE_ID, "advantage") ) return;
  for ( const roll of config.rolls ?? [] ) {
    roll.options ??= {};
    roll.options.advantage = true;
  }
}

/* -------------------------------------------- */

/**
 * Clear a pending Advantage card once a roll using it has been confirmed.
 * @param {D20Roll[]} rolls
 * @param {object} config  Roll process configuration.
 */
function onPostD20TestRollConfiguration(rolls, config) {
  const actor = getSubjectActor(config.subject);
  if ( rolls.length && actor?.getFlag(MODULE_ID, "advantage") ) actor.unsetFlag(MODULE_ID, "advantage");
}

/* -------------------------------------------- */
/*  Eligibility                                 */
/* -------------------------------------------- */

/**
 * @param {Actor5e|Activity|void} subject
 * @returns {Actor5e|void}
 */
function getSubjectActor(subject) {
  return subject instanceof Actor ? subject : subject?.actor;
}

/* -------------------------------------------- */

/**
 * Classify a chat message by the kind of roll it holds.
 * @param {ChatMessage5e} message
 * @returns {"attack"|"damage"|"check"|"save"|"initiative"|null}
 */
function getRollKind(message) {
  if ( !message.rolls.length ) return null;
  switch ( message.type ) {
    case "attack":
    case "damage":
      return message.type;
    case "check":
      return message.system.type === "initiative" ? "initiative" : "check";
    case "save":
      // Death saves have already been applied to the actor, so changing the card would desync them.
      return message.system.type === "death" ? null : "save";
    default:
      return null;
  }
}

/* -------------------------------------------- */

/**
 * @param {Activity} activity
 * @returns {string|void}  Key in CARDS.
 */
function getCardKey(activity) {
  const name = activity.name?.trim().toLowerCase();
  return Object.entries(CARDS).find(([, c]) => c.ids.includes(activity.id) || c.names.includes(name))?.[0];
}

/* -------------------------------------------- */

/**
 * @param {Actor5e} actor
 * @returns {Item5e[]}  The actor's RoBear-E Cards features.
 */
function getCardItems(actor) {
  return actor.items.filter(isCardItem);
}

/* -------------------------------------------- */

/**
 * @param {Item5e} item
 * @returns {boolean}  Is this a RoBear-E Cards feature?
 */
function isCardItem(item) {
  return (item.system.identifier === CARDS_IDENTIFIER)
    || !!item._stats?.compendiumSource?.endsWith(CARDS_ITEM_ID)
    || (item.name === "RoBear-E Cards");
}

/* -------------------------------------------- */

/**
 * @param {Activity} activity
 * @returns {boolean}  Whether the card can still be played. Cards with limited uses and none remaining cannot.
 */
function hasUsesLeft(activity) {
  return !activity.uses?.max || (activity.uses.value > 0);
}

/* -------------------------------------------- */

/**
 * @param {Activity} activity
 * @returns {string}  Display name, with Inspiration shown as the die it adds.
 */
function getCardLabel(activity) {
  return activity.name.replace(/^Inspiration\s*-\s*/i, "Inspiration + ");
}

/* -------------------------------------------- */

/**
 * @param {Activity} activity
 * @returns {string}  Path to the card's art, falling back to the activity's own icon.
 */
function getCardArt(activity) {
  const file = CARD_ART[activity.name.trim().toLowerCase()];
  return file ? `${IMAGE_PATH}/${file}` : activity.img;
}

/* -------------------------------------------- */

/**
 * Determine which cards the current user may spend on this message right now.
 * @param {ChatMessage5e} message
 * @returns {{ key: string, activity: Activity, label: string, icon: string }[]}
 */
function getCardOptions(message) {
  const kind = getRollKind(message);
  if ( !kind || !message.isContentVisible || !(message.isAuthor || game.user.isGM) ) return [];
  const actor = message.getAssociatedActor();
  if ( !actor?.isOwner ) return [];

  const roll = message.rolls[0];
  const d20 = (roll instanceof CONFIG.Dice.D20Roll) ? roll.d20 : null;
  const natural = d20?.results.find(r => r.active)?.result;
  const options = [];

  for ( const item of getCardItems(actor) ) {
    for ( const activity of item.system.activities ) {
      const key = getCardKey(activity);
      const card = CARDS[key];
      if ( !card?.appliesTo.includes(kind) ) continue;
      if ( !hasUsesLeft(activity) ) continue;

      switch ( key ) {
        case "inspiration":
          if ( !activity.roll?.formula ) continue;
          break;
        case "luck":
          if ( (kind !== "damage") && (!d20 || [1, 20].includes(natural)) ) continue;
          break;
        case "advantage":
          if ( !d20 || roll.hasAdvantage ) continue;
          break;
        case "indomitable":
          if ( !d20 || (Number.isNumeric(roll.options.target) && !roll.isFailure) ) continue;
          break;
        case "relentless":
          if ( !d20 || !findCombatant(message) || (game.combat.round > 1) ) continue;
          break;
      }
      options.push({ key, activity, label: getCardLabel(activity), img: getCardArt(activity) });
    }
  }
  return options;
}

/* -------------------------------------------- */

/**
 * @param {ChatMessage5e} message  An initiative roll message.
 * @returns {Combatant|void}
 */
function findCombatant(message) {
  const { actor, token } = message.speaker;
  return game.combat?.combatants.find(c => token ? c.tokenId === token : c.actorId === actor);
}

/* -------------------------------------------- */
/*  Rendering                                   */
/* -------------------------------------------- */

/**
 * @param {ChatMessage5e} message
 * @param {object} [options]
 * @param {boolean} [options.compact]  Render as an icon-only button.
 * @returns {HTMLButtonElement}
 */
function createCardButton(message, { compact=false }={}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = compact ? "robear-card-button icon" : "robear-card-button";
  button.dataset.tooltip = "Use a RoBear-E Card on this roll";
  button.innerHTML = `<i class="fa-solid fa-clone" inert></i>${compact ? "" : " RoBear-E Card"}`;
  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    promptCard(message, button);
  });
  return button;
}

/* -------------------------------------------- */

/**
 * @param {ChatMessage5e} message
 * @returns {HTMLElement[]}  Notes describing cards already spent on this message.
 */
function renderLog(message) {
  return (message.getFlag(MODULE_ID, "log") ?? []).map(entry => {
    const p = document.createElement("p");
    p.className = "supplement robear-card-log";
    p.innerHTML = `<strong>RoBear-E:</strong> `;
    p.append(entry);
    return p;
  });
}

/* -------------------------------------------- */
/*  Spending Cards                              */
/* -------------------------------------------- */

/**
 * Ask which card to spend, then apply it.
 * @param {ChatMessage5e} message
 * @param {HTMLButtonElement} button
 */
async function promptCard(message, button) {
  const options = getCardOptions(message);
  if ( !options.length ) return;
  const option = await chooseCard(options, "Choose a card to play on this roll. It will be spent until your next long rest.");
  if ( !option ) return;

  button.disabled = true;
  try {
    await applyCard(message, option);
  } finally {
    button.disabled = false;
  }
}

/* -------------------------------------------- */

/**
 * Show the card picker.
 * @param {{ label: string, img: string }[]} options
 * @param {string} hint  Instruction shown above the cards.
 * @returns {Promise<object|void>}  The chosen option.
 */
async function chooseCard(options, hint) {
  const cards = options.map((o, i) => `
    <button type="button" class="robear-card-choice" data-index="${i}" data-tooltip="${o.label}">
      <img src="${o.img}" alt="${o.label}">
      <span>${o.label}</span>
    </button>
  `).join("");

  // Card buttons live in the content rather than the footer, so the chosen index is returned through `close`.
  let chosen;
  await foundry.applications.api.DialogV2.wait({
    classes: ["robear-card-dialog"],
    window: { title: "Use a RoBear-E Card", icon: "fa-solid fa-clone" },
    position: { width: Math.clamp(48 + (options.length * 124), 340, 792) },
    content: `
      <p class="robear-card-hint">${hint}</p>
      <div class="robear-card-grid">${cards}</div>
    `,
    buttons: [{ action: "cancel", label: "Cancel", icon: "fa-solid fa-xmark" }],
    render: (event, dialog) => {
      for ( const el of dialog.element.querySelectorAll(".robear-card-choice") ) {
        el.addEventListener("click", () => {
          chosen = Number(el.dataset.index);
          dialog.close();
        });
      }
    },
    close: () => chosen,
    rejectClose: false
  });
  return options[chosen];
}

/* -------------------------------------------- */

/**
 * Spend the card's use, then rewrite the message's rolls.
 * @param {ChatMessage5e} message
 * @param {{ key: string, activity: Activity, label: string }} option
 */
async function applyCard(message, { key, activity, label }) {
  retroactiveUses.add(activity.uuid);
  let used;
  try {
    used = await activity.use({ subsequentActions: false }, { configure: false });
  } finally {
    retroactiveUses.delete(activity.uuid);
  }
  if ( !used ) return;

  const rolls = message.rolls.map(r => Roll.fromData(r.toJSON()));
  const before = rolls[0].total;
  let detail;

  switch ( key ) {
    case "inspiration": {
      const bonus = await new Roll(activity.roll.formula).evaluate();
      await showDice(bonus, message);
      const { OperatorTerm } = foundry.dice.terms;
      rolls[0].terms.push(OperatorTerm.fromData({ class: "OperatorTerm", operator: "+", evaluated: true }), ...bonus.terms);
      finalize(rolls[0]);
      detail = `added ${bonus.formula} (${bonus.total}): ${before} + ${bonus.total} = ${rolls[0].total}`;
      break;
    }
    case "luck":
      if ( getRollKind(message) === "damage" ) {
        await rerollAllDice(rolls, message);
        detail = `rerolled damage dice: ${sumTotals(message.rolls)} → ${sumTotals(rolls)}`;
        break;
      }
      // Falls through to reroll the d20.
    case "indomitable":
    case "relentless": {
      const [old, values] = await rerollD20(rolls[0], message);
      const dice = values.length > 1 ? "both d20s" : "the d20";
      detail = `rerolled ${dice} (${old.join(", ")} → ${values.join(", ")}): ${before} → ${rolls[0].total}`;
      break;
    }
    case "advantage": {
      if ( cancelDisadvantage(rolls[0]) ) {
        detail = `cancelled disadvantage: ${before} → ${rolls[0].total}`;
        break;
      }
      const [first, second] = await addAdvantage(rolls[0], message);
      detail = `rolled with advantage (${first} and ${second}): ${before} → ${rolls[0].total}`;
      break;
    }
  }

  const log = [...(message.getFlag(MODULE_ID, "log") ?? []), `${label}: ${detail}`];
  await message.update({ rolls: rolls.map(r => r.toJSON()), [`flags.${MODULE_ID}.log`]: log });

  if ( getRollKind(message) === "initiative" ) await findCombatant(message)?.update({ initiative: rolls[0].total });
}

/* -------------------------------------------- */
/*  Roll Manipulation                           */
/* -------------------------------------------- */

/**
 * Recompute a roll's formula and total after its terms were changed.
 * @param {Roll} roll
 */
function finalize(roll) {
  roll.resetFormula();
  roll._total = roll._evaluateTotal();
}

/* -------------------------------------------- */

/**
 * @param {Roll[]} rolls
 * @returns {number}
 */
function sumTotals(rolls) {
  return rolls.reduce((total, r) => total + r.total, 0);
}

/* -------------------------------------------- */

/**
 * Roll fresh dice, showing them with Dice So Nice if it is active.
 * @param {{ number: number, faces: number }[]} groups
 * @param {ChatMessage5e} message
 * @returns {Promise<number[][]>}  Results for each group.
 */
async function rollFresh(groups, message) {
  const roll = await new Roll(groups.map(g => `${g.number}d${g.faces}`).join(" + ")).evaluate();
  await showDice(roll, message);
  return roll.dice.map(d => d.results.map(r => r.result));
}

/* -------------------------------------------- */

/**
 * @param {Roll} roll
 * @param {ChatMessage5e} message  Message whose visibility the dice animation should match.
 */
async function showDice(roll, message) {
  if ( !game.dice3d ) return;
  const whisper = message.whisper.length ? message.whisper : null;
  await game.dice3d.showForRoll(roll, game.user, true, whisper, message.blind);
}

/* -------------------------------------------- */

/**
 * The d20 results currently in play: the last two not yet rerolled for advantage or disadvantage, otherwise the kept one.
 * @param {D20Roll} roll
 * @returns {object[]}
 */
function getLiveResults(roll) {
  const live = roll.d20.results.filter(r => !r.rerolled);
  return (roll.hasAdvantage || roll.hasDisadvantage) ? live.slice(-2) : live.filter(r => r.active);
}

/* -------------------------------------------- */

/**
 * Reroll whatever d20s are in play, keeping the higher or lower of a new pair as the roll's mode demands.
 * The new result must be used.
 * @param {D20Roll} roll
 * @param {ChatMessage5e} message
 * @returns {Promise<[number[], number[]]>}  The old and new results.
 */
async function rerollD20(roll, message) {
  const live = getLiveResults(roll);
  const [values] = await rollFresh([{ number: live.length, faces: 20 }], message);
  for ( const r of live ) {
    r.active = false;
    r.discarded = false;
    r.rerolled = true;
  }

  const kept = values.indexOf(roll.hasDisadvantage ? Math.min(...values) : Math.max(...values));
  roll.d20.results.push(...values.map((result, i) => ({ result, active: i === kept, discarded: i !== kept })));
  finalize(roll);
  return [live.map(r => r.result), values];
}

/* -------------------------------------------- */

/**
 * Advantage and disadvantage cancel out, leaving a straight roll of the first d20 in the pair.
 * @param {D20Roll} roll
 * @returns {boolean}  Whether disadvantage was cancelled.
 */
function cancelDisadvantage(roll) {
  if ( !roll.hasDisadvantage ) return false;
  const [first, second] = getLiveResults(roll);
  roll.d20.applyAdvantage(CONFIG.Dice.D20Roll.ADV_MODE.NORMAL);
  roll.options.advantageMode = CONFIG.Dice.D20Roll.ADV_MODE.NORMAL;
  Object.assign(first, { active: true, discarded: false });
  if ( second ) Object.assign(second, { active: false, discarded: true });
  finalize(roll);
  return true;
}

/* -------------------------------------------- */

/**
 * Roll a second d20 and keep the higher.
 * @param {D20Roll} roll
 * @param {ChatMessage5e} message
 * @returns {Promise<[number, number]>}  Both d20 results.
 */
async function addAdvantage(roll, message) {
  const die = roll.d20;
  const [[value]] = await rollFresh([{ number: 1, faces: 20 }], message);
  const first = die.results.find(r => r.active)?.result;
  die.applyAdvantage(CONFIG.Dice.D20Roll.ADV_MODE.ADVANTAGE);
  roll.options.advantageMode = CONFIG.Dice.D20Roll.ADV_MODE.ADVANTAGE;
  die.results.push({ result: value, active: true });

  const best = Math.max(first, value);
  let kept = false;
  for ( const r of die.results ) {
    if ( !r.active ) continue;
    if ( !kept && (r.result === best) ) kept = true;
    else {
      r.active = false;
      r.discarded = true;
    }
  }
  finalize(roll);
  return [first, value];
}

/* -------------------------------------------- */

/**
 * Reroll every active die across a set of damage rolls.
 * @param {DamageRoll[]} rolls
 * @param {ChatMessage5e} message
 */
async function rerollAllDice(rolls, message) {
  const dice = rolls.flatMap(r => r.dice).map(die => ({ die, active: die.results.filter(r => r.active) }))
    .filter(d => d.active.length);
  const fresh = await rollFresh(dice.map(({ die, active }) => ({ number: active.length, faces: die.faces })), message);
  dice.forEach(({ die, active }, i) => {
    for ( const r of active ) {
      r.active = false;
      r.rerolled = true;
    }
    die.results.push(...fresh[i].map(result => ({ result, active: true })));
  });
  rolls.forEach(finalize);
}
