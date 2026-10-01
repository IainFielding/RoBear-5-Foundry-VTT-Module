/**
 * Configuration for the end-to-end harness. Copy this to `config.mjs` and edit the paths.
 *
 * The harness drives a real Foundry install, so the paths are specific to one machine; `config.mjs`
 * is gitignored for that reason.
 */

/** Where Foundry Virtual Tabletop's Node build is installed (the directory holding `main.mjs`). */
export const FOUNDRY_ROOT = "C:/foundryvtt";

/** Foundry's user data root (the directory holding `Data/`, `Config/` and `Logs/`). */
export const DATA_PATH = "C:/Users/<you>/AppData/Local/FoundryVTT";

/** Foundry's `Data/` directory. */
export const DATA_DIR = `${DATA_PATH}/Data`;

/** The harness runs its own Foundry on this port, so one already running on 30000 is left alone. */
export const PORT = 30099;

export const BASE_URL = `http://127.0.0.1:${PORT}`;

/** The module under test. It must be linked into `Data/modules`: see `README.md`. */
export const MODULE_ID = "sogrom-robear-e";

/** The disposable test world. Its id is also its directory name under `Data/worlds`. */
export const WORLD = {
  id: "robear-e2e",
  title: "RoBear-E E2E",
  description: "<p>Automated tests for RoBear-E. Its contents are created and deleted on every run.</p>",
  modules: [MODULE_ID]
};

export const SYSTEM = "dnd5e";
export const SYSTEM_VERSION = "6.0.5";
export const CORE_VERSION = "14.368";

/** Foundry creates this passwordless GM in a world that has none. */
export const GM_USER = "Gamemaster";

/** The player account the harness creates, to test what players see and can do. */
export const PLAYER_USER = "Player";

/** `HEADED=1` shows the browsers while they drive Foundry. */
export const HEADED = process.env.HEADED === "1";

export const SERVER_TIMEOUT_MS = 120_000;
export const WORLD_READY_TIMEOUT_MS = 90_000;
