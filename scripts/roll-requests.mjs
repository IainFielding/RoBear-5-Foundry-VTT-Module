/**
 * RoBear-E Roll Requests: the GM asks for rolls from a chat card, and players roll from it.
 * Every roll is an ordinary dnd5e roll message tagged with the request, so RoBear-E Cards can be played on it and the
 * request card reflects the changed total. Results are never stored on the request: they are worked out from the
 * tagged roll messages each time the card renders, so deleting a roll message lets that actor roll again.
 */

import { MODULE_ID, createCardButton, getCardOptions, localize, renderLog, reportError } from "./robear-cards.mjs";
import { createIndomitableButton } from "./class-features.mjs";
import RollRequestConfig from "./roll-request-config.mjs";

/**
 * Kinds of request the GM can make. Contests set two sides against each other, each with its own roll.
 * Labels, hints and side names are keys in the language file. In a mode with `choices`, each roll may offer
 * alternatives, of which each actor makes one, and the GM may change its DC from the request card.
 */
export const MODES = {
  standard: {
    label: "ROBEAR.Request.Modes.Standard.Label",
    icon: "fa-solid fa-dice-d20",
    hint: "ROBEAR.Request.Modes.Standard.Hint",
    dice: ["d20", "d6", "d8", "d10", "d12", "d100"],
    choices: true
  },
  team: {
    label: "ROBEAR.Request.Modes.Team.Label",
    icon: "fa-solid fa-people-group",
    hint: "ROBEAR.Request.Modes.Team.Hint",
    choices: true
  },
  challenge: {
    label: "ROBEAR.Request.Modes.Challenge.Label",
    icon: "fa-solid fa-layer-group",
    hint: "ROBEAR.Request.Modes.Challenge.Hint",
    choices: true
  },
  rolloff: {
    label: "ROBEAR.Request.Modes.RollOff.Label",
    icon: "fa-solid fa-scale-balanced",
    hint: "ROBEAR.Request.Modes.RollOff.Hint",
    contest: true,
    sides: ["ROBEAR.Request.Sides.Challenger", "ROBEAR.Request.Sides.Opponent"],
    dice: ["d20", "d6", "d8", "d10", "d12", "d100"]
  },
  versus: {
    label: "ROBEAR.Request.Modes.Versus.Label",
    icon: "fa-solid fa-people-arrows",
    hint: "ROBEAR.Request.Modes.Versus.Hint",
    contest: true,
    sides: ["ROBEAR.Request.Sides.Players", "ROBEAR.Request.Sides.NPCs"],
    dice: ["d20"]
  },
  divine: {
    label: "ROBEAR.Request.Modes.Divine.Label",
    icon: "fa-solid fa-hands-praying",
    hint: "ROBEAR.Request.Modes.Divine.Hint"
  }
};

/**
 * How many consecutive numbers the GM may give a Divine Intervention roll.
 */
export const DIVINE_RANGE = { min: 1, max: 50, initial: 16 };

/**
 * Plain dice that can be rolled instead of a check.
 */
export const DICE = {
  d20: { label: "d20", formula: "1d20" },
  d6: { label: "d6", formula: "1d6" },
  d8: { label: "d8", formula: "1d8" },
  d10: { label: "d10", formula: "1d10" },
  d12: { label: "d12", formula: "1d12" },
  d100: { label: "d100", formula: "1d100" }
};

/**
 * Number of rolls in a skill challenge.
 */
export const CHALLENGE_PARTS = 3;

/**
 * The most rolls an actor may choose between for one part of a request.
 */
export const MAX_CHOICES = 4;

/**
 * Kinds of roll a request part can ask for, besides the plain dice.
 */
const PART_TYPES = ["skill", "check", "save", "tool"];

/**
 * Requests with a roll in progress on this client, keyed by "messageId.actorUuid.part", to ignore repeat clicks.
 * Another client can still roll at the same moment; if both rolls land, getResults counts the first.
 * @type {Set<string>}
 */
const rolling = new Set();

/**
 * Roll messages whose dice breakdown is open on the request card, so it stays open when the card is redrawn.
 * A message is forgotten when it is deleted.
 * @type {Set<string>}
 */
const expandedRolls = new Set();

/**
 * The IDs of the roll messages made for each request, keyed by request message ID, so drawing a request card does not
 * search the whole chat log. Built from the chat log the first time it is needed, then kept up to date as roll
 * messages are created, and pruned as they are deleted.
 * @type {{ source: object, rolls: Map<string, Set<string>> }|null}
 */
let rollIndex = null;

/* -------------------------------------------- */
/*  Hooks                                       */
/* -------------------------------------------- */

Hooks.once("init", () => {
  registerSettings();
  game.modules.get(MODULE_ID).api = { requestRolls: openRollRequest, createRequest };
});
Hooks.on("renderChatInput", onRenderChatInput);
Hooks.on("getSceneControlButtons", onGetSceneControlButtons);
Hooks.on("dnd5e.renderChatMessage", onRenderChatMessage);
Hooks.on("preDeleteChatMessage", onPreDeleteChatMessage);
Hooks.on("createChatMessage", onCreateChatMessage);
Hooks.on("updateChatMessage", refreshRequest);
Hooks.on("deleteChatMessage", onDeleteChatMessage);

/**
 * Register the roll request settings.
 */
function registerSettings() {
  game.settings.register(MODULE_ID, "showDCDefault", {
    name: "ROBEAR.Settings.ShowDCDefault.Name",
    hint: "ROBEAR.Settings.ShowDCDefault.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });
  game.settings.register(MODULE_ID, "attachRolls", {
    name: "ROBEAR.Settings.AttachRolls.Name",
    hint: "ROBEAR.Settings.AttachRolls.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => {
      for ( const message of game.messages ) {
        if ( message.getFlag(MODULE_ID, "request") || message.getFlag(MODULE_ID, "requestRoll") ) {
          ui.chat?.updateMessage(message);
        }
      }
    }
  });
}

/* -------------------------------------------- */

/**
 * Open the roll request window, or bring it to the front if it is already open, keeping what the GM has filled in.
 * A second window would replace the first under the same ID, leaving the first orphaned.
 * @returns {RollRequestConfig|void}
 */
export function openRollRequest() {
  if ( !game.user.isGM ) return;
  const open = foundry.applications.instances.get(RollRequestConfig.DEFAULT_OPTIONS.id);
  if ( open?.rendered ) {
    if ( open.minimized ) open.maximize();
    open.bringToFront();
    return open;
  }
  const app = new RollRequestConfig();
  app.render({ force: true });
  return app;
}

/* -------------------------------------------- */

/**
 * Add the request button to the GM's chat controls.
 * @param {ChatLog} _app
 * @param {Record<string, HTMLElement>} elements
 */
function onRenderChatInput(_app, elements) {
  const controls = elements["#chat-controls"]?.querySelector(".control-buttons");
  if ( !game.user.isGM || !controls || controls.querySelector(".robear-request-control") ) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ui-control icon fa-solid fa-anchor fa-rotate-90 robear-request-control";
  button.dataset.tooltipText = localize("ROBEAR.Request.WindowTitle");
  button.setAttribute("aria-label", localize("ROBEAR.Request.WindowTitle"));
  button.addEventListener("click", openRollRequest);
  controls.prepend(button);
}

/* -------------------------------------------- */

/**
 * Add the request button to the token controls, for when the chat sidebar is closed.
 * @param {Record<string, SceneControl>} controls
 */
function onGetSceneControlButtons(controls) {
  if ( !game.user.isGM || !controls.tokens ) return;
  controls.tokens.tools.robearRequest = {
    name: "robearRequest",
    order: Object.keys(controls.tokens.tools).length + 1,
    title: "ROBEAR.Request.WindowTitle",
    icon: "fa-solid fa-anchor fa-rotate-90",
    button: true,
    onChange: openRollRequest
  };
}

/* -------------------------------------------- */

/**
 * Only the GM may delete a roll made for a request that is still in chat. Deleting it lets that actor roll again, so a
 * player could otherwise throw away a bad roll.
 * @param {ChatMessage5e} message
 * @returns {boolean|void}  False to stop the deletion.
 */
function onPreDeleteChatMessage(message) {
  if ( game.user.isGM ) return;
  const requestId = message.getFlag(MODULE_ID, "requestRoll")?.request;
  if ( !requestId || !game.messages.has(requestId) ) return;
  ui.notifications.warn(localize("ROBEAR.Request.DeleteGMOnly"));
  return false;
}

/* -------------------------------------------- */

/**
 * Note a new roll message against its request, then redraw the request.
 * @param {ChatMessage5e} message
 */
function onCreateChatMessage(message) {
  const requestId = message.getFlag(MODULE_ID, "requestRoll")?.request;
  if ( requestId && rollIndex ) indexRoll(rollIndex.rolls, requestId, message.id);
  refreshRequest(message);
}

/* -------------------------------------------- */

/**
 * Forget a deleted message, so the roll index and open dice breakdowns don't grow for the whole session, then redraw
 * its request.
 * @param {ChatMessage5e} message
 */
function onDeleteChatMessage(message) {
  expandedRolls.delete(message.id);
  // A deleted request's rolls have no card to show them any more, so they are drawn again as messages of their own.
  // This must come before the request is dropped from the index, which is how its rolls are found.
  if ( message.getFlag(MODULE_ID, "request") ) {
    for ( const roll of getRollMessages(message.id) ) ui.chat?.updateMessage(roll);
  }
  if ( rollIndex ) {
    rollIndex.rolls.delete(message.id);
    const requestId = message.getFlag(MODULE_ID, "requestRoll")?.request;
    const ids = rollIndex.rolls.get(requestId);
    ids?.delete(message.id);
    if ( ids && !ids.size ) rollIndex.rolls.delete(requestId);
  }
  refreshRequest(message);
}

/* -------------------------------------------- */

/**
 * Redraw the request card when one of its rolls is made, changed by a card, or deleted, and its rolls when its result
 * is shown or hidden.
 * @param {ChatMessage5e} message
 * @param {object} [changes]  For an update, what changed.
 */
function refreshRequest(message, changes) {
  // Showing or hiding a request's result, or changing its DC, changes what its rolls offer, such as Indomitable on a
  // failed save.
  const changed = changes?.flags?.[MODULE_ID];
  if ( changed && (("revealed" in changed) || ("request" in changed)) ) {
    for ( const roll of getRollMessages(message.id) ) ui.chat?.updateMessage(roll);
  }
  const requestId = message.getFlag(MODULE_ID, "requestRoll")?.request;
  const request = game.messages.get(requestId);
  if ( request ) ui.chat?.updateMessage(request);
}

/* -------------------------------------------- */
/*  Creating Requests                           */
/* -------------------------------------------- */

/**
 * @typedef {object} RequestPart
 * @property {"skill"|"check"|"save"|"tool"|"d20"|"d100"} type
 * @property {string} [key]     Skill, ability or tool ID.
 * @property {number|null} dc
 * @property {{ type: string, key?: string }[]} [alternatives]  Other rolls the actor may make instead, against the same
 *   DC. Only in a mode with choices.
 */

/**
 * @typedef {object} RollRequest
 * @property {string} mode           Key in MODES.
 * @property {RequestPart[]} parts   One roll, three for a skill challenge, or one for each side of a contest.
 * @property {string[]} actors       Actor UUIDs of everyone rolling.
 * @property {string[][]} [sides]    For a contest, the actor UUIDs on each side.
 * @property {number} [range]        For Divine Intervention, how many consecutive numbers each actor picks.
 * @property {number} successes      Successes a skill challenge needs.
 * @property {boolean} showDC        Show the DC to players.
 * @property {"public"|"gm"} rollMode
 */

/**
 * Post a roll request to chat.
 * @param {RollRequest} request  Anything left out that the request window always fills in is given the window's default.
 * @returns {Promise<ChatMessage5e>}
 * @throws {Error}  If the request can't be rolled: see validateRequest.
 */
export async function createRequest(request) {
  // Only a GM's message is drawn as a request (see getRequest), so a player's would post as a plain message.
  if ( !game.user.isGM ) throw new Error(localize("ROBEAR.Request.Invalid.GMOnly"));
  request = withDefaults(request);
  validateRequest(request);
  // Only the rolls the mode uses are kept: the card would otherwise offer a Roll button for each extra one.
  request.parts = request.parts.slice(0, getPartCount(request));
  return ChatMessage.create({
    speaker: { alias: "RoBear-E" },
    content: `<p>${foundry.utils.escapeHTML(getRequestTitle(request))}</p>`,
    flags: { [MODULE_ID]: { request } }
  });
}

/* -------------------------------------------- */

/**
 * @param {ChatMessage5e|void} message
 * @returns {RollRequest|void}  The message's roll request, if it is one a GM posted. A player can write the same flag
 *   on a message of their own, which would otherwise draw as a request card and open everyone's pop-ups.
 */
export function getRequest(message) {
  const request = message?.getFlag(MODULE_ID, "request");
  return request && message.author?.isGM ? request : undefined;
}

/* -------------------------------------------- */

/**
 * Fill in what a macro may leave out, as the request window would.
 * @param {Partial<RollRequest>} request
 * @returns {RollRequest}  A copy, with the defaults filled in.
 */
export function withDefaults(request) {
  const defaults = { rollMode: "public", showDC: game.settings.get(MODULE_ID, "showDCDefault") };
  if ( request?.mode === "challenge" ) defaults.successes = 2;
  if ( request?.mode === "divine" ) defaults.range = DIVINE_RANGE.initial;
  const filled = { ...defaults, ...request };
  for ( const key of Object.keys(defaults) ) filled[key] ??= defaults[key];
  return filled;
}

/* -------------------------------------------- */

/**
 * Check a request can be rolled before it is posted. The request window checks the same things with friendlier
 * messages, but a macro can call createRequest directly.
 * @param {RollRequest} request
 * @throws {Error}
 */
export function validateRequest(request) {
  const check = (ok, key, data) => {
    if ( !ok ) throw new Error(localize(key, data));
  };
  check(request?.mode in MODES, "ROBEAR.Request.Invalid.Mode", { mode: request?.mode });
  const { actors } = request;
  check(Array.isArray(actors) && actors.every(uuid => uuid && (typeof uuid === "string"))
    && (new Set(actors).size === actors.length), "ROBEAR.Request.Invalid.Actors");
  check(actors.length, "ROBEAR.Request.Invalid.NoActors");
  check(["public", "gm"].includes(request.rollMode), "ROBEAR.Request.Invalid.RollMode", { rollMode: request.rollMode });

  const contest = isContest(request);
  if ( contest ) {
    const { sides } = request;
    check(Array.isArray(sides) && (sides.length === 2) && sides.every(s => Array.isArray(s) && s.length),
      "ROBEAR.Request.Invalid.EmptySide");
    // A roll-off is scored by each side's one roll, so a second actor on a side would never count.
    check((request.mode !== "rolloff") || sides.every(s => s.length === 1), "ROBEAR.Request.Invalid.RollOffSide");
    // Results are only worked out for the request's actors, so anyone on a side must be one of them.
    check(sides.flat().every(uuid => request.actors.includes(uuid)), "ROBEAR.Request.Invalid.SideNotActor");
  }

  const count = getPartCount(request);
  const parts = Array.isArray(request.parts) ? request.parts.slice(0, count) : [];
  check(parts.length >= count, "ROBEAR.Request.Invalid.MissingRoll");
  for ( const part of parts ) {
    const alternatives = part?.alternatives ?? [];
    check(Array.isArray(alternatives) && (!alternatives.length || MODES[request.mode].choices)
      && (alternatives.length < MAX_CHOICES) && alternatives.every(a => a && (typeof a === "object")),
    "ROBEAR.Request.Invalid.Choices", { max: MAX_CHOICES });
    for ( const { type, key } of getChoices(part ?? {}) ) {
      check((type in DICE) || PART_TYPES.includes(type), "ROBEAR.Request.Invalid.Roll", { type });
      const keys = getPartKeys(type);
      if ( keys ) check(keys.includes(key), "ROBEAR.Request.Invalid.Key", { type, key, keys: keys.join(", ") });
    }
    check((part.dc ?? null) === null || Number.isNumeric(part.dc), "ROBEAR.Request.Invalid.DC", { dc: part.dc });
  }

  const between = (n, min, max) => Number.isInteger(n) && (n >= min) && (n <= max);
  if ( request.mode === "challenge" ) {
    const { successes } = request;
    check(between(successes, 1, CHALLENGE_PARTS), "ROBEAR.Request.Invalid.Successes", { successes, total: CHALLENGE_PARTS });
  }
  if ( request.mode === "divine" ) {
    const { range } = request;
    const { min, max } = DIVINE_RANGE;
    check(between(range, min, max), "ROBEAR.Request.Invalid.Range", { range, min, max });
    // The picked numbers are 1 to 100, so only a d100 can land in them.
    check(parts[0].type === "d100", "ROBEAR.Request.Invalid.DivineRoll", { type: parts[0].type });
  }
}

/* -------------------------------------------- */

/**
 * @param {RollRequest} request
 * @returns {number}  How many rolls the request's mode uses: one for each side of a contest, three for a skill
 *   challenge, otherwise one.
 */
function getPartCount(request) {
  if ( isContest(request) ) return 2;
  return request.mode === "challenge" ? CHALLENGE_PARTS : 1;
}

/* -------------------------------------------- */

/**
 * @param {string} type  A request part's type.
 * @returns {string[]|void}  The keys a part of this type may name, or nothing for a plain die, which takes no key.
 */
function getPartKeys(type) {
  switch ( type ) {
    case "skill": return Object.keys(CONFIG.DND5E.skills);
    case "check":
    case "save": return Object.keys(CONFIG.DND5E.abilities);
    case "tool": return Object.keys(CONFIG.DND5E.tools);
  }
}

/* -------------------------------------------- */

/**
 * @param {RequestPart} part
 * @returns {string}  Name of the roll, e.g. "Athletics Check", "Dexterity Save" or "d100".
 */
export function getPartLabel({ type, key }) {
  const check = name => localize("ROBEAR.Request.Labels.Check", { name });
  switch ( type ) {
    case "skill": return check(CONFIG.DND5E.skills[key]?.label ?? key);
    case "check": return check(CONFIG.DND5E.abilities[key]?.label ?? key);
    case "save": return localize("ROBEAR.Request.Labels.Save", { name: CONFIG.DND5E.abilities[key]?.label ?? key });
    case "tool": return check(dnd5e.documents.Trait.keyLabel(key, { trait: "tool" }) ?? key);
  }
  return DICE[type]?.label ?? type;
}

/* -------------------------------------------- */

/**
 * @param {RequestPart} part
 * @returns {{ type: string, key: string|null }[]}  The rolls an actor may make for this part: its own, then any
 *   alternatives.
 */
export function getChoices(part) {
  return [part, ...(part.alternatives ?? [])].map(({ type, key }) => ({ type, key: key ?? null }));
}

/* -------------------------------------------- */

/**
 * @param {RequestPart} part
 * @returns {string}  The name of the roll, or of each roll the actor may choose between, e.g. "Athletics Check or
 *   Strength Save".
 */
export function getChoiceLabel(part) {
  const labels = getChoices(part).map(getPartLabel);
  return labels.length > 1 ? game.i18n.getListFormatter({ type: "disjunction" }).format(labels) : labels[0];
}

/* -------------------------------------------- */

/**
 * @param {RollRequest} request
 * @returns {boolean}  Whether the request sets two sides against each other.
 */
export function isContest(request) {
  return !!MODES[request.mode]?.contest;
}

/* -------------------------------------------- */

/**
 * @param {RollRequest} request
 * @returns {string}
 */
export function getRequestTitle(request) {
  if ( ["challenge", "divine"].includes(request.mode) || isContest(request) ) return localize(MODES[request.mode].label);
  const part = request.parts[0];
  if ( part.alternatives?.length ) return getChoiceLabel(part);
  const label = getPartLabel(part);
  return part.type in DICE ? localize("ROBEAR.Request.Labels.DieRoll", { die: label }) : label;
}

/* -------------------------------------------- */

/**
 * @param {RollRequest} request
 * @param {HTMLElement|null} [dc]  Shown in place of a standard roll's or team challenge's DC, such as the GM's button
 *   to change it.
 * @returns {string|(string|HTMLElement)[]}  What the request asks for, under its title.
 */
export function getRequestSubtitle(request, dc=null) {
  if ( request.mode === "challenge" ) {
    return localize("ROBEAR.Request.Subtitle.Challenge", { count: request.successes, total: request.parts.length });
  }
  if ( isContest(request) ) return request.parts.map(getPartLabel).join(` ${localize("ROBEAR.Request.Versus")} `);
  if ( request.mode === "divine" ) {
    if ( request.range === 1 ) return localize("ROBEAR.Request.Subtitle.DivineOne");
    return localize("ROBEAR.Request.Subtitle.Divine", { count: request.range });
  }
  const label = localize(MODES[request.mode].label);
  if ( dc ) return [label, " · ", dc];
  return [label, getDCText(request, request.parts[0].dc)].filterJoin(" · ");
}

/* -------------------------------------------- */

/**
 * @param {RollRequest} request
 * @param {number|null} dc
 * @returns {string}  The DC as this user may see it, e.g. "DC 12" or "DC ?", or nothing without one.
 */
function getDCText(request, dc) {
  if ( !Number.isNumeric(dc) ) return "";
  return localize("ROBEAR.Request.DC", { dc: request.showDC || game.user.isGM ? dc : "?" });
}

/* -------------------------------------------- */
/*  Results                                     */
/* -------------------------------------------- */

/**
 * @typedef {object} PartResult
 * @property {ChatMessage5e} message
 * @property {number} total
 * @property {number|void} natural   The d20 that counted.
 * @property {boolean} visible       Whether this user may see the result.
 * @property {boolean|null} success  Null without a DC.
 * @property {number} choice         Which of the part's choices was rolled: 0 for its own roll, or 1 on for an
 *   alternative.
 * @property {{ start: number, end: number }} [range]  The numbers picked for Divine Intervention.
 */

/**
 * @param {Map<string, Set<string>>} rolls  The index being built or kept up to date.
 * @param {string} requestId
 * @param {string} messageId  A roll message made for the request.
 */
function indexRoll(rolls, requestId, messageId) {
  if ( !rolls.has(requestId) ) rolls.set(requestId, new Set());
  rolls.get(requestId).add(messageId);
}

/* -------------------------------------------- */

/**
 * @param {string} requestId  The request message's ID.
 * @returns {ChatMessage5e[]}  The roll messages made for the request that are still in chat.
 */
export function getRollMessages(requestId) {
  // The index is rebuilt if the chat log itself has been replaced, as it is when Foundry reloads it.
  if ( rollIndex?.source !== game.messages ) {
    rollIndex = { source: game.messages, rolls: new Map() };
    for ( const m of game.messages ) {
      const id = m.getFlag(MODULE_ID, "requestRoll")?.request;
      if ( id ) indexRoll(rollIndex.rolls, id, m.id);
    }
  }
  const ids = rollIndex.rolls.get(requestId) ?? [];
  return [...ids].map(id => game.messages.get(id)).filter(Boolean);
}

/* -------------------------------------------- */

/**
 * @param {ChatMessage5e} roll  A roll message made for a request.
 * @param {string} uuid         The actor it was made for.
 * @returns {boolean}  Whether it counts: it was made by the GM, or by someone who owns the actor.
 */
function isRollByOwner(roll, uuid) {
  const author = roll.author;
  if ( !author ) return false;
  if ( author.isGM ) return true;
  return !!fromUuidSync(uuid)?.testUserPermission?.(author, "OWNER");
}

/* -------------------------------------------- */

/**
 * Find the results of each actor's rolls, from the roll messages tagged with this request.
 * In a contest each actor makes one roll, the one for their side. If a roll was made more than once, such as by the GM
 * and a player clicking Roll at the same moment, the first counts, so a second roll can't be used to fish for a better
 * one. To let an actor roll again, the GM deletes the roll that counts. A card or feature played on a roll changes its
 * message in place, so it stays the same roll.
 * A roll only counts if it was made by the GM or by one of the actor's owners.
 * @param {ChatMessage5e} message  The request message.
 * @returns {Map<string, (PartResult|null)[]>}  Results for each roll, keyed by actor UUID.
 */
export function getResults(message) {
  const request = message.getFlag(MODULE_ID, "request");
  const contest = isContest(request);
  const length = contest ? 1 : request.parts.length;
  const results = new Map(request.actors.map(uuid => [uuid, Array.from({ length }, () => null)]));
  const rolls = getRollMessages(message.id).sort((a, b) => a.timestamp - b.timestamp);

  for ( const roll of rolls ) {
    // The flag is written by whoever made the roll, so nothing in it is taken on trust.
    const { actor, part, range, choice } = roll.getFlag(MODULE_ID, "requestRoll");
    const first = roll.rolls[0];
    if ( !results.has(actor) || !first || !Number.isInteger(part) || !(part in request.parts) ) continue;
    if ( contest && !request.sides[part]?.includes(actor) ) continue;
    if ( !isRollByOwner(roll, actor) ) continue;
    const slot = contest ? 0 : part;
    if ( results.get(actor)[slot] ) continue;
    const dc = request.parts[part].dc;
    let success = Number.isNumeric(dc) ? first.total >= dc : null;
    // A Divine Intervention roll lands in the numbers picked, which must be as many as the request allows: a wider
    // run, such as 1 to 100, can't succeed.
    if ( request.mode === "divine" ) {
      success = isPickedRange(range, request.range) && (first.total >= range.start) && (first.total <= range.end);
    }
    const choices = getChoices(request.parts[part]).length;
    results.get(actor)[slot] = {
      message: roll,
      total: first.total,
      natural: first.d20?.results.find(r => r.active)?.result,
      visible: roll.isContentVisible,
      success,
      choice: (Number.isInteger(choice) && (choice >= 0) && (choice < choices)) ? choice : 0,
      range
    };
  }
  return results;
}

/* -------------------------------------------- */

/**
 * @param {{ start: number, end: number }|void} range  The numbers a Divine Intervention roll says were picked.
 * @param {number} size  How many numbers the request lets each actor pick.
 * @returns {boolean}  Whether they are a run the picker could have given: that many, within 1 to 100.
 */
function isPickedRange(range, size) {
  const { start, end } = range ?? {};
  return Number.isInteger(start) && (start >= 1) && (end === start + size - 1) && (end <= 100);
}

/* -------------------------------------------- */

/**
 * @param {number} start
 * @param {number} end
 * @returns {string}  A run of numbers picked for Divine Intervention, e.g. "40–55", or "40" when it is one number.
 */
export function formatRun(start, end) {
  return start === end ? String(start) : `${start}–${end}`;
}

/* -------------------------------------------- */

/**
 * Work out where an actor stands in a skill challenge. The challenge ends as soon as its outcome is settled.
 * @param {(PartResult|null)[]} results
 * @param {number} needed  Successes needed.
 * @returns {{ passed: number, failed: number, success: boolean|null, next: number|null }}
 *   `success` is null until settled, and `next` is the part to roll, or null if there is none.
 */
export function getChallengeState(results, needed) {
  let passed = 0;
  let failed = 0;
  for ( const [i, result] of results.entries() ) {
    if ( passed >= needed ) return { passed, failed, success: true, next: null };
    if ( failed > results.length - needed ) return { passed, failed, success: false, next: null };
    if ( !result ) return { passed, failed, success: null, next: i };
    if ( result.success ) passed++;
    else failed++;
  }
  return { passed, failed, success: passed >= needed, next: null };
}

/* -------------------------------------------- */

/**
 * Pool a team's rolls. Each natural 1 removes the highest remaining roll, and each natural 20 the lowest. Where there
 * are too many to leave any roll behind, 1s and 20s cancel out in pairs first, and at least one roll is always kept.
 * @param {{ uuid: string, total: number, natural: number }[]} entries  One per actor.
 * @returns {{ average: number, exact: number, removed: Map<string, string> }}
 *   The average rounded down, the exact average, and why each removed actor's roll was removed.
 */
export function poolTeamRolls(entries) {
  if ( !entries.length ) return { average: NaN, exact: NaN, removed: new Map() };
  const sorted = [...entries].sort((a, b) => a.total - b.total);
  const fumbles = entries.filter(e => e.natural === 1);
  const crits = entries.filter(e => e.natural === 20);
  let highs = fumbles.length;
  let lows = crits.length;
  while ( highs && lows && (highs + lows >= sorted.length) ) {
    highs--;
    lows--;
  }
  highs = Math.min(highs, sorted.length - 1);
  lows = Math.min(lows, sorted.length - 1 - highs);

  const removed = new Map();
  const byName = e => fromUuidSync(e.uuid)?.name ?? localize("ROBEAR.Common.Someone");
  sorted.slice(sorted.length - highs).reverse().forEach((e, i) => {
    removed.set(e.uuid, localize("ROBEAR.Request.Team.RemovedHighest", { name: byName(fumbles[i]) }));
  });
  sorted.slice(0, lows).forEach((e, i) => {
    removed.set(e.uuid, localize("ROBEAR.Request.Team.RemovedLowest", { name: byName(crits[i]) }));
  });

  const pool = sorted.filter(e => !removed.has(e.uuid));
  const exact = pool.reduce((sum, e) => sum + e.total, 0) / pool.length;
  return { average: Math.floor(exact), exact, removed };
}

/* -------------------------------------------- */

/**
 * @typedef {object} GroupOutcome
 * @property {boolean} complete        Everyone in the group has rolled.
 * @property {boolean} hidden          Some of the group's rolls are hidden from this user.
 * @property {number} [score]          The group's result: its pooled average, or its only roll.
 * @property {number} [exact]          The exact pooled average.
 * @property {Map<string, string>} removed  Rolls taken out of the pool, and why.
 */

/**
 * Work out a group's result once everyone in it has rolled.
 * @param {string[]} uuids
 * @param {Map<string, (PartResult|null)[]>} results
 * @param {boolean} pooled  Whether the group's rolls are pooled like a team challenge.
 * @returns {GroupOutcome}
 */
export function getGroupOutcome(uuids, results, pooled) {
  // A group with no one in it never has a result.
  if ( !uuids?.length ) return { complete: false, hidden: false, removed: new Map() };
  const entries = uuids.map(uuid => ({ uuid, result: results.get(uuid)?.[0] ?? null }));
  const complete = entries.every(e => e.result);
  const hidden = entries.some(e => e.result && !e.result.visible);
  if ( !complete || hidden ) return { complete, hidden, removed: new Map() };
  if ( !pooled ) return { complete, hidden, score: entries[0].result.total, removed: new Map() };
  const pool = poolTeamRolls(entries.map(({ uuid, result }) => ({ uuid, total: result.total, natural: result.natural })));
  return { complete, hidden, score: pool.average, exact: pool.exact, removed: pool.removed };
}

/* -------------------------------------------- */

/**
 * The pooled group an actor's row is drawn with: a team challenge's team, or their side in a group contest.
 * @param {ChatMessage5e} message
 * @param {RollRequest} request
 * @param {Map<string, (PartResult|null)[]>} results
 * @param {number} [side]  The actor's side, in a contest.
 * @returns {GroupOutcome|null}  Null when the request's rolls are not pooled.
 */
export function getRowGroup(message, request, results, side) {
  if ( request.mode === "versus" ) return getGroupOutcome(request.sides[side], results, true);
  if ( request.mode !== "team" ) return null;
  const team = getGroupOutcome(request.actors, results, true);
  // Which rolls a natural 1 or 20 took out of the pool is part of the result, so players see it with the result.
  if ( game.user.isGM || message.getFlag(MODULE_ID, "revealed") ) return team;
  return { ...team, removed: new Map() };
}

/* -------------------------------------------- */

/**
 * @param {GroupOutcome} group
 * @returns {boolean}  Whether the group has a result this user can see.
 */
function isSettled(group) {
  return group.complete && !group.hidden;
}

/* -------------------------------------------- */
/*  Rendering                                   */
/* -------------------------------------------- */

/**
 * Draw the request card.
 * @param {ChatMessage5e} message
 * @param {HTMLElement} html
 */
function onRenderChatMessage(message, html) {
  // A roll attached to its request card is shown there, so its own message is hidden, as dnd5e does for the rolls
  // it summarises inside their item's card. It is hidden by a class, not the hidden attribute: Foundry keeps a
  // message's hidden attribute when redrawing it, so it would stay hidden once its request is deleted.
  const requestRoll = message.getFlag(MODULE_ID, "requestRoll");
  if ( getRequest(game.messages.get(requestRoll?.request)) && game.settings.get(MODULE_ID, "attachRolls") ) {
    html.classList.add("robear-attached-roll");
    return;
  }
  const request = getRequest(message);
  const content = html.querySelector(".message-content");
  if ( !request || !content ) return;
  html.classList.add("robear-request-message");
  content.replaceChildren(renderRequest(message, request));
}

/* -------------------------------------------- */

/**
 * @param {ChatMessage5e} message
 * @param {RollRequest} request
 * @returns {HTMLElement}
 */
function renderRequest(message, request) {
  const results = getResults(message);
  const card = document.createElement("div");
  card.className = `robear-request mode-${request.mode}`;
  card.append(renderRequestHeader(message, request));

  if ( isContest(request) ) {
    renderContest(card, message, request, results);
    return card;
  }

  if ( request.mode === "challenge" ) {
    const steps = document.createElement("ol");
    steps.className = "robear-request-steps";
    request.parts.forEach((part, index) => {
      const step = document.createElement("li");
      const dc = game.user.isGM ? renderDCButton(message, request, index) : textElement("span", getDCText(request, part.dc));
      step.append(getChoiceLabel(part), " ", dc);
      steps.append(step);
    });
    card.append(steps);
  }

  // Players are only shown which rolls were removed from the pool once they can see the summary too.
  const team = getRowGroup(message, request, results);
  const list = document.createElement("ul");
  list.className = "robear-request-actors";
  for ( const uuid of request.actors ) {
    list.append(renderActorRow(message, request, uuid, results.get(uuid), { team }));
  }
  card.append(list);

  const summary = renderSummary(message, request, results, team);
  if ( summary ) card.append(summary);
  return card;
}

/* -------------------------------------------- */

/**
 * @param {string} icon
 * @param {string} title
 * @param {string|(string|HTMLElement)[]} subtitle
 * @returns {HTMLElement}
 */
export function renderHeader(icon, title, subtitle) {
  const { escapeHTML } = foundry.utils;
  const header = document.createElement("header");
  header.className = "robear-request-header";
  header.innerHTML = `
    <i class="${escapeHTML(icon)}" inert></i>
    <div>
      <h3>${escapeHTML(title)}</h3>
      <span class="robear-request-subtitle"></span>
    </div>
  `;
  header.querySelector(".robear-request-subtitle").append(...[subtitle].flat());
  return header;
}

/* -------------------------------------------- */

/**
 * Draw a request's header. The GM can change a standard roll's or team challenge's DC from it.
 * @param {ChatMessage5e} message
 * @param {RollRequest} request
 * @returns {HTMLElement}
 */
export function renderRequestHeader(message, request) {
  const editDC = game.user.isGM && ["standard", "team"].includes(request.mode);
  const dc = editDC ? renderDCButton(message, request, 0) : null;
  return renderHeader(MODES[request.mode].icon, getRequestTitle(request), getRequestSubtitle(request, dc));
}

/* -------------------------------------------- */

/**
 * @param {ChatMessage5e} message
 * @param {RollRequest} request
 * @param {number} part
 * @returns {HTMLButtonElement}  A GM button showing a part's DC, which changes it.
 */
function renderDCButton(message, request, part) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "robear-request-dc-edit";
  button.textContent = getDCText(request, request.parts[part].dc) || localize("ROBEAR.Request.EditDC.None");
  button.dataset.tooltipText = localize("ROBEAR.Request.EditDC.Tooltip");
  onAsyncClick(button, () => changeDC(message, part));
  return button;
}

/* -------------------------------------------- */

/**
 * Ask the GM for a new DC for one of a request's rolls, and save it. The rolls already made are scored again when the
 * card is redrawn, since results are always worked out against the request as it is now.
 * @param {ChatMessage5e} message  The request message.
 * @param {number} part
 */
export async function changeDC(message, part) {
  const request = message.getFlag(MODULE_ID, "request");
  const current = request.parts[part].dc;
  const required = request.mode === "challenge";
  const { escapeHTML } = foundry.utils;
  const data = await foundry.applications.api.DialogV2.input({
    classes: ["robear-card-dialog", "robear-dc-dialog"],
    window: { title: localize("ROBEAR.Request.EditDC.Title"), icon: "fa-solid fa-bullseye" },
    position: { width: 320 },
    content: `
      <p class="robear-card-hint">${escapeHTML(localize(required
        ? "ROBEAR.Request.EditDC.HintRequired" : "ROBEAR.Request.EditDC.Hint"))}</p>
      <div class="form-group">
        <label>${escapeHTML(localize("ROBEAR.Request.Config.DC"))}</label>
        <div class="form-fields">
          <input type="number" name="dc" value="${current ?? ""}" min="0" step="1" ${required ? "required" : ""} autofocus>
        </div>
      </div>
    `,
    ok: { label: "ROBEAR.Request.EditDC.Save", icon: "fa-solid fa-check" },
    rejectClose: false
  });
  // The request may have been deleted while the dialog was open.
  if ( !data || !game.messages.has(message.id) ) return;
  const dc = Number.isNumeric(data.dc) ? Number(data.dc) : null;
  if ( (dc === null) && required ) {
    ui.notifications.warn(localize("ROBEAR.Request.Config.ChallengeDC"));
    return;
  }
  // Read the request again, in case it changed while the dialog was open.
  const parts = foundry.utils.deepClone(message.getFlag(MODULE_ID, "request").parts);
  if ( parts[part].dc === dc ) return;
  parts[part].dc = dc;
  await message.update({ [`flags.${MODULE_ID}.request.parts`]: parts });
}

/* -------------------------------------------- */

/**
 * Draw both sides of a contest, and its winner once everyone has rolled.
 * @param {HTMLElement} card
 * @param {ChatMessage5e} message
 * @param {RollRequest} request
 * @param {Map<string, (PartResult|null)[]>} results
 */
function renderContest(card, message, request, results) {
  const pooled = request.mode === "versus";
  const groups = request.sides.map(uuids => getGroupOutcome(uuids, results, pooled));
  const settled = groups.every(isSettled);
  const [a, b] = groups.map(g => g.score);
  const winner = !settled ? undefined : (a > b ? 0 : (b > a ? 1 : null));
  const names = MODES[request.mode].sides.map(side => localize(side));

  const sides = document.createElement("div");
  sides.className = "robear-request-sides";
  request.sides.forEach((uuids, side) => {
    const group = groups[side];
    const block = document.createElement("section");
    block.className = "robear-request-side";
    if ( winner !== undefined ) block.classList.add(winner === side ? "success" : (winner === null ? "tie" : "failure"));
    const header = document.createElement("header");
    header.append(textElement("h4", names[side]), textElement("span", getPartLabel(request.parts[side])));
    if ( pooled && isSettled(group) ) {
      const score = textElement("span", group.score);
      score.className = "robear-request-score";
      setExactTooltip(score, group);
      header.append(score);
    }
    const list = document.createElement("ul");
    list.className = "robear-request-actors";
    block.append(header, list);
    for ( const uuid of uuids ) {
      list.append(renderActorRow(message, request, uuid, results.get(uuid), { team: pooled ? group : null, side }));
    }
    sides.append(block);
    if ( side === 0 ) {
      const divider = document.createElement("div");
      divider.className = "robear-request-versus";
      divider.textContent = localize("ROBEAR.Request.Versus");
      sides.append(divider);
    }
  });
  card.append(sides);

  const summary = document.createElement("footer");
  summary.className = "robear-request-summary";
  if ( winner !== undefined ) {
    const label = side => (pooled ? names[side] : fromUuidSync(request.sides[side][0])?.name) ?? names[side];
    const scores = `${label(0)} ${a} · ${label(1)} ${b}`;
    const verdict = winner === null ? localize("ROBEAR.Request.Contest.Tie")
      : localize(pooled ? "ROBEAR.Request.Contest.TeamWins" : "ROBEAR.Request.Contest.Wins", { name: label(winner) });
    summary.classList.add(winner === null ? "tie" : "success");
    summary.append(textElement("span", scores), textElement("strong", verdict));
  } else if ( groups.every(g => g.complete) ) {
    summary.append(textElement("span", localize("ROBEAR.Request.Contest.Hidden")));
  }
  const reveal = game.user.isGM ? renderRivalRevealButton(request, results) : null;
  if ( reveal ) summary.append(reveal);
  if ( summary.childElementCount ) card.append(summary);
}

/* -------------------------------------------- */

/**
 * Show a group's exact average as the element's tooltip, if its score was rounded.
 * @param {HTMLElement} element
 * @param {GroupOutcome} group
 */
function setExactTooltip(element, group) {
  if ( group.exact === group.score ) return;
  element.dataset.tooltipText = localize("ROBEAR.Request.Team.ExactAverage", { average: group.exact.toFixed(2) });
}

/* -------------------------------------------- */

/**
 * @param {ChatMessage5e} message
 * @param {RollRequest} request
 * @param {string} uuid
 * @param {(PartResult|null)[]} results
 * @param {object} [options]
 * @param {GroupOutcome|null} [options.team]  The pooled group this actor belongs to.
 * @param {number} [options.side]             The actor's side in a contest, which is also the part they roll.
 * @returns {HTMLLIElement}
 */
export function renderActorRow(message, request, uuid, results, { team=null, side }={}) {
  const actor = fromUuidSync(uuid);
  const challenge = request.mode === "challenge";
  const row = document.createElement("li");
  row.className = "robear-request-actor";
  const { escapeHTML } = foundry.utils;
  row.innerHTML = `
    <img src="${escapeHTML(actor?.img ?? CONST.DEFAULT_TOKEN)}" alt="">
    <span class="robear-request-name">${escapeHTML(actor?.name ?? localize("ROBEAR.Common.Unknown"))}</span>
    <span class="robear-request-rolls"></span>
  `;
  const slots = row.querySelector(".robear-request-rolls");

  // Passes and failures are part of a standard roll's or a skill challenge's result, which players see once the GM
  // shows it.
  const hideOutcome = ["standard", "challenge"].includes(request.mode) && !game.user.isGM
    && !message.getFlag(MODULE_ID, "revealed");
  let next = results.findIndex(r => !r);
  // A challenge's steps after the one that settled it are not counted. They are only rolled when a DC changed after.
  // How many count, and how many are shown as counting, which players only see once the GM shows the outcome.
  let settledAt = results.length;
  let counted = results.length;
  if ( challenge ) {
    const state = getChallengeState(results, request.successes);
    next = state.next ?? -1;
    if ( state.success !== null ) settledAt = state.passed + state.failed;
    if ( !hideOutcome ) counted = settledAt;
    if ( (state.success !== null) && !hideOutcome ) row.classList.add(state.success ? "success" : "failure");
  } else if ( results[0]?.visible && (results[0].success !== null) && !team && !hideOutcome ) {
    row.classList.add(results[0].success ? "success" : "failure");
  }
  if ( team?.removed.has(uuid) ) {
    row.classList.add("removed");
    row.dataset.tooltipText = team.removed.get(uuid);
  }

  results.forEach((result, slot) => {
    if ( result?.range && result.visible ) {
      const range = document.createElement("span");
      range.className = "robear-request-range";
      range.dataset.tooltipText = localize("ROBEAR.Request.Divine.Picked");
      range.textContent = formatRun(result.range.start, result.range.end);
      slots.append(range);
    }
    // Only a DC decides success, so pooled rolls are not marked as passing or failing on their own.
    if ( result ) {
      const uncounted = slot >= counted;
      const shown = (team || hideOutcome || uncounted) ? { ...result, success: null } : result;
      const choices = getChoices(request.parts[side ?? slot]);
      const chosen = choices.length > 1 ? getPartLabel(choices[result.choice] ?? choices[0]) : null;
      const pill = renderResult(shown, challenge ? slot : null, row, chosen);
      if ( uncounted ) {
        pill.classList.add("uncounted");
        pill.dataset.tooltipText = localize("ROBEAR.Request.Result.Uncounted", { result: pill.dataset.tooltipText });
      }
      slots.append(pill);
    }
    else if ( slot === next ) slots.append(renderRollButton(message, request, actor, side ?? slot));
    else if ( !challenge || (next !== -1) ) slots.append(renderPending());
  });

  // Cards and features are played on the latest roll that counts, not on one a changed DC has left uncounted, even
  // before players are shown which that is: a card spent on a roll that doesn't count would be wasted.
  const latest = results.slice(0, settledAt).findLast(r => r);
  if ( latest && getCardOptions(latest.message).length ) slots.append(createCardButton(latest.message, { compact: true }));
  const indomitable = latest ? createIndomitableButton(latest.message, { compact: true }) : null;
  if ( indomitable ) slots.append(indomitable);

  if ( challenge ) {
    const { passed, success } = getChallengeState(results, request.successes);
    const badge = document.createElement("span");
    badge.className = "robear-request-badge";
    const hidden = results.some(r => r && !r.visible);
    if ( hideOutcome ) {
      // Players see only that the actor is finished, not how it went.
      if ( success !== null ) {
        badge.textContent = localize("ROBEAR.Request.Challenge.Done");
        badge.dataset.tooltipText = localize("ROBEAR.Request.Challenge.DoneTooltip");
      }
    } else {
      badge.textContent = hidden ? "?" : `${passed}/${request.successes}`;
      if ( !hidden && (success !== null) ) {
        badge.dataset.tooltipText = localize(success ? "ROBEAR.Request.Challenge.Passed" : "ROBEAR.Request.Challenge.Failed");
      }
    }
    row.append(badge);
  }
  if ( game.settings.get(MODULE_ID, "attachRolls") ) renderNotes(row, results);
  return row;
}

/* -------------------------------------------- */

/**
 * With rolls attached to the request card, their own messages are hidden, so the notes on any cards played on them,
 * and any dice breakdowns opened, are shown under the actor's row instead.
 * @param {HTMLLIElement} row
 * @param {(PartResult|null)[]} results
 */
function renderNotes(row, results) {
  const details = document.createElement("div");
  details.className = "robear-request-details";
  for ( const result of results ) {
    if ( !result?.visible ) continue;
    details.append(...renderLog(result.message));
    if ( expandedRolls.has(result.message.id) ) details.append(renderRollDetail(result.message));
  }
  if ( details.childElementCount ) row.append(details);
}

/* -------------------------------------------- */

/**
 * @param {ChatMessage5e} message  A roll message.
 * @returns {HTMLElement}  The roll's formula and dice, as its own chat message would show them.
 */
function renderRollDetail(message) {
  const detail = document.createElement("div");
  detail.className = "robear-request-roll-detail";
  detail.dataset.messageId = message.id;
  const flavor = document.createElement("div");
  flavor.className = "robear-request-roll-flavor";
  flavor.textContent = message.flavor ?? "";
  detail.append(flavor);
  for ( const roll of message.rolls ) {
    const formula = document.createElement("div");
    formula.className = "robear-request-roll-formula";
    formula.textContent = `${roll.formula} = ${roll.total}`;
    // Each roll's dice go in a slot under its own formula, since they are drawn after the formulas are.
    const dice = document.createElement("div");
    detail.append(formula, dice);
    roll.getTooltip()
      .then(html => {
        dice.outerHTML = html;
      })
      .catch(err => {
        dice.remove();
        console.error(`${MODULE_ID} | Could not draw the dice of roll message ${message.id}`, err);
      });
  }
  if ( game.user.isGM ) detail.append(renderRollAgainButton(message));
  return detail;
}

/* -------------------------------------------- */

/**
 * A GM button to delete a roll made for a request, so its actor can roll again. With rolls attached to the request
 * card, the roll's own message is hidden, so this is the only way to reach it.
 * @param {ChatMessage5e} message  A roll message.
 * @returns {HTMLButtonElement}
 */
function renderRollAgainButton(message) {
  const name = fromUuidSync(message.getFlag(MODULE_ID, "requestRoll")?.actor)?.name ?? message.speaker.alias ?? "";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "robear-request-roll-again";
  button.dataset.tooltipText = localize("ROBEAR.Request.RollAgain.Tooltip", { name });
  button.innerHTML = '<i class="fa-solid fa-rotate-left" inert></i>';
  button.append(` ${localize("ROBEAR.Request.RollAgain.Label")}`);
  onAsyncClick(button, async () => {
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: "ROBEAR.Request.RollAgain.Title", icon: "fa-solid fa-rotate-left" },
      content: `<p>${foundry.utils.escapeHTML(localize("ROBEAR.Request.RollAgain.Confirm", { name }))}</p>`,
      rejectClose: false
    });
    if ( confirmed ) await message.delete();
  });
  return button;
}

/* -------------------------------------------- */

/**
 * Open or close a roll's dice breakdown under its actor's row.
 * @param {HTMLLIElement} row
 * @param {ChatMessage5e} message  The roll message.
 */
function toggleRollDetail(row, message) {
  const open = row.querySelector(`.robear-request-roll-detail[data-message-id="${message.id}"]`);
  if ( open ) {
    open.remove();
    expandedRolls.delete(message.id);
    return;
  }
  expandedRolls.add(message.id);
  let details = row.querySelector(".robear-request-details");
  if ( !details ) {
    details = document.createElement("div");
    details.className = "robear-request-details";
    row.append(details);
  }
  details.append(renderRollDetail(message));
}

/* -------------------------------------------- */

/**
 * @param {PartResult} result
 * @param {number|null} part  Index shown for skill challenge parts.
 * @param {HTMLLIElement} row  The actor's row, where clicking the result opens its dice when rolls are attached.
 * @param {string|null} [chosen]  The roll the actor chose, where they had a choice.
 * @returns {HTMLElement}
 */
function renderResult(result, part, row, chosen=null) {
  const pill = document.createElement("span");
  pill.className = "robear-request-result";
  if ( !result.visible ) {
    pill.textContent = "?";
    pill.dataset.tooltipText = localize("ROBEAR.Request.Result.Hidden");
    return pill;
  }
  pill.textContent = result.total;
  if ( result.natural === 20 ) pill.classList.add("critical");
  if ( result.natural === 1 ) pill.classList.add("fumble");
  if ( result.success !== null ) pill.classList.add(result.success ? "success" : "failure");
  let tooltip = result.natural
    ? localize("ROBEAR.Request.Result.TotalWithD20", { total: result.total, natural: result.natural })
    : String(result.total);
  if ( chosen ) tooltip = localize("ROBEAR.Request.Result.Chosen", { roll: chosen, result: tooltip });
  if ( part !== null ) tooltip = localize("ROBEAR.Request.Result.Numbered", { number: part + 1, result: tooltip });
  if ( game.settings.get(MODULE_ID, "attachRolls") ) {
    pill.classList.add("expandable");
    pill.role = "button";
    pill.tabIndex = 0;
    tooltip = localize("ROBEAR.Request.Result.ClickForDice", { result: tooltip });
    const toggle = event => {
      if ( (event.type === "keydown") && !["Enter", " "].includes(event.key) ) return;
      event.preventDefault();
      event.stopPropagation();
      toggleRollDetail(row, result.message);
    };
    pill.addEventListener("click", toggle);
    pill.addEventListener("keydown", toggle);
  }
  pill.dataset.tooltipText = tooltip;
  return pill;
}

/* -------------------------------------------- */

/**
 * @returns {HTMLElement}  A placeholder for a roll someone else will make.
 */
function renderPending() {
  const pending = document.createElement("span");
  pending.className = "robear-request-pending";
  pending.dataset.tooltipText = localize("ROBEAR.Request.Waiting");
  return pending;
}

/* -------------------------------------------- */

/**
 * @param {ChatMessage5e} message
 * @param {RollRequest} request
 * @param {Actor5e|void} actor
 * @param {number} part
 * @returns {HTMLElement}
 */
function renderRollButton(message, request, actor, part) {
  if ( !actor?.isOwner ) return renderPending();
  const button = document.createElement("button");
  button.type = "button";
  button.className = "robear-request-roll";
  const choices = getChoices(request.parts[part]);
  button.dataset.tooltipText = localize("ROBEAR.Request.RollTooltip", { roll: getChoiceLabel(request.parts[part]) });
  button.innerHTML = `<i class="fa-solid ${choices.length > 1 ? "fa-list-ul" : "fa-dice-d20"}" inert></i>`;
  button.append(` ${request.mode === "challenge" ? part + 1 : localize("ROBEAR.Request.Roll")}`);
  button.addEventListener("click", async event => {
    event.preventDefault();
    event.stopPropagation();
    button.disabled = true;
    try {
      // With a choice of rolls, the modifier keys are taken from the click that picks one.
      const picked = choices.length > 1 ? await chooseRoll(actor, choices) : { choice: 0, event };
      if ( picked ) await rollForRequest(message, actor, part, picked.event, picked.choice);
    } catch(err) {
      reportError(err);
    } finally {
      button.disabled = false;
    }
  });
  return button;
}

/* -------------------------------------------- */

/**
 * @param {ChatMessage5e} message  The request message.
 * @param {RollRequest} request
 * @param {Map<string, (PartResult|null)[]>} results
 * @param {GroupOutcome|null} team
 * @returns {HTMLElement|void}
 */
function renderSummary(message, request, results, team) {
  const summary = document.createElement("footer");
  summary.className = "robear-request-summary";

  if ( team ) {
    if ( !team.complete ) return;
    if ( team.hidden ) {
      summary.textContent = localize("ROBEAR.Request.Team.Hidden");
      return summary;
    }
    // The GM decides when players see the team's result.
    const revealed = !!message.getFlag(MODULE_ID, "revealed");
    if ( !revealed && !game.user.isGM ) return;
    const dc = request.parts[0].dc;
    const removed = team.removed.size ? localize("ROBEAR.Request.Team.Removed", { count: team.removed.size }) : "";
    const score = document.createElement("strong");
    score.textContent = team.score;
    const average = document.createElement("span");
    average.append(...formatNodes("ROBEAR.Request.Team.Average", { average: score, removed }));
    setExactTooltip(average, team);
    summary.append(average);
    if ( Number.isNumeric(dc) ) {
      const success = team.score >= dc;
      summary.classList.add(success ? "success" : "failure");
      const verdict = document.createElement("strong");
      verdict.textContent = localize(success ? "ROBEAR.Request.Success" : "ROBEAR.Request.Failure");
      summary.append(verdict);
    }
    if ( game.user.isGM ) summary.append(renderRevealButton(message, revealed));
    return summary;
  }

  const rows = [...results.values()];
  if ( request.mode === "challenge" ) {
    const states = rows.map(r => getChallengeState(r, request.successes));
    if ( states.some(s => s.success === null) || rows.some(r => r.some(p => p && !p.visible)) ) return;
    // The GM decides when players see how the challenge went.
    const revealed = !!message.getFlag(MODULE_ID, "revealed");
    if ( !revealed && !game.user.isGM ) return;
    const count = states.filter(s => s.success).length;
    summary.append(textElement("span", localize("ROBEAR.Request.Summary.Challenge", { count, total: rows.length })));
    if ( game.user.isGM ) summary.append(renderRevealButton(message, revealed));
    return summary;
  }

  if ( !rows.every(r => r[0]?.visible) ) return;
  if ( request.mode === "divine" ) {
    const answered = rows.filter(r => r[0].success).length;
    summary.classList.add(answered ? "success" : "failure");
    summary.append(
      textElement("span", localize("ROBEAR.Request.Summary.Divine", { count: answered, total: rows.length })),
      textElement("strong", localize(answered ? "ROBEAR.Request.Divine.Answered" : "ROBEAR.Request.Divine.NoAnswer"))
    );
    return summary;
  }
  if ( !Number.isNumeric(request.parts[0].dc) ) return;

  // The GM decides when players see how many succeeded.
  const revealed = !!message.getFlag(MODULE_ID, "revealed");
  if ( !revealed && !game.user.isGM ) return;
  const count = rows.filter(r => r[0].success).length;
  summary.append(textElement("span", localize("ROBEAR.Request.Summary.Standard", { count, total: rows.length })));
  if ( game.user.isGM ) summary.append(renderRevealButton(message, revealed));
  return summary;
}

/* -------------------------------------------- */

/**
 * @param {string} tag
 * @param {string} text
 * @returns {HTMLElement}  An element holding the text as text, never parsed as HTML.
 */
function textElement(tag, text) {
  const element = document.createElement(tag);
  element.textContent = text;
  return element;
}

/* -------------------------------------------- */

/**
 * Translate a string whose {placeholders} may be filled with elements as well as text, so a translation can place
 * them anywhere without the string ever being parsed as HTML.
 * @param {string} key
 * @param {Record<string, Node|string|number>} data
 * @returns {(Node|string)[]}  The pieces, in order, ready to append.
 */
export function formatNodes(key, data) {
  return localize(key).split(/({[^}]+})/).filter(Boolean).map(piece => {
    const name = piece.match(/^{([^}]+)}$/)?.[1];
    if ( !name || !(name in data) ) return piece;
    const value = data[name];
    return value instanceof Node ? value : String(value ?? "");
  });
}

/* -------------------------------------------- */

/**
 * @param {ChatMessage5e} message  The request message.
 * @param {boolean} revealed       Whether players can currently see the summary.
 * @returns {HTMLButtonElement}    A GM button to show the summary to players, or hide it again.
 */
function renderRevealButton(message, revealed) {
  return renderToggleButton(revealed, { hidden: "ROBEAR.Request.Reveal.Show", shown: "ROBEAR.Request.Reveal.Shown" },
    () => message.setFlag(MODULE_ID, "revealed", !revealed));
}

/* -------------------------------------------- */

/**
 * @param {boolean} revealed  Whether players can currently see the thing the button controls.
 * @param {{ hidden: string, shown: string }} labels
 * @param {() => Promise} toggle
 * @returns {HTMLButtonElement}  A GM button that shows something to players, or hides it again.
 */
function renderToggleButton(revealed, labels, toggle) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `robear-request-reveal${revealed ? " revealed" : ""}`;
  button.dataset.tooltipText = localize(revealed ? "ROBEAR.Request.Reveal.ShownTooltip" : "ROBEAR.Request.Reveal.HiddenTooltip");
  button.innerHTML = `<i class="fa-solid ${revealed ? "fa-eye" : "fa-eye-slash"}" inert></i>`;
  button.append(` ${localize(revealed ? labels.shown : labels.hidden)}`);
  onAsyncClick(button, toggle);
  return button;
}

/* -------------------------------------------- */

/**
 * Run a GM button's action on click, with the button disabled until it is done. On success the card is redrawn with
 * a new button; on failure the GM is told why, and this one works again.
 * @param {HTMLButtonElement} button
 * @param {() => Promise} action
 */
function onAsyncClick(button, action) {
  button.addEventListener("click", async event => {
    event.preventDefault();
    event.stopPropagation();
    button.disabled = true;
    try {
      await action();
    } catch(err) {
      reportError(err);
    } finally {
      button.disabled = false;
    }
  });
}

/* -------------------------------------------- */

/**
 * @param {RollRequest} request
 * @param {Actor5e|void} actor
 * @returns {boolean}  Whether this actor's roll is kept from players until the GM shows it: an NPC in a roll-off.
 */
function isHiddenRival(request, actor) {
  return (request.mode === "rolloff") && !!actor && !actor.hasPlayerOwner;
}

/* -------------------------------------------- */

/**
 * A GM button to show the NPC's roll-off roll to players, or to hide it again. The roll is a private GM roll until it
 * is shown. It is then shown as the request's other rolls are: to everyone for a public request, or for a private
 * one only to the players in it, so showing it never makes it more public than the request itself.
 * @param {RollRequest} request
 * @param {Map<string, (PartResult|null)[]>} results
 * @returns {HTMLButtonElement|void}  Nothing until an NPC has rolled, or if there is no player to show it to.
 */
function renderRivalRevealButton(request, results) {
  const rolls = request.actors.filter(uuid => isHiddenRival(request, fromUuidSync(uuid)))
    .map(uuid => results.get(uuid)[0]?.message).filter(Boolean);
  if ( !rolls.length ) return;
  const gms = ChatMessage.getWhisperRecipients("GM").map(u => u.id);
  let shownTo = [];
  if ( request.rollMode === "gm" ) {
    const players = game.users.filter(u => !u.isGM && request.actors.some(uuid => {
      return fromUuidSync(uuid)?.testUserPermission?.(u, "OWNER");
    })).map(u => u.id);
    if ( !players.length ) return;
    shownTo = [...gms, ...players];
  }
  const revealed = rolls.every(m => !m.whisper.length || m.whisper.some(id => !gms.includes(id)));
  const whisper = revealed ? gms : shownTo;
  return renderToggleButton(revealed, { hidden: "ROBEAR.Request.Reveal.ShowNPC", shown: "ROBEAR.Request.Reveal.NPCShown" },
    () => ChatMessage.updateDocuments(rolls.map(m => ({ _id: m.id, whisper }))));
}

/* -------------------------------------------- */
/*  Rolling                                     */
/* -------------------------------------------- */

/**
 * Make one of the requested rolls, tagging its message with the request.
 * @param {ChatMessage5e} message  The request message.
 * @param {Actor5e} actor
 * @param {number} part
 * @param {PointerEvent} event     Its modifier keys let dnd5e's fast-forward keys still apply.
 * @param {number} [choice=0]      Which of the part's choices to roll.
 */
async function rollForRequest(message, actor, part, event, choice=0) {
  const request = message.getFlag(MODULE_ID, "request");
  const key = `${message.id}.${actor.uuid}.${part}`;
  const slot = isContest(request) ? 0 : part;
  if ( rolling.has(key) || getResults(message).get(actor.uuid)?.[slot] ) return;

  const roll = getChoices(request.parts[part])[choice];
  if ( !roll ) return;
  const { type, key: id } = roll;
  // Only the modifier keys are passed on. dnd5e would otherwise treat the request card as the roll's origin.
  const { altKey, ctrlKey, metaKey, shiftKey } = event;
  const config = { event: { altKey, ctrlKey, metaKey, shiftKey } };
  // The DC is never sent with the roll: dnd5e would show the person rolling whether they beat it, before the GM
  // shows the result. The request card scores each roll against the request's DC itself.
  const requestRoll = { request: message.id, actor: actor.uuid, part, choice };
  // An NPC's roll in a roll-off is a private GM roll, until the GM shows it from the request card.
  const rollMode = isHiddenRival(request, actor) ? "gm" : request.rollMode;
  const messageConfig = { rollMode, data: { flags: { [MODULE_ID]: { requestRoll } } } };

  rolling.add(key);
  try {
    if ( request.mode === "divine" ) {
      const start = await chooseRange(actor, request.range);
      if ( !start ) return;
      requestRoll.range = { start, end: start + request.range - 1 };
    }
    switch ( type ) {
      case "skill": await actor.rollSkill({ ...config, skill: id }, {}, messageConfig); break;
      case "check": await actor.rollAbilityCheck({ ...config, ability: id }, {}, messageConfig); break;
      case "save": await actor.rollSavingThrow({ ...config, ability: id }, {}, messageConfig); break;
      case "tool": await actor.rollToolCheck({ ...config, tool: id }, {}, messageConfig); break;
      default:
        if ( type in DICE ) await rollDie(actor, request, type, config, messageConfig);
    }
  } finally {
    rolling.delete(key);
  }
}

/* -------------------------------------------- */

/**
 * Roll a plain die for an actor. A d20 goes through dnd5e's d20 test, so advantage, the dnd5e roll window and
 * RoBear-E Cards apply; other dice just roll.
 * @param {Actor5e} actor
 * @param {RollRequest} request
 * @param {string} die  Key in DICE.
 * @param {object} config
 * @param {object} messageConfig
 */
async function rollDie(actor, request, die, config, messageConfig) {
  const range = messageConfig.data.flags[MODULE_ID].requestRoll.range;
  Object.assign(messageConfig.data, {
    flavor: localize(range ? "ROBEAR.Request.Flavor.Range" : "ROBEAR.Request.Flavor.Die", {
      mode: localize(MODES[request.mode].label), die: DICE[die].label, numbers: range && formatRun(range.start, range.end)
    }),
    speaker: ChatMessage.getSpeaker({ actor })
  });
  // dnd5e sets each roll's advantage mode on `options`, and expects it to exist.
  if ( die === "d20" ) {
    const rollConfig = { ...config, subject: actor, hookNames: ["d20Test"], rolls: [{ parts: [], options: {} }] };
    await CONFIG.Dice.D20Roll.build(rollConfig, {}, messageConfig);
    return;
  }
  const rollConfig = { ...config, subject: actor, rolls: [{ parts: [DICE[die].formula], options: {} }] };
  await CONFIG.Dice.BasicRoll.build(rollConfig, { configure: false }, messageConfig);
}

/* -------------------------------------------- */

/**
 * Ask which of a part's rolls an actor makes.
 * @param {Actor5e} actor
 * @param {{ type: string, key: string|null }[]} choices
 * @returns {Promise<{ choice: number, event: PointerEvent }|null>}  The roll chosen, and the click that chose it, or
 *   null if the window was closed.
 */
async function chooseRoll(actor, choices) {
  const { escapeHTML } = foundry.utils;
  return foundry.applications.api.DialogV2.wait({
    classes: ["robear-card-dialog", "robear-choice-dialog"],
    window: {
      title: localize("ROBEAR.Request.Choose.Title", { name: actor.name }),
      icon: "fa-solid fa-list-ul"
    },
    position: { width: 320 },
    content: `<p class="robear-card-hint">${escapeHTML(localize("ROBEAR.Request.Choose.Hint", { name: actor.name }))}</p>`,
    buttons: choices.map((roll, choice) => ({
      action: `choice${choice}`,
      label: getPartLabel(roll),
      icon: "fa-solid fa-dice-d20",
      default: choice === 0,
      callback: event => ({ choice, event })
    })),
    rejectClose: false
  });
}

/* -------------------------------------------- */

/**
 * Ask a player to pick the consecutive numbers their Divine Intervention roll must land on.
 * Hovering a number previews the run starting there, kept within 1 to 100, and clicking picks it.
 * @param {Actor5e} actor
 * @param {number} size  How many numbers to pick.
 * @returns {Promise<number|void>}  The first number picked.
 */
async function chooseRange(actor, size) {
  const last = 101 - size;
  const cells = Array.from({ length: 100 }, (_, i) => `
    <button type="button" class="robear-divine-number" data-number="${i + 1}">${i + 1}</button>
  `).join("");

  const { escapeHTML } = foundry.utils;
  let start;
  const result = await foundry.applications.api.DialogV2.wait({
    classes: ["robear-card-dialog", "robear-divine-dialog"],
    window: {
      title: localize("ROBEAR.Request.Divine.DialogTitle", { name: actor.name }),
      icon: "fa-solid fa-hands-praying"
    },
    position: { width: 460 },
    content: `
      <p class="robear-card-hint">${escapeHTML(size === 1 ? localize("ROBEAR.Request.Divine.DialogHintOne")
        : localize("ROBEAR.Request.Divine.DialogHint", { count: size }))}</p>
      <div class="robear-divine-grid">${cells}</div>
      <p class="robear-divine-choice">${escapeHTML(localize("ROBEAR.Request.Divine.NonePicked"))}</p>
    `,
    buttons: [
      {
        action: "roll",
        label: "ROBEAR.Request.Divine.Roll",
        icon: "fa-solid fa-hands-praying",
        default: true,
        callback: () => start
      },
      { action: "cancel", label: "ROBEAR.Common.Cancel", icon: "fa-solid fa-xmark" }
    ],
    render: (_event, dialog) => {
      const numbers = [...dialog.element.querySelectorAll(".robear-divine-number")];
      const roll = dialog.element.querySelector('[data-action="roll"]');
      const choice = dialog.element.querySelector(".robear-divine-choice");
      roll.disabled = true;
      const mark = (from, cls) => numbers.forEach((el, i) => el.classList.toggle(cls, (from !== undefined)
        && (i + 1 >= from) && (i + 1 < from + size)));
      for ( const el of numbers ) {
        const from = Math.min(Number(el.dataset.number), last);
        el.addEventListener("pointerenter", () => mark(from, "preview"));
        el.addEventListener("focus", () => mark(from, "preview"));
        el.addEventListener("click", () => {
          start = from;
          mark(start, "picked");
          choice.textContent = localize("ROBEAR.Request.Divine.Need", { numbers: formatRun(start, start + size - 1) });
          roll.disabled = false;
        });
      }
      dialog.element.querySelector(".robear-divine-grid").addEventListener("pointerleave", () => mark(undefined, "preview"));
    },
    rejectClose: false
  });
  // Only a picked number starts the run. Anything else, such as the dialog's own action name, rolls nothing.
  return Number.isInteger(result) ? result : undefined;
}
