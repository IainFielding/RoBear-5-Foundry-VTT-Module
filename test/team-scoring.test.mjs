import { beforeEach, describe, expect, it } from "vitest";
import { actorNames, settingValues } from "./helpers/foundry-shims.mjs";
import { requestMessage } from "./helpers/messages.mjs";
import {
  SCORING, getGroupOutcome, getRequestSubtitle, getRowGroup, getScoring, poolTeamRolls, scoreTeam, validateRequest,
  withDefaults
} from "../scripts/roll-requests.mjs";

/** `[uuid, total, natural]` rows, as a team's rolls. */
const entries = rows => rows.map(([uuid, total, natural]) => ({ uuid, total, natural }));

/**
 * The party from the mock: Aria +7 rolls 14, Borin +5 rolls 3, Cass +1 rolls 11, Dain +3 rolls a natural 20.
 */
const party = entries([["Aria", 21, 14], ["Borin", 8, 3], ["Cass", 12, 11], ["Dain", 23, 20]]);

beforeEach(() => {
  actorNames.clear();
  for ( const name of ["Aria", "Borin", "Cass", "Dain"] ) actorNames.set(name, name);
  game.user = { isGM: true };
  settingValues.set("teamScoring", "average");
});

/* -------------------------------------------- */

describe("Scoring a team", () => {
  it("averages by default, as a Team Challenge always has", () => {
    const pool = poolTeamRolls(party);
    expect(scoreTeam(party)).toMatchObject({
      scoring: "average", score: pool.average, exact: pool.exact, removed: pool.removed, success: null
    });
    expect(scoreTeam(party, "average", 13)).toMatchObject({ score: pool.average, success: pool.average >= 13 });
  });

  it("succeeds when at least half the team meets the DC", () => {
    expect(scoreTeam(party, "half", 13)).toMatchObject({ scoring: "half", score: 2, needed: 2, total: 4, success: true });
    expect(scoreTeam(party, "half", 22)).toMatchObject({ score: 1, success: false });
    // With an odd number, half rounds up.
    const three = party.slice(0, 3);
    expect(scoreTeam(three, "half", 12)).toMatchObject({ score: 2, needed: 2, success: true });
    expect(scoreTeam(three, "half", 13)).toMatchObject({ score: 1, needed: 2, success: false });
  });

  it("counts the leader's roll, +1 for each other success and -1 for each other failure", () => {
    const score = scoreTeam(party, "leader", 13);
    expect(score).toMatchObject({ scoring: "leader", leader: "Aria", base: 21, helped: 1, hindered: 2, score: 20, success: true });
    expect(Object.fromEntries(score.notes)).toEqual({ Aria: "leader", Borin: "hindered", Cass: "hindered", Dain: "helped" });
  });

  it("counts the weakest roll, +1 for each other success, and ignores the other failures", () => {
    const score = scoreTeam(party, "weakest", 13);
    expect(score).toMatchObject({ scoring: "weakest", leader: "Cass", base: 12, helped: 2, hindered: 0, score: 14, success: true });
    expect(Object.fromEntries(score.notes)).toEqual({ Aria: "helped", Borin: "ignored", Cass: "weakest", Dain: "helped" });
    expect(scoreTeam(party, "weakest", 16)).toMatchObject({ score: 14, success: false });
  });

  it("picks the leader by the roll actually made, so a choice of rolls is judged by the one chosen", () => {
    // Borin rolled Athletics at +9, Aria Acrobatics at +2: Borin leads, though Aria's total is higher.
    const score = scoreTeam(entries([["Aria", 19, 17], ["Borin", 13, 4]]), "leader", 10);
    expect(score).toMatchObject({ leader: "Borin", base: 13, helped: 1, score: 14 });
  });

  it("breaks a tie on the modifier by the higher total, then by who is listed first", () => {
    expect(scoreTeam(entries([["Aria", 10, 5], ["Borin", 15, 10]]), "leader", 12).leader).toBe("Borin");
    expect(scoreTeam(entries([["Aria", 10, 5], ["Borin", 15, 10]]), "weakest", 12).leader).toBe("Borin");
    expect(scoreTeam(entries([["Aria", 10, 5], ["Borin", 10, 5]]), "leader", 12).leader).toBe("Aria");
  });

  it("never takes rolls out for natural 1s and 20s except in an average", () => {
    for ( const scoring of ["half", "leader", "weakest"] ) {
      expect(scoreTeam(entries([["Aria", 3, 1], ["Borin", 25, 20]]), scoring, 10).removed.size).toBe(0);
    }
  });

  it("scores a team of one by its only roll", () => {
    expect(scoreTeam(entries([["Aria", 14, 10]]), "half", 12)).toMatchObject({ score: 1, needed: 1, success: true });
    expect(scoreTeam(entries([["Aria", 14, 10]]), "leader", 15)).toMatchObject({ score: 14, success: false });
  });

  it("falls back to an average when a way that needs a DC has none", () => {
    expect(scoreTeam(party, "leader", null)).toMatchObject({ scoring: "average", success: null });
  });

  it("offers the four ways, of which all but the average need a DC", () => {
    expect(Object.keys(SCORING)).toEqual(["average", "half", "leader", "weakest"]);
    expect(Object.keys(SCORING).filter(k => SCORING[k].needsDC)).toEqual(["half", "leader", "weakest"]);
  });
});

/* -------------------------------------------- */

describe("A team's outcome on the card", () => {
  const results = new Map(party.map(({ uuid, total, natural }) => [uuid, [{ total, natural, visible: true }]]));
  const team = scoring => ({
    mode: "team", actors: party.map(e => e.uuid), parts: [{ type: "skill", key: "ath", dc: 13 }], scoring
  });

  it("scores a group the way it is asked to", () => {
    expect(getGroupOutcome(team().actors, results, true, { scoring: "leader", dc: 13 })).toMatchObject({
      complete: true, hidden: false, scoring: "leader", score: 20, success: true
    });
  });

  it("scores a Team Challenge by its own scoring and DC", () => {
    const row = getRowGroup(requestMessage(team("weakest")), team("weakest"), results);
    expect(row).toMatchObject({ scoring: "weakest", score: 14, success: true });
    expect(row.notes.get("Cass")).toBe("weakest");
  });

  it("averages a Team Challenge posted before there was a choice", () => {
    expect(getRowGroup(requestMessage(team()), team(), results).scoring).toBe("average");
  });

  it("keeps what each roll did from players until the GM shows the result", () => {
    game.user = { isGM: false };
    expect(getRowGroup(requestMessage(team("leader")), team("leader"), results).notes.size).toBe(0);
    expect(getRowGroup(requestMessage(team("leader"), "request", { revealed: true }), team("leader"), results).notes.size)
      .toBe(4);
  });

  it("names the scoring under the title, except for an average", () => {
    expect(getRequestSubtitle(team("leader"))).toBe("Team Challenge · Leader · DC 13");
    expect(getRequestSubtitle(team("half"))).toBe("Team Challenge · Half must succeed · DC 13");
    expect(getRequestSubtitle(team())).toBe("Team Challenge · DC 13");
  });

  it("only gives a Team Challenge a choice", () => {
    expect(getScoring({ mode: "team", scoring: "half" })).toBe("half");
    expect(getScoring({ mode: "versus", scoring: "half" })).toBe("average");
    expect(getScoring({ mode: "team", scoring: "nonsense" })).toBe("average");
  });
});

/* -------------------------------------------- */

describe("Checking a Team Challenge's scoring", () => {
  const request = (scoring, dc = 12) => ({
    mode: "team", actors: ["Aria"], parts: [{ type: "d20", dc }], rollMode: "public", scoring
  });

  it("accepts each way, and a request that leaves it out", () => {
    for ( const scoring of Object.keys(SCORING) ) expect(() => validateRequest(request(scoring))).not.toThrow();
    expect(() => validateRequest(request(undefined))).not.toThrow();
  });

  it("refuses an unknown way", () => {
    expect(() => validateRequest(request("best"))).toThrow(/Unknown way to score a Team Challenge: best/);
  });

  it("refuses a way that needs a DC when there is none", () => {
    expect(() => validateRequest(request("leader", null))).toThrow(/needs a DC/);
    expect(() => validateRequest(request("average", null))).not.toThrow();
  });

  it("starts from the GM's setting when a macro leaves it out", () => {
    settingValues.set("teamScoring", "half");
    expect(withDefaults({ mode: "team" }).scoring).toBe("half");
    expect(withDefaults({ mode: "team", scoring: "leader" }).scoring).toBe("leader");
    expect(withDefaults({ mode: "standard" }).scoring).toBeUndefined();
  });
});
