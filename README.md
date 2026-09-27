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

### Playing a card from the character sheet

Click the RoBear-E Cards feature on the sheet. A window opens showing every card you still
have, and clicking one plays it: its card is posted to chat and its use is spent.
Shift-click the feature to get the standard D&D 5e list instead.

Playing **Advantage** this way gives advantage on your next attack roll, ability check or
saving throw.

### Playing a card on a roll you've already made

Your attack, damage, ability check, saving throw and initiative rolls get a
**RoBear-E Card** button in chat. Click it to see only the cards that can be played on that
roll. The chat card then updates to show the new total, and hit or miss against the target,
or the save's success or failure, is worked out again. A note on the card records which
card was played and what it changed.

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

- Cards can only be played on your own rolls.
- Death saving throws can't be changed, because D&D 5e has already applied the result.
- Play a card on a damage roll **before** applying the damage — damage that's already been
  applied isn't changed.

## Credits

The artwork and the fan-made RoBear-E content in this module are the work of
[Captain RoBear](https://www.youtube.com/channel/UCktEYryPmattKzrpo0_kGzA) and remain
the property of their creator.

## Author

- **Sogrom** ([@IainFielding](https://github.com/IainFielding))

## License

Free for personal use — see [LICENSE](LICENSE).
