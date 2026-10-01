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
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(resolve(root, "module.json"), "utf8"));
const command = process.argv[2];

if ( !["build", "extract"].includes(command) ) {
  console.error("Usage: node tools/packs.mjs build|extract");
  process.exit(1);
}

// A pack that was never built has nothing to extract: the CLI fails on it unclearly, and leaves an empty folder behind.
const unbuilt = (manifest.packs ?? []).filter(p => !existsSync(resolve(root, p.path, "CURRENT"))).map(p => p.path);
if ( (command === "extract") && unbuilt.length ) {
  console.error(`Not built, so there is nothing to extract: ${unbuilt.join(", ")}. Run npm run build:packs first.`);
  process.exit(1);
}

for ( const { name, path } of manifest.packs ?? [] ) {
  const db = resolve(root, path);
  const src = resolve(root, "src/packs", name);
  if ( command === "build" ) {
    await compilePack(src, db, { yaml: true, recursive: true });
    console.log(`built      ${path}`);
  } else {
    await extract(db, src);
    console.log(`extracted  src/packs/${name}`);
  }
}

/**
 * Extract a pack over its YAML, leaving a document's file as it was if only volatile fields, such as its modified time,
 * changed. Files of documents no longer in the pack, deleted or moved to another folder, are removed: building would
 * otherwise bring a deleted one back, or fail on a moved one's two files.
 * @param {string} db   The LevelDB pack.
 * @param {string} src  Its YAML directory.
 */
async function extract(db, src) {
  // A clean extraction lists the files the pack makes now; omitVolatile needs the old files left in place to compare.
  const fresh = await mkdtemp(join(tmpdir(), "robear-packs-"));
  try {
    await extractPack(db, fresh, { yaml: true, folders: true });
    const keep = new Set(await listFiles(fresh));
    await extractPack(db, src, { yaml: true, folders: true, omitVolatile: true });
    for ( const file of await listFiles(src) ) {
      if ( !keep.has(file) ) await rm(join(src, file));
    }
    await removeEmptyDirs(src);
  } finally {
    await rm(fresh, { recursive: true, force: true });
  }
}

/**
 * @param {string} dir
 * @returns {Promise<string[]>}  Every file under the directory, relative to it.
 */
async function listFiles(dir) {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries.filter(e => e.isFile()).map(e => relative(dir, join(e.parentPath, e.name)));
}

/**
 * Remove the directories under `dir` left empty, deepest first.
 * @param {string} dir
 */
async function removeEmptyDirs(dir) {
  for ( const entry of await readdir(dir, { withFileTypes: true }) ) {
    if ( !entry.isDirectory() ) continue;
    const sub = join(dir, entry.name);
    await removeEmptyDirs(sub);
    if ( !(await readdir(sub)).length ) await rmdir(sub);
  }
}
