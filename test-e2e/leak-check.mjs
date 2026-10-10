/**
 * Measure whether a session's memory grows as roll requests come and go, in a real Foundry.
 *
 *   npm run test:leaks          # 40 requests between measurements
 *   npm run test:leaks -- 100   # 100 between measurements
 *
 * Uses the end-to-end harness (see README.md). One cycle is a request as a table makes it: the GM opens and closes the
 * request window, posts a Standard Roll, all three actors roll from the card, the GM shows the result, and the chat is
 * cleared. After a warm-up, each browser is measured three times with that many cycles in between, with garbage
 * collected first. A leak shows as the same growth in both stretches; a cache filling shows only in the first.
 */

import { GM_USER, PLAYER_USER, WORLD } from "./config.mjs";
import { clickRoll, forceDice, postRequest, waitFor, waitForCard, waitForRoll } from "./lib/harness.mjs";
import { startFoundry } from "./lib/server.mjs";
import { Session } from "./lib/session.mjs";
import { enableModules, ensureWorld, resetFixtures, resetWorld } from "./lib/world.mjs";

const WARM_UP = 5;
const CYCLES = Number(process.argv.slice(2).find(a => /^\d+$/.test(a))) || 40;

/**
 * One request, from the window to an empty chat.
 * @param {object} ctx
 */
async function cycle(ctx) {
  const { gm, player, ids } = ctx;
  await gm.page.locator("#chat-controls .stt-request-control").click();
  const app = gm.page.locator("#stt-roll-request");
  await app.waitFor({ timeout: 10_000 });
  await app.locator('[data-action="close"]').click();
  await app.waitFor({ state: "detached", timeout: 5000 });

  const id = await postRequest(ctx, {
    mode: "standard", parts: [{ type: "skill", key: "ath", dc: 12 }], actors: [ids.aria, ids.borin, ids.goblin]
  });
  await forceDice(player, [[15, 20], [6, 20]]);
  await clickRoll(player, id, "Aria", { fastForward: true });
  await waitForRoll(gm, id, ids.aria);
  await clickRoll(player, id, "Borin", { fastForward: true });
  await waitForRoll(gm, id, ids.borin);
  await forceDice(gm, [[11, 20]]);
  await clickRoll(gm, id, "Goblin", { fastForward: true });
  await waitForCard(gm, id, c => c.reveal === "Show to players", "the Show to players button");
  await gm.page.locator(`#chat [data-message-id="${id}"] .stt-request-reveal`).click();
  await waitForCard(player, id, c => c.summary, "the shown result");

  await gm.eval(() => ChatMessage.deleteDocuments(game.messages.map(m => m.id)));
  for ( const session of [gm, player] ) {
    await waitFor(session, () => !game.messages.size && !document.querySelector("#chat .chat-log li.chat-message"),
      null, "the chat to empty");
  }
}

/* -------------------------------------------- */

/**
 * @param {Session} session
 * @returns {Promise<Record<string, number>>}  What the browser holds, once garbage is collected.
 */
async function measure(session) {
  const cdp = session.cdp ??= await session.page.context().newCDPSession(session.page);
  await cdp.send("Performance.enable");
  // Foundry's tooltip adds a one-time listener to itself each time it is put away, and they pile up until its next
  // fade-out ends, which under a harness that moves the mouse in jumps is seldom. Ending one here lets them go.
  await session.eval(() => document.getElementById("tooltip")?.dispatchEvent(new Event("transitionend")));
  // Twice: the first pass frees what the second can then collect, such as DOM held by collected listeners.
  await cdp.send("HeapProfiler.collectGarbage");
  await session.page.waitForTimeout(500);
  await cdp.send("HeapProfiler.collectGarbage");
  const { metrics } = await cdp.send("Performance.getMetrics");
  const metric = name => metrics.find(m => m.name === name).value;
  const world = await session.eval(() => ({
    apps: foundry.applications.instances.size,
    attached: document.getElementsByTagName("*").length
  }));
  return {
    "heap (KB)": Math.round(metric("JSHeapUsedSize") / 1024),
    "DOM nodes": metric("Nodes"),
    "attached nodes": world.attached,
    "listeners": metric("JSEventListeners"),
    "open apps": world.apps
  };
}

/* -------------------------------------------- */

ensureWorld();
console.log(`Starting Foundry with "${WORLD.title}"…`);
const server = await startFoundry(WORLD.id);
let gm;
let player;
let leaking = false;
try {
  gm = await Session.open(GM_USER);
  await enableModules(gm);
  const ids = await resetFixtures(gm);
  player = await Session.open(PLAYER_USER);
  for ( const session of [gm, player] ) {
    await session.eval(() => { ui.sidebar.expand(); ui.sidebar.changeTab("chat", "primary"); });
  }
  await resetWorld(gm, player);
  const ctx = { gm, player, ids };

  const samples = { [GM_USER]: [], [PLAYER_USER]: [] };
  const sample = async () => {
    for ( const session of [gm, player] ) samples[session.user].push(await measure(session));
  };
  console.log(`Warming up with ${WARM_UP} requests…`);
  for ( let i = 0; i < WARM_UP; i++ ) await cycle(ctx);
  await sample();
  for ( const stretch of [1, 2] ) {
    console.log(`Stretch ${stretch}: ${CYCLES} requests…`);
    for ( let i = 0; i < CYCLES; i++ ) await cycle(ctx);
    await sample();
  }

  for ( const [user, [start, middle, end]] of Object.entries(samples) ) {
    console.log(`\n${user}`);
    console.log(`  ${"".padEnd(16)}${"start".padStart(10)}${"middle".padStart(10)}${"end".padStart(10)}`
      + `${"per request, 2nd stretch".padStart(28)}`);
    for ( const key of Object.keys(start) ) {
      const rate = (end[key] - middle[key]) / CYCLES;
      console.log(`  ${key.padEnd(16)}${String(start[key]).padStart(10)}${String(middle[key]).padStart(10)}`
        + `${String(end[key]).padStart(10)}${rate.toFixed(2).padStart(28)}`);
      // Counts that should come back to where they were: a request leaves nothing of its own behind.
      if ( ["listeners", "open apps", "attached nodes"].includes(key) && (rate >= 1) ) leaking = true;
    }
  }
} catch ( err ) {
  console.error(err);
  if ( gm ) console.error(`--- GM console ---\n${gm.tail(30)}`);
  if ( player ) console.error(`--- Player console ---\n${player.tail(30)}`);
  process.exitCode = 1;
} finally {
  await player?.close();
  await gm?.close({ shutDownWorld: true });
  await server.stop();
}

if ( leaking ) {
  console.log("\nA count grew by one or more for each request in the second stretch.");
  process.exitCode = 1;
}
