import js from "@eslint/js";
import globals from "globals";

/**
 * Flat ESLint config for RoBear-E.
 *
 * The module is browser ESM running inside Foundry VTT, so on top of the standard browser
 * globals we declare the Foundry / dnd5e globals the code reaches for.
 */

const foundryGlobals = {
  game: "readonly",
  CONFIG: "readonly",
  CONST: "readonly",
  foundry: "readonly",
  dnd5e: "readonly",
  Roll: "readonly",
  Hooks: "readonly",
  fromUuid: "readonly",
  fromUuidSync: "readonly",
  ui: "readonly",
  canvas: "readonly",
  Actor: "readonly",
  Item: "readonly",
  ChatMessage: "readonly"
};

export default [
  { ignores: ["**/node_modules/**"] },
  js.configs.recommended,
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.browser, ...foundryGlobals }
    },
    rules: {
      // Unused args are common in Foundry hook/callback signatures; ignore leading-underscore
      // names and trailing unused args rather than forcing churn on every handler.
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", args: "after-used" }],
      "no-empty": ["error", { allowEmptyCatch: true }]
    }
  },
  {
    files: ["tools/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node }
    }
  },
  {
    // Tests run in Node, but set up Foundry's globals (unit tests) or pass functions into the page to run in the
    // live world (end-to-end tests), so both sets of globals are in scope.
    files: ["test/**/*.mjs", "test-e2e/**/*.mjs", "vitest.config.mjs"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node, ...globals.browser, ...foundryGlobals, Combat: "readonly", Scene: "readonly", User: "readonly" }
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", args: "after-used" }]
    }
  }
];
