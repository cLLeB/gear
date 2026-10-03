import { FEATURE_DEFAULTS, type FeatureKey, type FeatureValues } from "./featureSettings";
import { usePreferencesStore } from "./preferences";

/** Reactive read of one feature setting. */
export function useFeature<K extends FeatureKey>(key: K): FeatureValues[K] {
  return usePreferencesStore(
    (s) => (s.featureSettings?.[key] ?? FEATURE_DEFAULTS[key]) as FeatureValues[K],
  );
}

/** Non-reactive read, for event handlers and module-level listeners. */
export function getFeature<K extends FeatureKey>(key: K): FeatureValues[K] {
  const values = usePreferencesStore.getState().featureSettings;
  return (values?.[key] ?? FEATURE_DEFAULTS[key]) as FeatureValues[K];
}
