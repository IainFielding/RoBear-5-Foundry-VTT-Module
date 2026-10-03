/**
 * RoBear-E Cards: let a player spend a card from the "RoBear-E Cards" feature on a roll that is already in chat.
 * The chat message's rolls are rewritten in place, so dnd5e re-evaluates hit/miss and save success on re-render.
 */

export const MODULE_ID = "sogrom-robear-e";
const CARDS_ITEM_ID = "xFVsPIjSASjXaqUO";
const CARDS_IDENTIFIER = "robear-e";
const IMAGE_PATH = `modules/${MODULE_ID}/assets/images`;

/**
 * Card activities that can change a roll, keyed by activity ID with the activity name as a fallback.
 * `appliesTo` lists the roll kinds (see getRollKind) the card may be spent on. `rerolls` marks a card that rerolls the
 * d20, which can never be played on a natural 1.
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
    appliesTo: ["attack", "damage", "check", "save", "initiative", "divine"],
    rerolls: true
  },
  advantage: {
    ids: ["OkUWoFMxuyT5TxX7"],
    names: ["advantage"],
    appliesTo: ["attack", "check", "save", "initiative", "divine"]
  },
  indomitable: {
    ids: ["aE8dyIQUgvXfcu3M"],
    names: ["indomitable"],
    appliesTo: ["save"],
    rerolls: true
  },
  relentless: {
    ids: ["28kjjOyF9Suf3hkq"],
    names: ["relentless"],
    appliesTo: ["initiative"],
    rerolls: true
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

/**
 * Roll messages a card is being chosen for or played on from this client, from when the card picker opens until the
 * card is applied, so a second click cannot open another picker and spend a second card on the same roll.
 * @type {Set<string>}
 */
const playing = new Set();

/**
 * How long a played card's art stays on screen.
 */
const PLAYED_CARD_MS = 3000;

/**
 * How many played cards are shown on screen side by side. Cards played while that many are up wait their turn.
 */
const PLAYED_CARD_MAX = 3;

/**
 * Played cards waiting for room on screen, oldest first.
 * @type {CardLogEntry[]}
 */
const playedCardQueue = [];

/* -------------------------------------------- */
/*  Localization                                */
/* -------------------------------------------- */

/**
 * Translate one of the module's strings from its language file.
 * @param {string} key      A key in lang/en.json, such as "ROBEAR.Cards.Button".
 * @param {object} [data]   Values for the string's {placeholders}.
 * @returns {string}
 */
export function localize(key, data) {
  return data ? game.i18n.format(key, data) : game.i18n.localize(key);
}

/**
 * Tell the user an action they took failed, and log why, rather than leaving a button that silently did nothing.
 * @param {Error} err
 */
export function reportError(err) {
  console.error(`${MODULE_ID} |`, err);
  ui.notifications.error(err.message);
}

/* -------------------------------------------- */
/*  Hooks                                       */
/* -------------------------------------------- */

Hooks.once("init", registerSettings);
Hooks.once("setup", wrapItemUse);
Hooks.on("dnd5e.renderChatMessage", onRenderChatMessage);
Hooks.on("createChatMessage", onCreateChatMessage);
Hooks.on("updateChatMessage", onUpdateChatMessage);
Hooks.on("dnd5e.postUseActivity", onPostUseActivity);
Hooks.on("dnd5e.preRollD20TestV2", onPreRollD20Test);
Hooks.on("dnd5e.postD20TestRollConfiguration", onPostD20TestRollConfiguration);

/**
 * Register the module's settings.
 */
function registerSettings() {
  game.settings.register(MODULE_ID, "lockNaturals", {
    name: "ROBEAR.Settings.LockNaturals.Name",
    hint: "ROBEAR.Settings.LockNaturals.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });
  game.settings.register(MODULE_ID, "showPlayedCards", {
    name: "ROBEAR.Settings.ShowPlayedCards.Name",
    hint: "ROBEAR.Settings.ShowPlayedCards.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });
}

/* -------------------------------------------- */

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
      ui.notifications.warn(localize("ROBEAR.Cards.NoneLeft"));
      return;
    }
    const option = await chooseCard(options, localize("ROBEAR.Cards.ChooseFromSheet"));
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
  // The notes on cards already played stay, even once no card is left to play on the roll.
  const content = html.querySelector(".message-content");
  if ( message.isContentVisible ) markNaturals(message, html);
  content?.append(...renderLog(message));
  if ( getCardOptions(message).length ) content?.append(createCardButton(message));

  for ( const summary of html.querySelectorAll(".card-summary[data-message-id]") ) {
    const child = game.messages.get(summary.dataset.messageId);
    if ( !child ) continue;
    if ( getCardOptions(child).length ) {
      const row = summary.querySelector(".icon-row") ?? summary;
      row.append(createCardButton(child, { compact: true }));
    }
    summary.append(...renderLog(child));
  }

  const activity = getCardActivity(message);
  if ( activity ) compactCardUsage(html, activity);
}

/* -------------------------------------------- */

/**
 * Mark the total of each of the message's d20 rolls that shows a natural 1 or 20: a natural 20 is ringed in gold, like
 * the Character Creator's Level Up button once the XP is there, and a natural 1 in a dull red.
 * @param {ChatMessage5e} message
 * @param {HTMLElement} html
 */
function markNaturals(message, html) {
  // Rolls of other messages, summarised inside this one, aren't this message's rolls.
  const rolls = [...html.querySelectorAll(".message-content .dice-roll")]
    .filter(el => !el.closest(".card-summary, .robear-request"));
  if ( rolls.length !== message.rolls.length ) return;
  message.rolls.forEach((roll, i) => {
    // The classic layout's total, or the whole roll in dnd5e's compact layout, which has no separate total.
    const natural = getNatural(roll);
    if ( [1, 20].includes(natural) ) {
      (rolls[i].querySelector(".dice-total") ?? rolls[i]).classList.add(`robear-natural-${natural}`);
    }
  });
}

/* -------------------------------------------- */

/**
 * @param {ChatMessage5e} message
 * @returns {Activity|void}  The card activity, if this is the chat record of a RoBear-E Card played from the sheet.
 */
function getCardActivity(message) {
  if ( message.type !== "usage" ) return;
  const activity = message.getAssociatedActivity?.();
  return activity?.item && isCardItem(activity.item) ? activity : undefined;
}

/* -------------------------------------------- */

/**
 * Keep a played card's chat record short: the card's art is shown on screen as it is played, so here its
 * description starts collapsed (clicking the header still opens it), and the small art in the header shows the card
 * full size on hover.
 * @param {HTMLElement} html
 * @param {Activity} activity
 */
function compactCardUsage(html, activity) {
  html.classList.add("robear-card-usage");
  html.querySelector(".card-description")?.classList.add("collapsed");
  const icon = html.querySelector(".activity-icon img");
  if ( icon ) {
    icon.dataset.tooltipHtml = cardArtHTML(getCardArt(activity), getCardLabel(activity));
    icon.dataset.tooltipClass = "robear-card-tooltip";
    icon.dataset.tooltipDirection = "LEFT";
  }
}

/* -------------------------------------------- */

/**
 * A card played from the sheet is shown on screen, as a card played on a roll is.
 * @param {ChatMessage5e} message
 */
function onCreateChatMessage(message) {
  const activity = getCardActivity(message);
  if ( !activity || !message.isContentVisible || !game.settings.get(MODULE_ID, "showPlayedCards") ) return;
  showPlayedCard({ card: getCardLabel(activity), img: getCardArt(activity), by: activity.actor?.name ?? "" });
}

/* -------------------------------------------- */

/**
 * Summarised rolls are drawn inside their originating activity card, which dnd5e only refreshes on system changes.
 * @param {ChatMessage5e} message
 * @param {object} changes
 */
async function onUpdateChatMessage(message, changes) {
  // A card was just played on this roll: show it to everyone who can see the roll.
  const played = changes.flags?.[MODULE_ID]?.log?.at(-1);
  if ( played?.img && message.isContentVisible && game.settings.get(MODULE_ID, "showPlayedCards") ) {
    showPlayedCard(played);
  }

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
  ui.notifications.info(localize("ROBEAR.Cards.NextRollAdvantage", { name: actor.name }));
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
 * @returns {"attack"|"damage"|"check"|"save"|"initiative"|"divine"|null}
 */
export function getRollKind(message) {
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
    default: {
      const request = message.getFlag(MODULE_ID, "requestRoll");
      // A Divine Intervention d100, which must land in the range of numbers the player picked.
      if ( request?.range ) return "divine";
      // Plain d20s rolled for a roll request are played on like ability checks.
      if ( request && (message.rolls[0] instanceof CONFIG.Dice.D20Roll) ) return "check";
      return null;
    }
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
export function getCardOptions(message) {
  const kind = getRollKind(message);
  if ( !kind || !message.isContentVisible || !(message.isAuthor || game.user.isGM) ) return [];
  const actor = message.getAssociatedActor();
  if ( !actor?.isOwner ) return [];

  const roll = message.rolls[0];
  const d20 = (roll instanceof CONFIG.Dice.D20Roll) ? roll.d20 : null;
  const natural = getNatural(roll);
  const locked = [1, 20].includes(natural) && game.settings.get(MODULE_ID, "lockNaturals");
  const options = [];

  for ( const item of getCardItems(actor) ) {
    for ( const activity of item.system.activities ) {
      const key = getCardKey(activity);
      const card = CARDS[key];
      if ( !card?.appliesTo.includes(kind) ) continue;
      if ( !hasUsesLeft(activity) ) continue;
      if ( locked ) continue;
      // A natural 1 is fixed in RoBear-E: nothing rerolls it, whatever the Natural 1s and 20s setting.
      if ( card.rerolls && (natural === 1) ) continue;

      switch ( key ) {
        case "inspiration":
          if ( !activity.roll?.formula ) continue;
          break;
        case "luck":
          if ( ["damage", "divine"].includes(kind) ) break;
          if ( !d20 || [1, 20].includes(natural) ) continue;
          break;
        case "advantage":
          if ( kind === "divine" ? roll.options.robearAdvantage : (!d20 || roll.hasAdvantage) ) continue;
          break;
        case "indomitable":
          if ( !d20 || !isKnownFailure(message) ) continue;
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
 * @param {Roll} roll
 * @returns {number|void}  The d20 a d20 roll keeps, before modifiers.
 */
export function getNatural(roll) {
  if ( !(roll instanceof CONFIG.Dice.D20Roll) ) return;
  return roll.d20?.results.find(r => r.active)?.result;
}

/* -------------------------------------------- */

/**
 * Whether this user may treat a saving throw as failed, for a card or feature that rerolls a failed save. Offering one
 * would tell them it failed, so it waits until they can see that: for a roll request's roll, until the GM shows the
 * result; otherwise, whenever dnd5e shows them the roll's outcome. A save with no DC to judge it by is left to them.
 * @param {ChatMessage5e} message
 * @returns {boolean}
 */
export function isKnownFailure(message) {
  const roll = message.rolls[0];
  const target = getRollTarget(message, roll);
  if ( !Number.isNumeric(target) ) return true;
  if ( roll.total >= target ) return false;
  if ( game.user.isGM ) return true;
  const request = message.getFlag(MODULE_ID, "requestRoll")?.request;
  if ( request ) return !!game.messages.get(request)?.getFlag(MODULE_ID, "revealed");
  return message.shouldDisplayChallenge ?? true;
}

/* -------------------------------------------- */

/**
 * The DC a roll is made against. A roll made for a roll request may not carry its DC, so dnd5e does not show the
 * result early, in which case it is read from the request.
 * @param {ChatMessage5e} message
 * @param {D20Roll} roll
 * @returns {number|null}
 */
export function getRollTarget(message, roll) {
  if ( Number.isNumeric(roll.options.target) ) return roll.options.target;
  const { request, part } = message.getFlag(MODULE_ID, "requestRoll") ?? {};
  return game.messages.get(request)?.getFlag(MODULE_ID, "request")?.parts[part]?.dc ?? null;
}

/* -------------------------------------------- */

/**
 * @param {ChatMessage5e} message  An initiative roll message.
 * @returns {Combatant|void}
 */
export function findCombatant(message) {
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
export function createCardButton(message, { compact=false }={}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = compact ? "robear-card-button icon" : "robear-card-button";
  button.dataset.tooltipText = localize("ROBEAR.Cards.ButtonTooltip");
  button.setAttribute("aria-label", localize("ROBEAR.Cards.ButtonTooltip"));
  button.innerHTML = '<i class="fa-solid fa-anchor fa-rotate-90" inert></i>';
  if ( !compact ) button.append(` ${localize("ROBEAR.Cards.Button")}`);
  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    promptCard(message, button);
  });
  return button;
}

/* -------------------------------------------- */

/**
 * @typedef {object} CardLogEntry
 * @property {string} text  What the card did, e.g. "Luck: rerolled the d20 (4 → 13): 4 → 13".
 * @property {string} card  The card's label.
 * @property {string} img   The card's art.
 * @property {string} by    The name of the actor who played it.
 */

/**
 * @param {ChatMessage5e} message
 * @returns {HTMLElement[]}  Notes describing cards already spent on this message, each with a thumbnail of the card,
 *   shown full size on hover. Notes written before 2.0.0 are plain text.
 */
export function renderLog(message) {
  return (message.getFlag(MODULE_ID, "log") ?? []).map(entry => {
    const p = document.createElement("p");
    p.className = "supplement robear-card-log";
    // Notes written before 2.0.0 are plain text, so they need a label to say where they came from.
    if ( typeof entry === "string" ) {
      const strong = document.createElement("strong");
      strong.textContent = localize("ROBEAR.Cards.LegacyLabel");
      p.append(strong, " ", entry);
      return p;
    }
    // A card's note leads with a thumbnail of the card; a bonus roll's, with an icon.
    if ( entry.img ) {
      const art = document.createElement("img");
      art.className = "robear-card-log-art";
      art.src = entry.img;
      art.alt = entry.card;
      art.dataset.tooltipHtml = cardArtHTML(entry.img, entry.card);
      art.dataset.tooltipClass = "robear-card-tooltip";
      art.dataset.tooltipDirection = "UP";
      p.append(art);
    } else if ( entry.icon ) {
      const icon = document.createElement("i");
      icon.className = `${entry.icon} robear-card-log-icon`;
      icon.inert = true;
      p.append(icon);
    }
    const text = document.createElement("span");
    text.textContent = entry.text;
    p.append(text);
    return p;
  });
}

/* -------------------------------------------- */

/**
 * Card art as HTML, for a tooltip that shows it full size. A note's art and label are read from the message's flags,
 * which whoever wrote the message can set to anything, so both are escaped.
 * @param {string} img
 * @param {string} label
 * @returns {string}
 */
export function cardArtHTML(img, label) {
  const { escapeHTML } = foundry.utils;
  return `<img src="${escapeHTML(img ?? "")}" alt="${escapeHTML(label ?? "")}">`;
}

/* -------------------------------------------- */

/**
 * Show a played card's art large on screen for a moment, with who played it. Up to three show side by side; any
 * more wait until one of those has gone, so every card played is seen for its full time.
 * @param {CardLogEntry} entry
 */
function showPlayedCard(entry) {
  playedCardQueue.push(entry);
  showQueuedCards();
}

/**
 * Move waiting cards on screen while there is room. A card still fading out keeps its place until it has gone, so
 * the row never holds more than three.
 */
function showQueuedCards() {
  let overlay = document.getElementById("robear-played-card");
  while ( playedCardQueue.length && ((overlay?.childElementCount ?? 0) < PLAYED_CARD_MAX) ) {
    if ( !overlay ) {
      overlay = document.createElement("div");
      overlay.id = "robear-played-card";
      overlay.className = "robear-played-card";
      overlay.setAttribute("role", "status");
      document.body.append(overlay);
    }
    overlay.classList.remove("leaving");
    overlay.append(createPlayedCard(playedCardQueue.shift()));
  }
}

/**
 * One played card for the on-screen row, which leaves after a moment or when clicked.
 * The entry comes from a message's flags, so it is only ever set as text and attributes, never parsed as HTML.
 * @param {CardLogEntry} entry
 * @returns {HTMLElement}
 */
function createPlayedCard(entry) {
  const card = document.createElement("div");
  card.className = "robear-played-card-entry";
  card.innerHTML = `
    <img alt="">
    <div class="robear-played-card-caption">
      <span class="robear-played-card-by"></span>
      <span class="robear-played-card-name"></span>
    </div>
  `;
  card.querySelector("img").src = entry.img;
  card.querySelector(".robear-played-card-by").textContent = localize("ROBEAR.Cards.Plays", { name: entry.by ?? "" });
  card.querySelector(".robear-played-card-name").textContent = entry.card ?? "";
  const dismiss = () => {
    if ( card.classList.contains("leaving") ) return;
    card.classList.add("leaving");
    // The last card out takes the backdrop with it.
    const overlay = card.parentElement;
    const staying = overlay?.querySelector(".robear-played-card-entry:not(.leaving)");
    if ( !staying && !playedCardQueue.length ) overlay?.classList.add("leaving");
    setTimeout(() => {
      card.remove();
      if ( overlay && !overlay.childElementCount ) overlay.remove();
      showQueuedCards();
    }, 400);
  };
  card.addEventListener("click", dismiss);
  setTimeout(dismiss, PLAYED_CARD_MS);
  return card;
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
  // One card at a time on a roll: two pickers open at once would spend two cards, of which only one would be applied.
  if ( playing.has(message.id) ) return;
  const options = getCardOptions(message);
  if ( !options.length ) return;
  playing.add(message.id);
  button.disabled = true;
  try {
    const option = await chooseCard(options, localize("ROBEAR.Cards.ChooseOnRoll"));
    if ( option ) await applyCard(message, option);
  } catch(err) {
    reportError(err);
  } finally {
    playing.delete(message.id);
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
  // The tooltip shows the card art at full size so its rules text is readable.
  const { escapeHTML } = foundry.utils;
  const cards = options.map((o, i) => `
    <button type="button" class="robear-card-choice" data-index="${i}"
            data-tooltip-html="${escapeHTML(cardArtHTML(o.img, o.label))}"
            data-tooltip-class="robear-card-tooltip" data-tooltip-direction="UP">
      <img src="${escapeHTML(o.img)}" alt="${escapeHTML(o.label)}">
      <span>${escapeHTML(o.label)}</span>
    </button>
  `).join("");

  // Card buttons live in the content rather than the footer, so the chosen index is returned through `close`.
  let chosen;
  await foundry.applications.api.DialogV2.wait({
    classes: ["robear-card-dialog"],
    window: { title: "ROBEAR.Cards.DialogTitle", icon: "fa-solid fa-anchor fa-rotate-90" },
    position: { width: Math.clamp(48 + (options.length * 124), 340, 792) },
    content: `
      <p class="robear-card-hint">${foundry.utils.escapeHTML(hint)}</p>
      <div class="robear-card-grid">${cards}</div>
    `,
    buttons: [{ action: "cancel", label: "ROBEAR.Common.Cancel", icon: "fa-solid fa-xmark" }],
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
  const spent = activity.uses?.spent ?? 0;
  retroactiveUses.add(activity.uuid);
  let used;
  try {
    // No usage card is posted: the card is shown on screen and noted on the roll instead, so the roll stays in view.
    used = await activity.use({ subsequentActions: false }, { configure: false }, { create: false });
  } finally {
    retroactiveUses.delete(activity.uuid);
  }
  if ( !used ) return;

  // The card is spent before the roll is changed. If changing it fails, the card is given back, so the player never
  // loses one without its effect.
  try {
    await playOnRoll(message, { key, activity, label });
  } catch(err) {
    await activity.item.update({ [`system.activities.${activity.id}.uses.spent`]: spent });
    throw err;
  }
  // The roll now holds the card's effect, so the card stays spent even if the tracker can't be updated.
  if ( getRollKind(message) === "initiative" ) {
    await findCombatant(message)?.update({ initiative: message.rolls[0].total }).catch(reportError);
  }
}

/* -------------------------------------------- */

/**
 * Rewrite a message's rolls with a card's effect, and note the card on it.
 * @param {ChatMessage5e} message
 * @param {{ key: string, activity: Activity, label: string }} option
 */
async function playOnRoll(message, { key, activity, label }) {
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
      detail = localize("ROBEAR.Cards.Log.Inspiration", {
        formula: bonus.formula, bonus: bonus.total, before, after: rolls[0].total
      });
      break;
    }
    case "luck":
      if ( getRollKind(message) === "damage" ) {
        await rerollAllDice(rolls, message);
        detail = localize("ROBEAR.Cards.Log.RerollDamage", { before: sumTotals(message.rolls), after: sumTotals(rolls) });
        break;
      }
      if ( getRollKind(message) === "divine" ) {
        await rerollAllDice(rolls, message);
        detail = localize("ROBEAR.Cards.Log.RerollD100", { before, after: rolls[0].total });
        break;
      }
      // Falls through to reroll the d20.
    case "indomitable": {
      const [old, values] = await rerollD20(rolls[0], message);
      detail = localize("ROBEAR.Cards.Log.RerollD20", {
        dice: describeD20s(values), old: old.join(", "), new: values.join(", "), before, after: rolls[0].total
      });
      break;
    }
    case "relentless": {
      // Initiative is rerolled and the higher total kept: a reroll no higher leaves the roll as it was.
      const original = rolls[0];
      rolls[0] = Roll.fromData(original.toJSON());
      const [old, values] = await rerollD20(rolls[0], message);
      const rerolled = rolls[0].total;
      if ( rerolled <= before ) rolls[0] = original;
      detail = localize("ROBEAR.Cards.Log.RerollKeepHigher", {
        dice: describeD20s(values), old: old.join(", "), new: values.join(", "), before, rerolled, after: rolls[0].total
      });
      break;
    }
    case "advantage": {
      if ( getRollKind(message) === "divine" ) {
        const [first, second] = await addDivineAdvantage(rolls[0], message);
        detail = localize("ROBEAR.Cards.Log.DivineAdvantage", { first, second, total: rolls[0].total });
        break;
      }
      if ( cancelDisadvantage(rolls[0]) ) {
        detail = localize("ROBEAR.Cards.Log.CancelDisadvantage", { before, after: rolls[0].total });
        break;
      }
      const [first, second] = await addAdvantage(rolls[0], message);
      detail = localize("ROBEAR.Cards.Log.Advantage", { first, second, before, after: rolls[0].total });
      break;
    }
  }

  const text = localize("ROBEAR.Cards.Log.Entry", { card: label, detail });
  const entry = { text, card: label, img: getCardArt(activity), by: activity.actor?.name ?? "" };
  const log = [...(message.getFlag(MODULE_ID, "log") ?? []), entry];
  await message.update({ rolls: rolls.map(r => r.toJSON()), [`flags.${MODULE_ID}.log`]: log });
}

/* -------------------------------------------- */
/*  Roll Manipulation                           */
/* -------------------------------------------- */

/**
 * Recompute a roll's formula and total after its terms were changed.
 * @param {Roll} roll
 */
export function finalize(roll) {
  roll.resetFormula();
  roll._total = roll._evaluateTotal();
}

/* -------------------------------------------- */

/**
 * @param {number[]} values  The d20s rolled again.
 * @returns {string}  "the d20", or "both d20s" for a roll with advantage or disadvantage.
 */
export function describeD20s(values) {
  return localize(values.length > 1 ? "ROBEAR.Cards.Log.BothD20s" : "ROBEAR.Cards.Log.TheD20");
}

/* -------------------------------------------- */

/**
 * @param {Roll[]} rolls
 * @returns {number}
 */
export function sumTotals(rolls) {
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
 * Show dice rolled for a card in Dice So Nice, as the roll they change was shown: with its speaker, so the dice take
 * the actor's own appearance where it has one, and its message, so they are hidden as a secret roll's are.
 * @param {Roll} roll
 * @param {ChatMessage5e} message  The roll's message.
 */
async function showDice(roll, message) {
  if ( !game.dice3d ) return;
  const whisper = message.whisper.length ? message.whisper : null;
  await game.dice3d.showForRoll(roll, game.user, true, whisper, message.blind, message.id, message.speaker);
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
export async function rerollD20(roll, message) {
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
 * Roll a second d100 for Divine Intervention. The new roll is kept only if it lands in the picked range and the
 * first did not; otherwise the first stands.
 * @param {Roll} roll
 * @param {ChatMessage5e} message
 * @returns {Promise<[number, number]>}  Both d100 results.
 */
async function addDivineAdvantage(roll, message) {
  const { start, end } = message.getFlag(MODULE_ID, "requestRoll").range;
  const inRange = n => (n >= start) && (n <= end);
  const die = roll.dice[0];
  const current = die.results.find(r => r.active);
  const [[value]] = await rollFresh([{ number: 1, faces: die.faces }], message);
  const swap = inRange(value) && !inRange(current.result);
  if ( swap ) Object.assign(current, { active: false, discarded: true });
  die.results.push({ result: value, active: swap, discarded: !swap });
  roll.options.robearAdvantage = true;
  finalize(roll);
  return [current.result, value];
}

/* -------------------------------------------- */

/**
 * Reroll every active die across a set of damage rolls, or the d100 of a Divine Intervention roll.
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
