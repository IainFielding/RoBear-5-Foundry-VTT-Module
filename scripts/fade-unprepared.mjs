/**
 * Fade Unprepared Spells
 *
 * Fades spells on actor sheets that can be prepared but aren't, so the prepared ones stand out.
 * The fade itself is in styles/world-scripts.css.
 */

import { MODULE_ID } from "./hero-cards.mjs";

Hooks.once("init", registerSettings);
Hooks.on("renderBaseActorSheet", onRenderActorSheet);

/**
 * Register the setting that turns the fade on.
 */
function registerSettings() {
  game.settings.register(MODULE_ID, "fadeUnprepared", {
    name: "STT.Settings.FadeUnprepared.Name",
    hint: "STT.Settings.FadeUnprepared.Hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
    onChange: renderActorSheets
  });
}

/* -------------------------------------------- */

/**
 * Re-render every open actor sheet, so a change to a sheet setting shows at once.
 */
export function renderActorSheets() {
  for ( const app of foundry.applications.instances.values() ) {
    if ( app.document instanceof Actor ) app.render();
  }
}

/* -------------------------------------------- */

/**
 * Mark each unprepared spell on an actor sheet.
 * @param {ApplicationV2} app
 * @param {HTMLElement} html
 */
function onRenderActorSheet(app, html) {
  if ( !game.settings.get(MODULE_ID, "fadeUnprepared") ) return;

  // Query both legacy (.items-list) and V2 (.item-list) sheet selectors
  // so this works regardless of which dnd5e sheet version is active.
  const items = html.querySelectorAll(".items-list .item, .item-list .item");
  for ( const itemElement of items ) {
    // Use the dataset property for clean access to data-item-id
    const id = itemElement.dataset.itemId;
    if ( !id ) continue;
    const item = app.document.items.get(id);
    if ( !item || item.type !== "spell" ) continue;

    // Skip spells that appear in the "Additional Spells" section:
    // 1) Item-granted spells (e.g. from a Staff of Power) carry a cachedFor flag
    if ( item.getFlag("dnd5e", "cachedFor") ) continue;
    // 2) Spells whose sheet section uses a non-preparable method (at-will, innate, etc.)
    //    V2 sheet: ancestor element has data-method; Legacy: header sibling has it
    const sectionEl = itemElement.closest("[data-method]")
      ?? itemElement.closest("ol")?.previousElementSibling;
    const sectionMethod = sectionEl?.dataset?.method;
    if ( sectionMethod && (sectionMethod !== "spell") && (sectionMethod !== "pact") ) continue;

    // prepared === 0 means unprepared (1 = prepared, 2 = always prepared)
    // method === "spell" or "pact" — both are preparable spellcasting methods
    // level > 0 excludes cantrips, which don't require preparation
    const method = item.system?.method;
    if ( (item.system?.prepared === 0) && ((method === "spell") || (method === "pact")) && (item.system.level > 0) ) {
      itemElement.classList.add("preparation-unprepared");
    }
  }
}
