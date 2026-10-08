# Changelog

All notable changes to Sogrom's Table Tools.

## Unreleased

### Renamed

- **The module is now Sogrom's Table Tools, and the cards are Hero Cards.** The module ID is now
  `sogrom-table-tools`, so Foundry treats it as a new module: install it from the new manifest, add the **Hero Cards**
  feature from **Items (Sogrom's Table Tools)** to each character, and set the module's settings again. Macros use
  `game.modules.get("sogrom-table-tools").api`. Chat notes and request cards made before the rename no longer show
  their extras.

### Changed

- **Settings are grouped into three menus.** **Configure Settings** now shows **Hero Cards**, **Dice Rolling** and
  **Roll Requests** buttons, each opening a window with that group's settings, instead of listing all eight.

### New

- **Natural 1s and 20s on a save against damage.** When a spell or feature calls for a save and deals damage, a
  creature whose save shows a natural 20 takes no damage, and one whose save shows a natural 1 takes the most the
  damage could do, every die at its highest (36 from 6d6, plus any modifier), ignoring its resistances and
  immunities. Nothing more is rolled: each creature starts at that in the damage's **Apply** tray, whether its save
  came before the damage or after, and the GM can still change it there before applying it. The **Natural 1s and 20s
  on saves against damage** setting, on by default, turns this off.

- **Each choice of roll can have its own DC.** In a Standard Roll or Skill Challenge, a roll offered as a choice now
  has a DC of its own, such as a DC 10 Dexterity save or a DC 15 Strength save. A new choice starts with the roll's
  DC. The card lists each choice with its DC, the GM can change each one, and players see them on the buttons they
  choose from (or "DC ?" while the DC is hidden). A Team Challenge's choices still share one DC, since its rolls are
  averaged against it. A macro gives an alternative its own `dc`; one that gives none shares the roll's, as before.

- **The GM can let someone roll again from the request card.** Click a result to open its dice, and the GM gets a
  **Roll again** button, which deletes the roll after asking, so the actor's Roll button comes back. With rolls
  attached to the request card, as they are by default, the roll's own message is hidden, so before this the GM had
  to turn that setting off to find it.

- **A setting for the natural 1 and 20 rings.** **Ring natural 1s and 20s**, on by default, so nothing changes until
  the GM turns it off. Off, totals in chat and results on request cards are shown plain.

### Fixed

- **A save rolled from a spell's card is ringed on a natural 1 or 20.** D&D 5e shows a save rolled from a spell's or
  feature's Save button inside that card rather than as a message of its own, and the ring skipped it there. It now
  gets the same gold or red ring as any other roll.

- **"Success" stays in one piece on the GM's request card.** Beside the Show to players button, a Team Challenge's
  result was squeezed until "Success" broke across two lines. The result now breaks only between words, and the
  average beside it wraps instead.

## 2.1.0

### New

- **The GM can change the DC after asking for a roll.** Click the DC on a Standard Roll, Team
  Challenge or Skill Challenge request card to change it, or to clear it. Rolls already made
  are scored again against the new DC.
- **A roll can offer a choice.** In the request window, the **+** beside a Standard Roll, Team
  Challenge or Skill Challenge roll adds another roll the actor may make instead, such as
  Athletics or Acrobatics, up to four in all. They share the roll's DC. Clicking **Roll** asks
  which one to make, and the result says which was chosen.
- **Cards played together are all shown.** Up to three cards played at the same time are shown
  on screen side by side. Any more wait their turn. Before, each new card replaced the one on
  screen, so a card played a moment earlier could vanish before anyone saw it.

### Fixed

- **A card is given back if it can't be played.** A card was spent before its roll was changed,
  so if changing the roll failed, the card was lost with nothing to show for it. It is now given
  back, as a use of Indomitable already was.
- **A double click spends one card.** Clicking the Hero Card button twice quickly opened two
  card choosers, and picking in both spent two cards, of which only one took effect.
- **A failed action says why.** The Roll button, the Hero Card button, Use Indomitable, and
  Add to or Subtract from a roll did nothing visible when something went wrong. They now show
  the error.
- **A bonus on initiative is spent once.** If the combat tracker couldn't be updated after a bonus
  was added to an initiative roll, the bonus could be spent again, and the player was told
  nothing had been spent.
- **Card dice use the actor's Dice So Nice appearance.** Dice rolled by a Hero Card, or by
  the Fighter's Indomitable, were shown in the player's own dice, not the ones set for that
  actor. They now look like the dice of the roll they change.
- **Divine Intervention reads right with one number to pick.** The card said "1 numbers in a row",
  and the picked run showed as "40–40". It now says "1 number on a d100", and shows "40".
- **A Divine Intervention roll only lands in numbers the picker could give.** A roll made outside
  the request card could claim any run of numbers, such as 1 to 100, and always succeed. A run
  that isn't as long as the request allows, or goes past 100, now fails.
- **Only a GM's request is a request.** A player could post a message carrying a request of their
  own, which drew as a request card and, with pop-ups on, opened a window on everyone else's
  screen. Now only a request a GM posted is drawn as one or opens pop-ups, and `createRequest`
  refuses a player with a message saying so.
- **A contest's pop-up opens when a macro lists someone on neither side.** It failed to draw,
  trying to give that actor a roll. Now only those on a side are given one.
- **A macro's request keeps only the rolls its kind uses.** Given more parts than that, such as two
  for a Standard Roll, `createRequest` posted them all, and the card offered each actor a Roll
  button for every extra one. The extras are now left off. A request whose `actors` aren't a list
  of actor UUIDs, each named once, is refused rather than posting a card that can't be drawn.
- **A macro's Divine Intervention must roll a d100.** `createRequest` accepted any roll for it,
  such as a skill check, which was then scored against the numbers picked. It now refuses
  anything but a d100, as the README already said.
- **The token controls' request button is grey.** It had the orange border Foundry gives button
  tools, unlike the tools beside it.
- **The fonts come with the module.** The module's windows and cards use Cinzel and Spectral, which
  were loaded from Google Fonts, so every player's browser contacted Google, and a table with no
  internet fell back to other fonts. They are now part of the module, under their own licence.

## 2.0.0

### New

- **The GM can ask for rolls.** A new window, opened from the chat controls or the token
  controls, posts a roll request to chat. Players roll from it with a **Roll** button for each
  of their characters, and the request fills in as the rolls come in. Hero Cards can be
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

  A macro can post a request with `game.modules.get("sogrom-table-tools").api.createRequest()`.
  Anything it leaves out is filled in as the window would, and a request that can't be rolled,
  such as one naming a skill D&D 5e doesn't know, is refused with a message saying why.
- **Fighter's Indomitable on a failed save.** A Use Indomitable button on a failed saving throw
  spends a use of the class feature and rerolls it, adding the Fighter level under the 2024 rules.
  A natural 1 is fixed, so it isn't offered on one.
- **Add another feature's die to a roll.** Right-click a die rolled by a feature such as Bardic
  Inspiration or Cutting Words, and choose Add to a roll or Subtract from a roll. Its total goes onto
  the roll you pick, which updates, with a note of what changed. The GM applies it to rolls that
  aren't yours to change, and tells you if it can't. Only the player who rolled the die, or the GM,
  can spend it.
- **Played cards appear on screen.** However a card is played, its art appears in the middle of
  the screen for a moment, for everyone who can see the roll. Chat keeps a short record: a card
  played on a roll is noted on the roll with a thumbnail, instead of posting a message that pushed
  the roll out of view, and a card played from the sheet has its description folded away. A
  setting turns the on-screen card off.
- **The DC is hidden from players by default.** A new setting decides whether Show DC to Players
  starts ticked in the request window. It starts unticked. The DC is kept off the chat card, but
  it still reaches each player's Foundry with the request, so it isn't a secret from a player who
  goes looking.
- **Rolls attach to the request card.** A new setting, on by default: the rolls made for a request
  show on its card rather than as messages of their own. Click a result to see its dice.
- **Roll request pop-ups.** Two settings, both off by default, open a window with the Roll buttons
  when a request is posted: one for players, with their own characters, and one for the GM, with
  the NPCs. The window closes once everything in it is rolled.
- **Natural 20s are ringed in gold.** A roll in chat whose d20 shows a natural 20, and its result
  on a roll request card, gets a turning gold ring and glow, like the Character Creator's Level Up
  button. Under reduced motion the ring holds still. A natural 1 gets a still, dull red ring.
- **Ready for translation.** Every string the module shows is now in `lang/en.json`.

### Changed

- **Natural 1s and 20s lock Hero Cards.** A new setting, **on by default**, so existing worlds
  change when they update: no card can be played on a roll whose d20 shows a natural 1 or 20.
  Turn the setting off to allow Advantage and Inspiration on them. Either way, Luck can't be
  played on a natural 20, and a natural 1 is fixed: nothing rerolls it, so Luck, Indomitable and
  Relentless can't be played on one.
- **The Hero Card button has a new icon**, the anchor also used for roll requests.
- **Corn Liquor uses Foundry's own jug icon.** The item and its effect now use an icon that ships
  with Foundry VTT, in place of the art added in 1.0.0, which is no longer included.

## 1.0.0

### New

- **Play a Hero Card on a roll you've already made.** Your attack, damage, ability check,
  saving throw and initiative rolls get a **Hero Card** button in chat, which offers only the
  cards that can be played on that roll. The chat card updates to show the new total, hit or miss
  against the target and a save's success or failure are worked out again, and a note records which
  card was played and what it changed.
  - **Inspiration + 1d6 / 1d8 / 1d10** adds the die to the roll.
  - **Luck** rerolls the dice in play: the d20, both d20s with advantage or disadvantage, or all
    the damage dice. It can't be played on a natural 1 or 20.
  - **Advantage** rolls a second d20 and keeps the higher, or cancels disadvantage.
  - **Indomitable** rerolls a failed saving throw.
  - **Relentless** rerolls initiative at the start of combat, keeps the higher total, and updates
    the combat tracker.
- **A card window.** Clicking the Hero Cards feature on a character sheet opens a window showing
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

- **Sogrom's Table Tools compendiums**, gathered in a Sogrom's Table Tools folder: a journal with the Hero Cards, the
  campaign, and class spell lists; custom spells, including Theodore's Morning Coffee; custom
  items, including the Hero Cards feature, the Belts of Phoenix Dexterity and Corn Liquor;
  classes and subclasses; and macros.
