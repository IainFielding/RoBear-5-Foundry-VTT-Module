/**
 * Move the compendium packs between their YAML source in `src/packs/` and the LevelDB databases in `packs/` that
 * Foundry reads. Only the YAML is committed: Foundry rewrites the databases whenever it opens them, so they would
 * show as changed after every session.
 *
 *   npm run build:packs     YAML → LevelDB, before trying the module in Foundry and when releasing.
 *   npm run extract:packs   LevelDB → YAML, after editing the packs in Foundry.
 *
 * Close Foundry first either way: it holds the databases open while a world using the module is running.
 */

import { compilePack, extractPack } from "@foundryvtt/foundryvtt-cli";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(resolve(root, "module.json"), "utf8"));
const command = process.argv[2];

if ( !["build", "extract"].includes(command) ) {
  console.error("Usage: node tools/packs.mjs build|extract");
  process.exit(1);
}

for ( const { name, path } of manifest.packs ?? [] ) {
  const db = resolve(root, path);
  const src = resolve(root, "src/packs", name);
  if ( command === "build" ) {
    await compilePack(src, db, { yaml: true, recursive: true });
    console.log(`built      ${path}`);
  } else {
    // Volatile changes, such as a document's modified time, are left out when nothing else in it changed.
    await extractPack(db, src, { yaml: true, folders: true, omitVolatile: true });
    console.log(`extracted  src/packs/${name}`);
  }
}
