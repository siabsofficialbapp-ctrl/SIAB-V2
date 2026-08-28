/**
 * SIAB localisation.
 *
 * Two rules the codebase depends on:
 *   1. No user-visible string is written inline in a component. Everything
 *      resolves through `t()`.
 *   2. `en` and `ar` always have identical key sets — enforced by a test, so
 *      a missing Arabic string fails CI rather than silently falling back.
 */
import i18next, { type i18n as I18nInstance } from 'i18next';

import en from './locales/en.json' with { type: 'json' };
import ar from './locales/ar.json' with { type: 'json' };

export const SUPPORTED_LOCALES = ['en', 'ar'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

/** Locales that lay out right-to-left. */
const RTL_LOCALES = new Set<Locale>(['ar']);

export function isRtl(locale: Locale): boolean {
  return RTL_LOCALES.has(locale);
}

export function textDirection(locale: Locale): 'ltr' | 'rtl' {
  return isRtl(locale) ? 'rtl' : 'ltr';
}

export const resources = {
  en: { translation: en },
  ar: { translation: ar },
} as const;

export function isSupportedLocale(value: string): value is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * Picks the best supported locale for a device. Accepts anything —
 * 'ar-SA', 'ar', 'en-GB' — and never throws.
 */
export function resolveLocale(preferred: string | null | undefined): Locale {
  if (!preferred) return DEFAULT_LOCALE;
  const base = preferred.toLowerCase().split(/[-_]/)[0] ?? '';
  return isSupportedLocale(base) ? base : DEFAULT_LOCALE;
}

let instance: I18nInstance | null = null;

export function initI18n(locale: Locale = DEFAULT_LOCALE): I18nInstance {
  if (instance) {
    if (instance.language !== locale) void instance.changeLanguage(locale);
    return instance;
  }
  const i18n = i18next.createInstance();
  void i18n.init({
    lng: locale,
    fallbackLng: DEFAULT_LOCALE,
    resources,
    interpolation: { escapeValue: false }, // React Native escapes for us
    returnNull: false,
  });
  instance = i18n;
  return i18n;
}

export function getI18n(): I18nInstance {
  return instance ?? initI18n();
}

/**
 * Formats a date in the active locale. Arabic uses the Gregorian calendar
 * with Arabic month names, which is what Saudi commerce actually uses day to
 * day — not the Hijri calendar.
 */
export function formatDate(iso: string, locale: Locale = DEFAULT_LOCALE): string {
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SA-u-ca-gregory' : 'en-GB', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(iso));
}

export function formatDateTime(iso: string, locale: Locale = DEFAULT_LOCALE): string {
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SA-u-ca-gregory' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}

export function formatNumber(value: number, locale: Locale = DEFAULT_LOCALE): string {
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-SA' : 'en-SA').format(value);
}

export { en, ar };
