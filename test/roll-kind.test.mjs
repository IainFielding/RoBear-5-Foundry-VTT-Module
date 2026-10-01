import { describe, expect, it } from "vitest";
import { MODULE_ID, getRollKind } from "../scripts/robear-cards.mjs";

/**
 * @param {object} data
 * @returns {object}  A chat message stand-in, as getRollKind reads it.
 */
function message({ type = "base", system = {}, rolls = [{}], flag }) {
  return { type, system, rolls, getFlag: (scope, key) => (scope === MODULE_ID && key === "requestRoll" ? flag : undefined) };
}

describe("Which rolls a card can be played on", () => {
  it("reads dnd5e's own roll message types", () => {
    expect(getRollKind(message({ type: "attack" }))).toBe("attack");
    expect(getRollKind(message({ type: "damage" }))).toBe("damage");
    expect(getRollKind(message({ type: "check", system: { type: "ability" } }))).toBe("check");
    expect(getRollKind(message({ type: "check", system: { type: "initiative" } }))).toBe("initiative");
    expect(getRollKind(message({ type: "save", system: {} }))).toBe("save");
  });

  it("leaves death saves alone", () => {
    expect(getRollKind(message({ type: "save", system: { type: "death" } }))).toBeNull();
  });

  it("ignores messages without rolls", () => {
    expect(getRollKind(message({ type: "check", rolls: [] }))).toBeNull();
  });

  it("treats a request's plain d20 as a check", () => {
    const d20 = new CONFIG.Dice.D20Roll();
    expect(getRollKind(message({ rolls: [d20], flag: { request: "r" } }))).toBe("check");
  });

  it("treats a Divine Intervention d100 as its own kind", () => {
    expect(getRollKind(message({ rolls: [{}], flag: { request: "r", range: { start: 1, end: 16 } } }))).toBe("divine");
  });

  it("ignores a request's d100 roll-off and any untagged plain roll", () => {
    expect(getRollKind(message({ rolls: [{}], flag: { request: "r" } }))).toBeNull();
    expect(getRollKind(message({ rolls: [new CONFIG.Dice.D20Roll()] }))).toBeNull();
  });
});
