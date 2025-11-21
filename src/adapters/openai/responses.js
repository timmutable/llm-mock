import {
  extractUserTextFromResponses,
  responsesShape,
} from "../../providers.js";

export const openaiResponsesAdapter = {
  id: "openai.responses",
  routes: ["/v1/responses", "/responses"],

  matchesRequest(req) {
    const path = req.path || "";
    return this.routes.includes(path) && req.method === "POST";
  },

  toCoreRequest(req) {
    const body = req.body || {};
    return {
      providerId: this.id,
      model: body.model || "llm-mock",
      text: extractUserTextFromResponses(body) || "",
      rawBody: body,
      stream: !!body.stream,
    };
  },

  createResponse(coreRequest, coreResult) {
    const text =
      coreResult.kind === "chat" ? coreResult.text : "[mock tools result]";

    return responsesShape({
      model: coreRequest.model,
      text,
    });
  },

  getContracts() {
    return {
      requestSchema: "openai.responses.request",
      responseSchema: "openai.responses.response",
    };
  },
};
