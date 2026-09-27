# Contributing

Thanks for taking the time to contribute. This is a Foundry VTT module for the D&D 5e
system, so most changes need checking in a real world as well as by CI.

## Getting set up

```sh
npm install        # dev tooling only — nothing here ships in the module archive
npm run check      # manifest validation and lint (what CI runs)
```

To try the module in Foundry, symlink or copy the repository into your `Data/modules/`
directory as `sogrom-robear-e`. On Windows a directory junction works without admin rights:

```powershell
New-Item -ItemType Junction -Path "$env:LOCALAPPDATA\FoundryVTT\Data\modules\sogrom-robear-e" -Target (Get-Location)
```

## Compendium packs

The packs in `packs/` are LevelDB databases, and Foundry holds them open while a world using
the module is running. Either edit them in Foundry, or close Foundry and rebuild them with the
[Foundry CLI](https://github.com/foundryvtt/foundryvtt-cli) — never both at once, or one set
of changes will overwrite the other.

## Before opening a pull request

- `npm run check` passes locally.
- The change has been clicked through in a real world — CI doesn't run Foundry.
  Say which Foundry version, D&D 5e system version, and roll or chat modules you tested against.

Keep pull requests small and focused; unrelated changes bundled together are much slower
to review. The pull request template asks for the same details, so filling it in is enough.

## Commit messages

Write a short imperative subject line describing the change, and use the body for the
reasoning if it isn't obvious from the diff. Every commit needs a sign-off, and no commit
should carry AI tool attribution — both are explained below.

### Sign your work — the Developer Certificate of Origin

Every commit must be signed off. Sign-off is a single trailer at the end of the commit
message:

```
Signed-off-by: Your Name <your.email@example.com>
```

`git commit -s` adds it for you, using your configured `user.name` and `user.email`.

Adding that line certifies that you wrote the change, or otherwise have the right to
submit it under this project's licence. The full text of what you are certifying is the
Developer Certificate of Origin 1.1, reproduced verbatim in [DCO](DCO) at the root of this
repository.

This is **not** a contributor licence agreement. There is no paperwork to sign and no
rights are assigned to anyone; you are simply asserting, per commit, that the code was
yours to give.

This repository ships a hook that adds the trailer for you, including on commits made from
an editor's source-control panel, which never pass `-s`:

```sh
git config core.hooksPath .githooks
```

`git config format.signOff true` does **not** do this: it is honoured only by
`git format-patch` and `git send-email`.

If you forget, CI will tell you. To fix it:

```sh
git commit --amend -s --no-edit       # the most recent commit
git rebase --signoff origin/main      # every commit on your branch
```

Then force-push the branch.

### AI-assisted contributions

AI coding assistants are permitted. You remain fully responsible for the correctness,
licensing, and style compliance of anything you submit, and you must be able to explain
your change on request.

Please do **not** include AI tool attribution in commit messages. Remove trailers such as
`Co-Authored-By: Claude ...`, `Co-authored-by: Copilot ...`, "Generated with ..." footers,
and similar tool sign-offs before opening a pull request.

The same `core.hooksPath` setting above also turns on a hook that catches this before you
commit, and `.github/workflows/no-ai-attribution.yml` checks every pull request in CI.
