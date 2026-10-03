/**
 * Fail-fast manifest validation. Foundry parses `module.json` at load, and there is no build step
 * to catch a stray comma, so CI parses it here on every push. It also checks that every script,
 * stylesheet, compendium pack and language file the manifest names exists, since a missing one only
 * shows up as a 404 or an empty compendium in the live game, and that every string key the scripts
 * and templates use is in each language file.
 *
 * `module.json` carries `#{VERSION}#`-style release tokens that are substituted at publish
 * time; those live *inside* JSON string values, so the file is still valid JSON as committed.
 */

import { readFile, readdir, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

let failures = 0;
const fail = message => {
  failures++;
  console.error(`FAIL  ${message}`);
};

let manifest;
try {
  manifest = JSON.parse(await readFile(resolve(root, "module.json"), "utf8"));
  console.log("ok    module.json");
} catch ( err ) {
  fail(`module.json: ${err.message}`);
}

if ( manifest ) {
  const paths = [
    ...(manifest.esmodules ?? []),
    ...(manifest.styles ?? []).map(s => (typeof s === "string" ? s : s.src)),
    // Packs are built from their YAML source at release, so it's the source that must exist.
    ...(manifest.packs ?? []).map(p => `src/packs/${p.name}`),
    ...(manifest.languages ?? []).map(l => l.path)
  ];
  for ( const rel of paths ) {
    try {
      await access(resolve(root, rel));
      console.log(`ok    ${rel}`);
    } catch {
      fail(`${rel}: listed in module.json but not found`);
    }
  }

  // Every pack a compendium folder lists must be a pack the manifest declares.
  const packNames = new Set((manifest.packs ?? []).map(p => p.name));
  for ( const folder of manifest.packFolders ?? [] ) {
    for ( const name of folder.packs ?? [] ) {
      if ( !packNames.has(name) ) fail(`packFolders "${folder.name}" lists unknown pack "${name}"`);
    }
  }

  await validateStyleUrls(manifest);
  await validateLanguages(manifest);
}

/**
 * Every local file a stylesheet loads, such as a font, must exist: a missing one only shows in the game as text
 * drawn in a fallback font. A remote URL would have every player's browser contact a third party, so none is allowed.
 * @param {object} manifest
 */
async function validateStyleUrls(manifest) {
  for ( const rel of (manifest.styles ?? []).map(s => (typeof s === "string" ? s : s.src)) ) {
    let source;
    try {
      source = await readFile(resolve(root, rel), "utf8");
    } catch {
      continue; // Already reported as missing above.
    }
    let count = 0;
    const urls = [...source.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)|@import\s+["']([^"']+)["']/g)].map(m => m[1] ?? m[2]);
    for ( const url of urls ) {
      if ( url.startsWith("data:") ) continue;
      if ( /^[a-z]+:|^\/\//i.test(url) ) {
        fail(`${rel}: loads ${url} from another site`);
        continue;
      }
      count++;
      try {
        await access(resolve(root, dirname(rel), url));
      } catch {
        fail(`${rel}: ${url} not found`);
      }
    }
    if ( count ) console.log(`ok    ${rel}: ${count} file(s) it loads`);
  }
}

/**
 * Every language file must parse, and every string key the scripts and templates use must be in each of them: a
 * missing key shows in the game as the key itself, such as "ROBEAR.Request.Roll".
 *
 * Every script is read, not just those the manifest loads, since the rest are imported by them. Keys are found as
 * whole string literals, so a key must be written out in full rather than built from pieces.
 * @param {object} manifest
 */
async function validateLanguages(manifest) {
  const listed = async dir => (await readdir(resolve(root, dir))).map(f => `${dir}/${f}`);
  const files = [
    ...(await listed("scripts")).filter(f => f.endsWith(".mjs")),
    ...(await listed("templates")).filter(f => f.endsWith(".hbs"))
  ];
  const used = new Set();
  for ( const rel of files ) {
    const source = await readFile(resolve(root, rel), "utf8");
    for ( const [, key] of source.matchAll(/["'`](ROBEAR\.[A-Za-z0-9.]+)["'`]/g) ) used.add(key);
  }

  for ( const { lang, path } of manifest.languages ?? [] ) {
    let strings;
    try {
      strings = JSON.parse(await readFile(resolve(root, path), "utf8"));
    } catch ( err ) {
      fail(`${path}: ${err.message}`);
      continue;
    }
    const missing = [...used].filter(key => typeof key.split(".").reduce((o, k) => o?.[k], strings) !== "string");
    for ( const key of missing ) fail(`${path}: no "${lang}" string for ${key}`);
    if ( !missing.length ) console.log(`ok    ${used.size} strings used, all in ${path}`);
  }
}

if ( failures ) {
  console.error(`\n${failures} manifest problem(s) found.`);
  process.exit(1);
}
console.log("\nManifest valid.");
