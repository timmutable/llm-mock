import { log } from "./log.js";
import { sleep } from "./util.js";
import { extractVarsLoosely } from "./patterns.js";

/**
 * A single ScenarioRunner instance, created per server (in middleware.js).
 * It reads from config.useScenario + config.scenarios.
 *
 * Supports:
 * - Linear scenarios: { id, steps: [ { kind, reply, delayMs? }, ... ] }
 * - Graph scenarios:  { id, start, steps: { stateId: { branches: [...] , final? }, ... } }
 *
 * Additionally:
 * - Tracks an "active HTTP profile" that can be used by HTTP mocks
 *   (scenario.httpProfile and branch.httpProfile).
 */
export class ScenarioRunner {
  constructor(config) {
    this.config = config;

    // One global session for now; can be extended to per-conversation later.
    this.session = null; // { scenarioId, mode, index?, stateId?, done? }

    // Currently active HTTP profile (string or null).
    // This is derived from the active scenario and the last taken branch.
    this.activeHttpProfile = null;
  }

  /**
   * Resolve the currently configured scenario from config.useScenario.
   */
  activeScenario() {
    const id = this.config.useScenario;
    if (!id) return null;
    return (this.config.scenarios || []).find((s) => s.id === id) || null;
  }

  /**
   * Expose the currently active HTTP profile.
   * This is typically used by the HTTP mock router to choose between
   * global httpMocks and profile-specific httpProfiles.
   */
  getActiveHttpProfile() {
    return this.activeHttpProfile;
  }

  /**
   * Determine if a scenario spec is graph-style (branching) or linear.
   */
  isGraphScenario(sc) {
    return (
      sc && typeof sc.start === "string" && sc.steps && !Array.isArray(sc.steps)
    );
  }

  isLinearScenario(sc) {
    return sc && Array.isArray(sc.steps);
  }

  /**
   * Ensure we have a session for the active scenario, resetting if the id changed.
   *
   * Also seeds the activeHttpProfile from scenario.httpProfile when we first
   * create a session for that scenario.
   */
  ensureSessionFor(sc) {
    if (!this.session || this.session.scenarioId !== sc.id) {
      const mode = this.isGraphScenario(sc)
        ? "graph"
        : this.isLinearScenario(sc)
        ? "linear"
        : "none";

      this.session = {
        scenarioId: sc.id,
        mode,
        index: 0,
        stateId: this.isGraphScenario(sc) ? sc.start : null,
        done: mode === "none",
      };

      // Seed the HTTP profile from the scenario, if defined.
      // Branches can override this later.
      this.activeHttpProfile = sc.httpProfile || null;
    }
    return this.session;
  }

  /**
   * Main entry point used by middleware:
   *
   *   const step = await scenarios.nextStep({ provider, model, text, headers, params });
   *
   * Returns:
   *   - a step object: { kind: "chat" | "tools", reply?, result? }
   *   - or null if no scenario / no matching branch / scenario finished
   */
  async nextStep(ctx = {}) {
    const sc = this.activeScenario();
    if (!sc) return null;

    const session = this.ensureSessionFor(sc);
    if (session.done || session.mode === "none") {
      return null;
    }

    if (session.mode === "graph") {
      return this.nextGraphStep(sc, session, ctx);
    }

    if (session.mode === "linear") {
      return this.nextLinearStep(sc, session);
    }

    return null;
  }

  /**
   * Original linear behavior: walk sc.steps[index++].
   * This assumes config.scenarios[i].steps is an array of step objects:
   *   { kind: "chat" | "tools", reply?, result?, delayMs? }
   */
  async nextLinearStep(sc, session) {
    const steps = sc.steps || [];
    const idx = session.index ?? 0;

    if (idx >= steps.length) {
      session.done = true;
      return null;
    }

    const step = steps[idx];

    // Optional per-step delay (for more realistic demos)
    if (step.delayMs && step.delayMs > 0) {
      await sleep(step.delayMs);
    }

    log("scenario.step", {
      scenarioId: sc.id,
      index: idx,
      kind: step.kind,
      mode: "linear",
    });

    session.index = idx + 1;
    if (session.index >= steps.length) {
      session.done = true;
    }

    return {
      kind: step.kind || "chat",
      reply: step.reply,
      result: step.result,
    };
  }

  /**
   * Graph/branching behavior:
   * - sc.steps is a map: { [stateId]: { branches: [...], final? } }
   * - session.stateId is the current state
   * - ctx.text is the last user text (from the request)
   *
   * Each branch can look like:
   *   {
   *     when: "my last name is {{lastName}}",
   *     if: (vars, ctx) => boolean (optional),
   *     kind: "chat" | "tools",
   *     reply?: string | (args) => string,
   *     result?: any,
   *     next?: "nextStateId",
   *     httpProfile?: "github-fail"       // optional HTTP profile override
   *   }
   *
   * The active HTTP profile is determined as:
   *   - if branch.httpProfile is set, use that
   *   - else if scenario.httpProfile is set, use that
   *   - else keep whatever profile we already had (or null)
   */
  async nextGraphStep(sc, session, ctx) {
    const steps = sc.steps || {};
    const currentId = session.stateId;

    if (!currentId) {
      session.done = true;
      return null;
    }

    const state = steps[currentId];
    if (!state) {
      session.done = true;
      return null;
    }

    // If state is terminal and has no branches, we are done.
    if (state.final && !state.branches) {
      session.done = true;
      return null;
    }

    const branches = state.branches || state;
    const text = ctx.text || "";

    for (let i = 0; i < branches.length; i++) {
      const branch = branches[i];
      const pattern = branch.when;
      if (!pattern) continue;

      const vars = extractVarsLoosely(text, pattern);
      if (!vars) {
        // pattern didn't match
        continue;
      }

      // Optional guard
      if (typeof branch.if === "function") {
        const ok = branch.if(vars, ctx);
        if (!ok) continue;
      }

      // We have a matching branch.

      // 🔴 Update active HTTP profile:
      // - branch-level override wins if present
      // - otherwise use scenario-level default
      // - otherwise keep the current value
      const scenarioProfile = sc.httpProfile || null;
      const branchProfile = branch.httpProfile || null;
      this.activeHttpProfile =
        branchProfile ?? scenarioProfile ?? this.activeHttpProfile ?? null;

      let reply = undefined;
      let result = branch.result;

      if (typeof branch.reply === "function") {
        reply = await branch.reply({
          text,
          vars,
          stateId: currentId,
          branch,
          ctx,
        });
      } else {
        reply = branch.reply;
      }

      const kind = branch.kind || "chat";

      log("scenario.step", {
        scenarioId: sc.id,
        stateId: currentId,
        branchIndex: i,
        kind,
        mode: "graph",
        httpProfile: this.activeHttpProfile || undefined,
      });

      // Optional per-branch delay
      if (branch.delayMs && branch.delayMs > 0) {
        await sleep(branch.delayMs);
      }

      // Move to next state
      if (branch.next) {
        session.stateId = branch.next;
        const nextState = steps[branch.next];
        if (nextState && nextState.final && !nextState.branches) {
          session.done = true;
        }
      } else if (state.final) {
        session.done = true;
      }

      return { kind, reply, result };
    }
    return null;
  }

  /**
   * Inspect the currently active scenario state.
   * Useful for debugging, logging, or external visualization tools.
   *
   * Returns:
   *   {
   *     scenarioId: string | null,
   *     mode: "graph" | "linear" | "none",
   *     stateId: string | null,         // graph mode only
   *     index: number | null,           // linear mode only
   *     done: boolean,
   *     httpProfile: string | null
   *   }
   */
  inspect() {
    if (!this.session) {
      return {
        scenarioId: null,
        mode: "none",
        stateId: null,
        index: null,
        done: true,
        httpProfile: null,
      };
    }

    const { scenarioId, mode, stateId, index, done } = this.session;

    return {
      scenarioId,
      mode,
      stateId: stateId ?? null,
      index: index ?? null,
      done,
      httpProfile: this.activeHttpProfile ?? null,
    };
  }

  reset() {
    this.session = null;
    this.activeHttpProfile = null;
  }
}
