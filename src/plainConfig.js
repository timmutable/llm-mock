// src/plainConfig.js
import { scenario, caseWhen, httpWhen } from "./dsl.js";

/**
 * Convert a plain JSON or YAML configuration object into the
 * internal DSL representation that llm-mock uses.
 *
 * Supported top-level keys:
 * - server
 * - defaults
 * - useScenario
 * - scenarios: [ { id, httpProfile?, start, steps } ]
 * - httpMocks: [ HttpMock ]
 * - httpProfiles: { [profileName: string]: HttpMock[] }
 * - cases: [ Case ]
 *
 * Where:
 * - steps[stateId] is either:
 *   - { final: true }
 *   - or an array of "rules" (branches) for that state.
 */
export function fromPlainConfig(plainConfig) {
  const root = plainConfig || {};

  const scenarios = (root.scenarios || []).map(normalizeScenario);

  // Global HTTP mocks (no profile tag)
  const httpMocks = (root.httpMocks || []).map((mockConfig) =>
    normalizeHttpMock(mockConfig, null),
  );

  // Profile-specific HTTP mocks (each entry tagged with profile name)
  const httpProfiles = {};
  for (const [profileName, mockList] of Object.entries(
    root.httpProfiles || {},
  )) {
    httpProfiles[profileName] = (mockList || []).map((mockConfig) =>
      normalizeHttpMock(mockConfig, profileName),
    );
  }

  return {
    server: root.server || {},
    defaults: root.defaults || {},
    useScenario: root.useScenario,
    scenarios,
    cases: (root.cases || []).map(normalizeCase),
    httpMocks,
    httpProfiles,
  };
}

/**
 * Normalize a single scenario configuration into the shape
 * expected by ScenarioRunner:
 *
 * scenario(id, {
 *   start: "state-id",
 *   httpProfile?: "profile-name",
 *   steps: {
 *     [stateId]: {
 *       final?: boolean,
 *       branches?: Branch[]
 *     }
 *   }
 * })
 */
function normalizeScenario(scenarioConfig) {
  if (!scenarioConfig || !scenarioConfig.id) {
    throw new Error("Scenario must have an 'id'.");
  }

  const scenarioSteps = normalizeScenarioSteps(scenarioConfig.steps || {});

  return scenario(scenarioConfig.id, {
    start: scenarioConfig.start,
    httpProfile: scenarioConfig.httpProfile,
    steps: scenarioSteps,
  });
}

/**
 * stepsConfig: { [stateId]: Rule[] | { final: true } }
 */
function normalizeScenarioSteps(stepsConfig) {
  const normalizedSteps = {};

  for (const [stateId, stateConfig] of Object.entries(stepsConfig || {})) {
    // Final node: steps[stateId] = { final: true }
    if (stateConfig && stateConfig.final) {
      normalizedSteps[stateId] = { final: true };
      continue;
    }

    // Otherwise: steps[stateId] should be an array of rules
    const rules = Array.isArray(stateConfig)
      ? stateConfig
      : stateConfig && Array.isArray(stateConfig.branches)
      ? stateConfig.branches // Backwards compatibility if 'branches' is still present
      : [];

    normalizedSteps[stateId] = {
      branches: rules.map(normalizeBranchRule),
    };
  }

  return normalizedSteps;
}

/**
 * Branch rule:
 *
 * {
 *   when: "pattern {{var}}",
 *   guard?: { op, var, value?, values? },
 *   sequence?: [
 *     { kind?: "chat", reply?, replyTemplate?, delayMs?, fault? },
 *     ...
 *   ],
 *   reply?: string,
 *   replyTemplate?: string,
 *   next?: string,
 *   httpProfile?: string,
 *   delayMs?: number,
 *   fault?: any
 * }
 */
function normalizeBranchRule(ruleConfig) {
  if (!ruleConfig || !ruleConfig.when) {
    throw new Error("Branch rule is missing required 'when' pattern.");
  }

  const branch = {
    when: ruleConfig.when,
    kind: ruleConfig.kind || "chat",
    next: ruleConfig.next,
    httpProfile: ruleConfig.httpProfile,
  };

  // Guard is compiled into a function: (vars, ctx) => boolean
  if (ruleConfig.guard) {
    branch.if = buildGuardFunction(ruleConfig.guard);
  }

  // Sequence of child steps (local linear flow)
  if (Array.isArray(ruleConfig.sequence) && ruleConfig.sequence.length > 0) {
    branch.sequence = ruleConfig.sequence.map(normalizeChildStep);
    return branch;
  }

  // Shorthand: single reply / replyTemplate on the branch
  if (ruleConfig.replyTemplate) {
    branch.reply = ({ vars }) => interpolateTemplate(ruleConfig.replyTemplate, vars);
  } else if (typeof ruleConfig.reply === "string") {
    branch.reply = ruleConfig.reply;
  }

  if (ruleConfig.result !== undefined) {
    branch.result = ruleConfig.result;
  }

  if (ruleConfig.delayMs != null) {
    branch.delayMs = ruleConfig.delayMs;
  }

  if (ruleConfig.fault) {
    branch.fault = ruleConfig.fault;
  }

  return branch;
}

/**
 * Child step in a branch.sequence:
 * {
 *   kind?: "chat",
 *   reply?: string,
 *   replyTemplate?: string,
 *   result?: any,
 *   delayMs?: number,
 *   fault?: any
 * }
 */
function normalizeChildStep(stepConfig) {
  const childStep = {
    kind: stepConfig.kind || "chat",
  };

  if (stepConfig.replyTemplate) {
    childStep.reply = ({ vars }) => interpolateTemplate(stepConfig.replyTemplate, vars);
  } else if (typeof stepConfig.reply === "string") {
    childStep.reply = stepConfig.reply;
  }

  if (stepConfig.result !== undefined) {
    childStep.result = stepConfig.result;
  }

  if (stepConfig.delayMs != null) {
    childStep.delayMs = stepConfig.delayMs;
  }

  if (stepConfig.fault) {
    childStep.fault = stepConfig.fault;
  }

  return childStep;
}

/**
 * CASES
 *
 * cases: [
 *   {
 *     id: "explain-simple",
 *     pattern: "explain {{topic}} simply",
 *     replyTemplate?: "...",
 *     reply?: "..."
 *   }
 * ]
 */
function normalizeCase(caseConfig) {
  if (!caseConfig || !caseConfig.pattern) {
    throw new Error("Case must have a 'pattern'.");
  }

  if (caseConfig.replyTemplate) {
    return caseWhen(caseConfig.pattern, (variables) =>
      interpolateTemplate(caseConfig.replyTemplate, variables),
    );
  }

  if (typeof caseConfig.reply === "string") {
    return caseWhen(caseConfig.pattern, () => caseConfig.reply);
  }

  throw new Error(
    `Case '${caseConfig.id || caseConfig.pattern}' must have 'reply' or 'replyTemplate'.`,
  );
}

/**
 * HTTP MOCKS
 *
 * Global:
 *   httpMocks: [ { ... } ]
 *
 * Profiles:
 *   httpProfiles: {
 *     "github-fail": [ { ... }, ... ]
 *   }
 *
 * Each mock is created via httpWhen(match, handler, options) and
 * tagged with an optional .options.profile so the router can decide
 * which mocks to apply based on the active profile.
 */
function normalizeHttpMock(httpMockConfig, profileName) {
  if (!httpMockConfig || !httpMockConfig.path) {
    throw new Error("httpMock entry must have a 'path'.");
  }

  const httpMethod = (httpMockConfig.method || "GET").toUpperCase();
  const match = {
    method: httpMethod,
    path: httpMockConfig.path,
    profile: profileName || null,
  };

  const options = {};
  if (httpMockConfig.status != null) {
    options.status = httpMockConfig.status;
  }
  if (httpMockConfig.delayMs != null) {
    options.delayMs = httpMockConfig.delayMs;
  }
  if (httpMockConfig.fault) {
    options.fault = httpMockConfig.fault;
  }
  if (profileName) {
    options.profile = profileName;
  }

  const handler =
    httpMockConfig.bodyTemplate != null
      ? ({ params, query, body }) =>
          deepInterpolate(httpMockConfig.bodyTemplate, { params, query, body })
      : ({ params, query, body }) =>
          httpMockConfig.body !== undefined ? httpMockConfig.body : {};

  return httpWhen(match, handler, options);
}

/**
 * Guard mini-DSL:
 *
 * guard:
 *   op: equals | includes | oneOf | matches
 *   var: name
 *   value: "approved"
 *   values: ["approved", "ok"]  # for oneOf
 */
function buildGuardFunction(guardConfig) {
  const operator = guardConfig.op || "equals";
  const variableName = guardConfig.var;

  switch (operator) {
    case "equals":
      return (variables) =>
        String(variables[variableName] ?? "").toLowerCase() ===
        String(guardConfig.value ?? "").toLowerCase();

    case "includes":
      return (variables) =>
        String(variables[variableName] ?? "").toLowerCase().includes(
          String(guardConfig.value ?? "").toLowerCase(),
        );

    case "oneOf":
      return (variables) => {
        const value = String(variables[variableName] ?? "").toLowerCase();
        return (guardConfig.values || []).some(
          (candidate) => value === String(candidate).toLowerCase(),
        );
      };

    case "matches":
      return (variables) => {
        const value = String(variables[variableName] ?? "");
        const regex = new RegExp(guardConfig.value || "");
        return regex.test(value);
      };

    default:
      // Unknown operator - allow everything (no-op guard).
      return () => true;
  }
}

/**
 * Simple {{var}} interpolation like "Hello {{name}}"
 */
function interpolateTemplate(template, variables) {
  return String(template).replace(/{{\s*([\w.]+)\s*}}/g, (_, key) => {
    const value = getByPath(variables, key);
    return value == null ? "" : String(value);
  });
}

/**
 * Deep interpolation for HTTP bodies:
 * e.g. { key: "{{params.id}}", bucket: "mock" }
 */
function deepInterpolate(value, context) {
  if (
    value == null ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "string") {
    return interpolateTemplate(value, context);
  }

  if (Array.isArray(value)) {
    return value.map((item) => deepInterpolate(item, context));
  }

  const result = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    result[key] = deepInterpolate(nestedValue, context);
  }
  return result;
}

function getByPath(object, path) {
  if (!path) {
    return undefined;
  }

  const parts = String(path).split(".");
  let current = object;

  for (const part of parts) {
    if (current == null) {
      return undefined;
    }
    current = current[part];
  }

  return current;
}
