import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import de from "./locales/de.json";
import en from "./locales/en.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";
import ja from "./locales/ja.json";

export const SUPPORTED_LANGUAGES = [
  { code: "en", label: "English" },
  { code: "fr", label: "Français" },
  { code: "es", label: "Español" },
  { code: "de", label: "Deutsch" },
  { code: "ja", label: "日本語" },
] as const;

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]["code"] | "";

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      fr: { translation: fr },
      es: { translation: es },
      de: { translation: de },
      ja: { translation: ja },
    },
    fallbackLng: "en",
    interpolation: { escapeValue: false },
    detection: {
      order: ["navigator"],
      caches: [],
    },
  });

/** Apply a stored language preference. No-op when lang is empty (auto-detect). */
export function applyLanguage(lang: string): void {
  if (!lang) return;
  void i18n.changeLanguage(lang);
}

export default i18n;
