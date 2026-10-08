/**
 * The GM's window for asking for rolls.
 */

import { MODULE_ID, localize } from "./hero-cards.mjs";
import {
  CHALLENGE_PARTS, DICE, DIVINE_RANGE, MAX_CHOICES, MODES, createRequest, getChoices, getPartLabel
} from "./roll-requests.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const { FormDataExtended } = foundry.applications.ux;

/**
 * @typedef {object} DraftRoll
 * @property {string} roll            The roll, e.g. "skill.ath" or "d20".
 * @property {number|null} dc
 * @property {DraftChoice[]} alternatives  Other rolls the actor may choose instead.
 */

/**
 * @typedef {object} DraftChoice
 * @property {string} roll
 * @property {number|null} [dc]  Its own DC, in a mode where each choice has one: null for none. Left out, as when the
 *   choice was added in a mode without, it starts as its roll's DC.
 */

/**
 * @typedef {object} RequestDraft
 * @property {string} mode
 * @property {DraftRoll[]} parts  Always three: the rolls outside a contest.
 * @property {DraftRoll} standard  A standard roll's roll and DC, starting as a d20.
 * @property {Record<string, [string, string]>} sideRolls  Each contest mode's roll for each side, keyed by mode,
 *   starting as d20 against d20.
 * @property {number} successes
 * @property {boolean} showDC
 * @property {"public"|"gm"} rollMode
 * @property {string[]} actors                 Who rolls, outside a contest.
 * @property {[string[], string[]]} teams      Each team in Team vs Team.
 * @property {[string|null, string|null]} rivals  Each side of a Roll-Off.
 */

export default class RollRequestConfig extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "stt-roll-request",
    classes: ["stt-card-dialog", "stt-request-config"],
    tag: "form",
    window: {
      title: "STT.Request.WindowTitle",
      icon: "fa-solid fa-anchor fa-rotate-90",
      contentClasses: ["standard-form"]
    },
    position: { width: 600, height: "auto" },
    form: {
      handler: RollRequestConfig.#onSubmit,
      closeOnSubmit: true
    },
    actions: {
      selectAll: RollRequestConfig.#onSelectAll,
      addChoice: RollRequestConfig.#onAddChoice,
      removeChoice: RollRequestConfig.#onRemoveChoice
    }
  };

  /** @override */
  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/roll-request.hbs` },
    footer: { template: "templates/generic/form-footer.hbs" }
  };

  /**
   * The last request made this session, used as the starting point for the next one.
   * @type {RequestDraft|null}
   */
  static #last = null;

  /**
   * Actors offered in the window, in the order shown. Chosen when the window first opens.
   * @type {Actor5e[]|null}
   */
  #actors = null;

  /**
   * The request as filled in so far, kept so switching mode does not lose it.
   * @type {RequestDraft|null}
   */
  #draft = null;

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  /** @inheritDoc */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    this.#actors ??= getCandidates();
    this.#draft ??= this.#getInitialDraft();
    const draft = this.#draft;
    const mode = MODES[draft.mode];
    const challenge = draft.mode === "challenge";
    const rollOptions = getRollGroups(mode.dice ?? ["d20"]);

    // Divine Intervention is always a d100, so it has no roll to choose.
    // Contests keep their own rolls, one per side, so they start as d20 against d20 whatever the other modes hold.
    let rows = [];
    if ( mode.contest ) {
      rows = mode.sides.map((side, index) => ({
        label: localize("STT.Request.Config.SideRoll", { side: localize(side) }),
        field: `sideRolls.${index}`,
        roll: draft.sideRolls[draft.mode][index]
      }));
    }
    else if ( challenge ) {
      rows = Array.from({ length: CHALLENGE_PARTS }, (_, i) => ({
        label: localize("STT.Request.Config.NumberedRoll", { number: i + 1 }), hasDC: true
      }));
    }
    // A standard roll keeps its own roll too, starting as a d20.
    else if ( draft.mode === "standard" ) {
      rows = [{ label: localize("STT.Request.Config.Roll"), hasDC: true, field: "standard", ...draft.standard }];
    }
    else if ( draft.mode !== "divine" ) rows = [{ label: localize("STT.Request.Config.Roll"), hasDC: true }];
    rows.forEach((row, index) => {
      if ( !row.field ) Object.assign(row, { field: `parts.${index}`, ...draft.parts[index] });
      // Where the mode allows it, a roll can offer others to choose from instead.
      row.canChoose = !!mode.choices && !!row.hasDC;
      row.choiceDCs = row.canChoose && !!mode.choiceDCs;
      row.alternatives = row.canChoose ? row.alternatives.map(({ roll, dc }, i) => ({
        roll, dc: dc === undefined ? row.dc : dc, index: i
      })) : [];
      row.full = row.alternatives.length >= MAX_CHOICES - 1;
    });

    const choice = (actor, index, checked) => ({ index, name: actor.name, img: actor.img, checked });
    return Object.assign(context, {
      modes: Object.entries(MODES).map(([value, m]) => ({
        value, icon: m.icon, label: localize(m.label), hint: localize(m.hint), checked: value === draft.mode
      })),
      rows,
      rollOptions,
      challenge,
      contest: !!mode.contest,
      divine: draft.mode === "divine",
      range: draft.range,
      rangeLimits: DIVINE_RANGE,
      successes: draft.successes,
      successOptions: Array.from({ length: CHALLENGE_PARTS }, (_, i) => ({
        value: i + 1, label: localize("STT.Request.Config.SuccessesOf", { count: i + 1, total: CHALLENGE_PARTS })
      })),
      actors: this.#actors.map((a, i) => choice(a, i, draft.actors.includes(a.uuid))),
      sides: mode.contest ? mode.sides.map((label, side) => ({
        label: localize(label),
        side,
        single: draft.mode === "rolloff",
        actors: this.#actors.map((a, i) => choice(a, i, draft.mode === "rolloff"
          ? draft.rivals[side] === a.uuid
          : draft.teams[side].includes(a.uuid)))
      })) : null,
      showDC: draft.showDC,
      rollMode: draft.rollMode,
      buttons: [{ type: "submit", icon: "fa-solid fa-paper-plane", label: "STT.Request.Config.Send" }]
    });
  }

  /* -------------------------------------------- */

  /**
   * @returns {RequestDraft}  The last request made, or a fresh one built from the selected tokens.
   */
  #getInitialDraft() {
    const selected = canvas.tokens?.controlled.map(t => t.actor).filter(Boolean) ?? [];
    const players = this.#actors.filter(a => a.hasPlayerOwner).map(a => a.uuid);
    const draft = foundry.utils.deepClone(RollRequestConfig.#last) ?? {
      mode: "standard",
      parts: Array.from({ length: CHALLENGE_PARTS }, () => ({ roll: "skill.ath", dc: 15 })),
      successes: 2,
      range: DIVINE_RANGE.initial,
      rollMode: "public"
    };
    draft.standard ??= { roll: "d20", dc: 15 };
    for ( const part of [draft.standard, ...draft.parts] ) part.alternatives ??= [];
    draft.sideRolls ??= {};
    for ( const [key, m] of Object.entries(MODES) ) if ( m.contest ) draft.sideRolls[key] ??= ["d20", "d20"];
    // Who rolls always starts from the current selection rather than the last request, and whether players see the
    // DC always starts from the GM's setting.
    return Object.assign(draft, {
      showDC: game.settings.get(MODULE_ID, "showDCDefault"),
      actors: selected.length ? selected.map(a => a.uuid) : players,
      teams: [players, selected.filter(a => !a.hasPlayerOwner).map(a => a.uuid)],
      rivals: [selected[0]?.uuid ?? null, selected[1]?.uuid ?? null]
    });
  }

  /* -------------------------------------------- */

  /**
   * Update the draft from the fields currently shown.
   * @returns {RequestDraft}
   */
  #readForm() {
    const data = foundry.utils.expandObject(new FormDataExtended(this.element).object);
    const draft = this.#draft;
    const chosen = flags => this.#actors.filter((_, i) => flags?.[i]).map(a => a.uuid);
    const shown = draft.mode;

    const toDC = dc => (Number.isNumeric(dc) ? Number(dc) : null);
    // A choice's DC is only shown in a mode where each choice has one. Elsewhere it is left out, not cleared, so it
    // starts as its roll's DC on switching to such a mode.
    const toRoll = ({ roll, dc, alternatives }, previous) => ({
      roll,
      dc: toDC(dc),
      alternatives: Object.values(alternatives ?? {}).map((a, i) => {
        if ( "dc" in a ) return { roll: a.roll, dc: toDC(a.dc) };
        const before = previous?.alternatives?.[i];
        return (before && ("dc" in before)) ? { roll: a.roll, dc: before.dc } : { roll: a.roll };
      })
    });
    for ( const [i, part] of Object.entries(data.parts ?? {}) ) draft.parts[i] = toRoll(part, draft.parts[i]);
    for ( const [i, side] of Object.entries(data.sideRolls ?? {}) ) draft.sideRolls[shown][i] = side.roll;
    if ( data.standard ) draft.standard = toRoll(data.standard);
    if ( "successes" in data ) draft.successes = Number(data.successes) || 2;
    if ( "range" in data ) {
      draft.range = Math.clamp(Math.round(Number(data.range) || DIVINE_RANGE.initial), DIVINE_RANGE.min, DIVINE_RANGE.max);
    }
    if ( "showDC" in data ) draft.showDC = !!data.showDC;
    draft.rollMode = data.rollMode === "gm" ? "gm" : "public";

    if ( shown === "rolloff" ) draft.rivals = [0, 1].map(s => this.#actors[data.rivals?.[s]]?.uuid ?? null);
    else if ( shown === "versus" ) draft.teams = [0, 1].map(s => chosen(data.teams?.[s]));
    else draft.actors = chosen(data.actors);

    if ( data.mode in MODES ) draft.mode = data.mode;
    return draft;
  }

  /* -------------------------------------------- */
  /*  Event Handlers                              */
  /* -------------------------------------------- */

  /** @inheritDoc */
  _onChangeForm(formConfig, event) {
    super._onChangeForm(formConfig, event);
    if ( event.target.name !== "mode" ) return;
    this.#readForm();
    this.render({ parts: ["form"] });
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  async _onRender(context, options) {
    await super._onRender(context, options);
    // The fields differ between modes, so let the window fit them.
    if ( !options.isFirstRender ) this.setPosition({ height: "auto" });
  }

  /* -------------------------------------------- */

  /**
   * Tick every actor in a list, or untick them all if they already are.
   * @this {RollRequestConfig}
   * @param {PointerEvent} _event
   * @param {HTMLElement} target
   */
  static #onSelectAll(_event, target) {
    const list = target.closest("fieldset").querySelector(".stt-request-actor-list");
    const boxes = [...list.querySelectorAll("input[type=checkbox]")];
    const checked = !boxes.every(b => b.checked);
    for ( const box of boxes ) box.checked = checked;
  }

  /* -------------------------------------------- */

  /**
   * Offer another roll to choose from instead of a roll, starting as the first that isn't offered already.
   * @this {RollRequestConfig}
   * @param {PointerEvent} _event
   * @param {HTMLElement} target
   */
  static #onAddChoice(_event, target) {
    const row = foundry.utils.getProperty(this.#readForm(), target.dataset.field);
    if ( !row || (row.alternatives.length >= MAX_CHOICES - 1) ) return;
    const offered = [row.roll, ...row.alternatives.map(a => a.roll)];
    const next = getRollGroups([]).flatMap(g => g.options).find(o => !offered.includes(o.value));
    if ( next ) row.alternatives.push({ roll: next.value });
    this.render({ parts: ["form"] });
  }

  /* -------------------------------------------- */

  /**
   * Stop offering one of a roll's alternatives.
   * @this {RollRequestConfig}
   * @param {PointerEvent} _event
   * @param {HTMLElement} target
   */
  static #onRemoveChoice(_event, target) {
    const row = foundry.utils.getProperty(this.#readForm(), target.dataset.field);
    row?.alternatives.splice(Number(target.dataset.index), 1);
    this.render({ parts: ["form"] });
  }

  /* -------------------------------------------- */

  /**
   * Post the request to chat. A thrown error is shown as a notification and keeps the window open.
   * @this {RollRequestConfig}
   */
  static async #onSubmit() {
    const draft = this.#readForm();
    const mode = MODES[draft.mode];
    const split = roll => {
      const [type, key] = roll.split(".");
      return { type, key: key ?? null };
    };
    const toPart = ({ roll, dc, alternatives=[] }) => {
      const part = { ...split(roll), dc: mode.contest ? null : dc };
      // The same roll offered twice is no choice at all.
      const offered = new Set([roll]);
      const others = alternatives.filter(a => !offered.has(a.roll) && offered.add(a.roll));
      if ( mode.choices && others.length ) {
        part.alternatives = others.map(a => (mode.choiceDCs
          ? { ...split(a.roll), dc: a.dc === undefined ? dc : a.dc } : split(a.roll)));
      }
      return part;
    };
    const request = {
      mode: draft.mode,
      successes: Math.clamp(draft.successes, 1, CHALLENGE_PARTS),
      showDC: draft.showDC,
      rollMode: draft.rollMode
    };

    if ( mode.contest ) {
      const sides = draft.mode === "rolloff" ? draft.rivals.map(uuid => uuid ? [uuid] : []) : draft.teams;
      if ( sides.some(s => !s.length) ) {
        const side = localize(mode.sides[sides.findIndex(s => !s.length)]);
        throw new Error(localize("STT.Request.Config.ChooseSide", { side }));
      }
      if ( sides[0].some(uuid => sides[1].includes(uuid)) ) throw new Error(localize("STT.Request.Config.BothSides"));
      const parts = draft.sideRolls[draft.mode].map(roll => toPart({ roll, dc: null }));
      Object.assign(request, { parts, sides, actors: sides.flat() });
    } else {
      if ( !draft.actors.length ) throw new Error(localize("STT.Request.Config.ChooseActor"));
      const count = draft.mode === "challenge" ? CHALLENGE_PARTS : 1;
      const parts = draft.mode === "standard" ? [toPart(draft.standard)] : draft.parts.slice(0, count).map(toPart);
      if ( (draft.mode === "challenge") && parts.some(p => getChoices(p).some(c => c.dc === null)) ) {
        throw new Error(localize("STT.Request.Config.ChallengeDC"));
      }
      Object.assign(request, { parts, actors: draft.actors });
      if ( draft.mode === "divine" ) {
        Object.assign(request, { parts: [{ type: "d100", key: null, dc: null }], range: draft.range });
      }
    }

    RollRequestConfig.#last = foundry.utils.deepClone(draft);
    await createRequest(request);
  }
}

/* -------------------------------------------- */
/*  Helpers                                     */
/* -------------------------------------------- */

/**
 * Actors the GM might ask to roll: those of the selected tokens, the player characters, then the scene's other tokens.
 * @returns {Actor5e[]}
 */
function getCandidates() {
  const actors = new Map();
  const add = actor => actor && !actors.has(actor.uuid) && actors.set(actor.uuid, actor);
  for ( const token of canvas.tokens?.controlled ?? [] ) add(token.actor);
  for ( const actor of game.actors ) {
    if ( (actor.type === "character") && actor.hasPlayerOwner ) add(actor);
  }
  // The scene the GM is looking at, read from the documents so it works with the canvas turned off too.
  const scene = canvas.scene ?? game.scenes.viewed ?? game.scenes.active;
  for ( const token of scene?.tokens ?? [] ) add(token.actor);
  return [...actors.values()];
}

/* -------------------------------------------- */

/**
 * Every roll that can be requested, grouped for the roll picker.
 * @param {string[]} dice  Plain dice offered in this mode.
 * @returns {{ label: string, options: { value: string, label: string }[] }[]}
 */
function getRollGroups(dice) {
  const abilities = Object.keys(CONFIG.DND5E.abilities);
  const sorted = options => options.sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang));
  return [
    {
      label: localize("STT.Request.Config.Groups.Dice"),
      options: dice.map(die => ({ value: die, label: DICE[die].label }))
    },
    {
      label: localize("STT.Request.Config.Groups.Skills"),
      options: sorted(Object.entries(CONFIG.DND5E.skills).map(([key, s]) => ({ value: `skill.${key}`, label: s.label })))
    },
    {
      label: localize("STT.Request.Config.Groups.Checks"),
      options: abilities.map(key => ({ value: `check.${key}`, label: getPartLabel({ type: "check", key }) }))
    },
    {
      label: localize("STT.Request.Config.Groups.Saves"),
      options: abilities.map(key => ({ value: `save.${key}`, label: getPartLabel({ type: "save", key }) }))
    },
    {
      label: localize("STT.Request.Config.Groups.Tools"),
      options: sorted(Object.keys(CONFIG.DND5E.tools).map(key => ({
        value: `tool.${key}`,
        label: dnd5e.documents.Trait.keyLabel(key, { trait: "tool" }) ?? key
      })))
    }
  ];
}
