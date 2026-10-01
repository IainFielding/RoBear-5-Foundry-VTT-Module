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
  hidden DC, deleting a roll to reroll, double clicks, the cards played from a request card, and attaching
  rolls to the request card.
- `tests-popup.mjs`: the roll request pop-ups for players and for the GM: who gets one, rolling from it,
  when it closes, and getting it back after a reload.
- `tests-cards.mjs`: RoBear-E Cards on rolls already in chat, and from the sheet. This covers who can play
  them, and Inspiration, Luck, Advantage, Indomitable and Relentless, including when each is offered.
  It also covers spent uses, death saves, the card window's art, Advantage on the next roll, the "no cards
  left" warning and shift-click.

The rules themselves also have unit tests in `../test`, which `npm test` runs without Foundry.
