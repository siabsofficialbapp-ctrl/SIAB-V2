/**
 * Seller Insights & Analytics (§16).
 *
 * Every figure comes from the API, which computes it from real orders. There
 * is no placeholder number anywhere on this screen — a new seller correctly
 * sees zeros.
 */
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { formatMoney, theme, type SellerAnalytics } from '@siab/core';

import { Header } from '../../src/components/Header';
import { ScoreBadge } from '../../src/components/ScoreBadge';
import { Card, ErrorState, LoadingState } from '../../src/components/ui';
import { useLocaleInfo, useT } from '../../src/hooks/useT';
import { apiFetch, errorKey } from '../../src/lib/api';

interface AnalyticsResponse {
  analytics: SellerAnalytics;
  recentOrders: { id: string; reference: string; productTitle: string; totalMinor: number; status: string }[];
}

export default function Insights() {
  const t = useT();
  const router = useRouter();
  const { locale } = useLocaleInfo();

  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ['seller', 'analytics'],
    queryFn: () => apiFetch<AnalyticsResponse>('/seller/analytics'),
  });

  if (isLoading) return <><Header /><LoadingState /></>;
  if (error || !data) return <><Header /><ErrorState messageKey={errorKey(error)} onRetry={() => void refetch()} /></>;

  const a = data.analytics;
  const nothingYet = a.completedOrders === 0 && a.stallViews === 0;

  return (
    <View style={styles.container}>
      <Header title={t('insights.title')} />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor={theme.color.primary} />
        }
      >
        {/* Headline */}
        <Card style={styles.hero}>
          <Text style={styles.heroLabel}>{t('insights.revenue')}</Text>
          <Text style={styles.heroValue}>{formatMoney(a.revenueMinor, locale)}</Text>
          <View style={styles.heroFoot}>
            <Text style={styles.heroSub}>
              {t('insights.netProfit')}: {formatMoney(a.netProfitMinor, locale)}
            </Text>
            <ScoreBadge score={a.reputationScore} band={a.scoreBand} size="sm" />
          </View>
        </Card>

        {nothingYet ? (
          <Card style={styles.noDataCard}>
            <Ionicons name="bar-chart-outline" size={22} color={theme.color.primary} />
            <Text style={styles.noDataText}>{t('insights.noData')}</Text>
          </Card>
        ) : null}

        {/* Grid */}
        <View style={styles.grid}>
          <Stat icon="cart-outline" label={t('insights.averageOrder')} value={formatMoney(a.averageOrderMinor, locale)} />
          <Stat icon="checkmark-done-outline" label={t('order.title')} value={String(a.completedOrders)} />
          <Stat icon="chatbubbles-outline" label={t('insights.conversations')} value={String(a.buyerConversations)} />
          <Stat icon="eye-outline" label={t('insights.stallViews')} value={String(a.stallViews)} />
          <Stat icon="pricetags-outline" label={t('insights.activeProducts')} value={String(a.activeProducts)} />
          <Stat icon="wallet-outline" label={t('insights.costs')} value={formatMoney(a.costsMinor, locale)} />
        </View>

        {/* Breakdown */}
        <Card>
          <Text style={styles.cardTitle}>{t('order.breakdown')}</Text>
          <Row label={t('insights.revenue')} value={formatMoney(a.revenueMinor, locale)} />
          <Row label={t('order.vat')} value={`− ${formatMoney(a.vatMinor, locale)}`} muted />
          <Row label={t('order.platformFee')} value={`− ${formatMoney(a.platformFeeMinor, locale)}`} muted />
          <Row label={t('insights.costs')} value={`− ${formatMoney(a.costsMinor, locale)}`} muted />
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>{t('insights.netProfit')}</Text>
            <Text style={styles.totalValue}>{formatMoney(a.netProfitMinor, locale)}</Text>
          </View>
        </Card>

        {/* Recent orders */}
        {data.recentOrders.length ? (
          <Card>
            <Text style={styles.cardTitle}>{t('insights.recentOrders')}</Text>
            {data.recentOrders.map((o) => (
              <View key={o.id} style={styles.recentRow}>
                <View style={styles.recentText}>
                  <Text style={styles.recentTitle} numberOfLines={1}>{o.productTitle}</Text>
                  <Text style={styles.recentRef}>{o.reference} · {t(`order.status.${o.status}`)}</Text>
                </View>
                <Text style={styles.recentAmount}>{formatMoney(o.totalMinor, locale)}</Text>
              </View>
            ))}
          </Card>
        ) : null}

        {/* Say plainly where these numbers come from. */}
        <Text style={styles.computedNote}>{t('insights.computedNote')}</Text>
      </ScrollView>
    </View>
  );
}

function Stat({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Ionicons name={icon} size={18} color={theme.color.primary} />
      <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      <Text style={styles.statLabel} numberOfLines={2}>{label}</Text>
    </View>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, muted && styles.rowMuted]}>{label}</Text>
      <Text style={[styles.rowValue, muted && styles.rowMuted]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.color.background },
  content: { padding: theme.spacing.lg, gap: theme.spacing.md, paddingBottom: theme.spacing.xxl },

  hero: { backgroundColor: theme.color.primary, borderColor: theme.color.primary, gap: 4 },
  heroLabel: { fontSize: theme.fontSize.xs, color: 'rgba(255,255,255,0.85)', fontWeight: '600' },
  heroValue: { fontSize: 34, fontWeight: '700', color: theme.color.onPrimary },
  heroFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: theme.spacing.sm },
  heroSub: { fontSize: theme.fontSize.sm, color: 'rgba(255,255,255,0.9)' },

  noDataCard: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, backgroundColor: theme.color.primarySubtle, borderColor: theme.color.primary },
  noDataText: { flex: 1, fontSize: theme.fontSize.sm, color: theme.color.text, lineHeight: 20 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.md },
  stat: {
    flexBasis: '31%', flexGrow: 1,
    backgroundColor: theme.color.surface, borderRadius: theme.radius.lg,
    borderWidth: 1, borderColor: theme.color.border,
    padding: theme.spacing.md, gap: 4, alignItems: 'flex-start',
  },
  statValue: { fontSize: theme.fontSize.lg, fontWeight: '700', color: theme.color.text },
  statLabel: { fontSize: 11, color: theme.color.textMuted, lineHeight: 14 },

  cardTitle: { fontSize: theme.fontSize.md, fontWeight: '700', color: theme.color.text, marginBottom: theme.spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  rowLabel: { fontSize: theme.fontSize.sm, color: theme.color.text },
  rowValue: { fontSize: theme.fontSize.sm, color: theme.color.text, fontWeight: '500' },
  rowMuted: { color: theme.color.textMuted },
  totalRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    borderTopWidth: 1, borderTopColor: theme.color.border,
    marginTop: theme.spacing.sm, paddingTop: theme.spacing.md,
  },
  totalLabel: { fontSize: theme.fontSize.md, fontWeight: '700', color: theme.color.text },
  totalValue: { fontSize: theme.fontSize.lg, fontWeight: '700', color: theme.color.primary },

  recentRow: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md,
    paddingVertical: theme.spacing.sm, borderTopWidth: 1, borderTopColor: theme.color.border,
  },
  recentText: { flex: 1, gap: 2 },
  recentTitle: { fontSize: theme.fontSize.sm, fontWeight: '600', color: theme.color.text },
  recentRef: { fontSize: theme.fontSize.xs, color: theme.color.textMuted },
  recentAmount: { fontSize: theme.fontSize.sm, fontWeight: '700', color: theme.color.text },

  computedNote: { fontSize: theme.fontSize.xs, color: theme.color.textMuted, textAlign: 'center', paddingHorizontal: theme.spacing.lg },
});
