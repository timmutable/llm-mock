// src/adapters/types.js
export class LlmAdapter {
  /** A stable identifier used in logs and scenarios (e.g. "openai.chat") */
  id;

  /** Called by router/middleware to see if this adapter handles this route. */
  matchesRequest(_req) {
    return false;
  }

  /** Extract a normalized request from the provider’s wire format. */
  toCoreRequest(_req) {
    /** @type {import("../core/types.js").CoreLlmRequest} */
    throw new Error("not implemented");
  }

  /** Build provider-specific JSON from the core result. */
  createResponse(_coreRequest, _coreResult) {
    throw new Error("not implemented");
  }

  /** Optional contract names for validation. */
  getContracts() {
    return {
      requestSchema: null,
      responseSchema: null
    };
  }
}
