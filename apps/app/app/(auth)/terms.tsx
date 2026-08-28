/**
 * The Terms gate (§6).
 *
 * The Continue button stays disabled until the user has BOTH scrolled to the
 * bottom and ticked the box. Acceptance is recorded server-side with the
 * version and a timestamp.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Pressable, ScrollView, StyleSheet, Text, View,
  type NativeScrollEvent, type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { theme } from '@siab/core';

import { Button, ErrorState, LoadingState } from '../../src/components/ui';
import { useLocaleInfo, useT } from '../../src/hooks/useT';
import { apiFetch, errorKey } from '../../src/lib/api';
import { useSession } from '../../src/lib/session';

interface TermsResponse {
  terms: { id: string; version: string; body_en: string; body_ar: string };
}

export default function Terms() {
  const t = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { locale } = useLocaleInfo();
  const { refresh } = useSession();

  const [readToEnd, setReadToEnd] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['terms', 'current'],
    queryFn: () => apiFetch<TermsResponse>('/terms/current', { anonymous: true }),
  });

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    // 40px of slack so a rubber-band overscroll or a rounding difference does
    // not leave the button stuck disabled at the very bottom.
    if (layoutMeasurement.height + contentOffset.y >= contentSize.height - 40) {
      setReadToEnd(true);
    }
  };

  const accept = async () => {
    if (!data) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await apiFetch('/terms/accept', { method: 'POST', body: { termsVersionId: data.terms.id } });
      await refresh();
      router.replace('/');
    } catch (err) {
      setSubmitError(errorKey(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading) return <LoadingState />;
  if (error || !data) return <ErrorState messageKey={errorKey(error)} onRetry={() => void refetch()} />;

  const body = locale === 'ar' ? data.terms.body_ar : data.terms.body_en;
  const canContinue = readToEnd && agreed && !submitting;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('terms.title')}</Text>
        <Text style={styles.version}>{t('terms.version', { version: data.terms.version })}</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        onScroll={onScroll}
        scrollEventThrottle={64}
      >
        <Text style={[styles.body, locale === 'ar' && styles.bodyRtl]}>{body}</Text>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + theme.spacing.lg }]}>
        {!readToEnd ? (
          <View style={styles.scrollPrompt}>
            <Ionicons name="arrow-down-circle-outline" size={18} color={theme.color.primary} />
            <Text style={styles.scrollPromptText}>{t('terms.scrollPrompt')}</Text>
          </View>
        ) : null}

        <Pressable
          onPress={() => readToEnd && setAgreed(!agreed)}
          disabled={!readToEnd}
          style={[styles.checkRow, !readToEnd && styles.checkRowDisabled]}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: agreed, disabled: !readToEnd }}
        >
          <View style={[styles.checkbox, agreed && styles.checkboxOn]}>
            {agreed ? <Ionicons name="checkmark" size={16} color={theme.color.onPrimary} /> : null}
          </View>
          <Text style={styles.checkLabel}>{t('terms.agree')}</Text>
        </Pressable>

        {submitError ? <Text style={styles.error}>{t(submitError)}</Text> : null}

        <Button label={t('common.continue')} onPress={accept} disabled={!canContinue} loading={submitting} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.color.background },
  header: { paddingHorizontal: theme.spacing.xl, paddingVertical: theme.spacing.lg },
  title: { fontSize: theme.fontSize.xxl, fontWeight: '700', color: theme.color.text },
  version: { fontSize: theme.fontSize.xs, color: theme.color.textMuted, marginTop: 4 },
  scroll: { flex: 1, borderTopWidth: 1, borderTopColor: theme.color.border },
  scrollContent: { padding: theme.spacing.xl, paddingBottom: theme.spacing.xxl },
  body: { fontSize: theme.fontSize.sm, lineHeight: 24, color: theme.color.text },
  bodyRtl: { textAlign: 'right', writingDirection: 'rtl' },
  footer: {
    paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.lg,
    borderTopWidth: 1, borderTopColor: theme.color.border,
    backgroundColor: theme.color.surface, gap: theme.spacing.md,
  },
  scrollPrompt: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  scrollPromptText: { fontSize: theme.fontSize.sm, color: theme.color.primary },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
  checkRowDisabled: { opacity: 0.4 },
  checkbox: {
    width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: theme.color.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: theme.color.primary },
  checkLabel: { flex: 1, fontSize: theme.fontSize.sm, color: theme.color.text },
  error: { color: theme.color.danger, fontSize: theme.fontSize.sm },
});
