import { defineConfig } from "vitest/config";

// The rules run in plain Node. `setupFiles` installs the Foundry globals before any test imports the scripts.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.mjs"],
    setupFiles: ["test/helpers/foundry-shims.mjs"]
  }
});
