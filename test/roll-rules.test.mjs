import { beforeEach, describe, expect, it } from "vitest";
import { actorNames, actorOwners, settingValues } from "./helpers/foundry-shims.mjs";
import { requestMessage, rollMessage } from "./helpers/messages.mjs";
import {
  DIVINE_RANGE, MAX_CHOICES, MODES, getChallengeState, getChoiceLabel, getChoices, getGroupOutcome, getPartLabel,
  getRequestSubtitle, getRequestTitle, getResults, getRowGroup, isContest, poolTeamRolls, validateRequest, withDefaults
} from "../scripts/roll-requests.mjs";

const entries = rows => rows.map(([uuid, total, natural]) => ({ uuid, total, natural }));
const pass = { success: true };
const fail = { success: false };

beforeEach(() => {
  actorNames.clear();
  actorOwners.clear();
  for ( const name of ["A", "B", "C", "D"] ) actorNames.set(name, name);
  game.messages = [];
  game.user = { isGM: true };
  settingValues.set("showDCDefault", false);
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

  it("scores a roll chosen from a choice against the shared DC, noting which was chosen", () => {
    const part = { type: "skill", key: "ath", dc: 12, alternatives: [{ type: "save", key: "str" }] };
    const message = requestMessage({ mode: "standard", actors: ["A", "B"], parts: [part] });
    game.messages = [rollMessage({ actor: "A", total: 13, choice: 1 }), rollMessage({ actor: "B", total: 9 })];
    const results = getResults(message);
    expect(results.get("A")[0]).toMatchObject({ choice: 1, success: true });
    expect(results.get("B")[0]).toMatchObject({ choice: 0, success: false });
  });

  it("scores rolls already made against a DC changed since, as results are read from the request each time", () => {
    const request = { mode: "standard", actors: ["A"], parts: [{ type: "skill", key: "ath", dc: 15 }] };
    const message = requestMessage(request);
    game.messages = [rollMessage({ actor: "A", total: 13 })];
    expect(getResults(message).get("A")[0].success).toBe(false);
    request.parts[0].dc = 12;
    expect(getResults(message).get("A")[0].success).toBe(true);
  });

  it("has no success without a DC", () => {
    const message = requestMessage({ mode: "standard", actors: ["A"], parts: [{ type: "skill", key: "ath", dc: null }] });
    game.messages = [rollMessage({ actor: "A", total: 12, natural: 10 })];
    expect(getResults(message).get("A")[0].success).toBeNull();
  });

  it("counts the first roll when a part is rolled twice, so a second can't fish for a better one", () => {
    const message = requestMessage({ mode: "standard", actors: ["A"], parts: [{ type: "skill", key: "ath", dc: 12 }] });
    game.messages = [rollMessage({ actor: "A", total: 3, natural: 3 }), rollMessage({ actor: "A", total: 20, natural: 18 })];
    expect(getResults(message).get("A")[0].total).toBe(3);
  });

  it("counts the first roll by when it was made, whatever order the chat log holds them in", () => {
    const message = requestMessage({ mode: "standard", actors: ["A"], parts: [{ type: "skill", key: "ath", dc: 12 }] });
    const first = rollMessage({ actor: "A", total: 3, natural: 3 });
    const second = rollMessage({ actor: "A", total: 20, natural: 18 });
    game.messages = [second, first];
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

  it("fails a Divine Intervention roll whose numbers aren't a run the picker could give", () => {
    const message = requestMessage({ mode: "divine", range: 16, actors: ["A", "B", "C", "D"], parts: [{ type: "d100", dc: null }] });
    game.messages = [
      rollMessage({ actor: "A", total: 70, range: { start: 1, end: 100 } }),
      rollMessage({ actor: "B", total: 100, range: { start: 90, end: 105 } }),
      rollMessage({ actor: "C", total: 50 }),
      rollMessage({ actor: "D", total: 50, range: { start: "40", end: "55" } })
    ];
    const results = getResults(message);
    expect(["A", "B", "C", "D"].map(a => results.get(a)[0].success)).toEqual([false, false, false, false]);
  });

  it("ignores a roll whose part isn't one of the request's, however it is written", () => {
    const message = requestMessage({ mode: "standard", actors: ["A"], parts: [{ type: "skill", key: "ath", dc: 12 }] });
    game.messages = ["length", "0", "constructor", 0.5, null].map(part => rollMessage({ actor: "A", total: 20, part }));
    expect(getResults(message).get("A")).toEqual([null]);
  });

  it("reads a choice that isn't one of the part's as its own roll", () => {
    const part = { type: "skill", key: "ath", dc: 12, alternatives: [{ type: "save", key: "str" }] };
    const message = requestMessage({ mode: "standard", actors: ["A", "B", "C"], parts: [part] });
    game.messages = [
      rollMessage({ actor: "A", total: 13, choice: 2 }),
      rollMessage({ actor: "B", total: 13, choice: "constructor" }),
      rollMessage({ actor: "C", total: 13, choice: -1 })
    ];
    const results = getResults(message);
    expect(["A", "B", "C"].map(a => results.get(a)[0].choice)).toEqual([0, 0, 0]);
  });

  it("marks rolls this user may not see", () => {
    const message = requestMessage({ mode: "standard", actors: ["A"], parts: [{ type: "skill", key: "ath", dc: 12 }] });
    game.messages = [rollMessage({ actor: "A", total: 12, visible: false })];
    expect(getResults(message).get("A")[0].visible).toBe(false);
  });

  it("counts a player's roll for their own actor, but not for someone else's", () => {
    const message = requestMessage({ mode: "standard", actors: ["A", "B"], parts: [{ type: "skill", key: "ath", dc: 12 }] });
    const player = { id: "p1", isGM: false };
    actorOwners.set("A", ["p1"]);
    game.messages = [
      rollMessage({ actor: "A", total: 14, author: player }),
      rollMessage({ actor: "B", total: 20, author: player })
    ];
    const results = getResults(message);
    expect(results.get("A")[0].total).toBe(14);
    expect(results.get("B")).toEqual([null]);
  });

  it("ignores a roll with no author", () => {
    const message = requestMessage({ mode: "standard", actors: ["A"], parts: [{ type: "skill", key: "ath", dc: 12 }] });
    game.messages = [rollMessage({ actor: "A", total: 14, author: null })];
    expect(getResults(message).get("A")).toEqual([null]);
  });

  it("finds rolls made after the request card was first drawn", () => {
    const message = requestMessage({ mode: "standard", actors: ["A", "B"], parts: [{ type: "skill", key: "ath", dc: 12 }] });
    game.messages = [rollMessage({ actor: "A", total: 14 })];
    expect(getResults(message).get("B")).toEqual([null]);
    game.messages = [...game.messages, rollMessage({ actor: "B", total: 9 })];
    expect(getResults(message).get("B")[0].total).toBe(9);
  });
});

/* -------------------------------------------- */

describe("Checking a request before it is posted", () => {
  const part = { type: "d20", dc: null };
  const valid = {
    standard: { mode: "standard", actors: ["A"], parts: [part], rollMode: "public" },
    challenge: { mode: "challenge", actors: ["A"], parts: [part, part, part], successes: 2, rollMode: "public" },
    rolloff: { mode: "rolloff", actors: ["A", "B"], sides: [["A"], ["B"]], parts: [part, part], rollMode: "gm" },
    versus: { mode: "versus", actors: ["A", "B", "C"], sides: [["A", "B"], ["C"]], parts: [part, part], rollMode: "public" },
    divine: { mode: "divine", actors: ["A"], parts: [{ type: "d100", dc: null }], range: 16, rollMode: "public" }
  };

  /**
   * @param {object} request
   * @returns {string|null}  Why the request was refused, or null if it was accepted.
   */
  const errorFor = request => {
    try {
      validateRequest(request);
    } catch ( err ) {
      return err.message;
    }
    return null;
  };

  it("accepts a well-formed request of each kind", () => {
    for ( const request of Object.values(valid) ) expect(errorFor(request)).toBeNull();
    expect(errorFor({ ...valid.standard, parts: [{ type: "skill", key: "ath", dc: 15 }] })).toBeNull();
  });

  it("refuses a request with no one to roll", () => {
    expect(errorFor({ ...valid.standard, actors: [] })).not.toBeNull();
  });

  it("refuses a contest with an empty side", () => {
    expect(errorFor({ ...valid.versus, sides: [["A", "B"], []] })).not.toBeNull();
    expect(errorFor({ ...valid.rolloff, sides: [["A"]] })).not.toBeNull();
  });

  it("refuses an unknown mode, or a skill challenge without its three rolls", () => {
    expect(errorFor({ ...valid.standard, mode: "nonsense" })).not.toBeNull();
    expect(errorFor({ ...valid.challenge, parts: [part] })).not.toBeNull();
  });

  it("refuses a skill challenge needing more successes than it has rolls, or none", () => {
    expect(errorFor({ ...valid.challenge, successes: 4 })).toBe("A skill challenge needs from 1 to 3 successes, not 4.");
    for ( const successes of [0, undefined, 1.5] ) expect(errorFor({ ...valid.challenge, successes })).not.toBeNull();
  });

  it("refuses Divine Intervention without a run of numbers to pick, or with too long a run", () => {
    expect(errorFor({ ...valid.divine, range: undefined })).not.toBeNull();
    expect(errorFor({ ...valid.divine, range: DIVINE_RANGE.max + 1 }))
      .toBe(`Divine Intervention needs from 1 to ${DIVINE_RANGE.max} numbers to pick, not ${DIVINE_RANGE.max + 1}.`);
  });

  it("refuses Divine Intervention with any roll but a d100, which is all the picked numbers can be rolled on", () => {
    expect(errorFor({ ...valid.divine, parts: [{ type: "skill", key: "ath", dc: null }] }))
      .toBe("Divine Intervention's roll is a d100, not skill.");
    expect(errorFor({ ...valid.divine, parts: [{ type: "d20", dc: null }] })).not.toBeNull();
  });

  it("refuses a Roll-Off with more than one actor on a side, whose second roll would never count", () => {
    expect(errorFor({ ...valid.rolloff, actors: ["A", "B", "C"], sides: [["A", "C"], ["B"]] }))
      .toBe("Each side of a Roll-Off needs exactly one actor.");
  });

  it("refuses a contest with someone on a side who isn't one of the request's actors", () => {
    expect(errorFor({ ...valid.versus, sides: [["A", "B"], ["D"]] })).not.toBeNull();
  });

  it("refuses an unknown roll, a DC that isn't a number, or an unknown visibility", () => {
    expect(errorFor({ ...valid.standard, parts: [{ type: "d7", dc: null }] })).toBe("Unknown kind of roll: d7.");
    expect(errorFor({ ...valid.standard, parts: [{ type: "d20", dc: "hard" }] })).not.toBeNull();
    expect(errorFor({ ...valid.standard, rollMode: "blind" })).not.toBeNull();
  });

  it("accepts a choice of rolls in a standard roll, team challenge or skill challenge step", () => {
    const choice = { type: "skill", key: "ath", dc: 15, alternatives: [{ type: "save", key: "str" }, { type: "d20" }] };
    expect(errorFor({ ...valid.standard, parts: [choice] })).toBeNull();
    expect(errorFor({ ...valid.standard, mode: "team", parts: [choice] })).toBeNull();
    expect(errorFor({ ...valid.challenge, parts: [part, choice, part] })).toBeNull();
  });

  it("refuses a choice of rolls in a contest, too many choices, or a choice dnd5e can't roll", () => {
    const alternatives = [{ type: "save", key: "str" }];
    expect(errorFor({ ...valid.rolloff, parts: [{ ...part, alternatives }, part] })).not.toBeNull();
    expect(errorFor({ ...valid.divine, parts: [{ type: "d100", dc: null, alternatives }] })).not.toBeNull();
    const many = Array.from({ length: MAX_CHOICES }, () => ({ type: "save", key: "str" }));
    expect(errorFor({ ...valid.standard, parts: [{ ...part, alternatives: many }] })).not.toBeNull();
    expect(errorFor({ ...valid.standard, parts: [{ ...part, alternatives: [{ type: "save", key: "strength" }] }] }))
      .toBe("Unknown save for a roll: strength. Use one of: str, dex, wis.");
    expect(errorFor({ ...valid.standard, parts: [{ ...part, alternatives: { type: "save", key: "str" } }] })).not.toBeNull();
    // Refused with the module's own message, not a TypeError from reading the missing roll.
    for ( const bad of [null, "str", 4] ) {
      expect(errorFor({ ...valid.standard, parts: [{ ...part, alternatives: [bad] }] })).toMatch(/^Only a Standard Roll/);
    }
  });

  it("refuses a skill, check, save or tool that dnd5e doesn't know, which would only fail once someone rolled it", () => {
    expect(errorFor({ ...valid.standard, parts: [{ type: "skill", key: "athletics", dc: 15 }] }))
      .toBe("Unknown skill for a roll: athletics. Use one of: ath, acr.");
    expect(errorFor({ ...valid.standard, parts: [{ type: "save", key: "strength", dc: 15 }] })).not.toBeNull();
    expect(errorFor({ ...valid.standard, parts: [{ type: "check", dc: 15 }] })).not.toBeNull();
    expect(errorFor({ ...valid.standard, parts: [{ type: "tool", key: "lute", dc: 15 }] })).not.toBeNull();
    for ( const part of [{ type: "check", key: "dex" }, { type: "save", key: "wis" }, { type: "tool", key: "thief" }] ) {
      expect(errorFor({ ...valid.standard, parts: [{ ...part, dc: 15 }] })).toBeNull();
    }
  });
});

/* -------------------------------------------- */

describe("Filling in what a macro leaves out", () => {
  const part = { type: "d20", dc: null };

  it("gives the request window's defaults, so a short macro request is still valid", () => {
    const challenge = withDefaults({ mode: "challenge", actors: ["A"], parts: [part, part, part] });
    expect(challenge).toMatchObject({ rollMode: "public", showDC: false, successes: 2 });
    expect(() => validateRequest(challenge)).not.toThrow();
    const divine = withDefaults({ mode: "divine", actors: ["A"], parts: [{ type: "d100", dc: null }] });
    expect(divine.range).toBe(DIVINE_RANGE.initial);
    expect(() => validateRequest(divine)).not.toThrow();
  });

  it("follows the GM's Show DC setting", () => {
    settingValues.set("showDCDefault", true);
    expect(withDefaults({ mode: "standard" }).showDC).toBe(true);
  });

  it("keeps what the macro gave, and fills in a value it left as null", () => {
    expect(withDefaults({ mode: "challenge", successes: 3, rollMode: "gm" })).toMatchObject({ successes: 3, rollMode: "gm" });
    expect(withDefaults({ mode: "challenge", successes: null }).successes).toBe(2);
  });

  it("doesn't change the request it was given", () => {
    const request = { mode: "standard" };
    withDefaults(request);
    expect(request).toEqual({ mode: "standard" });
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

  it("never settles a side with no one on it", () => {
    expect(getGroupOutcome([], new Map(), true)).toMatchObject({ complete: false, hidden: false });
    expect(getGroupOutcome([], new Map(), false).score).toBeUndefined();
  });

  it("scores a team by its pooled average, with the 1 and 20 rule", () => {
    const outcome = getGroupOutcome(["A", "B", "C"], results({ A: roll(1, 1), B: roll(15, 15), C: roll(10, 10) }), true);
    expect(outcome.score).toBe(5);
    expect([...outcome.removed.keys()]).toEqual(["B"]);
  });
});

/* -------------------------------------------- */

describe("The group an actor's row is drawn with", () => {
  const results = new Map([["A", [{ total: 1, natural: 1, visible: true }]], ["B", [{ total: 15, natural: 15, visible: true }]],
    ["C", [{ total: 10, natural: 10, visible: true }]]]);
  const team = { mode: "team", actors: ["A", "B", "C"], parts: [{ type: "d20", dc: 10 }] };
  const removedFor = (request, flags, side) => [...getRowGroup(requestMessage(request, "request", flags), request, results, side)
    .removed.keys()];

  it("shows the GM which roll a natural 1 or 20 took out of a team's pool", () => {
    game.user = { isGM: true };
    expect(removedFor(team, {})).toEqual(["B"]);
  });

  it("keeps that from players until the GM shows the result", () => {
    game.user = { isGM: false };
    expect(removedFor(team, {})).toEqual([]);
    expect(removedFor(team, { revealed: true })).toEqual(["B"]);
  });

  it("pools only the actor's own side in Team vs Team", () => {
    game.user = { isGM: false };
    const versus = { mode: "versus", actors: ["A", "B", "C"], sides: [["A", "B"], ["C"]], parts: [team.parts[0], team.parts[0]] };
    expect(removedFor(versus, {}, 0)).toEqual(["B"]);
    expect(removedFor(versus, {}, 1)).toEqual([]);
  });

  it("draws no group for rolls that aren't pooled", () => {
    expect(getRowGroup(requestMessage({}), { mode: "standard" }, results)).toBeNull();
    expect(getRowGroup(requestMessage({}), { mode: "rolloff" }, results, 0)).toBeNull();
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

/* -------------------------------------------- */

describe("A choice of rolls", () => {
  const part = { type: "skill", key: "ath", dc: 15, alternatives: [{ type: "save", key: "str" }, { type: "tool", key: "thief" }] };

  it("lists the part's own roll first, then its alternatives", () => {
    expect(getChoices(part)).toEqual([
      { type: "skill", key: "ath" }, { type: "save", key: "str" }, { type: "tool", key: "thief" }
    ]);
    expect(getChoices({ type: "d20", dc: null })).toEqual([{ type: "d20", key: null }]);
  });

  it("names every roll there is to choose from", () => {
    expect(getChoiceLabel(part)).toBe("Athletics Check, Strength Save, or Thieves' Tools Check");
    expect(getChoiceLabel({ type: "skill", key: "acr", alternatives: [{ type: "check", key: "dex" }] }))
      .toBe("Acrobatics Check or Dexterity Check");
    expect(getChoiceLabel({ type: "skill", key: "acr" })).toBe("Acrobatics Check");
  });

  it("says under the title what the request asks for, with the DC as this user may see it", () => {
    const standard = dc => ({ mode: "standard", showDC: false, parts: [{ type: "d20", dc }] });
    expect(getRequestSubtitle(standard(15))).toBe("Standard Roll · DC 15");
    game.user = { isGM: false };
    expect(getRequestSubtitle(standard(15))).toBe("Standard Roll · DC ?");
    expect(getRequestSubtitle({ ...standard(15), showDC: true })).toBe("Standard Roll · DC 15");
    expect(getRequestSubtitle(standard(null))).toBe("Standard Roll");
    expect(getRequestSubtitle({ mode: "challenge", successes: 2, parts: [{}, {}, {}] })).toBe("2 of 3 to succeed");
    expect(getRequestSubtitle({ mode: "rolloff", parts: [{ type: "d20" }, { type: "skill", key: "ath" }] }))
      .toBe("d20 vs Athletics Check");
    expect(getRequestSubtitle({ mode: "divine", range: 16, parts: [{ type: "d100" }] })).toBe("16 numbers in a row on a d100");
  });

  it("puts the GM's DC button in the subtitle, in place of the DC", () => {
    const button = { nodeName: "BUTTON" };
    expect(getRequestSubtitle({ mode: "team", parts: [{ type: "d20", dc: 12 }] }, button))
      .toEqual(["Team Challenge", " · ", button]);
  });

  it("titles a standard roll's card with the choice", () => {
    expect(getRequestTitle({ mode: "standard", parts: [{ type: "d20", alternatives: [{ type: "save", key: "wis" }] }] }))
      .toBe("d20 or Wisdom Save");
    expect(getRequestTitle({ mode: "standard", parts: [{ type: "d20" }] })).toBe("d20 Roll");
  });
});
