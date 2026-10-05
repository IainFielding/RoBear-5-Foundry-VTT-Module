/**
 * A browser joined to the active world as one user.
 *
 * Tests drive the world through its own objects with `eval`, and through the real DOM wherever the
 * thing under test is a click: a chat card button, a dialog.
 */

import { chromium } from "playwright";
import { BASE_URL, HEADED, WORLD_READY_TIMEOUT_MS } from "../config.mjs";

export class Session {

  /** @type {import("playwright").Browser} */ browser;
  /** @type {import("playwright").Page} */ page;
  /** Console lines and page errors from the world, newest last. */
  consoleLog = [];

  constructor(browser, page, user) {
    this.browser = browser;
    this.page = page;
    this.user = user;
  }

  /**
   * Launch a browser, join the world as `user`, and wait for `game.ready`.
   * @param {string} user  The user's name.
   * @param {object} [options]
   * @param {number} [options.scale=1]  Device pixels per CSS pixel, for sharper screenshots.
   * @returns {Promise<Session>}
   */
  static async open(user, { scale = 1 } = {}) {
    const browser = await chromium.launch({
      headless: !HEADED,
      args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--mute-audio", "--disable-dev-shm-usage"]
    });
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: scale });
    const page = await context.newPage();
    const session = new Session(browser, page, user);

    page.on("console", msg => session.consoleLog.push(`[${msg.type()}] ${msg.text()}`));
    page.on("pageerror", err => session.consoleLog.push(`[pageerror] ${err.message}\n${err.stack ?? ""}`));

    // No canvas: nothing tested draws on it, and software WebGL under headless Chromium is fragile.
    // `core.noCanvas` is a client setting, kept in localStorage, so it is set before the page loads.
    await page.addInitScript(() => {
      try { window.localStorage.setItem("core.noCanvas", "true"); } catch { /* storage blocked */ }
      // A failed render is an unhandled rejection, which never fires `pageerror`.
      addEventListener("unhandledrejection", event => {
        const reason = event.reason;
        console.error(`[unhandledrejection] ${reason?.message ?? reason}\n${reason?.stack ?? ""}`);
      });
    });

    // The first join after a cold start can land while the server is still wiring itself up.
    for ( let attempt = 1; ; attempt++ ) {
      try {
        await session.join();
        return session;
      } catch ( err ) {
        if ( attempt >= 2 ) {
          await browser.close().catch(() => {});
          throw err;
        }
        await page.waitForTimeout(5000);
      }
    }
  }

  /** Load the join page, pick the user, and wait for the world. Handles both join-screen themes. */
  async join() {
    await this.page.goto(`${BASE_URL}/join`, { waitUntil: "domcontentloaded" });
    const select = this.page.locator("select[name=userid]");
    const username = this.page.locator("input[name=username]");
    await Promise.race([select.waitFor({ timeout: 30_000 }), username.waitFor({ timeout: 30_000 })]).catch(() => {
      throw new Error(`The join form never appeared. Page: ${this.page.url()}`);
    });
    if ( await select.count() ) await select.selectOption({ label: this.user });
    else await username.fill(this.user);
    await this.page.locator("button[name=join]").click();
    await this.waitForReady();
  }

  /** Block until `game.ready`. */
  async waitForReady() {
    try {
      await this.page.waitForFunction(() => globalThis.game?.ready === true, null, {
        timeout: WORLD_READY_TIMEOUT_MS, polling: 250
      });
    } catch ( err ) {
      throw new Error(`${this.user} never reached game.ready.\n--- console tail ---\n${this.tail(40)}`, { cause: err });
    }
    await this.page.waitForTimeout(1000);
  }

  /**
   * Run a function in the world and return its JSON-serialisable result.
   * @param {Function} fn
   * @param {*} [arg]
   */
  eval(fn, arg) {
    return this.page.evaluate(fn, arg);
  }

  /** Reload the page and wait for the world, for changes Foundry applies only on reload. */
  async reload() {
    await this.page.reload({ waitUntil: "domcontentloaded" });
    await this.waitForReady();
  }

  /**
   * Close the browser. The GM's session also returns the world to setup first, which closes its
   * database cleanly before the server is killed.
   */
  async close({ shutDownWorld = false } = {}) {
    if ( shutDownWorld ) {
      try {
        await this.page.evaluate(() => globalThis.game?.shutDown?.());
        await this.page.waitForTimeout(3000);
      } catch { /* the page may already be gone */ }
    }
    await this.browser.close().catch(() => {});
  }

  /** The last `n` console lines, without Foundry's routine chatter. */
  tail(n = 40) {
    const noise = /Constructed index of|Retrieved and compiled template|(Un)?[Rr]egistered callback for|Loaded localization/;
    return this.consoleLog.filter(line => !noise.test(line)).slice(-n).join("\n");
  }
}
