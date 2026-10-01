/**
 * Just enough of Foundry and dnd5e for the module's rules to be imported and run under Node.
 *
 * The scripts register hooks and define an ApplicationV2 subclass when they load, and read `CONFIG`,
 * `game` and `fromUuidSync` when they run. Vitest loads this file before any test imports them.
 */

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
    escapeHTML: s => String(s),
    deepClone: v => structuredClone(v)
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

globalThis.game = { messages: [], user: { isGM: true } };

globalThis.fromUuidSync = uuid => (actorNames.has(uuid) ? { name: actorNames.get(uuid) } : null);
