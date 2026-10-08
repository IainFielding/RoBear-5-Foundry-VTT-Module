/**
 * Chat Button Labels
 *
 * Writes each icon button's label beside its icon on compact chat cards, so they can be
 * read without hovering for a tooltip.
 * The labels themselves are in styles/world-scripts.css, which only applies them while
 * the body carries the stt-chat-button-labels class.
 */

import { MODULE_ID } from "./hero-cards.mjs";

Hooks.once("init", registerSettings);
Hooks.once("ready", applyLabels);

/**
 * Register the setting that turns the labels on.
 */
function registerSettings() {
  game.settings.register(MODULE_ID, "chatButtonLabels", {
    name: "STT.Settings.ChatButtonLabels.Name",
    hint: "STT.Settings.ChatButtonLabels.Hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
    onChange: applyLabels
  });
}

/* -------------------------------------------- */

/**
 * Show or hide the labels to match the setting.
 */
function applyLabels() {
  document.body.classList.toggle("stt-chat-button-labels", game.settings.get(MODULE_ID, "chatButtonLabels"));
}
