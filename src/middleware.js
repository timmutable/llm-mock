import express from "express";
import cors from "cors";

import { withReqId } from "./log.js";
import { ScenarioRunner } from "./scenario.js";
import { findHttpMock } from "./findHttpMock.js";
import { coreHandleLlmRequest } from "./core/engine.js";

// Adapters
import { openaiChatAdapter } from "./adapters/openai/chat.js";
import { openaiResponsesAdapter } from "./adapters/openai/responses.js";
import { geminiAdapter } from "./adapters/gemini/chat.js";

const llmAdapters = [openaiChatAdapter, openaiResponsesAdapter, geminiAdapter];

export async function createLlmMockRouter(config) {
  const router = express.Router();
  const scenarios = new ScenarioRunner(config);

  router.use(cors());
  router.use(express.json({ limit: "2mb" }));
  router.use(withReqId);

  // Core LLM handler - covers all supported providers

  const llmRoutes = [];
  llmAdapters.forEach((adapter) => llmRoutes.push(...adapter.routes));

  router.post(llmRoutes, async (req, res) => {
    const adapter = llmAdapters.find((candidate) =>
      candidate.matchesRequest(req)
    );

    if (!adapter) {
      return res
        .status(404)
        .json({ error: "No adapter for this LLM endpoint." });
    }

    const coreRequest = adapter.toCoreRequest(req);

    const wireResponse = await coreHandleLlmRequest({
      adapter,
      coreRequest,
      config,
      scenarioRunner: scenarios,
      httpContext: { req, res },
    });

    return res.json(wireResponse);
  });

  // HTTP mocks
  router.all("*", (req, res) => {
    const activeProfile = scenarioRunner.getActiveHttpProfile();

    const profileMocks =
      activeProfile && config.httpProfiles
        ? config.httpProfiles[activeProfile] || []
        : [];

    const globalMocks = config.httpMocks || [];

    // Profile mocks first so they shadow the global ones
    const allMocks = [...profileMocks, ...globalMocks];

    const match = findHttpMock(
      [
        ...(allMocks || []),
        // flattened active profile mocks will be layered in here later,
        // once you propagate httpProfile from ScenarioRunner
      ],
      req
    );

    if (!match) {
      return res.status(404).json({
        error: "No mock defined for this HTTP request.",
      });
    }

    const { mock, params } = match;
    const { handler, options = {} } = mock;
    const statusCode = options.status || 200;
    const body = handler({
      params,
      query: req.query,
      body: req.body,
    });

    res.status(statusCode).json(body);
  });

  return router;
}
