// Palette commands for Gear Wrapped.

import { openWrapped } from "./store";

export const WRAPPED_ACTIONS = [
  { id: "wrapped.year", label: "Gear Wrapped: Your year in Gear", keywords: ["wrapped", "recap", "year in review", "stats", "fun", "persona", "story"], run: () => openWrapped("year") },
  { id: "wrapped.month", label: "Gear Wrapped: This month so far", keywords: ["wrapped", "recap", "month", "stats", "fun"], run: () => openWrapped("month") },
];
