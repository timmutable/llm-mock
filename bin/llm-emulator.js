#!/usr/bin/env node

import minimist from "minimist";
import { loadJsConfig } from "../src/loadConfig.js";
import { start } from "../src/server.js";
import { applyEnvOverrides } from "../src/util.js";

const argv = minimist(process.argv.slice(2), {
  string: ["env", "testTag", "port", "seed", "scenario"],
  boolean: ["detached"],
  alias: {
    e: "env",
    p: "port",
    s: "scenario",
  },
});

const configPath = argv._[0] || "./examples/config.mjs";

let config = await loadJsConfig(configPath);

config = applyEnvOverrides(config, {
  env: argv.env || config.env || "local",
  seed: argv.seed ? Number(argv.seed) : config.seed ?? 42,
  testTag: argv.testTag ?? config.testTag,
  port: argv.port ? Number(argv.port) : config.server?.port ?? 11434,
  useScenario: argv.scenario || (config.useScenario ?? null),
});

console.log("[llm-mock] config loaded from:", configPath);
console.log("[llm-mock] env:", config.env);
console.log("[llm-mock] port:", config.server?.port);
console.log("[llm-mock] scenario (useScenario):", config.useScenario);

await start(config).catch((err) => {
  console.error("[llm-mock] Failed to start:", err);
  process.exit(1);
});
