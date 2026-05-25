export type GradientCategory = "cool" | "warm" | "dark" | "vibrant";

export interface BuiltinGradient {
  id: string;
  label: string;
  category: GradientCategory;
  css: string;
}

export const BUILTIN_GRADIENTS: BuiltinGradient[] = [
  // Dark
  {
    id: "midnight",
    label: "Midnight",
    category: "dark",
    css: "linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)",
  },
  {
    id: "void",
    label: "Void",
    category: "dark",
    css: "linear-gradient(135deg, #000000 0%, #1a1a2e 50%, #16213e 100%)",
  },
  {
    id: "obsidian",
    label: "Obsidian",
    category: "dark",
    css: "radial-gradient(ellipse at top, #1b2838 0%, #0d0d0d 100%)",
  },
  {
    id: "storm",
    label: "Storm",
    category: "dark",
    css: "linear-gradient(135deg, #1f1c2c 0%, #928dab 100%)",
  },
  // Cool
  {
    id: "aurora",
    label: "Aurora",
    category: "cool",
    css: "linear-gradient(135deg, #0f3460 0%, #16213e 30%, #1a936f 70%, #114b5f 100%)",
  },
  {
    id: "arctic",
    label: "Arctic",
    category: "cool",
    css: "linear-gradient(135deg, #e0eafc 0%, #cfdef3 100%)",
  },
  {
    id: "ocean-deep",
    label: "Ocean Deep",
    category: "cool",
    css: "linear-gradient(135deg, #005c97 0%, #363795 100%)",
  },
  {
    id: "forest-mist",
    label: "Forest Mist",
    category: "cool",
    css: "linear-gradient(135deg, #134e5e 0%, #71b280 100%)",
  },
  // Warm
  {
    id: "sunset",
    label: "Sunset",
    category: "warm",
    css: "linear-gradient(135deg, #f83600 0%, #f9d423 100%)",
  },
  {
    id: "ember",
    label: "Ember",
    category: "warm",
    css: "linear-gradient(135deg, #ff416c 0%, #ff4b2b 100%)",
  },
  {
    id: "golden-hour",
    label: "Golden Hour",
    category: "warm",
    css: "linear-gradient(135deg, #f7971e 0%, #ffd200 100%)",
  },
  {
    id: "coral-reef",
    label: "Coral Reef",
    category: "warm",
    css: "linear-gradient(135deg, #ff9a9e 0%, #fad0c4 50%, #ffecd2 100%)",
  },
  // Vibrant
  {
    id: "synthwave",
    label: "Synthwave",
    category: "vibrant",
    css: "linear-gradient(135deg, #2d1b69 0%, #11998e 50%, #f953c6 100%)",
  },
  {
    id: "neon-pulse",
    label: "Neon Pulse",
    category: "vibrant",
    css: "linear-gradient(135deg, #12c2e9 0%, #f64f59 50%, #c471ed 100%)",
  },
  {
    id: "cotton-candy",
    label: "Cotton Candy",
    category: "vibrant",
    css: "linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)",
  },
];

export const GRADIENT_CATEGORIES: { id: GradientCategory | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "dark", label: "Dark" },
  { id: "cool", label: "Cool" },
  { id: "warm", label: "Warm" },
  { id: "vibrant", label: "Vibrant" },
];

export function getGradientById(id: string): BuiltinGradient | undefined {
  return BUILTIN_GRADIENTS.find((g) => g.id === id);
}
