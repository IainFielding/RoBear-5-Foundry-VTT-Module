/**
 * One-Tab Activities
 *
 * Lays an activity's Identity, Activation and Effect tabs side by side in one wide window,
 * convenient for mass content creation. The layout itself is in styles/world-scripts.css,
 * which only applies it while the body carries the stt-one-tab-activities class.
 */

import { MODULE_ID } from "./hero-cards.mjs";

Hooks.once("init", registerSettings);
Hooks.once("ready", applyLayout);

/**
 * Register the setting that turns the layout on.
 */
function registerSettings() {
  game.settings.register(MODULE_ID, "oneTabActivities", {
    name: "STT.Settings.OneTabActivities.Name",
    hint: "STT.Settings.OneTabActivities.Hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
    onChange: applyLayout
  });
}

/* -------------------------------------------- */

/**
 * Use the layout or not, to match the setting.
 */
function applyLayout() {
  document.body.classList.toggle("stt-one-tab-activities", game.settings.get(MODULE_ID, "oneTabActivities"));
}
