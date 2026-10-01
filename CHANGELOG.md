# Changelog

All notable changes to RoBear-E.

## 1.1.0

### New

- **The GM can ask for rolls.** A new window, opened from the chat controls or the token
  controls, posts a roll request to chat. Players roll from it with a **Roll** button for each
  of their characters, and the request fills in as the rolls come in. RoBear-E Cards can be
  played on these rolls, and the request updates when they are.
  - **Standard Roll**: each actor rolls once against the DC, with a d20 by default, a d6, d8,
    d10, d12 or d100, or any check, save or tool.
  - **Skill Challenge**: three rolls in turn, each with its own roll and DC, needing a chosen
    number of successes.
  - **Team Challenge**: the party's rolls are averaged against the DC. A natural 1 removes the
    highest roll from the pool, and a natural 20 removes the lowest.
  - **Roll-Off**: one actor against another, each with its own roll: a d20 by default, a d6,
    d8, d10, d12 or d100, or any check, save or tool. The higher total wins. An NPC's roll
    stays private to the GM until the GM shows it.
  - **Team vs Team**: the players against a team of NPCs. Each team is averaged like a Team
    Challenge, and the higher average wins.
  - **Divine Intervention**: each player picks a run of 1 to 50 numbers in a row (the GM
    chooses how many), then rolls a d100 and must roll one of them. The Advantage and Luck
    cards can be played on the d100.

- **Played cards appear on screen.** However a card is played, its art appears in the middle of
  everyone's screen for a moment. Chat keeps a short record: a card played on a roll is noted on
  the roll with a thumbnail, instead of posting a message that pushed the roll out of view, and a
  card played from the sheet has its description folded away. A setting turns the on-screen card off.
- **The DC is hidden from players by default.** A new setting decides whether Show DC to Players
  starts ticked in the request window. It starts unticked.
- **Rolls attach to the request card.** A new setting, on by default: the rolls made for a request
  show on its card rather than as messages of their own. Click a result to see its dice.
- **Roll request pop-ups.** Two settings, both off by default, open a window with the Roll buttons
  when a request is posted: one for players, with their own characters, and one for the GM, with
  the NPCs. The window closes once everything in it is rolled.
- **Natural 1s and 20s lock RoBear-E Cards.** A new setting, on by default: no card can be played
  on a roll whose d20 shows a natural 1 or 20. Turn it off to allow them; Luck still can't be played
  on a natural 1 or 20.

## 1.0.0

### New

- **Play a RoBear-E Card on a roll you've already made.** Your attack, damage, ability check,
  saving throw and initiative rolls get a **RoBear-E Card** button in chat, which offers only the
  cards that can be played on that roll. The chat card updates to show the new total, hit or miss
  against the target and a save's success or failure are worked out again, and a note records which
  card was played and what it changed.
  - **Inspiration + 1d6 / 1d8 / 1d10** adds the die to the roll.
  - **Luck** rerolls the dice in play: the d20, both d20s with advantage or disadvantage, or all
    the damage dice. It can't be played on a natural 1 or 20.
  - **Advantage** rolls a second d20 and keeps the higher, or cancels disadvantage.
  - **Indomitable** rerolls a failed saving throw.
  - **Relentless** rerolls initiative at the start of combat and updates the combat tracker.
- **A card window.** Clicking the RoBear-E Cards feature on a character sheet opens a window showing
  the art of every card you still have, and clicking one plays it. Cards with no uses left aren't
  shown. Shift-click the feature for the standard D&D 5e list instead.
- **Advantage on your next roll.** Playing Advantage from the sheet gives advantage on your next
  attack roll, ability check or saving throw.

### Changed

- **Needs Foundry VTT v14 and D&D 5e 6.x.** Verified on D&D 5e 6.0.5.
- **Corn Liquor has its own art.** The item and its effect now use art shipped with this module,
  rather than images from other modules that might not be installed.
- **The Classes & Subclasses and Macros compendiums have been removed.**

## 0.0.1 — First Release

### New

- **RoBear-E compendiums**, gathered in a RoBear-E folder: a journal with the RoBear-E Cards, the
  campaign, and class spell lists; custom spells, including Theodore's Morning Coffee; custom
  items, including the RoBear-E Cards feature, the Belts of Phoenix Dexterity and Corn Liquor;
  classes and subclasses; and macros.
