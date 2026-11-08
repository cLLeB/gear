// Palette commands for the typing effects.

import { toast } from "sonner";
import { setFeatureSetting } from "@/modules/settings/store";
import { getFeature } from "@/modules/settings/useFeature";
import type { SparkStyle } from "./typingSparks";

const ORDER: SparkStyle[] = ["off", "sparks", "rainbow", "fire"];
const NAMES: Record<SparkStyle, string> = { off: "Off", sparks: "Theme sparks", rainbow: "Rainbow", fire: "Fire" };

async function cycleSparks() {
  const now = getFeature("effects.typingSparks") as SparkStyle;
  const next = ORDER[(ORDER.indexOf(now) + 1) % ORDER.length];
  await setFeatureSetting("effects.typingSparks", next);
  toast(`Typing sparks: ${NAMES[next]}`);
}

async function toggleCombo() {
  const next = !getFeature("effects.typingCombo");
  await setFeatureSetting("effects.typingCombo", next);
  toast(next ? "Combo counter on" : "Combo counter off");
}

export const EFFECT_ACTIONS = [
  {
    id: "effects.cycleSparks",
    label: "Effects: Cycle typing sparks (off, theme, rainbow, fire)",
    keywords: ["sparks", "particles", "power mode", "fun", "typing", "effects", "fire", "rainbow"],
    run: () => void cycleSparks(),
  },
  {
    id: "effects.toggleCombo",
    label: "Effects: Toggle typing combo counter",
    keywords: ["combo", "streak", "power mode", "fun", "typing", "effects"],
    run: () => void toggleCombo(),
  },
];
