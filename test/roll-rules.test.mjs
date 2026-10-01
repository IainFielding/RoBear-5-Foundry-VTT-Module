import { beforeEach, describe, expect, it } from "vitest";
import { actorNames } from "./helpers/foundry-shims.mjs";
import { requestMessage, rollMessage } from "./helpers/messages.mjs";
import {
  DIVINE_RANGE, MODES, getChallengeState, getGroupOutcome, getPartLabel, getResults, isContest, poolTeamRolls
} from "../scripts/roll-requests.mjs";

const entries = rows => rows.map(([uuid, total, natural]) => ({ uuid, total, natural }));
const pass = { success: true };
const fail = { success: false };

beforeEach(() => {
  actorNames.clear();
  for ( const name of ["A", "B", "C", "D"] ) actorNames.set(name, name);
  game.messages = [];
});

/* -------------------------------------------- */

describe("Team Challenge pooling", () => {
  it("averages every roll when no one rolls a 1 or 20, rounding down", () => {
    expect(poolTeamRolls(entries([["A", 12, 8], ["B", 15, 11], ["C", 10, 5]]))).toMatchObject({
      average: 12, exact: 37 / 3, removed: new Map()
    });
  });

  it("removes the highest roll for a natural 1", () => {
    const { average, removed } = poolTeamRolls(entries([["A", 5, 1], ["B", 18, 14], ["C", 12, 9], ["D", 14, 10]]));
    expect([...removed.keys()]).toEqual(["B"]);
    expect(removed.get("B")).toBe("Highest roll, removed by A's natural 1");
    expect(average).toBe(10);
  });

  it("removes the lowest roll for a natural 20", () => {
    const { average, removed } = poolTeamRolls(entries([["A", 25, 20], ["B", 8, 4], ["C", 12, 9], ["D", 14, 10]]));
    expect([...removed.keys()]).toEqual(["B"]);
    expect(removed.get("B")).toBe("Lowest roll, removed by A's natural 20");
    expect(average).toBe(17);
  });

  it("applies a 1 and a 20 together when the pool is big enough", () => {
    const { average, removed } = poolTeamRolls(entries([["A", 5, 1], ["B", 25, 20], ["C", 12, 9], ["D", 14, 10]]));
    expect(new Set(removed.keys())).toEqual(new Set(["A", "B"]));
    expect(average).toBe(13);
  });

  it("cancels a 1 and a 20 out when applying both would empty the pool", () => {
    const { average, removed } = poolTeamRolls(entries([["A", 5, 1], ["B", 25, 20]]));
    expect(removed.size).toBe(0);
    expect(average).toBe(15);
  });

  it("removes one roll per natural 1, but always keeps one", () => {
    const { average, removed } = poolTeamRolls(entries([["A", 5, 1], ["B", 4, 1], ["C", 16, 12]]));
    expect(removed.size).toBe(2);
    expect(average).toBe(4);
  });

  it("never removes a lone roll", () => {
    expect(poolTeamRolls(entries([["A", 5, 1]]))).toMatchObject({ average: 5, removed: new Map() });
    expect(poolTeamRolls(entries([["A", 25, 20]]))).toMatchObject({ average: 25, removed: new Map() });
  });

  it("ignores rolls without a d20, such as a d100", () => {
    expect(poolTeamRolls(entries([["A", 1, undefined], ["B", 20, undefined]])).removed.size).toBe(0);
  });
});

/* -------------------------------------------- */

describe("Skill Challenge progress", () => {
  it("asks for the first roll before any are made", () => {
    expect(getChallengeState([null, null, null], 2)).toEqual({ passed: 0, failed: 0, success: null, next: 0 });
  });

  it("asks for the next roll while the outcome is open", () => {
    expect(getChallengeState([pass, fail, null], 2)).toMatchObject({ success: null, next: 2 });
  });

  it("stops as soon as enough rolls succeed", () => {
    expect(getChallengeState([pass, pass, null], 2)).toEqual({ passed: 2, failed: 0, success: true, next: null });
  });

  it("stops as soon as success is out of reach", () => {
    expect(getChallengeState([fail, fail, null], 2)).toEqual({ passed: 0, failed: 2, success: false, next: null });
  });

  it("decides on the third roll", () => {
    expect(getChallengeState([pass, fail, pass], 2)).toMatchObject({ passed: 2, success: true });
    expect(getChallengeState([fail, pass, fail], 2)).toMatchObject({ passed: 1, success: false });
  });

  it("needing 1 of 3 ends on the first success", () => {
    expect(getChallengeState([fail, pass, null], 1)).toMatchObject({ success: true, next: null });
  });

  it("needing 3 of 3 ends on the first failure", () => {
    expect(getChallengeState([pass, fail, null], 3)).toMatchObject({ success: false, next: null });
  });
});

/* -------------------------------------------- */

describe("Results from tagged roll messages", () => {
  it("scores each roll against its part's DC", () => {
    const message = requestMessage({ mode: "standard", actors: ["A", "B"], parts: [{ type: "skill", key: "ath", dc: 12 }] });
    game.messages = [rollMessage({ actor: "A", total: 12, natural: 10 }), rollMessage({ actor: "B", total: 11, natural: 9 })];
    const results = getResults(message);
    expect(results.get("A")[0]).toMatchObject({ total: 12, natural: 10, success: true, visible: true });
    expect(results.get("B")[0]).toMatchObject({ total: 11, success: false });
  });

  it("has no success without a DC", () => {
    const message = requestMessage({ mode: "standard", actors: ["A"], parts: [{ type: "skill", key: "ath", dc: null }] });
    game.messages = [rollMessage({ actor: "A", total: 12, natural: 10 })];
    expect(getResults(message).get("A")[0].success).toBeNull();
  });

  it("counts the latest roll when a part is rolled twice", () => {
    const message = requestMessage({ mode: "standard", actors: ["A"], parts: [{ type: "skill", key: "ath", dc: 12 }] });
    game.messages = [rollMessage({ actor: "A", total: 20, natural: 18 }), rollMessage({ actor: "A", total: 3, natural: 3 })];
    expect(getResults(message).get("A")[0].total).toBe(3);
  });

  it("ignores rolls for other requests, other actors and missing parts", () => {
    const message = requestMessage({ mode: "standard", actors: ["A"], parts: [{ type: "skill", key: "ath", dc: 12 }] });
    game.messages = [
      rollMessage({ actor: "A", total: 5, request: "other" }),
      rollMessage({ actor: "Z", total: 5 }),
      rollMessage({ actor: "A", total: 5, part: 4 })
    ];
    expect(getResults(message).get("A")).toEqual([null]);
    expect(getResults(message).has("Z")).toBe(false);
  });

  it("keeps a skill challenge's parts apart", () => {
    const parts = [{ type: "skill", key: "ath", dc: 10 }, { type: "skill", key: "acr", dc: 15 }, { type: "save", key: "wis", dc: 5 }];
    const message = requestMessage({ mode: "challenge", actors: ["A"], parts });
    game.messages = [rollMessage({ actor: "A", total: 12, part: 0 }), rollMessage({ actor: "A", total: 12, part: 1 })];
    const [first, second, third] = getResults(message).get("A");
    expect(first.success).toBe(true);
    expect(second.success).toBe(false);
    expect(third).toBeNull();
  });

  it("gives each contest actor one result, for their own side only", () => {
    const message = requestMessage({
      mode: "rolloff", actors: ["A", "B"], sides: [["A"], ["B"]],
      parts: [{ type: "d100", dc: null }, { type: "skill", key: "ath", dc: null }]
    });
    game.messages = [
      rollMessage({ actor: "A", total: 40, part: 0 }),
      rollMessage({ actor: "B", total: 99, part: 0 }),
      rollMessage({ actor: "B", total: 14, part: 1 })
    ];
    const results = getResults(message);
    expect(results.get("A")).toHaveLength(1);
    expect(results.get("A")[0].total).toBe(40);
    expect(results.get("B")[0].total).toBe(14);
  });

  it("scores Divine Intervention by the picked range, both ends included", () => {
    const message = requestMessage({ mode: "divine", range: 16, actors: ["A", "B", "C", "D"], parts: [{ type: "d100", dc: null }] });
    const range = { start: 40, end: 55 };
    game.messages = [
      rollMessage({ actor: "A", total: 40, range }),
      rollMessage({ actor: "B", total: 55, range }),
      rollMessage({ actor: "C", total: 39, range }),
      rollMessage({ actor: "D", total: 56, range })
    ];
    const results = getResults(message);
    expect(["A", "B", "C", "D"].map(a => results.get(a)[0].success)).toEqual([true, true, false, false]);
    expect(results.get("A")[0].range).toEqual(range);
  });

  it("marks rolls this user may not see", () => {
    const message = requestMessage({ mode: "standard", actors: ["A"], parts: [{ type: "skill", key: "ath", dc: 12 }] });
    game.messages = [rollMessage({ actor: "A", total: 12, visible: false })];
    expect(getResults(message).get("A")[0].visible).toBe(false);
  });
});

/* -------------------------------------------- */

describe("Group outcomes", () => {
  const results = map => new Map(Object.entries(map).map(([uuid, r]) => [uuid, [r]]));
  const roll = (total, natural, visible = true) => ({ total, natural, visible });

  it("waits until everyone has rolled", () => {
    expect(getGroupOutcome(["A", "B"], results({ A: roll(10, 10), B: null }), true)).toMatchObject({ complete: false });
  });

  it("stays hidden when this user cannot see a roll", () => {
    expect(getGroupOutcome(["A"], results({ A: roll(10, 10, false) }), false)).toMatchObject({ complete: true, hidden: true });
  });

  it("scores a single roll-off side by its total", () => {
    expect(getGroupOutcome(["A"], results({ A: roll(73) }), false)).toMatchObject({ score: 73 });
  });

  it("scores a team by its pooled average, with the 1 and 20 rule", () => {
    const outcome = getGroupOutcome(["A", "B", "C"], results({ A: roll(1, 1), B: roll(15, 15), C: roll(10, 10) }), true);
    expect(outcome.score).toBe(5);
    expect([...outcome.removed.keys()]).toEqual(["B"]);
  });
});

/* -------------------------------------------- */

describe("Modes and labels", () => {
  it("offers six modes, two of them contests", () => {
    expect(Object.keys(MODES)).toEqual(["standard", "team", "challenge", "rolloff", "versus", "divine"]);
    expect(Object.keys(MODES).filter(m => isContest({ mode: m }))).toEqual(["rolloff", "versus"]);
  });

  it("offers plain dice in a Standard Roll and a Roll-Off, and only a d20 to teams", () => {
    expect(MODES.standard.dice).toEqual(["d20", "d6", "d8", "d10", "d12", "d100"]);
    expect(MODES.rolloff.dice).toEqual(["d20", "d6", "d8", "d10", "d12", "d100"]);
    // The 1 and 20 rule needs a d20, so team rolls offer nothing else.
    expect(MODES.versus.dice).toEqual(["d20"]);
    expect(MODES.team.dice).toBeUndefined();
  });

  it("lets Divine Intervention pick 1 to 50 numbers, 16 by default", () => {
    expect(DIVINE_RANGE).toEqual({ min: 1, max: 50, initial: 16 });
  });

  it("names every kind of roll", () => {
    expect(getPartLabel({ type: "skill", key: "ath" })).toBe("Athletics Check");
    expect(getPartLabel({ type: "check", key: "str" })).toBe("Strength Check");
    expect(getPartLabel({ type: "save", key: "dex" })).toBe("Dexterity Save");
    expect(getPartLabel({ type: "tool", key: "thief" })).toBe("Thieves' Tools Check");
    expect(getPartLabel({ type: "d20" })).toBe("d20");
    expect(getPartLabel({ type: "d100" })).toBe("d100");
    for ( const die of ["d6", "d8", "d10", "d12"] ) expect(getPartLabel({ type: die })).toBe(die);
  });
});
