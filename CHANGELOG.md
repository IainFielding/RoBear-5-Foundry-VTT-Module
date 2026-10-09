# Changelog

All notable changes to Sogrom's Table Tools.

## 0.0.6

For Foundry VTT v14 and the D&D 5e system 6.x.

### Hero Cards

- **Divine Intervention, played from the sheet, tells the GM.** The GM is whispered a note with a **Set Up Divine
  Intervention** button, which opens the request window set to Divine Intervention with that character the one to
  roll.
- **The card window lines up.** Every card's art starts at the same height, whether its name takes one line or two.

### Settings

- **World Altering Scripts are now Gameplay Enhancements**, in Configure Settings and in the guides. The settings
  themselves are unchanged, and worlds keep what they had turned on.
- **Clearer hint for Chat Button Labels**, saying what it fixes.

### Documentation

- **A new README** introduces the module, with links to the guides.
- **The guides have moved into `docs/`**: the player guide (the old README), the GM guide and the developer guide.
- **Screenshots retaken** for the settings and the card window.

### Smaller download

- **Unused font weights removed**: Spectral's light and medium weights, which nothing used, about 150 KB.

## 0.0.5: First release

For Foundry VTT v14 and the D&D 5e system 6.x.

### Hero Cards

- **Twelve one-use cards** on the **Hero Cards** feature, each back after a long rest: Advantage, Lucky, Inspiration
  (1d6, 1d8 and 1d10), Indomitable, Relentless, Divine Intervention, Charger, Reaction Surge, Extra Strike and Mind's
  Eye.
- **Played on a roll already in chat** from the button under it, or **from the character sheet**. Each card is offered
  only on rolls it can change, and the roll is rewritten in place with a note of what the card did.
- **Played cards are shown on screen** to everyone who can see the roll, up to three side by side.
- **Natural 1s and 20s** lock the cards by default, and nothing ever rerolls a natural 1.

### Roll requests

- **The GM asks the table for rolls** from the tankard button in the chat controls: a Standard Roll, Skill Challenge,
  Team Challenge, Roll-Off, Team vs Team or Divine Intervention, each answered from a card in chat.
- **A roll can offer a choice**, each with its own DC, and the GM can change a DC after asking.
- **Results stay hidden** from players until the GM shows them, rolls are attached to the request card, and the GM can
  let someone roll again.
- **Pop-up windows** for players and the GM, and **death saves** asked for at the start of a dying creature's turn.
- **Macros** can open the request window or post a request through the module's API.

### Rolls in chat

- **Natural 1s and 20s are ringed** in red and gold.
- **Natural 1s and 20s on saves against damage**: a natural 20 takes none, and a natural 1 takes the most the damage
  could do.
- **Another feature's die**, such as Bardic Inspiration, can be added to or subtracted from a roll from the chat
  right-click menu.
- **Fighter's Indomitable** is offered on a failed save, under both the 2014 and 2024 rules.

### Gameplay Enhancements

- **Five optional enhancements**, each off until the GM turns it on: Bloodied Token Tint, Fade Unprepared Spells, Item
  Rarity Colours, Chat Button Labels and One-Tab Activities.

### Settings

- **Grouped into four menus** in Configure Settings: Hero Cards, Dice Rolling, Roll Requests and Gameplay Enhancements.
