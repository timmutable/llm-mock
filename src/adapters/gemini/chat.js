import {
  extractUserTextFromGemini,
  geminiResponseShape,
} from "../../providers.js";

export const geminiAdapter = {
  id: "gemini.chat",
  routes: [
    '/v1/models/:model:generateContent',
    '/v1alpha/models/:model:generateContent',
    '/v1beta/models/:model:generateContent',
  ],


  matchesRequest(req) {
    const path = req.path || "";
    const isGenerate =
      /\/v1(beta|alpha)?\/models\/.+:generateContent$/.test(path) ||
      /\/v1\/models\/.+:generateContent$/.test(path);
    return isGenerate && req.method === "POST";
  },

  toCoreRequest(req) {
    const body = req.body || {};
    return {
      providerId: this.id,
      model: body.model || "gemini-2.5-flash",
      text: extractUserTextFromGemini(body) || "",
      rawBody: body,
      stream: !!body.stream,
    };
  },

  createResponse(coreRequest, coreResult) {
    const text =
      coreResult.kind === "chat"
        ? coreResult.text
        : "[mock tools result]";

    return geminiResponseShape({
      model: coreRequest.model,
      text,
    });
  },

  getContracts() {
    return {
      requestSchema: "gemini.generateContent.request",
      responseSchema: "gemini.generateContent.response",
    };
  },
};
