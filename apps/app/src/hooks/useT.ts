/**
 * Translation hook.
 *
 * Every user-visible string in SIAB goes through this. A component that
 * hard-codes English text is a bug — the whole app must switch to Arabic,
 * including error messages and notifications.
 */
import { useTranslation } from 'react-i18next';

export function useT() {
  const { t } = useTranslation();
  return (key: string, params?: Record<string, unknown>): string =>
    t(key, params ?? {}) as string;
}

export function useLocaleInfo() {
  const { i18n } = useTranslation();
  const locale = (i18n.language === 'ar' ? 'ar' : 'en') as 'en' | 'ar';
  return { locale, isRtl: locale === 'ar' };
}
