import { beforeEach, describe, expect, it } from "vitest";
import { requestMessage, rollMessage } from "./helpers/messages.mjs";
import { getPopupActors, hasRollsLeft } from "../scripts/roll-request-popup.mjs";

// What the current user owns, and which actors have a player owner.
const actors = {
  aria: { isOwner: true, hasPlayerOwner: true },
  borin: { isOwner: true, hasPlayerOwner: true },
  cleric: { isOwner: false, hasPlayerOwner: true },
  goblin: { isOwner: false, hasPlayerOwner: false }
};

beforeEach(() => {
  globalThis.fromUuidSync = uuid => actors[uuid] ?? null;
  game.user = { isGM: false };
  game.messages = [];
  actors.goblin.isOwner = false;
  actors.cleric.isOwner = false;
});

describe("Who a pop-up is for", () => {
  it("gives a player their own characters, and nobody else's", () => {
    expect(getPopupActors({ actors: ["aria", "cleric", "goblin", "borin"] })).toEqual(["aria", "borin"]);
  });

  it("gives a player nothing when none of their characters is asked to roll", () => {
    expect(getPopupActors({ actors: ["cleric", "goblin"] })).toEqual([]);
  });

  it("gives the GM only the actors no player owns", () => {
    game.user = { isGM: true };
    for ( const a of Object.values(actors) ) a.isOwner = true;
    expect(getPopupActors({ actors: ["aria", "goblin", "cleric"] })).toEqual(["goblin"]);
  });

  it("skips actors that no longer exist", () => {
    expect(getPopupActors({ actors: ["gone", "aria"] })).toEqual(["aria"]);
  });
});

describe("When a pop-up has nothing left to roll", () => {
  const standard = requestMessage({ mode: "standard", actors: ["aria", "borin"], parts: [{ type: "d20", dc: 10 }] });

  it("waits for every one of the user's actors to roll", () => {
    game.messages = [rollMessage({ actor: "aria", total: 12, natural: 12 })];
    expect(hasRollsLeft(standard, ["aria", "borin"])).toBe(true);
    expect(hasRollsLeft(standard, ["aria"])).toBe(false);
  });

  it("is done in a skill challenge once the outcome is settled, before the third roll", () => {
    const parts = [{ type: "d20", dc: 10 }, { type: "d20", dc: 10 }, { type: "d20", dc: 10 }];
    const challenge = requestMessage({ mode: "challenge", actors: ["aria"], parts, successes: 2 });
    game.messages = [rollMessage({ actor: "aria", total: 15, part: 0 })];
    expect(hasRollsLeft(challenge, ["aria"])).toBe(true);
    game.messages = [...game.messages, rollMessage({ actor: "aria", total: 15, part: 1 })];
    expect(hasRollsLeft(challenge, ["aria"])).toBe(false);
  });

  it("counts a contest actor's one roll for their side", () => {
    const rolloff = requestMessage({
      mode: "rolloff", actors: ["aria", "goblin"], sides: [["aria"], ["goblin"]],
      parts: [{ type: "d20", dc: null }, { type: "d20", dc: null }]
    });
    expect(hasRollsLeft(rolloff, ["aria"])).toBe(true);
    game.messages = [rollMessage({ actor: "aria", total: 9, part: 0 })];
    expect(hasRollsLeft(rolloff, ["aria"])).toBe(false);
  });
});
