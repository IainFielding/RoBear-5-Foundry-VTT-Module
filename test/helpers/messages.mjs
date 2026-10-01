/**
 * Stand-ins for chat messages: a request, and the tagged roll messages its results come from.
 */

import { MODULE_ID } from "../../scripts/robear-cards.mjs";

let clock = 0;

/**
 * @param {object} request  The request's flag data.
 * @returns {object}        A request message.
 */
export function requestMessage(request, id = "request") {
  return { id, getFlag: (scope, key) => (scope === MODULE_ID && key === "request" ? request : undefined) };
}

/**
 * A roll made for a request.
 * @param {object} data
 * @param {string} data.actor     Actor UUID.
 * @param {number} data.total
 * @param {number} [data.natural]  The d20 kept, if the roll has one.
 * @param {number} [data.part=0]
 * @param {object} [data.range]    Divine Intervention's picked numbers.
 * @param {boolean} [data.visible=true]
 * @param {string} [data.request="request"]
 * @returns {object}
 */
export function rollMessage({ actor, total, natural, part = 0, range, visible = true, request = "request" }) {
  const flag = { request, actor, part, range };
  return {
    timestamp: ++clock,
    isContentVisible: visible,
    rolls: [{ total, d20: natural === undefined ? undefined : { results: [{ result: natural, active: true }] } }],
    getFlag: (scope, key) => (scope === MODULE_ID && key === "requestRoll" ? flag : undefined)
  };
}
