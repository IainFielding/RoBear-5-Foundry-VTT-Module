/**
 * RoBear-E Roll Requests: the GM asks for rolls from a chat card, and players roll from it.
 * Every roll is an ordinary dnd5e roll message tagged with the request, so RoBear-E Cards can be played on it and the
 * request card reflects the changed total. Results are never stored on the request: they are worked out from the
 * tagged roll messages each time the card renders, so deleting a roll message lets that actor roll again.
 */

import { MODULE_ID, createCardButton, getCardOptions, localize, renderLog } from "./robear-cards.mjs";
import { createIndomitableButton } from "./class-features.mjs";
import RollRequestConfig from "./roll-request-config.mjs";

/**
 * Kinds of request the GM can make. Contests set two sides against each other, each with its own roll.
 * Labels, hints and side names are keys in the language file.
 */
export const MODES = {
  standard: {
    label: "ROBEAR.Request.Modes.Standard.Label",
    icon: "fa-solid fa-dice-d20",
    hint: "ROBEAR.Request.Modes.Standard.Hint",
    dice: ["d20", "d6", "d8", "d10", "d12", "d100"]
  },
  team: {
    label: "ROBEAR.Request.Modes.Team.Label",
    icon: "fa-solid fa-people-group",
    hint: "ROBEAR.Request.Modes.Team.Hint"
  },
  challenge: {
    label: "ROBEAR.Request.Modes.Challenge.Label",
    icon: "fa-solid fa-layer-group",
    hint: "ROBEAR.Request.Modes.Challenge.Hint"
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
 * Requests with a roll in progress on this client, keyed by "messageId.actorUuid.part", to ignore repeat clicks.
 * @type {Set<string>}
 */
const rolling = new Set();

/**
 * Roll messages whose dice breakdown is open on the request card, so it stays open when the card is redrawn.
 * @type {Set<string>}
 */
const expandedRolls = new Set();

/**
 * The IDs of the roll messages made for each request, keyed by request message ID, so drawing a request card does not
 * search the whole chat log. Built from the chat log the first time it is needed, then kept up to date as roll
 * messages are created. A deleted message is simply no longer found.
 * @type {{ source: object, rolls: Map<string, Set<string>> }|null}
 */
let rollIndex = null;

/* -------------------------------------------- */
/*  Hooks                                       */
/* -------------------------------------------- */

Hooks.once("init", () => {
  registerSettings();
  game.modules.get(MODULE_ID).api = { requestRolls: openRollRequest };
});
Hooks.on("renderChatInput", onRenderChatInput);
Hooks.on("getSceneControlButtons", onGetSceneControlButtons);
Hooks.on("dnd5e.renderChatMessage", onRenderChatMessage);
Hooks.on("preDeleteChatMessage", onPreDeleteChatMessage);
Hooks.on("createChatMessage", onCreateChatMessage);
Hooks.on("updateChatMessage", refreshRequest);
Hooks.on("deleteChatMessage", refreshRequest);

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
 * Open the roll request window.
 * @returns {RollRequestConfig|void}
 */
export function openRollRequest() {
  if ( !game.user.isGM ) return;
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
  button.dataset.tooltip = localize("ROBEAR.Request.WindowTitle");
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
 * Redraw the request card when one of its rolls is made, changed by a card, or deleted, and its rolls when its result
 * is shown or hidden.
 * @param {ChatMessage5e} message
 * @param {object} [changes]  For an update, what changed.
 */
function refreshRequest(message, changes) {
  // Showing or hiding a request's result changes what its rolls offer, such as Indomitable on a failed save.
  if ( changes?.flags?.[MODULE_ID] && ("revealed" in changes.flags[MODULE_ID]) ) {
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
 * @param {RollRequest} request
 * @returns {Promise<ChatMessage5e>}
 * @throws {Error}  If the request has no one to roll, or a contest has an empty side.
 */
export async function createRequest(request) {
  validateRequest(request);
  return ChatMessage.create({
    speaker: { alias: "RoBear-E" },
    content: `<p>${foundry.utils.escapeHTML(getRequestTitle(request))}</p>`,
    flags: { [MODULE_ID]: { request } }
  });
}

/* -------------------------------------------- */

/**
 * Check a request can be rolled before it is posted. The request window checks the same things with friendlier
 * messages, but a macro can call createRequest directly.
 * @param {RollRequest} request
 * @throws {Error}
 */
export function validateRequest(request) {
  if ( !(request?.mode in MODES) ) throw new Error(localize("ROBEAR.Request.Invalid.Mode", { mode: request?.mode }));
  if ( !request.actors?.length ) throw new Error(localize("ROBEAR.Request.Invalid.NoActors"));
  const parts = isContest(request) ? request.sides?.length : (request.mode === "challenge" ? CHALLENGE_PARTS : 1);
  if ( (request.parts?.length ?? 0) < parts ) throw new Error(localize("ROBEAR.Request.Invalid.MissingRoll"));
  if ( isContest(request) && ((request.sides?.length !== 2) || request.sides.some(s => !s?.length)) ) {
    throw new Error(localize("ROBEAR.Request.Invalid.EmptySide"));
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
  const label = getPartLabel(request.parts[0]);
  return request.parts[0].type in DICE ? localize("ROBEAR.Request.Labels.DieRoll", { die: label }) : label;
}

/* -------------------------------------------- */

/**
 * @param {RollRequest} request
 * @returns {string}  What the request asks for, under its title.
 */
export function getRequestSubtitle(request) {
  if ( request.mode === "challenge" ) {
    return localize("ROBEAR.Request.Subtitle.Challenge", { count: request.successes, total: request.parts.length });
  }
  if ( isContest(request) ) return request.parts.map(getPartLabel).join(` ${localize("ROBEAR.Request.Versus")} `);
  if ( request.mode === "divine" ) return localize("ROBEAR.Request.Subtitle.Divine", { count: request.range });
  return [localize(MODES[request.mode].label), getDCText(request, request.parts[0].dc)].filterJoin(" · ");
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
 * In a contest each actor makes one roll, the one for their side. If a roll was made more than once, the latest counts.
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
    const { actor, part, range } = roll.getFlag(MODULE_ID, "requestRoll");
    const first = roll.rolls[0];
    if ( !results.has(actor) || !first || !(part in request.parts) ) continue;
    if ( contest && !request.sides[part]?.includes(actor) ) continue;
    if ( !isRollByOwner(roll, actor) ) continue;
    const dc = request.parts[part].dc;
    let success = Number.isNumeric(dc) ? first.total >= dc : null;
    if ( range ) success = (first.total >= range.start) && (first.total <= range.end);
    results.get(actor)[contest ? 0 : part] = {
      message: roll,
      total: first.total,
      natural: first.d20?.results.find(r => r.active)?.result,
      visible: roll.isContentVisible,
      success,
      range
    };
  }
  return results;
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
  // it summarises inside their item's card.
  const requestRoll = message.getFlag(MODULE_ID, "requestRoll");
  if ( requestRoll && game.messages.has(requestRoll.request) && game.settings.get(MODULE_ID, "attachRolls") ) {
    html.hidden = true;
    return;
  }
  const request = message.getFlag(MODULE_ID, "request");
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
  card.append(renderHeader(MODES[request.mode].icon, getRequestTitle(request), getRequestSubtitle(request)));

  if ( isContest(request) ) {
    renderContest(card, message, request, results);
    return card;
  }

  if ( request.mode === "challenge" ) {
    const steps = document.createElement("ol");
    steps.className = "robear-request-steps";
    steps.innerHTML = request.parts.map(p => {
    return `<li>${foundry.utils.escapeHTML(getPartLabel(p))} <span>${getDCText(request, p.dc)}</span></li>`;
  }).join("");
    card.append(steps);
  }

  const team = request.mode === "team" ? getGroupOutcome(request.actors, results, true) : null;
  // Which rolls a natural 1 or 20 took out of the pool is part of the result, so players see it with the result.
  const shownTeam = team && !game.user.isGM && !message.getFlag(MODULE_ID, "revealed")
    ? { ...team, removed: new Map() } : team;
  const list = document.createElement("ul");
  list.className = "robear-request-actors";
  for ( const uuid of request.actors ) {
    list.append(renderActorRow(message, request, uuid, results.get(uuid), { team: shownTeam }));
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
 * @param {string} subtitle
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
      <span class="robear-request-subtitle">${escapeHTML(subtitle)}</span>
    </div>
  `;
  return header;
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
    const score = pooled && isSettled(group) ? `<span class="robear-request-score"${exactTooltip(group)}>${group.score}</span>` : "";
    block.innerHTML = `
      <header>
        <h4>${foundry.utils.escapeHTML(names[side])}</h4>
        <span>${foundry.utils.escapeHTML(getPartLabel(request.parts[side]))}</span>
        ${score}
      </header>
      <ul class="robear-request-actors"></ul>
    `;
    const list = block.querySelector("ul");
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
    summary.innerHTML = "<span></span><strong></strong>";
    summary.querySelector("span").textContent = scores;
    summary.querySelector("strong").textContent = verdict;
  } else if ( groups.every(g => g.complete) ) {
    summary.innerHTML = "<span></span>";
    summary.querySelector("span").textContent = localize("ROBEAR.Request.Contest.Hidden");
  }
  const reveal = game.user.isGM ? renderRivalRevealButton(request, results) : null;
  if ( reveal ) summary.append(reveal);
  if ( summary.childElementCount ) card.append(summary);
}

/* -------------------------------------------- */

/**
 * @param {GroupOutcome} group
 * @returns {string}  A tooltip attribute showing the exact average, if it was rounded.
 */
function exactTooltip(group) {
  if ( group.exact === group.score ) return "";
  const tooltip = localize("ROBEAR.Request.Team.ExactAverage", { average: group.exact.toFixed(2) });
  return ` data-tooltip="${foundry.utils.escapeHTML(tooltip)}"`;
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
  if ( challenge ) {
    const state = getChallengeState(results, request.successes);
    next = state.next ?? -1;
    if ( (state.success !== null) && !hideOutcome ) row.classList.add(state.success ? "success" : "failure");
  } else if ( results[0]?.visible && (results[0].success !== null) && !team && !hideOutcome ) {
    row.classList.add(results[0].success ? "success" : "failure");
  }
  if ( team?.removed.has(uuid) ) {
    row.classList.add("removed");
    row.dataset.tooltip = team.removed.get(uuid);
  }

  results.forEach((result, slot) => {
    if ( result?.range && result.visible ) {
      const range = document.createElement("span");
      range.className = "robear-request-range";
      range.dataset.tooltip = localize("ROBEAR.Request.Divine.Picked");
      range.textContent = `${result.range.start}–${result.range.end}`;
      slots.append(range);
    }
    // Only a DC decides success, so pooled rolls are not marked as passing or failing on their own.
    if ( result ) {
      const shown = (team || hideOutcome) ? { ...result, success: null } : result;
      slots.append(renderResult(shown, challenge ? slot : null, row));
    }
    else if ( slot === next ) slots.append(renderRollButton(message, request, actor, side ?? slot));
    else if ( !challenge || (next !== -1) ) slots.append(renderPending());
  });

  const latest = results.findLast(r => r);
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
        badge.dataset.tooltip = localize("ROBEAR.Request.Challenge.DoneTooltip");
      }
    } else {
      badge.textContent = hidden ? "?" : `${passed}/${request.successes}`;
      if ( !hidden && (success !== null) ) {
        badge.dataset.tooltip = localize(success ? "ROBEAR.Request.Challenge.Passed" : "ROBEAR.Request.Challenge.Failed");
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
  detail.innerHTML = `<div class="robear-request-roll-flavor">${foundry.utils.escapeHTML(message.flavor ?? "")}</div>`;
  for ( const roll of message.rolls ) {
    const formula = document.createElement("div");
    formula.className = "robear-request-roll-formula";
    formula.textContent = `${roll.formula} = ${roll.total}`;
    detail.append(formula);
    roll.getTooltip().then(html => detail.insertAdjacentHTML("beforeend", html));
  }
  return detail;
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
 * @returns {HTMLElement}
 */
function renderResult(result, part, row) {
  const pill = document.createElement("span");
  pill.className = "robear-request-result";
  if ( !result.visible ) {
    pill.textContent = "?";
    pill.dataset.tooltip = localize("ROBEAR.Request.Result.Hidden");
    return pill;
  }
  pill.textContent = result.total;
  if ( result.natural === 20 ) pill.classList.add("critical");
  if ( result.natural === 1 ) pill.classList.add("fumble");
  if ( result.success !== null ) pill.classList.add(result.success ? "success" : "failure");
  let tooltip = result.natural
    ? localize("ROBEAR.Request.Result.TotalWithD20", { total: result.total, natural: result.natural })
    : String(result.total);
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
  pill.dataset.tooltip = tooltip;
  return pill;
}

/* -------------------------------------------- */

/**
 * @returns {HTMLElement}  A placeholder for a roll someone else will make.
 */
function renderPending() {
  const pending = document.createElement("span");
  pending.className = "robear-request-pending";
  pending.dataset.tooltip = localize("ROBEAR.Request.Waiting");
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
  button.dataset.tooltip = localize("ROBEAR.Request.RollTooltip", { roll: getPartLabel(request.parts[part]) });
  button.innerHTML = '<i class="fa-solid fa-dice-d20" inert></i>';
  button.append(` ${request.mode === "challenge" ? part + 1 : localize("ROBEAR.Request.Roll")}`);
  button.addEventListener("click", async event => {
    event.preventDefault();
    event.stopPropagation();
    button.disabled = true;
    try {
      await rollForRequest(message, actor, part, event);
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
    const average = localize("ROBEAR.Request.Team.Average", { average: `<strong>${team.score}</strong>`, removed });
    summary.innerHTML = `<span${exactTooltip(team)}>${average}</span>`;
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
    const text = localize("ROBEAR.Request.Summary.Challenge", { count: states.filter(s => s.success).length, total: rows.length });
    summary.innerHTML = `<span>${text}</span>`;
    if ( game.user.isGM ) summary.append(renderRevealButton(message, revealed));
    return summary;
  }

  if ( !rows.every(r => r[0]?.visible) ) return;
  if ( request.mode === "divine" ) {
    const answered = rows.filter(r => r[0].success).length;
    summary.classList.add(answered ? "success" : "failure");
    summary.innerHTML = `<span>${localize("ROBEAR.Request.Summary.Divine", { count: answered, total: rows.length })}</span>`
      + `<strong>${localize(answered ? "ROBEAR.Request.Divine.Answered" : "ROBEAR.Request.Divine.NoAnswer")}</strong>`;
    return summary;
  }
  if ( !Number.isNumeric(request.parts[0].dc) ) return;

  // The GM decides when players see how many succeeded.
  const revealed = !!message.getFlag(MODULE_ID, "revealed");
  if ( !revealed && !game.user.isGM ) return;
  const text = localize("ROBEAR.Request.Summary.Standard", { count: rows.filter(r => r[0].success).length, total: rows.length });
  summary.innerHTML = `<span>${text}</span>`;
  if ( game.user.isGM ) summary.append(renderRevealButton(message, revealed));
  return summary;
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
  button.dataset.tooltip = localize(revealed ? "ROBEAR.Request.Reveal.ShownTooltip" : "ROBEAR.Request.Reveal.HiddenTooltip");
  button.innerHTML = `<i class="fa-solid ${revealed ? "fa-eye" : "fa-eye-slash"}" inert></i>`;
  button.append(` ${localize(revealed ? labels.shown : labels.hidden)}`);
  button.addEventListener("click", async event => {
    event.preventDefault();
    event.stopPropagation();
    button.disabled = true;
    // On success the card is redrawn with a new button; on failure this one must work again.
    try {
      await toggle();
    } finally {
      button.disabled = false;
    }
  });
  return button;
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
 * A GM button to show the NPC's roll-off roll to players, by making its private roll public, or to hide it again.
 * @param {RollRequest} request
 * @param {Map<string, (PartResult|null)[]>} results
 * @returns {HTMLButtonElement|void}  Nothing until an NPC has rolled.
 */
function renderRivalRevealButton(request, results) {
  const rolls = request.actors.filter(uuid => isHiddenRival(request, fromUuidSync(uuid)))
    .map(uuid => results.get(uuid)[0]?.message).filter(Boolean);
  if ( !rolls.length ) return;
  const revealed = rolls.every(m => !m.whisper.length);
  const whisper = revealed ? ChatMessage.getWhisperRecipients("GM").map(u => u.id) : [];
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
 */
async function rollForRequest(message, actor, part, event) {
  const request = message.getFlag(MODULE_ID, "request");
  const key = `${message.id}.${actor.uuid}.${part}`;
  const slot = isContest(request) ? 0 : part;
  if ( rolling.has(key) || getResults(message).get(actor.uuid)?.[slot] ) return;

  const { type, key: id } = request.parts[part];
  // Only the modifier keys are passed on. dnd5e would otherwise treat the request card as the roll's origin.
  const { altKey, ctrlKey, metaKey, shiftKey } = event;
  const config = { event: { altKey, ctrlKey, metaKey, shiftKey } };
  // The DC is never sent with the roll: dnd5e would show the person rolling whether they beat it, before the GM
  // shows the result. The request card scores each roll against the request's DC itself.
  const requestRoll = { request: message.id, actor: actor.uuid, part };
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
      mode: localize(MODES[request.mode].label), die: DICE[die].label, start: range?.start, end: range?.end
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

  let start;
  return foundry.applications.api.DialogV2.wait({
    classes: ["robear-card-dialog", "robear-divine-dialog"],
    window: {
      title: localize("ROBEAR.Request.Divine.DialogTitle", { name: actor.name }),
      icon: "fa-solid fa-hands-praying"
    },
    position: { width: 460 },
    content: `
      <p class="robear-card-hint">${localize("ROBEAR.Request.Divine.DialogHint", { count: size })}</p>
      <div class="robear-divine-grid">${cells}</div>
      <p class="robear-divine-choice">${localize("ROBEAR.Request.Divine.NonePicked")}</p>
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
          choice.textContent = localize("ROBEAR.Request.Divine.Need", { start, end: start + size - 1 });
          roll.disabled = false;
        });
      }
      dialog.element.querySelector(".robear-divine-grid").addEventListener("pointerleave", () => mark(undefined, "preview"));
    },
    rejectClose: false
  }).then(result => (result === "cancel" ? undefined : result));
}
