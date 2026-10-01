/**
 * Just enough of Foundry and dnd5e for the module's rules to be imported and run under Node.
 *
 * The scripts register hooks and define an ApplicationV2 subclass when they load, and read `CONFIG`,
 * `game` and `fromUuidSync` when they run. Vitest loads this file before any test imports them.
 */

import { readFileSync } from "node:fs";

export const actorNames = new Map();

// Foundry's own `Number.isNumeric` (common/primitives/number.mjs), which it installs at startup.
Number.isNumeric = n => {
  if ( Array.isArray(n) ) return false;
  if ( [null, ""].includes(n) ) return false;
  return +n === +n;
};

globalThis.Hooks = { on() {}, once() {}, call() { return true; }, callAll() {} };

globalThis.foundry = {
  applications: {
    api: {
      ApplicationV2: class {},
      HandlebarsApplicationMixin: Base => class extends Base {},
      DialogV2: { wait: async () => null }
    },
    ux: { FormDataExtended: class {} }
  },
  utils: {
    // Foundry's own escapeHTML (common/utils/helpers.mjs).
    escapeHTML: s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" })[c]),
    deepClone: v => structuredClone(v),
    getProperty: (object, key) => key.split(".").reduce((o, k) => o?.[k], object)
  }
};

globalThis.CONFIG = {
  Dice: { D20Roll: class {}, BasicRoll: class {} },
  DND5E: {
    abilities: { str: { label: "Strength" }, dex: { label: "Dexterity" }, wis: { label: "Wisdom" } },
    skills: { ath: { label: "Athletics" }, acr: { label: "Acrobatics" } },
    tools: { thief: {} }
  }
};

globalThis.dnd5e = { documents: { Trait: { keyLabel: key => ({ thief: "Thieves' Tools" })[key] } } };

/**
 * Enough of Foundry's chat log for the scripts: iterable, and able to find a message by ID. Tests assign a plain array
 * of messages to `game.messages`, which is wrapped in a new log each time, as Foundry replaces its log on reload.
 */
class MessageLog extends Array {
  get(id) {
    return this.find(m => m.id === id);
  }

  has(id) {
    return !!this.get(id);
  }

  get contents() {
    return [...this];
  }
}

/**
 * The module's English strings, read as Foundry reads them, so tests see the same text players do.
 */
const strings = JSON.parse(readFileSync(new URL("../../lang/en.json", import.meta.url), "utf8"));

/**
 * @param {string} key
 * @returns {string}  The string, or the key itself if there is none, as Foundry does.
 */
function localize(key) {
  const value = foundry.utils.getProperty(strings, key);
  return typeof value === "string" ? value : key;
}

let messages = new MessageLog();
globalThis.game = {
  user: { isGM: true },
  i18n: {
    lang: "en",
    localize,
    // Foundry's own format (client/helpers/localization.mjs): each {name} is replaced by data.name.
    format: (key, data = {}) => localize(key).replace(/{[^}]+}/g, k => String(data[k.slice(1, -1)] ?? k))
  },
  get messages() {
    return messages;
  },
  set messages(value) {
    messages = MessageLog.from(value);
  }
};

/**
 * The IDs of the users who own each actor, keyed by actor UUID.
 * @type {Map<string, string[]>}
 */
export const actorOwners = new Map();

globalThis.fromUuidSync = uuid => (actorNames.has(uuid) ? {
  name: actorNames.get(uuid),
  testUserPermission: (user, level) => (level === "OWNER") && !!actorOwners.get(uuid)?.includes(user.id)
} : null);
