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
    ...(manifest.packs ?? []).map(p => p.path),
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

  await validateLanguages(manifest);
}

/**
 * Every language file must parse, and every string key the scripts and templates use must be in each of them: a
 * missing key shows in the game as the key itself, such as "ROBEAR.Request.Roll".
 * @param {object} manifest
 */
async function validateLanguages(manifest) {
  const files = [
    ...(manifest.esmodules ?? []),
    ...(await readdir(resolve(root, "templates"))).map(f => `templates/${f}`)
  ];
  const used = new Set();
  for ( const rel of files ) {
    const source = await readFile(resolve(root, rel), "utf8");
    for ( const [, key] of source.matchAll(/["'](ROBEAR\.[A-Za-z0-9.]+)["']/g) ) used.add(key);
  }

  for ( const { lang, path } of manifest.languages ?? [] ) {
    let strings;
    try {
      strings = JSON.parse(await readFile(resolve(root, path), "utf8"));
      console.log(`ok    ${path}`);
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
