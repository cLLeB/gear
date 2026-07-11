import { describe, expect, it } from "vitest";
import {
  getModelContextLimit,
  MODEL_PRICING,
  modelSupportsTemperature,
  modelUsesReasoningTokens,
  getModel,
} from "./config";

describe("current frontier models", () => {
  it.each([
    ["gpt-5.6", "openai"],
    ["gpt-5.6-terra", "openai"],
    ["gpt-5.6-luna", "openai"],
    ["claude-fable-5", "anthropic"],
    ["claude-sonnet-5", "anthropic"],
    ["grok-4.5", "xai"],
  ] as const)("resolves %s through %s", (modelId, provider) => {
    expect(getModel(modelId).provider).toBe(provider);
  });

  it.each([
    ["gpt-5.6", 1_050_000],
    ["gpt-5.6-terra", 1_050_000],
    ["gpt-5.6-luna", 1_050_000],
    ["claude-fable-5", 1_000_000],
    ["claude-sonnet-5", 1_000_000],
    ["grok-4.5", 500_000],
    ["claude-opus-4-7", 1_000_000],
  ] as const)("uses the published context limit for %s", (modelId, limit) => {
    expect(getModelContextLimit(modelId)).toBe(limit);
  });

  it.each([
    ["gpt-5.6", 5, 30, 0.5],
    ["gpt-5.6-terra", 2.5, 15, 0.25],
    ["gpt-5.6-luna", 1, 6, 0.1],
    ["claude-fable-5", 10, 50, 1],
    ["claude-sonnet-5", 3, 15, 0.3],
    ["grok-4.5", 2, 6, 0.5],
  ] as const)("prices %s", (modelId, input, output, cacheRead) => {
    expect(MODEL_PRICING[modelId]).toEqual({ input, output, cacheRead });
  });
});

describe("modelSupportsTemperature", () => {
  it.each([
    ["openai", "gpt-5.4-nano"],
    ["openai", "gpt-5.6"],
    ["anthropic", "claude-fable-5"],
    ["anthropic", "claude-sonnet-5"],
  ] as const)("omits temperature for %s/%s", (provider, modelId) => {
    expect(modelSupportsTemperature(provider, modelId)).toBe(false);
  });

  it("keeps temperature for models that accept sampling params", () => {
    expect(modelSupportsTemperature("openai", "gpt-4.1-mini")).toBe(true);
    expect(modelSupportsTemperature("xai", "grok-4.5")).toBe(true);
  });

  it("defaults unknown models to temperature support", () => {
    expect(modelSupportsTemperature("openai-compatible", "custom-model")).toBe(
      true,
    );
  });
});

describe("modelUsesReasoningTokens", () => {
  it.each([
    ["openai", "gpt-5.4-nano"],
    ["openai", "gpt-5.6-luna"],
    ["anthropic", "claude-sonnet-5"],
    ["xai", "grok-4.5"],
    ["groq", "openai/gpt-oss-20b"],
  ] as const)("allocates a reasoning budget for %s/%s", (provider, modelId) => {
    expect(modelUsesReasoningTokens(provider, modelId)).toBe(true);
  });

  it("does not for plain chat models", () => {
    expect(modelUsesReasoningTokens("openai", "gpt-4.1-mini")).toBe(false);
  });
});
