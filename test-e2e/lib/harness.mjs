/**
 * The e2e test runner, and the helpers tests use to drive the world through its real UI.
 */

import fs from "node:fs";
import { MODULE_ID } from "../config.mjs";

/* -------------------------------------------- */
/*  Runner                                      */
/* -------------------------------------------- */

const tests = [];

/**
 * Register a test.
 * @param {string} name
 * @param {(ctx: TestContext) => Promise<void>} fn
 * @param {object} [options]
 * @param {Record<string, string>} [options.skip]  Compatibility runs to skip the test in, keyed by `STT_COMPAT`, each with
 *   why: what the test checks is something that module replaces, such as dnd5e's roll window.
 */
export function test(name, fn, { skip={} }={}) {
  tests.push({ name, fn, skip });
}

/**
 * The compatibility run in progress, as `STT_COMPAT` names it, or null in the plain world.
 */
export const COMPAT = process.env.STT_COMPAT || null;

/**
 * @typedef {object} TestContext
 * @property {import("./session.mjs").Session} gm
 * @property {import("./session.mjs").Session} player
 * @property {{ player: string, aria: string, borin: string, goblin: string }} ids
 */

/**
 * Run every registered test in order. A failure is recorded with a screenshot of each browser, and the run
 * carries on.
 * @param {TestContext} ctx
 * @param {object} [options]
 * @param {string} [options.filter]  Only run tests whose name contains this.
 * @param {(ctx: TestContext) => Promise<void>} [options.beforeEach]
 * @returns {Promise<{ passed: number, failed: { name: string, error: string }[], skipped: number }>}
 */
export async function runTests(ctx, { filter, beforeEach } = {}) {
  // A screenshot from an earlier run would look like a failure of this one.
  for ( const file of fs.readdirSync("test-e2e") ) {
    if ( /^fail-\d+-(gm|player)\.png$/.test(file) ) fs.rmSync(`test-e2e/${file}`);
  }
  const failed = [];
  let passed = 0;
  let skipped = 0;
  for ( const [i, { name, fn, skip }] of tests.entries() ) {
    if ( filter && !name.toLowerCase().includes(filter.toLowerCase()) ) continue;
    if ( COMPAT && skip[COMPAT] ) {
      skipped++;
      console.log(`  skip  ${name}\n        ${skip[COMPAT]}`);
      continue;
    }
    const started = Date.now();
    try {
      await beforeEach?.(ctx);
      await fn(ctx);
      passed++;
      console.log(`  ok    ${name} (${Date.now() - started}ms)`);
    } catch ( err ) {
      const slug = `fail-${String(i + 1).padStart(2, "0")}`;
      await ctx.gm.page.screenshot({ path: `test-e2e/${slug}-gm.png` }).catch(() => {});
      await ctx.player.page.screenshot({ path: `test-e2e/${slug}-player.png` }).catch(() => {});
      const error = `${err.message}\n--- GM console ---\n${ctx.gm.tail(12)}\n--- Player console ---\n${ctx.player.tail(12)}`;
      failed.push({ name, error });
      console.log(`  FAIL  ${name}\n${indent(err.message)}\n        screenshots: test-e2e/${slug}-*.png`);
    }
  }
  return { passed, failed, skipped };
}

/**
 * @param {string} text
 * @returns {string}
 */
function indent(text) {
  return text.split("\n").slice(0, 12).map(line => `        ${line}`).join("\n");
}

/* -------------------------------------------- */
/*  Assertions                                  */
/* -------------------------------------------- */

/**
 * @param {*} condition
 * @param {string} message
 */
export function assert(condition, message) {
  if ( !condition ) throw new Error(message);
}

/**
 * @param {*} actual
 * @param {*} expected
 * @param {string} what
 */
export function assertEqual(actual, expected, what) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if ( a !== e ) throw new Error(`${what}: expected ${e}, got ${a}`);
}

/**
 * Wait until a function run in the world returns something truthy, and return it.
 * @param {import("./session.mjs").Session} session
 * @param {Function} fn
 * @param {*} [arg]
 * @param {string} [what]  Described in the error if it never happens.
 * @param {number} [timeout=10000]
 */
export async function waitFor(session, fn, arg, what = "condition", timeout = 10_000) {
  try {
    const handle = await session.page.waitForFunction(fn, arg, { timeout, polling: 100 });
    return handle.jsonValue();
  } catch ( err ) {
    // A check that throws is a broken test, not a slow one, so its own error is kept.
    if ( err.name !== "TimeoutError" ) throw err;
    throw new Error(`Timed out waiting for ${what} (${session.user}).`);
  }
}

/* -------------------------------------------- */
/*  World Helpers                               */
/* -------------------------------------------- */

/**
 * Make the next dice rolled on this user's client come up as given, in order. Foundry turns
 * `CONFIG.Dice.randomUniform()` into a face with `ceil((1 - u) * faces)`, so each result maps back to one `u`.
 * @param {import("./session.mjs").Session} session
 * @param {[number, number][]} dice  `[result, faces]` pairs.
 */
export function forceDice(session, dice) {
  const values = dice.map(([result, faces]) => 1 - ((result - 0.5) / faces));
  return session.eval(values => {
    if ( !globalThis.__sttDice ) {
      globalThis.__sttDice = [];
      const random = CONFIG.Dice.randomUniform;
      CONFIG.Dice.randomUniform = () => (globalThis.__sttDice.length ? globalThis.__sttDice.shift() : random());
    }
    globalThis.__sttDice.push(...values);
  }, values);
}

/**
 * @param {import("./session.mjs").Session} session
 * @returns {Promise<number>}  Forced dice not yet used.
 */
export function unusedDice(session) {
  return session.eval(() => globalThis.__sttDice?.length ?? 0);
}

/**
 * Post a request as the GM, straight through the module's API, and wait for both users to render it.
 * @param {TestContext} ctx
 * @param {object} request
 * @returns {Promise<string>}  The request message's ID.
 */
export async function postRequest({ gm, player }, request) {
  const id = await gm.eval(async ({ moduleId, request }) => {
    const { createRequest } = await import(`/modules/${moduleId}/scripts/roll-requests.mjs`);
    return (await createRequest({ successes: 2, showDC: true, rollMode: "public", ...request })).id;
  }, { moduleId: MODULE_ID, request });
  for ( const session of [gm, player] ) {
    await waitFor(session, id => !!document.querySelector(`#chat .chat-log [data-message-id="${id}"] .stt-request`),
      id, "the request card to render");
  }
  return id;
}

/**
 * The request card as a user sees it, read from their chat log.
 * @param {import("./session.mjs").Session} session
 * @param {string} id
 * @returns {Promise<object>}
 */
export function readCard(session, id) {
  return session.eval(id => {
    const card = document.querySelector(`#chat .chat-log [data-message-id="${id}"] .stt-request`);
    if ( !card ) return null;
    const text = el => el?.textContent.replace(/\s+/g, " ").trim() ?? null;
    return {
      title: text(card.querySelector(".stt-request-header h3")),
      subtitle: text(card.querySelector(".stt-request-subtitle")),
      rows: [...card.querySelectorAll(".stt-request-actor")].map(row => ({
        name: text(row.querySelector(".stt-request-name")),
        classes: ["success", "failure", "removed"].filter(c => row.classList.contains(c)),
        results: [...row.querySelectorAll(".stt-request-result")].map(p => ({
          text: text(p), classes: ["success", "failure", "critical", "fumble", "uncounted"].filter(c => p.classList.contains(c))
        })),
        range: text(row.querySelector(".stt-request-range")),
        rollButtons: row.querySelectorAll(".stt-request-roll").length,
        pending: row.querySelectorAll(".stt-request-pending").length,
        cardButton: !!row.querySelector(".stt-card-button"),
        badge: text(row.querySelector(".stt-request-badge")),
        tooltip: row.dataset.tooltipText ?? null
      })),
      sides: [...card.querySelectorAll(".stt-request-side")].map(side => ({
        name: text(side.querySelector("h4")),
        score: text(side.querySelector(".stt-request-score")),
        classes: ["success", "failure", "tie"].filter(c => side.classList.contains(c))
      })),
      // The summary's parts sit side by side, so they are read one by one rather than as run-together text.
      summary: (() => {
        const summary = card.querySelector(".stt-request-summary");
        if ( !summary ) return null;
        return summary.children.length ? [...summary.children].map(text).join(" ") : text(summary);
      })(),
      summaryClasses: ["success", "failure", "tie"].filter(c => card.querySelector(".stt-request-summary")?.classList.contains(c)),
      reveal: text(card.querySelector(".stt-request-reveal"))
    };
  }, id);
}

/**
 * Wait until the request card, as a user sees it, satisfies a check run against `readCard`'s output.
 * @param {import("./session.mjs").Session} session
 * @param {string} id
 * @param {(card: object) => boolean} check
 * @param {string} what
 * @returns {Promise<object>}  The card once it passed.
 */
export async function waitForCard(session, id, check, what) {
  const deadline = Date.now() + 10_000;
  let card;
  while ( Date.now() < deadline ) {
    card = await readCard(session, id);
    if ( card && check(card) ) return card;
    await session.page.waitForTimeout(150);
  }
  throw new Error(`Timed out waiting for ${what} (${session.user}). Card: ${JSON.stringify(card)}`);
}

/**
 * The Roll button on the request card for one actor, in the user's chat sidebar.
 * @param {import("./session.mjs").Session} session
 * @param {string} id
 * @param {string} name  The actor's name.
 */
export function rollButton(session, id, name) {
  return session.page.locator(`#chat .chat-log [data-message-id="${id}"] `
    + `li.stt-request-actor:has(.stt-request-name:text-is("${name}")) .stt-request-roll`);
}

/**
 * The modifier keys that roll an actor's request roll straight away, or that open dnd5e's roll window for it. Shift
 * fast-forwards, except with RSReforged, which swaps them for the checks, saves and tools it rolls: a plain click
 * rolls those straight away, and Shift opens the window. A plain die is dnd5e's own either way.
 * @param {import("./session.mjs").Session} session
 * @param {string} id     The request message's ID.
 * @param {string} name   The actor's name.
 * @param {boolean} fastForward
 * @returns {Promise<string[]>}
 */
export async function rollModifiers(session, id, name, fastForward) {
  const swapped = await session.eval(({ id, name, moduleId }) => {
    if ( !game.modules.get("rsreforged")?.active ) return false;
    const request = game.messages.get(id)?.getFlag(moduleId, "request");
    const uuid = game.actors.getName(name)?.uuid;
    const side = request?.sides?.findIndex(s => s.includes(uuid)) ?? -1;
    const part = request?.parts[Math.max(side, 0)];
    return [part, ...(part?.alternatives ?? [])].some(c => ["skill", "check", "save", "tool", "death"].includes(c?.type));
  }, { id, name, moduleId: MODULE_ID });
  return fastForward !== swapped ? ["Shift"] : [];
}

/**
 * Click an actor's Roll button the way a user would.
 * @param {import("./session.mjs").Session} session
 * @param {string} id
 * @param {string} name
 * @param {object} [options]
 * @param {boolean} [options.fastForward]  Shift-click, skipping dnd5e's roll window. Otherwise the window is
 *   expected to open, and its Normal button is clicked.
 */
export async function clickRoll(session, id, name, { fastForward = false } = {}) {
  const button = rollButton(session, id, name);
  assertEqual(await button.count(), 1, `Roll buttons for ${name} (${session.user})`);
  if ( fastForward ) {
    await button.click({ modifiers: await rollModifiers(session, id, name, true) });
    return;
  }
  await button.click({ modifiers: await rollModifiers(session, id, name, false) });
  const normal = session.page.locator(".application.roll-configuration button", { hasText: "Normal" });
  await normal.waitFor({ timeout: 10_000 }).catch(() => {
    throw new Error(`dnd5e's roll window did not open after clicking Roll for ${name} (${session.user}).`);
  });
  await normal.click();
}

/**
 * Wait for a new roll message for an actor, and return what dnd5e put on it.
 * @param {import("./session.mjs").Session} session
 * @param {string} id     The request message's ID.
 * @param {string} uuid   The actor.
 * @param {number} [part=0]
 */
export function waitForRoll(session, id, uuid, part = 0) {
  return waitFor(session, ({ id, uuid, part, moduleId }) => {
    const roll = game.messages.contents.find(m => {
      const flag = m.getFlag(moduleId, "requestRoll");
      return flag?.request === id && flag.actor === uuid && flag.part === part;
    });
    if ( !roll ) return null;
    const r = roll.rolls[0];
    return {
      id: roll.id, type: roll.type, flavor: roll.flavor, total: r.total, formula: r.formula,
      target: r.options.target ?? null, isD20: r instanceof CONFIG.Dice.D20Roll,
      flag: roll.getFlag(moduleId, "requestRoll"), speaker: roll.speaker.alias, author: roll.author?.name
    };
  }, { id, uuid, part, moduleId: MODULE_ID }, `a roll message for ${uuid} part ${part}`);
}

/**
 * Open the Hero Card chooser from the card button beside an actor's result, list what it offers, and cancel.
 * @param {import("./session.mjs").Session} session
 * @param {string} id
 * @param {string} name  The actor's name.
 * @returns {Promise<string[]>}  Every card offered, by its activity's name.
 */
export async function cardsOnRow(session, id, name) {
  const button = session.page.locator(`#chat .chat-log [data-message-id="${id}"] `
    + `li.stt-request-actor:has(.stt-request-name:text-is("${name}")) .stt-card-button`);
  assertEqual(await button.count(), 1, `card buttons for ${name}`);
  await button.click();
  const dialog = session.page.locator(".stt-card-dialog.application").last();
  await dialog.locator(".stt-card-choice").first().waitFor({ timeout: 10_000 });
  const offered = await dialog.locator(".stt-card-choice").evaluateAll(els => els.map(el => el.dataset.card));
  await dialog.locator('button[data-action="cancel"]').click();
  await dialog.waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  return offered;
}

/* -------------------------------------------- */

/**
 * Open the Hero Card chooser from the card button beside an actor's result, and play a card.
 * @param {import("./session.mjs").Session} session
 * @param {string} id
 * @param {string} name   The actor's name.
 * @param {string} card   The card's activity name, e.g. "Advantage" or "Inspiration - 1d6".
 * @returns {Promise<string[]>}  Every card that was offered.
 */
export async function playCard(session, id, name, card) {
  const button = session.page.locator(`#chat .chat-log [data-message-id="${id}"] `
    + `li.stt-request-actor:has(.stt-request-name:text-is("${name}")) .stt-card-button`);
  assertEqual(await button.count(), 1, `card buttons for ${name}`);
  await button.click();
  const dialog = session.page.locator(".stt-card-dialog.application").last();
  await dialog.locator(".stt-card-choice").first().waitFor({ timeout: 10_000 });
  const offered = await dialog.locator(".stt-card-choice").evaluateAll(els => els.map(el => el.dataset.card));
  const choice = dialog.locator(`.stt-card-choice[data-card="${card}"]`);
  assert(await choice.count(), `${card} was not offered. Offered: ${offered.join(", ")}`);
  await choice.first().click();
  return offered;
}
