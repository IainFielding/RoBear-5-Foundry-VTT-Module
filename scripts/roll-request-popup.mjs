/**
 * Roll request pop-ups: when the GM posts a roll request, a window opens for each user with something to roll in it,
 * holding the same Roll buttons as the chat card. Players and the GM each have a setting, both off by default.
 */

import { MODULE_ID } from "./hero-cards.mjs";
import {
  getChallengeState, getRequest, getResults, getRowGroup, isContest, renderActorRow, renderRequestHeader
} from "./roll-requests.mjs";

const { ApplicationV2 } = foundry.applications.api;

/**
 * How recent a request must be for a user who joins after it was posted to still get its pop-up.
 */
const LATE_JOIN_MS = 30 * 60 * 1000;

/**
 * How long a pop-up stays open after its last roll, so the result can be seen.
 */
const CLOSE_DELAY_MS = 1500;

/* -------------------------------------------- */
/*  Hooks                                       */
/* -------------------------------------------- */

Hooks.once("init", registerSettings);
Hooks.once("ready", openRecentRequests);
Hooks.on("createChatMessage", onCreateMessage);
Hooks.on("updateChatMessage", onChangeMessage);
Hooks.on("deleteChatMessage", onDeleteMessage);

/**
 * Register the pop-up settings.
 */
function registerSettings() {
  game.settings.register(MODULE_ID, "popupPlayers", {
    name: "STT.Settings.PopupPlayers.Name",
    hint: "STT.Settings.PopupPlayers.Hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: false
  });
  game.settings.register(MODULE_ID, "popupGM", {
    name: "STT.Settings.PopupGM.Name",
    hint: "STT.Settings.PopupGM.Hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: false
  });
}

/* -------------------------------------------- */

/**
 * A user who joins while a recent request still needs their rolls gets its pop-up too.
 */
function openRecentRequests() {
  const since = Date.now() - LATE_JOIN_MS;
  for ( const message of game.messages.contents.slice(-20) ) {
    if ( message.timestamp >= since ) openPopup(message);
  }
}

/* -------------------------------------------- */

/**
 * Open a pop-up for a new request, and redraw one when a roll for its request is made.
 * @param {ChatMessage5e} message
 */
function onCreateMessage(message) {
  if ( message.getFlag(MODULE_ID, "request") ) openPopup(message);
  else onChangeMessage(message);
}

/* -------------------------------------------- */

/**
 * Redraw a request's pop-up when the request changes, such as the GM showing its result, or when one of its rolls is
 * changed by a card or deleted. A pop-up the user has closed stays closed.
 * @param {ChatMessage5e} message
 */
function onChangeMessage(message) {
  const requestId = message.getFlag(MODULE_ID, "request") ? message.id
    : message.getFlag(MODULE_ID, "requestRoll")?.request;
  if ( requestId ) foundry.applications.instances.get(RollRequestPopup.idFor(requestId))?.render();
}

/* -------------------------------------------- */

/**
 * Close a request's pop-up when the request is deleted, and redraw it when one of its rolls is.
 * @param {ChatMessage5e} message
 */
function onDeleteMessage(message) {
  if ( message.getFlag(MODULE_ID, "request") ) {
    foundry.applications.instances.get(RollRequestPopup.idFor(message.id))?.close();
    return;
  }
  onChangeMessage(message);
}

/* -------------------------------------------- */
/*  Who Gets a Pop-Up                           */
/* -------------------------------------------- */

/**
 * The actors in a request this user rolls for: a player's own characters, or for the GM, actors no player owns.
 * @param {RollRequest} request
 * @returns {string[]}  Actor UUIDs.
 */
export function getPopupActors(request) {
  // In a contest only those on a side roll, though a macro's request may list others among its actors.
  const rolling = isContest(request) ? request.sides.flat() : request.actors;
  return request.actors.filter(uuid => {
    if ( !rolling.includes(uuid) ) return false;
    const actor = fromUuidSync(uuid);
    if ( !actor?.isOwner ) return false;
    return game.user.isGM ? !actor.hasPlayerOwner : true;
  });
}

/* -------------------------------------------- */

/**
 * @param {ChatMessage5e} message  The request message.
 * @param {string[]} uuids
 * @returns {boolean}  Whether any of these actors still has a roll to make.
 */
export function hasRollsLeft(message, uuids) {
  const request = message.getFlag(MODULE_ID, "request");
  const results = getResults(message);
  return uuids.some(uuid => {
    const rolls = results.get(uuid);
    if ( request.mode === "challenge" ) return getChallengeState(rolls, request.successes).next !== null;
    return !rolls[0];
  });
}

/* -------------------------------------------- */

/**
 * Open a request's pop-up for this user, if their setting is on and they still have something to roll.
 * @param {ChatMessage5e} message
 */
function openPopup(message) {
  const request = getRequest(message);
  if ( !request ) return;
  if ( !game.settings.get(MODULE_ID, game.user.isGM ? "popupGM" : "popupPlayers") ) return;
  if ( foundry.applications.instances.get(RollRequestPopup.idFor(message.id)) ) return;
  const uuids = getPopupActors(request);
  if ( !uuids.length || !hasRollsLeft(message, uuids) ) return;
  new RollRequestPopup(message).render({ force: true });
}

/* -------------------------------------------- */
/*  Pop-Up Window                               */
/* -------------------------------------------- */

/**
 * A request's Roll buttons for one user's actors, in a window of their own.
 */
export default class RollRequestPopup extends ApplicationV2 {
  /**
   * @param {ChatMessage5e} message  The request message.
   * @param {object} [options]
   */
  constructor(message, options={}) {
    super({ id: RollRequestPopup.idFor(message.id), ...options });
    this.message = message;
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["stt-card-dialog", "stt-request-popup"],
    window: { title: "STT.Request.PopupTitle", icon: "fa-solid fa-beer-mug-empty" },
    position: { width: 380, height: "auto" }
  };

  /**
   * @param {string} messageId  The request message's ID.
   * @returns {string}  The pop-up's application ID.
   */
  static idFor(messageId) {
    return `stt-request-popup-${messageId}`;
  }

  /**
   * The timer that closes the pop-up once everything is rolled, if one is running.
   * @type {number|null}
   */
  #closeTimer = null;

  /* -------------------------------------------- */

  /** @override */
  async _renderHTML() {
    const request = this.message.getFlag(MODULE_ID, "request");
    const results = getResults(this.message);
    const card = document.createElement("div");
    card.className = `stt-request mode-${request.mode}`;
    card.append(renderRequestHeader(this.message, request));
    const list = document.createElement("ul");
    list.className = "stt-request-actors";
    for ( const uuid of getPopupActors(request) ) {
      // In a contest an actor rolls for their own side.
      const side = isContest(request) ? request.sides.findIndex(s => s.includes(uuid)) : undefined;
      const team = getRowGroup(this.message, request, results, side);
      list.append(renderActorRow(this.message, request, uuid, results.get(uuid), { team, side }));
    }
    card.append(list);
    return card;
  }

  /* -------------------------------------------- */

  /** @override */
  _replaceHTML(result, content) {
    content.replaceChildren(result);
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  async _onRender(context, options) {
    await super._onRender(context, options);
    this.setPosition({ height: "auto" });
    // Once everything is rolled, leave the results up a moment, then close. If a roll is deleted in that moment, so
    // there is something to roll again, the pop-up stays open.
    const request = this.message.getFlag(MODULE_ID, "request");
    if ( hasRollsLeft(this.message, getPopupActors(request)) ) this.#cancelClose();
    else this.#closeTimer ??= setTimeout(() => {
      this.#closeTimer = null;
      this.close();
    }, CLOSE_DELAY_MS);
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  _onClose(options) {
    super._onClose(options);
    this.#cancelClose();
  }

  /* -------------------------------------------- */

  /**
   * Stop the pop-up closing itself.
   */
  #cancelClose() {
    clearTimeout(this.#closeTimer);
    this.#closeTimer = null;
  }
}
