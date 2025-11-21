import { extractUserTextFromOpenAI, openAIResponse } from "../../providers.js";

export const openaiChatAdapter = {
  id: "openai.chat",
  routes: ["/v1/chat/completions", "/chat/completions"],

  matchesRequest(req) {
    const path = req.path || "";
    return this.routes.includes(path) && req.method === "POST";
  },

  toCoreRequest(req) {
    const body = req.body || {};
    return {
      providerId: this.id,
      model: body.model || "llm-mock",
      text: extractUserTextFromOpenAI(body) || "",
      rawBody: body,
      stream: !!body.stream,
    };
  },

  createResponse(coreRequest, coreResult) {
    if (coreResult.kind === "tools") {
      // You can add tool call shapes here if you want later
      return openAIResponse({
        model: coreRequest.model,
        text: "[mock tools result]",
      });
    }

    return openAIResponse({
      model: coreRequest.model,
      text: coreResult.text,
    });
  },

  getContracts() {
    return {
      requestSchema: "openai.chat.completions.request",
      responseSchema: "openai.chat.completions.response",
    };
  },
};
