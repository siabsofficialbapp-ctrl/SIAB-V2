/**
 * Localisation bootstrap, including layout direction.
 *
 * Arabic must flip the whole layout, not just the text. On native that means
 * I18nManager; on web it means the `dir` attribute. Both are handled here so
 * no screen has to think about it.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Localization from 'expo-localization';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { I18nManager, Platform } from 'react-native';

import { DEFAULT_LOCALE, resolveLocale, resources, type Locale } from '@siab/i18n';

const STORAGE_KEY = 'siab.locale';

/** The user's saved choice, falling back to the device language. */
export async function loadLocale(): Promise<Locale> {
  try {
    const saved = await AsyncStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'ar') return saved;
  } catch {
    // Storage unavailable (private browsing, cleared data) — fall through.
  }
  return resolveLocale(Localization.getLocales()[0]?.languageTag ?? null);
}

export async function saveLocale(locale: Locale): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Not fatal: the language still applies for this session.
  }
}

/**
 * Applies text direction.
 *
 * Returns true when a native restart is required. React Native cannot flip
 * an already-rendered tree reliably, so the caller tells the user rather
 * than leaving the layout half-flipped.
 */
export function applyDirection(locale: Locale): { needsRestart: boolean } {
  const shouldBeRtl = locale === 'ar';

  if (Platform.OS === 'web') {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('dir', shouldBeRtl ? 'rtl' : 'ltr');
      document.documentElement.setAttribute('lang', locale);
    }
    return { needsRestart: false };
  }

  if (I18nManager.isRTL !== shouldBeRtl) {
    I18nManager.allowRTL(shouldBeRtl);
    I18nManager.forceRTL(shouldBeRtl);
    return { needsRestart: true };
  }
  return { needsRestart: false };
}

let started = false;

export async function initI18n(): Promise<Locale> {
  const locale = await loadLocale();

  if (!started) {
    await i18next.use(initReactI18next).init({
      lng: locale,
      fallbackLng: DEFAULT_LOCALE,
      resources,
      interpolation: { escapeValue: false },
      returnNull: false,
      compatibilityJSON: 'v4',
    });
    started = true;
  } else {
    await i18next.changeLanguage(locale);
  }

  applyDirection(locale);
  return locale;
}

export async function changeLocale(locale: Locale): Promise<{ needsRestart: boolean }> {
  await saveLocale(locale);
  await i18next.changeLanguage(locale);
  return applyDirection(locale);
}
