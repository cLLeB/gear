// One-shot completions with the user's selected model, for small AI helpers
// outside the chat (command suggestions, explanations). Mirrors how the
// commit-message generator builds its model, without React hooks.

import { getModel, modelSupportsTemperature, providerNeedsKey } from "@/modules/ai/config";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { usePreferencesStore } from "@/modules/settings/preferences";

/** Why AI can't be used right now, or null when a model is configured. */
export function oneShotUnavailableReason(): string | null {
  const chat = useChatStore.getState();
  const prefs = usePreferencesStore.getState();
  const model = getModel(chat.selectedModelId);
  if (providerNeedsKey(model.provider) && !chat.apiKeys[model.provider]) return "Connect an AI provider in Settings → Models";
  const missing =
    (model.id === "lmstudio-local" && !prefs.lmstudioModelId.trim()) ||
    (model.id === "mlx-local" && !prefs.mlxModelId.trim()) ||
    (model.id === "ollama-local" && !prefs.ollamaModelId.trim()) ||
    (model.id === "openai-compatible-custom" && (!prefs.openaiCompatibleBaseURL.trim() || !prefs.openaiCompatibleModelId.trim())) ||
    (model.id === "openrouter-custom" && !prefs.openrouterModelId.trim());
  return missing ? "Pick a model for the selected local/custom provider in Settings → Models" : null;
}

export async function generateOneShot(options: {
  system: string;
  prompt: string;
  maxOutputTokens?: number;
  temperature?: number;
}): Promise<string> {
  const [{ buildConfiguredLanguageModel }, { generateText }] = await Promise.all([import("./agent"), import("ai")]);
  const chat = useChatStore.getState();
  const prefs = usePreferencesStore.getState();
  const modelId = chat.selectedModelId;
  const model = await buildConfiguredLanguageModel(modelId, chat.apiKeys, {
    lmstudioBaseURL: prefs.lmstudioBaseURL,
    lmstudioModelId: prefs.lmstudioModelId,
    mlxBaseURL: prefs.mlxBaseURL,
    mlxModelId: prefs.mlxModelId,
    ollamaBaseURL: prefs.ollamaBaseURL,
    ollamaModelId: prefs.ollamaModelId,
    openaiCompatibleBaseURL: prefs.openaiCompatibleBaseURL,
    openaiCompatibleModelId: prefs.openaiCompatibleModelId,
    openrouterModelId: prefs.openrouterModelId,
  });
  const supportsTemperature = modelSupportsTemperature(getModel(modelId).provider, modelId);
  const result = await generateText({
    model,
    system: options.system,
    prompt: options.prompt,
    maxOutputTokens: options.maxOutputTokens ?? 400,
    ...(supportsTemperature && options.temperature !== undefined ? { temperature: options.temperature } : {}),
  });
  return result.text;
}
