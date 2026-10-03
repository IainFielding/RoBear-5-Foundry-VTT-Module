/**
 * Stand-ins for chat messages: a request, and the tagged roll messages its results come from.
 */

import { MODULE_ID } from "../../scripts/robear-cards.mjs";

let clock = 0;

/**
 * The GM, as a message's author.
 */
export const GM = { id: "gm", isGM: true };

/**
 * @param {object} request  The request's flag data.
 * @param {string} [id="request"]
 * @param {object} [flags]  The request message's other flags, such as `revealed`.
 * @returns {object}        A request message.
 */
export function requestMessage(request, id = "request", flags = {}) {
  const all = { ...flags, request };
  return { id, getFlag: (scope, key) => (scope === MODULE_ID ? all[key] : undefined) };
}

/**
 * A roll made for a request.
 * @param {object} data
 * @param {string} data.actor     Actor UUID.
 * @param {number} data.total
 * @param {number} [data.natural]  The d20 kept, if the roll has one.
 * @param {number} [data.part=0]
 * @param {object} [data.range]    Divine Intervention's picked numbers.
 * @param {number} [data.choice]   Which of the part's choices was rolled.
 * @param {boolean} [data.visible=true]
 * @param {string} [data.request="request"]
 * @param {object} [data.author]   Who made the roll. The GM by default, whose rolls always count.
 * @returns {object}
 */
export function rollMessage({
  actor, total, natural, part = 0, range, choice, visible = true, request = "request", author = GM
}) {
  const flag = { request, actor, part, range, choice };
  return {
    id: `roll${++clock}`,
    timestamp: clock,
    author,
    isContentVisible: visible,
    rolls: [{ total, d20: natural === undefined ? undefined : { results: [{ result: natural, active: true }] } }],
    getFlag: (scope, key) => (scope === MODULE_ID && key === "requestRoll" ? flag : undefined)
  };
}
