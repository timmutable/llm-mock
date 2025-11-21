#!/usr/bin/env node

import minimist from "minimist";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

import { loadJsConfig } from "../src/loadConfig.js";
import { start } from "../src/server.js";
import { applyEnvOverrides } from "../src/util.js";
import { fromPlainConfig } from "../src/plainConfig.js";
import { define } from "../src/dsl.js";

const argv = minimist(process.argv.slice(2), {
  string: ["env", "testTag", "port", "seed", "scenario"],
  boolean: ["detached"],
  alias: {
    e: "env",
    p: "port",
    s: "scenario",
  },
});

// Default is your existing examples config
const configPathArg = argv._[0] || "./examples/config.mjs";
const configPath = path.resolve(process.cwd(), configPathArg);

async function loadConfig(configPath) {
  const ext = path.extname(configPath).toLowerCase();

  // JS/TS config (existing behavior)
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs" || ext === ".ts") {
    return await loadJsConfig(configPath);
  }

  // JSON / YAML config (new behavior)
  if (ext === ".json" || ext === ".yaml" || ext === ".yml") {
    const raw = await fs.promises.readFile(configPath, "utf8");
    const obj =
      ext === ".json" ? JSON.parse(raw) : yaml.load(raw, { json: true });

    const plainCfg = fromPlainConfig(obj);
    // Wrap with define so it flows through the same pipeline as JS DSL configs
    return define(plainCfg);
  }

  throw new Error(
    `[llm-mock] Unsupported config extension "${ext}". Use .mjs/.js/.ts/.json/.yaml/.yml`
  );
}

let config = await loadConfig(configPath);

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
