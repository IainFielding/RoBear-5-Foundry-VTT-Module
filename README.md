# RoBear-E

A [Foundry VTT](https://foundryvtt.com/) module for the **dnd5e** system, providing custom content for the RoBear-E campaign.

## Compatibility

- **Foundry VTT**: v14
- **Game System**: dnd5e 6.x (verified on 6.0.5)

## Contents

This module includes the following compendium packs, organized under the "RoBear-E" folder in the compendium sidebar:

- **Journal (RoBear-E)** — Campaign journals and spell list reference pages
- **Spells (RoBear-E)** — Custom spells
- **Items (RoBear-E)** — Custom items, including the RoBear-E Cards

## Installation

1. In Foundry VTT, go to **Add-on Modules** and click **Install Module**.
2. Search for "RoBear-E" or paste the manifest URL:
   `https://github.com/IainFielding/RoBear-5-Foundry-VTT-Module/releases/latest/download/module.json`
3. Enable the module in your world's **Manage Modules** settings.

## Using the RoBear-E Cards

Give a character the **RoBear-E Cards** feature from the Items compendium. Each card can be
played once, and comes back after a long rest.

However a card is played, its art appears in the middle of the screen for a moment, with who
played it, for everyone who can see the roll it was played on. Click it to dismiss it early.
Chat keeps a short record of it. The GM can turn the on-screen card off with **Show played
cards on screen** in **Configure Settings → RoBear-E**.

### Playing a card from the character sheet

Click the RoBear-E Cards feature on the sheet. A window opens showing every card you still
have, and clicking one plays it: its use is spent, and a short record goes to chat with the
card's description folded away. Click the record's header to open it, or hover the small card art
to see it full size.
Shift-click the feature to get the standard D&D 5e list instead.

Playing **Advantage** this way gives advantage on your next attack roll, ability check or
saving throw.

### Playing a card on a roll you've already made

Your attack, damage, ability check, saving throw and initiative rolls get a
**RoBear-E Card** button in chat. Click it to see only the cards that can be played on that
roll. The chat card then updates to show the new total, and hit or miss against the target,
or the save's success or failure, is worked out again. A note on the roll records which
card was played and what it changed, with a thumbnail of the card; no separate message is posted,
so the roll stays where it is in chat.

| Card | What it does to the roll |
|---|---|
| **Inspiration + 1d6 / 1d8 / 1d10** | Adds the die to the roll. |
| **Luck** | Rerolls the dice and you must use the new result: the d20 (both d20s with advantage or disadvantage), or all the damage dice. Can't be played on a natural 1 or 20. |
| **Advantage** | Rolls a second d20 and keeps the higher. On a roll with disadvantage, the two cancel out and the roll becomes a straight roll. |
| **Indomitable** | Rerolls a failed saving throw, and you must use the new result. |
| **Relentless** | Rerolls initiative at the start of combat, and updates the combat tracker. |

Charger, Reaction Surge, Extra Strike, Mind's Eye and Divine Intervention are played from the
sheet. Divine Intervention's chat card has a button to roll its 1d100.

A few things to know:

- **Natural 1s and 20s lock the cards.** By default no card can be played on a roll whose d20 shows a
  natural 1 or 20, except **Indomitable**: it only ever rerolls a failed save, so it can still be
  played on a failed natural 1. The GM can turn the lock off in **Configure Settings → RoBear-E**; Luck
  still can't be played on a natural 1 or 20 either way. Rolls without a d20, such as damage, aren't
  affected.
- Cards can only be played on your own rolls.
- Death saving throws can't be changed, because D&D 5e has already applied the result.
- Play a card on a damage roll **before** applying the damage — damage that's already been
  applied isn't changed.

## Adding Another Feature's Die to a Roll

Some features roll a die to change someone else's roll, like **Bardic Inspiration** or **Cutting
Words**. Roll the die as usual, then right-click its message in chat and choose **Add to a roll…**
or **Subtract from a roll…**. Pick the roll from the list, newest first, and the die's total is
added or taken off. The roll updates its total and, where it can, whether it hits or saves. A
roll request's card updates too.

- The roll changed gets a note, such as "Bardic Inspiration: added 1d6 (4): 9 → 13", and the die's
  own message says which roll it went to. A die can only be used once.
- Only the player who rolled the die can spend it, or the GM.
- Any roll you can see can be chosen. If it isn't yours to change, such as a monster's roll for
  Cutting Words, the GM's Foundry applies it, so a GM needs to be logged in. If the GM's Foundry
  can't apply it, you're told, and the die isn't spent.
- Checks, saves, attacks and damage can't be used as the die.

## Fighter's Indomitable

A Fighter with the **Indomitable** feature from D&D 5e's compendiums can use it on a saving throw
they failed. A **Use Indomitable** button appears on the failed save, and on its row of a roll
request's card. It's also in the save's right-click menu. Using it spends one use of the feature
and rerolls the d20, and the new roll stands. A save rolled with no DC can't be known to have
failed, so the button is offered on it either way, and asks you to confirm before spending a use.
If the reroll can't be saved, the use is given back. Under the 2024 rules the reroll also adds the
Fighter's level; under the 2014 rules it doesn't. The save notes what happened, e.g.
"Indomitable: rerolled the d20 (6 → 8) + 9 (Fighter level): 6 → 17".

Indomitable, the feature or the RoBear-E card, is only offered once the player can see the save
failed. On a roll request whose result the GM hasn't shown yet, it appears when the GM clicks
**Show to players**, since offering it any sooner would tell the player they failed.

This is the class feature. The RoBear-E **Indomitable** card is separate and works as before, and like
the feature it can be played on a failed natural 1 even with **Natural 1s and 20s lock RoBear-E
Cards** on.

## Asking for Rolls (GM)

As GM, click the **anchor** button in the chat controls, or **Request RoBear-E Rolls** in the
token controls. Pick the kind of roll, the roll and DC, and who rolls. Actors of any selected
tokens are ticked for you; otherwise the player characters are. A macro can open the same
window with `game.modules.get("sogrom-robear-e").api.requestRolls()`.

The request is posted to chat. Each player gets a **Roll** button for their own characters, and
the GM can roll for anyone. The rolls are ordinary D&D 5e rolls, so they get the
**RoBear-E Card** button too, and the request updates as soon as a card changes a roll. You can
also play a card from the anchor button next to a result on the request.

| Kind | How it works |
|---|---|
| **Standard Roll** | Each actor rolls once against the DC: a d20 by default, or a d6, d8, d10, d12 or d100, or any check, save or tool. Only the GM sees who passed and how many succeeded until they click **Show to players** (and they can hide it again). The DC isn't sent with the rolls, so dnd5e doesn't show it on them either. |
| **Skill Challenge** | Three rolls in turn, each with its own roll and DC. Choose how many successes are needed (2 of 3 by default). An actor stops as soon as they have passed or failed. Only the GM sees who passed until they click **Show to players**; players see "Done" once they have finished. |
| **Team Challenge** | Everyone rolls, and the average (rounded down) is compared to the DC. Only the GM sees the result, and which rolls were removed, until they click **Show to players**. Each natural 1 removes the highest roll from the pool, and each natural 20 removes the lowest. If that would leave no rolls, 1s and 20s cancel out in pairs, and at least one roll always stays in the pool. |
| **Roll-Off** | Pick a Challenger and an Opponent, player characters or NPCs, and a roll for each: a d20 (the default for both), a d6, d8, d10, d12 or d100, or any check, save or tool. The higher total wins, and an equal total is a tie. An NPC's roll is a private GM roll: players see "?" until the GM clicks **Show NPC roll** on the request (and they can hide it again). |
| **Team vs Team** | Pick a Players team and an NPCs team, and a roll for each (a d20 by default, or any check, save or tool). Each team's rolls are pooled like a Team Challenge, 1s and 20s included, and the higher average wins. |
| **Divine Intervention** | Set how many numbers each player picks, from 1 to 50 (16 by default). When a player clicks **Roll**, they pick that many numbers in a row from 1 to 100, then roll a d100, and must roll one of their numbers. **Advantage** rolls a second d100 and keeps whichever lands in their numbers, and **Luck** rerolls the d100. |

The actor lists offer the selected tokens, the player characters and the tokens on the current
scene.

A few things to know:

- A roll only counts on the request if it was made by the GM or by one of the actor's owners.
- To let someone roll again, the GM deletes their roll message and the **Roll** button comes back.
  Players can't delete a roll made for a request, so a bad roll can't be thrown away.
- If the same roll is made twice, such as by the GM and a player clicking **Roll** at the same moment,
  the first one counts.
- With **Show DC to Players** off, players see "DC ?", and the DC is kept off their roll so
  D&D 5e doesn't show success or failure on it. It starts off for each new request; the GM can
  make it start on with **Show the DC to players by default** in **Configure Settings → RoBear-E**.
- With **Private GM Roll**, each player sees only their own results. In a private Roll-Off,
  **Show NPC roll** shows the NPC's roll only to the players in the request, not to everyone.
- **What "hidden" means.** The DC, and results the GM hasn't shown yet, are hidden on the chat card,
  but they still reach every player's Foundry as part of the request. A player who opens the browser
  console can read them. That's how Foundry shares chat messages, so treat the hiding as keeping the
  table honest rather than keeping a secret.
- **Attached rolls.** By default the rolls made for a request don't get messages of their own: they show on
  the request card, as dnd5e does for an item's saves. Click a result to see its dice; notes on any cards
  played show under the row. Turn off **Attach rolls to the request card** in **Configure Settings →
  RoBear-E** to give each roll its own message again.
- **Pop-ups.** Two settings in **Configure Settings → RoBear-E**, both off by default, open a window
  when a request is posted. **Pop up roll requests for players** gives each player a window with a
  **Roll** button for each of their characters in the request. **Pop up roll requests for the GM**
  does the same for the GM, for NPCs and any other actor no player owns. The window closes once
  everything in it is rolled. A player who joins within 30 minutes of a request they still need to
  roll for gets its window too. The chat card works either way.

### Posting a request from a macro

A macro can post a request without the window, with
`game.modules.get("sogrom-robear-e").api.createRequest(request)`. For example, a Dexterity save
against DC 14 for the selected tokens:

```js
await game.modules.get("sogrom-robear-e").api.createRequest({
  mode: "standard",
  parts: [{ type: "save", key: "dex", dc: 14 }],
  actors: canvas.tokens.controlled.map(t => t.actor.uuid)
});
```

| Field | What it holds |
|---|---|
| `mode` | `"standard"`, `"challenge"` (Skill Challenge), `"team"` (Team Challenge), `"rolloff"`, `"versus"` (Team vs Team) or `"divine"`. |
| `parts` | The rolls: one, three for a Skill Challenge, or one for each side of a Roll-Off or Team vs Team. Each is `{ type, key, dc }`. `type` is `"skill"`, `"check"`, `"save"` or `"tool"`, with `key` naming it as D&D 5e does (`"ath"`, `"dex"`, `"thief"`), or a plain die, `"d20"`, `"d6"`, `"d8"`, `"d10"`, `"d12"` or `"d100"`, with no key. `dc` is a number, or `null` for none. Divine Intervention's part is `{ type: "d100", dc: null }`. |
| `actors` | The actor UUIDs of everyone rolling. |
| `sides` | For a Roll-Off or Team vs Team, two lists of actor UUIDs, one per side, each also in `actors`. A Roll-Off has exactly one actor on each side. |
| `successes` | For a Skill Challenge, how many of the three rolls must pass. Defaults to 2. |
| `range` | For Divine Intervention, how many numbers in a row each player picks, from 1 to 50. Defaults to 16. |
| `showDC` | Whether players see the DC. Defaults to **Show the DC to players by default**. |
| `rollMode` | `"public"`, or `"gm"` for a Private GM Roll. Defaults to `"public"`. |

A request that can't be rolled, such as a skill D&D 5e doesn't know, isn't posted: `createRequest`
throws an error saying why.

## Credits

The artwork and the fan-made RoBear-E content in this module are the work of
[Captain RoBear](https://www.youtube.com/channel/UCktEYryPmattKzrpo0_kGzA) and remain
the property of their creator.

## Author

- **Sogrom** ([@IainFielding](https://github.com/IainFielding))

## License

Free for personal use — see [LICENSE](LICENSE).
