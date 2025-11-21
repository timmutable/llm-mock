import { routeToCase, runHandler } from "../router.js";
import { applyFaultOrLatency } from "../faults.js";
import { validatePayload } from "../contracts.js";
import { log } from "../log.js";

/**
 * coreHandleLlmRequest
 * Shared logic for all providers (OpenAI, Gemini, etc).
 */
export async function coreHandleLlmRequest({
  adapter,
  coreRequest,
  config,
  scenarioRunner,
  httpContext, // { req, res } or { headers, params } if you prefer
}) {
  const { providerId, model, text, stream } = coreRequest;

  // Optional contract validation for the request
  const { requestSchema, responseSchema } = adapter.getContracts() || {};
  if (requestSchema) {
    validatePayload(
      "request",
      requestSchema,
      coreRequest.rawBody,
      config.contracts?.mode || "warn"
    );
  }

  log("req.in", { provider: providerId, model, text });

  const scenarioStep = await scenarioRunner.nextStep({
    provider: providerId,
    model,
    text,
    headers: httpContext.req.headers,
    params: httpContext.req.query,
  });

  const context = {
    env: config.env,
    testTag: config.testTag,
    provider: providerId,
    model,
    headers: httpContext.req.headers,
    params: httpContext.req.query,
    stream,
  };

  async function runCore() {
    let coreResult;

    if (scenarioStep) {
      log("scenario.step", {
        provider: providerId,
        stateId: scenarioStep.stateId,
        branchIndex: scenarioStep.branchIndex,
        sequenceIndex: scenarioStep.sequenceIndex,
      });

      coreResult =
        scenarioStep.kind === "tools"
          ? { kind: "tools", result: scenarioStep.result }
          : { kind: "chat", text: scenarioStep.reply ?? "" };
    } else {
      const match = await routeToCase({ text, cfg: config });
      if (match.chosen) {
        log("match", {
          provider: providerId,
          mode: match.mode,
          pattern: match.pattern,
          score: match.score,
          vars: match.vars,
        });
        const outputText = await runHandler(match.chosen, {
          text,
          vars: match.vars,
          model,
          provider: providerId,
          score: match.score,
          matchedPattern: match.pattern,
        });
        coreResult = { kind: "chat", text: outputText };
      } else {
        log("match.none", { provider: providerId });
        coreResult = {
          kind: "chat",
          text:
            config.defaults?.fallback ||
            "Sorry, I don't have a mock for that yet.",
        };
      }
    }

    // Build provider-specific payload
    const wireResponse = adapter.createResponse(coreRequest, coreResult);

    // Optional response contract validation
    if (responseSchema) {
      validatePayload(
        "response",
        responseSchema,
        wireResponse,
        config.contracts?.mode || "warn"
      );
    }

    return wireResponse;
  }

  return applyFaultOrLatency(
    findCaseOptions(config, text),
    context,
    httpContext.res,
    runCore
  );
}

function findCaseOptions(config, text) {
  const c = (config.cases || []).find((cs) =>
    text.toLowerCase().includes(cs.pattern.split("{{")[0].trim().toLowerCase())
  );
  return c?.options || {};
}
