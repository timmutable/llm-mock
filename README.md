# llm-mock

**llm-mock** is an enterprise-grade mocking server for applications that depend on LLMs and downstream HTTP APIs.

It is designed for:

- Local development without API keys
- Deterministic CI / integration / E2E tests
- Multi-step, multi-turn conversational flows
- Mocking both LLM calls *and* your own REST dependencies

llm-mock speaks **OpenAI-style** and **Gemini-style** HTTP APIs, so your app can simply point its `baseURL` or `baseUrl` at `http://localhost:11434` and run against mocks instead of real models.

---

## Features

- **Scenario graphs**  
  Model complex flows as branching state machines (e.g. onboarding, checkout, experiment creation).

- **Per-node sequences**  
  Inside any graph node you can define a small linear script of messages to send in order.

- **Case-based mocks**  
  Simple prompt → response mappings using patterns like `"explain {{topic}} simply"`.

- **HTTP mocks**  
  Mock your own REST dependencies (GitHub Actions, webhooks, S3, internal services).

- **Configurable matching engine (for LLM text)**  
  - Template patterns with `{{vars}}`
  - Simple guards (`equals`, `includes`, `oneOf`, `matches`)

- **Fault injection & latency**  
  - Add artificial delays
  - Override HTTP status codes
  - Attach custom `fault` metadata (handled by your app)

- **JSON / YAML / JS config support**  
  - Author configs in **YAML** or **JSON**
  - Or use the **JS/TS DSL** for maximum flexibility

- **Express middleware**  
  Optionally mount llm-mock into an existing Express app.

- **VCR-style recording (cassettes)**  
  Record requests/responses to JSONL for inspection (if enabled in config).

---

## Installation

```bash
npm install --save-dev llm-mock
```

You can run it via `npx`:

```bash
npx llm-mock ./mocks/config.yaml
```

By default the server listens on `http://localhost:11434`.

---

## Quick start (OpenAI-style)

Example test script:

```ts
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "mock-llm",
  baseURL: "http://localhost:11434",
});

const response = await client.chat.completions.create({
  model: "gpt-4o",
  messages: [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "Explain TypeScript simply." },
  ],
});

console.log(response.choices[0].message?.content);
```

As long as your config defines a matching **scenario** or **case**, this will return a deterministic mock response.

---

## Config formats overview

llm-mock supports **three** configuration styles:

1. **YAML** (recommended for most teams)
2. **JSON** (machine-friendly, same shape as YAML)
3. **JS/TS DSL** (for dynamic or computed mocks)

Internally, YAML/JSON configs are normalized via `fromPlainConfig()` into the same shape as the JS DSL.

### Top-level keys

All formats share the same top-level structure:

```yaml
server:
  port: 11434
  delayMs: 0        # optional default delay for all responses

env: local          # optional
useScenario: happy-path

defaults:
  fallback: "No mock available."

scenarios: []       # list of scenario graphs
cases: []           # optional simple pattern → reply mocks
httpMocks: []       # global HTTP mocks
httpProfiles: {}    # named HTTP-mock profiles (overrides)
contracts: {}       # optional JSON schema validation
vcr: {}             # optional VCR recording config
```

In JSON, the shape is identical:

```json
{
  "server": { "port": 11434, "delayMs": 0 },
  "env": "local",
  "useScenario": "happy-path",
  "defaults": { "fallback": "No mock available." },
  "scenarios": [],
  "cases": [],
  "httpMocks": [],
  "httpProfiles": {},
  "contracts": {},
  "vcr": {}
}
```

---

## Scenario graphs (YAML)

A **scenario** is a named graph representing a multi-step flow. You select which one is active via `useScenario` or the `--scenario` CLI flag.

Basic shape:

```yaml
scenarios:
  - id: happy-path
    httpProfile: default    # optional – see HTTP profiles below
    start: ask-intent       # starting state ID
    steps:
      ask-intent:
        - when: "i want to create an experiment"
          sequence:
            - kind: chat
              reply: "Great, let's create an experiment."
            - kind: chat
              reply: "First, what should we call this experiment?"
          next: collect-name

      collect-name:
        - when: "the experiment name is {{expName}}"
          sequence:
            - kind: chat
              replyTemplate: "Nice, '{{expName}}' sounds interesting."
            - kind: chat
              reply: "I'll trigger the GitHub workflow to set it up."
          next: trigger-github

      trigger-github:
        - when: "run the github workflow"
          sequence:
            - kind: chat
              reply: "Triggering GitHub action (mock)..."
            - kind: chat
              reply: "The action completed successfully. Your experiment is ready."
          next: end-success

      end-success:
        final: true
```

Key concepts:

- `id`: Scenario identifier (e.g. `checkout`, `onboarding`, `github-action-fail`).
- `start`: Name of the initial state node.
- `httpProfile` (optional): default HTTP profile to use for this scenario.
- `steps`: object mapping **stateId → either**:
  - `{ final: true }` – terminal node, or
  - an **array of rules** for that state.

### Rules (branches)

Each rule describes what happens when the user says something that matches `when` while in a given state:

```yaml
ask-intent:
  - when: "i want to create an experiment"
    guard:
      op: includes
      var: intent
      value: "experiment"   # optional guard
    sequence:
      - kind: chat
        reply: "Great, let's create an experiment."
      - kind: chat
        reply: "First, what should we call this experiment?"
    next: collect-name
    httpProfile: default     # optional
```

Fields:

- `when` (required): pattern string, may contain `{{variables}}` captured from user text.
- `guard` (optional): extra boolean condition based on extracted variables.
- `sequence` (optional): array of child steps (local linear script).
- `reply` / `replyTemplate` (optional): shorthand for a single-step `sequence`.
- `next` (optional): next state ID. If omitted and not `final`, the state remains unchanged.
- `httpProfile` (optional): overrides the scenario’s HTTP profile for this branch.
- `delayMs`, `fault` (optional): per-branch latency / fault injection metadata.
- `kind` (optional): usually `"chat"`, but reserved for future types like `"tools"`.

### Guards

Guards are compiled to JavaScript functions `(vars, ctx) => boolean`. Supported operators:

```yaml
guard:
  op: equals     # equals | includes | oneOf | matches
  var: name      # which captured variable to read
  value: "approved"
```

- `equals`: case-insensitive equality
- `includes`: substring match
- `oneOf`: check against a list

```yaml
guard:
  op: oneOf
  var: status
  values: ["approved", "ok", "yes"]
```

- `matches`: regular expression test

```yaml
guard:
  op: matches
  var: email
  value: ".*@example\.com$"
```

### Sequence items

`sequence` lets you script a mini linear flow inside a single state:

```yaml
sequence:
  - kind: chat
    replyTemplate: "Nice to meet you, {{name}}."
  - kind: chat
    reply: "Let me verify a few details."
```

Each item supports:

- `kind`: `"chat"` (currently the only supported kind).
- `reply`: static string.
- `replyTemplate`: string with `{{vars}}` interpolation.
- `delayMs`: optional delay before sending.
- `fault`: optional fault metadata.
- `result`: optional structured data for future tool-style results.

---

## Scenario graphs (JSON)

The JSON representation is identical in structure. Example (trimmed):

```json
{
  "scenarios": [
    {
      "id": "happy-path",
      "httpProfile": "default",
      "start": "ask-intent",
      "steps": {
        "ask-intent": [
          {
            "when": "i want to create an experiment",
            "sequence": [
              { "kind": "chat", "reply": "Great, let's create an experiment." },
              { "kind": "chat", "reply": "First, what should we call this experiment?" }
            ],
            "next": "collect-name"
          }
        ],
        "collect-name": [
          {
            "when": "the experiment name is {{expName}}",
            "sequence": [
              { "kind": "chat", "replyTemplate": "Nice, '{{expName}}' sounds interesting." },
              { "kind": "chat", "reply": "I'll trigger the GitHub workflow to set it up." }
            ],
            "next": "trigger-github"
          }
        ],
        "end-success": { "final": true }
      }
    }
  ]
}
```

---

## Cases (simple pattern → reply mocks)

Cases are global and apply across scenarios. They are a simpler way to map a prompt to a reply without modelling a full graph.

YAML:

```yaml
cases:
  - id: explain-simple
    pattern: "explain {{topic}} simply"
    replyTemplate: "Simple explanation of {{topic}}."
```

JSON:

```json
{
  "cases": [
    {
      "id": "explain-simple",
      "pattern": "explain {{topic}} simply",
      "replyTemplate": "Simple explanation of {{topic}}."
    }
  ]
}
```

At runtime, the pattern engine extracts `topic` and passes it into the handler generated by `fromPlainConfig`.

---

## HTTP mocks

HTTP mocks let you simulate your own REST dependencies such as:

- GitHub Actions dispatch endpoints
- Internal microservices
- S3 or other storage APIs
- Webhooks your app expects to receive

Global HTTP mocks are defined at the top level:

```yaml
httpMocks:
  - id: github-dispatch
    method: POST
    path: /github/actions/dispatch
    status: 200
    body:
      status: "ok"
      runId: "mock-run-123"

  - id: github-webhook
    method: POST
    path: /webhooks/experiment-complete
    status: 200
    body:
      ok: true
      experimentId: "exp-mock-123"
```

Fields:

- `id`: arbitrary label for debugging.
- `method`: HTTP method, default `"GET"`.
- `path`: Express-style path, supports `:params` (e.g. `/s3/bucket/:bucket/object/:key`).
- `status`: HTTP status code (default 200).
- `body`: static JSON to return.
- `bodyTemplate`: JSON template with interpolation (see below).
- `delayMs`: artificial latency before the response.
- `fault`: arbitrary metadata attached to the mock (consumed by your tests/tools).

### Body templates

You can use `bodyTemplate` to interpolate values from the request:

```yaml
httpMocks:
  - id: s3-put
    method: PUT
    path: /s3/bucket/:bucket/object/:key
    status: 200
    bodyTemplate:
      ok: true
      bucket: "{{params.bucket}}"
      key: "{{params.key}}"
      size: "{{body.size}}"
```

Available interpolation sources:

- `params`: path parameters (e.g. `:bucket`, `:key`)
- `query`: query string parameters
- `body`: parsed JSON body

---

## HTTP profiles

Sometimes you want different HTTP behaviour depending on the scenario or branch:

- `happy-path`: GitHub and S3 succeed
- `github-action-fail`: GitHub dispatch returns 500
- `s3-fail`: S3 upload fails, others succeed

You can express this with **httpProfiles**. Profiles are collections of mocks that override global `httpMocks` when active.

YAML:

```yaml
httpProfiles:
  github-fail:
    - id: github-dispatch
      method: POST
      path: /github/actions/dispatch
      status: 500
      body:
        status: "error"
        message: "Simulated GitHub failure (mock)."
```

In JSON:

```json
{
  "httpProfiles": {
    "github-fail": [
      {
        "id": "github-dispatch",
        "method": "POST",
        "path": "/github/actions/dispatch",
        "status": 500,
        "body": {
          "status": "error",
          "message": "Simulated GitHub failure (mock)."
        }
      }
    ]
  }
}
```

Each profile entry is turned into a `httpWhen()` mock with an attached `options.profile` value equal to the profile name. Your HTTP dispatch logic can then:

1. Determine the active profile (scenario-level, branch-level, or default).
2. Prefer mocks whose `options.profile` matches that profile.
3. Fall back to global `httpMocks` (where `profile` is `null`).

> **Note:** If you have not yet wired profiles into your HTTP router, you can still use `httpMocks` alone. `httpProfiles` are forward-compatible and do not interfere with existing behaviour until you opt in.

---

## JSON vs YAML: full config parity

Everything you can express in YAML can be expressed in JSON with the same structure. The only difference is syntax.

- Use YAML for hand-authored configs checked into your repo.
- Use JSON if the mocks are generated programmatically from other tools.

At runtime, both are loaded by the CLI, parsed, then converted via `fromPlainConfig()` into a normalized internal config.

---

## JS/TS DSL (optional)

If you prefer to stay in JavaScript/TypeScript, you can use the small DSL instead of YAML/JSON.

Example `config.mjs`:

```js
import { define, scenario, caseWhen, httpWhen } from "../src/dsl.js";

export default define({
  server: { port: 11434 },
  env: "local",
  useScenario: "happy-path",

  scenarios: [
    scenario("happy-path", {
      start: "ask-intent",
      steps: {
        "ask-intent": {
          branches: [
            {
              when: "i want to create an experiment",
              reply: "Great, let's create an experiment.",
              next: "collect-name",
            },
          ],
        },
        "collect-name": {
          branches: [
            {
              when: "the experiment name is {{expName}}",
              reply: ({ vars }) =>
                `Nice, '${vars.expName}' sounds interesting.`,
              next: "end",
            },
          ],
        },
        end: { final: true },
      },
    }),
  ],

  cases: [
    caseWhen("explain {{topic}} simply", (vars) => {
      return `Simple explanation of ${vars.topic}.`;
    }),
  ],

  httpMocks: [
    httpWhen(
      { method: "POST", path: "/github/actions/dispatch" },
      () => ({ status: "ok", runId: "mock-run-123" }),
      { status: 200 },
    ),
  ],
});
```

You can then run:

```bash
npx llm-mock ./examples/config.mjs
```

Internally this bypasses `fromPlainConfig()` and uses your JS config as-is.

---

## CLI usage

```bash
npx llm-mock ./mocks/config.yaml   --env local   --port 11434   --scenario happy-path
```

Supported flags:

- `--env` / `-e`: environment label (e.g. `local`, `ci`).
- `--port` / `-p`: HTTP port (overrides `server.port`).
- `--seed`: numeric seed for deterministic embeddings, etc.
- `--scenario` / `-s`: which scenario id to activate (overrides `useScenario`).
- `--testTag`: optional tag passed into the runtime context.

---

## Clean code & extensibility

The core of llm-mock is intentionally small and modular:

- `src/plainConfig.js` – converts YAML/JSON configs into the internal DSL.
- `src/dsl.js` – tiny helpers for JS-based configs (`scenario`, `caseWhen`, `httpWhen`).
- `src/scenario.js` – scenario runtime (graph + linear behaviour).
- `src/providers.js` – OpenAI and Gemini request/response helpers.
- `src/findHttpMock.js`, `src/matchPathPattern.js` – HTTP mock resolution.
- `src/middleware.js` – Express router implementing all endpoints.
- `src/vcr.js` – optional request/response recording.
- `src/contracts.js` – optional JSON Schema validation wiring.

You can safely extend behaviour by:

- Adding new `kind` types for scenario steps.
- Expanding guard operators.
- Enhancing HTTP dispatch to fully leverage `httpProfiles`.

---

## License

MIT
