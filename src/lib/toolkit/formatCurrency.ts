export interface CurrencyOptions {
  /** ISO 4217 currency code. Defaults to "USD". */
  currency?: string;
  /** BCP-47 locale. */
  locale?: string;
  /** Override fraction digits (defaults to the currency's standard). */
  digits?: number;
}

/**
 * Format a numeric amount as localized currency using Intl.NumberFormat.
 * Falls back to a plain "code amount" string if the runtime lacks the locale.
 */
export function formatCurrency(amount: number, options: CurrencyOptions = {}): string {
  const { currency = "USD", locale, digits } = options;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      ...(digits !== undefined ? { minimumFractionDigits: digits, maximumFractionDigits: digits } : {}),
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(digits ?? 2)}`;
  }
}
