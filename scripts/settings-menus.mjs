/**
 * Settings menus: the module's settings, grouped into Hero Cards, Dice Rolling, Roll Requests and Gameplay
 * Enhancements, each opened from a button in Configure Settings rather than listed there.
 */

import { MODULE_ID } from "./hero-cards.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * A window for one group of the module's world settings. Each subclass names its settings in `SETTINGS`.
 */
class SettingsMenu extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["stt-settings-menu"],
    tag: "form",
    window: {
      icon: "fa-solid fa-gears",
      contentClasses: ["standard-form"]
    },
    position: { width: 520, height: "auto" },
    form: {
      handler: SettingsMenu.#onSubmit,
      closeOnSubmit: true
    }
  };

  /** @override */
  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/settings-menu.hbs` },
    footer: { template: "templates/generic/form-footer.hbs" }
  };

  /**
   * The keys of the settings this menu shows, in order.
   * @type {string[]}
   */
  static SETTINGS = [];

  /* -------------------------------------------- */

  /** @inheritDoc */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.settings = this.constructor.SETTINGS.map(key => {
      const setting = game.settings.settings.get(`${MODULE_ID}.${key}`);
      return {
        key,
        id: `${this.id}-${key}`,
        label: game.i18n.localize(setting.name),
        hint: game.i18n.localize(setting.hint),
        value: game.settings.get(MODULE_ID, key)
      };
    });
    context.buttons = [{ type: "submit", icon: "fa-solid fa-floppy-disk", label: "SETTINGS.Save" }];
    return context;
  }

  /* -------------------------------------------- */

  /**
   * Save the settings that changed, so only their own onChange handlers run.
   * @this {SettingsMenu}
   * @param {SubmitEvent} event
   * @param {HTMLFormElement} form
   * @param {FormDataExtended} formData
   */
  static async #onSubmit(event, form, formData) {
    const values = formData.object;
    for ( const key of this.constructor.SETTINGS ) {
      const value = !!values[key];
      if ( value !== game.settings.get(MODULE_ID, key) ) await game.settings.set(MODULE_ID, key, value);
    }
  }
}

/* -------------------------------------------- */

class HeroCardsSettings extends SettingsMenu {
  /** @override */
  static DEFAULT_OPTIONS = {
    id: "stt-settings-hero-cards",
    window: { title: "STT.Settings.Menus.HeroCards.Name", icon: "fa-solid fa-cards-blank" }
  };

  /** @override */
  static SETTINGS = ["lockNaturals", "showPlayedCards"];
}

class DiceRollingSettings extends SettingsMenu {
  /** @override */
  static DEFAULT_OPTIONS = {
    id: "stt-settings-dice-rolling",
    window: { title: "STT.Settings.Menus.DiceRolling.Name", icon: "fa-solid fa-dice-d20" }
  };

  /** @override */
  static SETTINGS = ["markNaturals", "naturalSaves"];
}

class RollRequestSettings extends SettingsMenu {
  /** @override */
  static DEFAULT_OPTIONS = {
    id: "stt-settings-roll-requests",
    window: { title: "STT.Settings.Menus.RollRequests.Name", icon: "fa-solid fa-beer-mug-empty" }
  };

  /** @override */
  static SETTINGS = ["showDCDefault", "attachRolls", "popupPlayers", "popupGM", "deathSavePrompt"];
}

class WorldScriptSettings extends SettingsMenu {
  /** @override */
  static DEFAULT_OPTIONS = {
    id: "stt-settings-world-scripts",
    window: { title: "STT.Settings.Menus.WorldScripts.Name", icon: "fa-solid fa-earth-europe" }
  };

  /** @override */
  static SETTINGS = ["bloodiedTint", "fadeUnprepared", "rarityColours", "chatButtonLabels", "oneTabActivities"];
}

/* -------------------------------------------- */

Hooks.once("init", registerMenus);

/**
 * Register a Configure Settings button for each group of settings.
 */
function registerMenus() {
  const menus = {
    heroCards: [HeroCardsSettings, "HeroCards"],
    diceRolling: [DiceRollingSettings, "DiceRolling"],
    rollRequests: [RollRequestSettings, "RollRequests"],
    worldScripts: [WorldScriptSettings, "WorldScripts"]
  };
  for ( const [key, [type, lang]] of Object.entries(menus) ) {
    game.settings.registerMenu(MODULE_ID, key, {
      name: `STT.Settings.Menus.${lang}.Name`,
      label: `STT.Settings.Menus.${lang}.Label`,
      hint: `STT.Settings.Menus.${lang}.Hint`,
      icon: type.DEFAULT_OPTIONS.window.icon,
      type,
      restricted: true
    });
  }
}
