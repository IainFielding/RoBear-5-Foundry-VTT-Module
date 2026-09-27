/**
 * Fail-fast manifest validation. Foundry parses `module.json` at load, and there is no build step
 * to catch a stray comma, so CI parses it here on every push. It also checks that every script,
 * stylesheet and compendium pack the manifest names exists, since a missing one only shows up as
 * a 404 or an empty compendium in the live game.
 *
 * `module.json` carries `#{VERSION}#`-style release tokens that are substituted at publish
 * time; those live *inside* JSON string values, so the file is still valid JSON as committed.
 */

import { readFile, access } from "node:fs/promises";
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
    ...(manifest.packs ?? []).map(p => p.path)
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
}

if ( failures ) {
  console.error(`\n${failures} manifest problem(s) found.`);
  process.exit(1);
}
console.log("\nManifest valid.");
