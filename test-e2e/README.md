# End-to-end tests

These tests run RoBear-E in a real Foundry, with one browser joined as the GM and another as a player. They
click the real buttons: the Roll buttons on a request card, dnd5e's roll window, the Divine Intervention
number picker, the RoBear-E Card chooser and the request window. Then they check what each user sees.

Dice are forced, so each rule is tested exactly: natural 1s and 20s, ranges, ties and winners. Foundry turns
`CONFIG.Dice.randomUniform()` into a face with `ceil((1 - u) * faces)`, and `forceDice` feeds back the `u`
for each result wanted.

The harness is not shipped: the release archive in `.github/workflows/main.yml` lists its contents.

## Setting up

1. Copy `config.example.mjs` to `config.mjs` and set the paths. `FOUNDRY_ROOT` is Foundry's Node build, the
   folder holding `main.mjs`.
2. Link the repo into Foundry's modules folder, so the tests run the working copy. From an administrator
   prompt, or with Developer Mode on:

   ```
   mklink /J "%LOCALAPPDATA%\FoundryVTT\Data\modules\sogrom-robear-e" "H:\Code\FoundryModules\RoBear-5-Foundry-VTT-Module"
   ```

3. `npm install`, then `npx playwright install chromium` if Playwright has no browser yet.
4. `npm run build:packs`, so the module has its compendium packs, and again after the YAML in `src/packs/`
   changes.

Close any Foundry you have running first: only one Foundry can use the data folder at a time.

## Running

```
npm run test:e2e                 # every test
npm run test:e2e -- divine       # only tests whose name contains "divine"
HEADED=1 npm run test:e2e        # watch the browsers
```

Foundry is started on port 30099 with the `robear-e2e` world, which is created on the first run. Every run
deletes the world's actors, chat, combats and scenes, then recreates the fixtures in `lib/world.mjs`:

- **Player**, a player user;
- **Aria**, the player's character, holding the RoBear-E Cards and a Dagger;
- **Borin**, another of the player's characters, with no cards;
- **Goblin**, an NPC with a token on the active scene.

Every ability is 10 and nothing is proficient, so a check's total is exactly the die forced for it.

A failed test saves a screenshot from each browser as `fail-NN-gm.png` and `fail-NN-player.png`, and prints
the end of both consoles.

## What is tested

- `tests.mjs`: roll requests. This covers the GM's buttons, the request window's fields, carrying values
  between modes and its validation, and every mode's Roll button. It also covers the hidden summary and
  hidden DC, deleting a roll to reroll (which only the GM may do), rolls that don't count because their
  author doesn't own the actor, double clicks, the cards played from a request card, and attaching rolls to
  the request card.
- `tests-popup.mjs`: the roll request pop-ups for players and for the GM: who gets one, rolling from it,
  when it closes, redrawing when the GM shows the result, staying closed once closed, and getting it back
  after a reload.
- `tests-bonus.mjs`: adding another feature's die to a roll, or subtracting it, from the chat right-click menu,
  including through the GM when the roll isn't yours. Only the die's own roller can spend it, the GM refuses
  forged requests, and a die can't be spent twice.
- `tests-features.mjs`: Fighter's Indomitable from dnd5e's compendiums under both sets of rules: rerolling a
  failed save, the 2024 Fighter-level bonus, and when it is offered.
- `tests-cards.mjs`: RoBear-E Cards on rolls already in chat, and from the sheet. This covers who can play
  them, and Inspiration, Luck, Advantage, Indomitable and Relentless, including when each is offered.
  It also covers spent uses, death saves, the card window's art, Advantage on the next roll, the "no cards
  left" warning and shift-click. Played cards are shown only to those who can see the roll, and a note's art
  and name are never run as HTML.

The rules themselves also have unit tests in `../test`, which `npm test` runs without Foundry.

## Screenshots

`screenshots.mjs` uses the same harness to take the screenshots in `docs/images` for the user guides, with forced
dice so every run takes the same pictures. `npm run docs:screenshots` takes them all, and
`npm run docs:screenshots -- divine` only those whose name contains "divine".
