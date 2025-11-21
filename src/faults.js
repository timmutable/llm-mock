import { sleep } from "./util.js";

export function shouldApply(when = {}, context = {}) {
  if (!when) return true;
  if (when.env && context.env !== when.env) return false;
  if (when.testTag && context.testTag !== when.testTag) return false;
  if (when.provider && context.provider !== when.provider) return false;
  if (when.model && context.model !== when.model) return false;
  if (typeof when.stream === "boolean" && !!context.stream !== when.stream)
    return false;
  if (when.headers) {
    for (const [k, v] of Object.entries(when.headers)) {
      if (context.headers?.[k] !== v) return false;
    }
  }
  if (when.params) {
    for (const [k, v] of Object.entries(when.params)) {
      if (context.params?.[k] !== v) return false;
    }
  }
  return true;
}

export function pickFault(faults = [], context = {}) {
  for (const fault of faults) {
    if (!shouldApply(fault.when, context)) continue;
    const ratio = fault.ratio ?? 1;
    if (Math.random() <= ratio) return fault;
  }
  return null;
}

export function latencyMs(profile = {}, context = {}) {
  let mean = profile.meanMs ?? 100;
  let p95 = profile.p95Ms ?? 300;

  if (profile.overrides) {
    for (const override of profile.overrides) {
      if (shouldApply(override.when, context)) {
        mean = override.meanMs ?? mean;
        p95 = override.p95Ms ?? p95;
      }
    }
  }
  const jitter = profile.jitterMs ?? 0;
  const base = mean + ((Math.random() - 0.5) * (p95 - mean)) / 2;
  return Math.max(0, Math.round(base + (jitter ? Math.random() * jitter : 0)));
}

export async function applyFaultOrLatency(
  caseOpt = {},
  context,
  res,
  payloadSender
) {
  const { latency = {}, faults = [] } = caseOpt;
  const delay = latencyMs(latency, context);
  if (delay) await sleep(delay);

  const fault = pickFault(faults, context);
  if (!fault) return await payloadSender();

  switch (fault.kind) {
    case "TIMEOUT":
      return;
    case "HTTP_429": {
      res.status(429);
      if (fault.retryAfterSec)
        res.setHeader("Retry-After", String(fault.retryAfterSec));
      res.json({
        error: fault.body || { message: "rate limited" },
      });
      return;
    }
    case "HTTP_400":
    case "HTTP_401":
    case "HTTP_403":
    case "HTTP_404":
    case "HTTP_409":
    case "HTTP_422":
    case "HTTP_500":
    case "HTTP_502":
    case "HTTP_503": {
      const code = Number(fault.kind.split("_")[1]) || 500;
      res.status(code).json(
        fault.body || {
          error: { message: `mock error ${code}` },
        }
      );
      return;
    }
    case "MALFORMED_JSON": {
      res.setHeader("Content-Type", "application/json");
      res.status(200).end('{"not":"closed"');
      return;
    }
    case "STREAM_DROP_AFTER":
    case "STREAM_DUPLICATE_CHUNK":
      context._fault = fault;
      return await payloadSender();
    default:
      return await payloadSender();
  }
}
