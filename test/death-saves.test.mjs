import { beforeEach, describe, expect, it } from "vitest";
import { GM } from "./helpers/messages.mjs";
import { MODULE_ID } from "../scripts/hero-cards.mjs";
import { findDeathSaveRequests, needsDeathSave } from "../scripts/death-saves.mjs";

/**
 * @param {object} [data]
 * @param {string} [data.type="character"]
 * @param {number} [data.hp=0]
 * @param {number} [data.max=20]
 * @param {number} [data.success=0]
 * @param {number} [data.failure=0]
 * @param {boolean} [data.important=false]
 * @param {string[]} [data.statuses]
 * @param {object} [data.flags]  The module's flags on the actor.
 * @returns {object}  A stand-in for an actor.
 */
function actor({
  type = "character", hp = 0, max = 20, success = 0, failure = 0, important = false, statuses = [], flags = {}
} = {}) {
  return {
    type,
    statuses: new Set(statuses),
    system: { attributes: { hp: { value: hp, max }, death: { success, failure } }, traits: { important } },
    getFlag: (scope, key) => (scope === MODULE_ID ? flags[key] : undefined)
  };
}

/**
 * @param {string} uuid    The actor it was posted for.
 * @param {object} [author]
 * @returns {object}  A death save request message.
 */
function deathSaveRequest(uuid, author = GM) {
  const flags = { request: { mode: "standard" }, deathSave: { actor: uuid, combat: "combat", round: 1 } };
  return { id: `request-${uuid}`, author, getFlag: (scope, key) => (scope === MODULE_ID ? flags[key] : undefined) };
}

beforeEach(() => {
  game.messages = [];
});

describe("Who makes a death save at the start of their turn", () => {
  it("asks a character at 0 hit points", () => {
    expect(needsDeathSave(actor())).toBe(true);
    expect(needsDeathSave(actor({ success: 2, failure: 2 }))).toBe(true);
  });

  it("asks no one who is still standing", () => {
    expect(needsDeathSave(actor({ hp: 1 }))).toBe(false);
  });

  it("asks an NPC only if it is marked Important, as dnd5e shows death saves for", () => {
    expect(needsDeathSave(actor({ type: "npc" }))).toBe(false);
    expect(needsDeathSave(actor({ type: "npc", important: true }))).toBe(true);
  });

  it("asks no one who is dead, or stable", () => {
    expect(needsDeathSave(actor({ failure: 3 }))).toBe(false);
    expect(needsDeathSave(actor({ statuses: ["dead"] }))).toBe(false);
    expect(needsDeathSave(actor({ statuses: ["stable"] }))).toBe(false);
    // dnd5e clears a creature's successes once it is stable, so the module notes it.
    expect(needsDeathSave(actor({ flags: { stable: true } }))).toBe(false);
    expect(needsDeathSave(actor({ flags: { stable: false } }))).toBe(true);
  });

  it("asks nothing of an actor with no hit points or death saves to track", () => {
    expect(needsDeathSave(actor({ max: 0 }))).toBe(false);
    expect(needsDeathSave({ type: "vehicle", system: { attributes: { hp: { value: 0, max: 10 } } } })).toBe(false);
    expect(needsDeathSave(null)).toBe(false);
  });
});

describe("Finding a creature's death save requests", () => {
  it("finds only that creature's, and only those a GM posted", () => {
    const aria = deathSaveRequest("aria");
    game.messages = [aria, deathSaveRequest("borin"), deathSaveRequest("aria", { id: "player", isGM: false })];
    expect(findDeathSaveRequests("aria")).toEqual([aria]);
  });
});
