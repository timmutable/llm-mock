import { define, caseWhen, scenario, httpWhen } from "../src/dsl.js";

export default define({
  server: {
    port: 11434,
    stream: false
  },
  env: "local",
  seed: 42,
  matching: {
    order: ["pattern-regex", "pattern", "fuzzy"],
    fuzzy: { threshold: 0.38 },
  },
  scenarios: [
    scenario("checkout-graph", {
      start: "collect-name",
      steps: {
        "collect-name": {
          branches: [
            {
              when: "How does AI work?",
              if: ({ names }) =>
                (names || "").toLowerCase().includes("declined"),
              kind: "chat",
              reply: "I'm sorry, your application has been declined (mock).",
              next: "end-declined",
            },
            {
              when: "my name is {{name}}",
              if: ({ names }) =>
                (names || "").toLowerCase().includes("approved"),
              kind: "chat",
              reply: "Great news, your application is approved (mock)!",
              next: "end-approved",
            },
            {
              when: "my name is {{name}}",
              kind: "chat",
              reply: ({ vars: { name } }) =>
                `Thanks ${name}, let's continue your application, what is your address?`,
              next: "collect-address",
            },
          ],
        },

        "collect-address": {
          branches: [
            {
              when: "my address is {{address}}",
              kind: "chat",
              reply: ({ vars: { address }}) => `Got it. Your application review is in progress, we will send a written response to ${address}`,
              next: "end-pending",
            },
          ],
        },
        "end-declined": { final: true },
        "end-approved": { final: true },
        "end-pending": { final: true },
      },
    }),
    scenario("checkout-linear", {
      seed: 1337,
      steps: [
        {
          kind: "chat",
          user: "priming",
          reply: "You are a shopping assistant.",
        },
        {
          kind: "chat",
          user: "find me a red jacket under $100",
          reply: "I found 3 jackets under $100. Which size?",
        },
        {
          kind: "tools",
          call: {
            name: "search_catalog",
            arguments: { color: "red", max_price: 100 },
          },
          result: [{ sku: "RJ-001", price: 89.99 }],
        },
        {
          kind: "chat",
          user: "buy the medium one",
          error: { code: 502, body: { error: "gateway_unavailable" } },
        },
        {
          kind: "chat",
          user: "retry purchase",
          reply: "Order placed. Confirmation #MOCK123.",
        },
      ],
    }),
  ],

  contracts: { provider: "openai", version: "2025-06-01", mode: "warn" },

  defaults: { fallback: "Sorry, I don't have a mock for that yet." },
});
