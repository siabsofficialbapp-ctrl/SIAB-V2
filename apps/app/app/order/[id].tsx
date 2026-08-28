/**
 * Order detail — the pipeline, the mutual handover confirmation, and the
 * ±5 rating.
 *
 * The VAT and fee breakdown appears ONLY for the seller. A buyer sees one
 * total, because that is what they pay and what Saudi pricing rules expect.
 */
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  FULFILMENT_PIPELINE, ORDER_STATUS_COLOR, formatMoney, nextStatuses, pendingAction,
  pipelineIndex, theme, type Order, type OrderStatus,
} from '@siab/core';

import { Header } from '../../src/components/Header';
import { ScoreBadge } from '../../src/components/ScoreBadge';
import { Button, Card, Divider, ErrorState, LoadingState } from '../../src/components/ui';
import { useLocaleInfo, useT } from '../../src/hooks/useT';
import { apiFetch, errorKey } from '../../src/lib/api';

export default function OrderDetail() {
  const t = useT();
  const router = useRouter();
  const { locale } = useLocaleInfo();
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['orders', 'detail', id],
    queryFn: async () => {
      const res = await apiFetch<{ orders: (Order & { viewerIsSeller: boolean; viewerHasRated: boolean })[] }>('/orders');
      return res.orders.find((o) => o.id === id) ?? null;
    },
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['orders'] });
    void refetch();
  };

  const advance = useMutation({
    mutationFn: (to: OrderStatus) => apiFetch(`/orders/${id}/advance`, { method: 'POST', body: { to } }),
    onSuccess: invalidate,
    onError: (err) => setActionError(errorKey(err)),
  });

  const confirmHandover = useMutation({
    mutationFn: () => apiFetch<{ ratingOpen: boolean }>(`/orders/${id}/confirm-handover`, { method: 'POST' }),
    onSuccess: invalidate,
    onError: (err) => setActionError(errorKey(err)),
  });

  const rate = useMutation({
    mutationFn: (delta: 5 | -5 | 0) => apiFetch(`/orders/${id}/rate`, { method: 'POST', body: { delta } }),
    onSuccess: invalidate,
    onError: (err) => setActionError(errorKey(err)),
  });

  if (isLoading) return <><Header /><LoadingState /></>;
  if (error || !data) return <><Header /><ErrorState messageKey={errorKey(error)} onRetry={() => void refetch()} /></>;

  const order = data;
  const viewer = order.viewerIsSeller ? 'seller' : 'buyer';
  const action = pendingAction(
    { status: order.status, sellerConfirmedAt: order.sellerConfirmedAt, buyerConfirmedAt: order.buyerConfirmedAt },
    viewer,
    Boolean(order.viewerHasRated),
  );
  const available = nextStatuses(order.status, viewer);
  const statusColor = ORDER_STATUS_COLOR[order.status] ?? theme.color.textMuted;
  const stage = pipelineIndex(order.status);

  return (
    <View style={styles.container}>
      <Header title={t('order.orderRef', { reference: order.reference })} />

      <ScrollView contentContainerStyle={styles.content}>
        {/* Status */}
        <Card>
          <View style={styles.statusHead}>
            <Text style={styles.productTitle}>{order.productTitle}</Text>
            <View style={[styles.statusPill, { backgroundColor: `${statusColor}1A`, borderColor: statusColor }]}>
              <Text style={[styles.statusText, { color: statusColor }]}>{t(`order.status.${order.status}`)}</Text>
            </View>
          </View>

          {order.status !== 'cancelled' ? (
            <View style={styles.timeline}>
              {FULFILMENT_PIPELINE.map((step, i) => {
                const done = i <= stage;
                return (
                  <View key={step} style={styles.timelineRow}>
                    <View style={styles.timelineGutter}>
                      <View style={[styles.timelineDot, done && styles.timelineDotDone]}>
                        {done ? <Ionicons name="checkmark" size={12} color={theme.color.onPrimary} /> : null}
                      </View>
                      {i < FULFILMENT_PIPELINE.length - 1 ? (
                        <View style={[styles.timelineBar, i < stage && styles.timelineBarDone]} />
                      ) : null}
                    </View>
                    <Text style={[styles.timelineLabel, done && styles.timelineLabelDone]}>
                      {t(`order.status.${step}`)}
                    </Text>
                  </View>
                );
              })}
            </View>
          ) : null}
        </Card>

        {/* Handover confirmation */}
        {(order.status === 'delivered' || order.status === 'completed') ? (
          <Card style={styles.handoverCard}>
            <Text style={styles.cardTitle}>{t('handover.explain')}</Text>

            <View style={styles.confirmRow}>
              <ConfirmChip
                label={t('handover.sellerConfirm')}
                done={Boolean(order.sellerConfirmedAt)}
              />
              <ConfirmChip
                label={t('handover.buyerConfirm')}
                done={Boolean(order.buyerConfirmedAt)}
              />
            </View>

            {action === 'confirm_handover' ? (
              <Button
                label={viewer === 'seller' ? t('handover.sellerConfirm') : t('handover.buyerConfirm')}
                onPress={() => confirmHandover.mutate()}
                loading={confirmHandover.isPending}
                icon="checkmark-circle-outline"
              />
            ) : action === 'awaiting_other' ? (
              <Text style={styles.waiting}>
                {viewer === 'seller' ? t('handover.waitingOnBuyer') : t('handover.waitingOnSeller')}
              </Text>
            ) : null}
          </Card>
        ) : null}

        {/* The ±5 rating — only once both have confirmed */}
        {action === 'rate' && order.counterparty ? (
          <Card style={styles.rateCard}>
            <Text style={styles.cardTitle}>{t('score.rateTitle')}</Text>
            <Text style={styles.rateSubtitle}>
              {t('score.ratePrompt', {
                name: (order.counterparty as { stallName?: string }).stallName ?? order.counterparty.displayName,
                reference: order.reference,
              })}
            </Text>

            <View style={styles.rateButtons}>
              <Button
                label={t('score.addFive')}
                onPress={() => rate.mutate(5)}
                icon="add-circle-outline"
                disabled={rate.isPending}
              />
              <Button
                label={t('score.removeFive')}
                onPress={() => rate.mutate(-5)}
                variant="danger"
                icon="remove-circle-outline"
                disabled={rate.isPending}
              />
              <Button
                label={t('common.skip')}
                onPress={() => rate.mutate(0)}
                variant="ghost"
                disabled={rate.isPending}
              />
            </View>
          </Card>
        ) : order.viewerHasRated ? (
          <Card>
            <View style={styles.ratedRow}>
              <Ionicons name="checkmark-circle" size={20} color={theme.color.success} />
              <Text style={styles.ratedText}>{t('score.rated')}</Text>
            </View>
          </Card>
        ) : null}

        {/* Counterparty */}
        {order.counterparty ? (
          <Card onPress={() => router.push(`/profile/${order.counterparty!.id}` as never)}>
            <Text style={styles.cardLabel}>
              {viewer === 'seller' ? t('order.buyer') : t('order.seller')}
            </Text>
            <View style={styles.partyRow}>
              <Text style={styles.partyName}>
                {(order.counterparty as { stallName?: string }).stallName ?? order.counterparty.displayName}
              </Text>
              <ScoreBadge score={order.counterparty.reputationScore} size="sm" />
              <Ionicons name="chevron-forward" size={18} color={theme.color.textMuted} />
            </View>
          </Card>
        ) : null}

        {/* Money */}
        <Card>
          <Text style={styles.cardTitle}>{t('order.breakdown')}</Text>
          <Row label={t('order.quantity')} value={String(order.quantity)} />
          <Row label={t('order.total')} value={formatMoney(order.totalMinor, locale)} strong />

          {/* Seller-only. A buyer never sees a tax line. */}
          {order.viewerIsSeller && order.vatMinor !== undefined ? (
            <>
              <Divider />
              <Row label={t('order.vat')} value={formatMoney(order.vatMinor, locale)} muted />
              <Row label={t('order.platformFee')} value={formatMoney(order.platformFeeMinor ?? 0, locale)} muted />
              <Row
                label={t('order.yourEarnings')}
                value={formatMoney(
                  order.totalMinor - (order.vatMinor ?? 0) - (order.platformFeeMinor ?? 0),
                  locale,
                )}
                strong
              />
            </>
          ) : null}

          <Divider />
          <Row label={t('payment.title')} value={t(`payment.status.${order.paymentStatus}`)} muted />
        </Card>

        {/* Seller pipeline actions */}
        {available.length > 0 ? (
          <Card>
            <Text style={styles.cardTitle}>{t('order.timeline')}</Text>
            <View style={styles.actions}>
              {available.map((to) => (
                <Button
                  key={to}
                  label={t(
                    to === 'confirmed' ? 'order.action.confirm'
                    : to === 'processing' ? 'order.action.process'
                    : to === 'shipped' ? 'order.action.ship'
                    : to === 'delivered' ? 'order.action.deliver'
                    : 'order.action.cancel',
                  )}
                  variant={to === 'cancelled' ? 'ghost' : 'primary'}
                  onPress={() => {
                    if (to === 'cancelled') {
                      Alert.alert(t('order.action.cancel'), t('order.cancelConfirm'), [
                        { text: t('common.cancel'), style: 'cancel' },
                        { text: t('common.confirm'), style: 'destructive', onPress: () => advance.mutate(to) },
                      ]);
                    } else {
                      advance.mutate(to);
                    }
                  }}
                  disabled={advance.isPending}
                />
              ))}
            </View>
          </Card>
        ) : null}

        {/* Safety note — SIAB is not part of what happens when people meet. */}
        <Card style={styles.safety}>
          <View style={styles.safetyHead}>
            <Ionicons name="shield-checkmark-outline" size={18} color={theme.color.warning} />
            <Text style={styles.safetyTitle}>{t('safety.meetingTitle')}</Text>
          </View>
          <Text style={styles.safetyBody}>{t('safety.meetingBody')}</Text>
        </Card>

        {actionError ? <Text style={styles.error}>{t(actionError)}</Text> : null}
      </ScrollView>
    </View>
  );
}

function ConfirmChip({ label, done }: { label: string; done: boolean }) {
  return (
    <View style={[styles.chip, done && styles.chipDone]}>
      <Ionicons
        name={done ? 'checkmark-circle' : 'ellipse-outline'}
        size={16}
        color={done ? theme.color.success : theme.color.textMuted}
      />
      <Text style={[styles.chipText, done && styles.chipTextDone]}>{label}</Text>
    </View>
  );
}

function Row({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, muted && styles.rowMuted]}>{label}</Text>
      <Text style={[styles.rowValue, strong && styles.rowStrong, muted && styles.rowMuted]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.color.background },
  content: { padding: theme.spacing.lg, gap: theme.spacing.md, paddingBottom: theme.spacing.xxl },

  statusHead: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.md, marginBottom: theme.spacing.lg },
  productTitle: { flex: 1, fontSize: theme.fontSize.lg, fontWeight: '700', color: theme.color.text },
  statusPill: { borderWidth: 1, borderRadius: theme.radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  statusText: { fontSize: theme.fontSize.xs, fontWeight: '700' },

  timeline: { gap: 0 },
  timelineRow: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.md },
  timelineGutter: { alignItems: 'center', width: 22 },
  timelineDot: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: theme.color.border,
    alignItems: 'center', justifyContent: 'center', backgroundColor: theme.color.surface,
  },
  timelineDotDone: { backgroundColor: theme.color.primary, borderColor: theme.color.primary },
  timelineBar: { width: 2, height: 22, backgroundColor: theme.color.border },
  timelineBarDone: { backgroundColor: theme.color.primary },
  timelineLabel: { fontSize: theme.fontSize.sm, color: theme.color.textMuted, paddingTop: 2 },
  timelineLabelDone: { color: theme.color.text, fontWeight: '600' },

  handoverCard: { borderColor: theme.color.primary, gap: theme.spacing.md },
  rateCard: { borderColor: theme.color.success, gap: theme.spacing.md },
  cardTitle: { fontSize: theme.fontSize.md, fontWeight: '700', color: theme.color.text },
  cardLabel: { fontSize: theme.fontSize.xs, color: theme.color.textMuted, marginBottom: 6 },
  rateSubtitle: { fontSize: theme.fontSize.sm, color: theme.color.textMuted, lineHeight: 20 },
  rateButtons: { gap: theme.spacing.sm },

  confirmRow: { flexDirection: 'row', gap: theme.spacing.sm, flexWrap: 'wrap' },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: theme.radius.pill,
    borderWidth: 1, borderColor: theme.color.border,
  },
  chipDone: { borderColor: theme.color.success, backgroundColor: '#DCFCE7' },
  chipText: { fontSize: theme.fontSize.xs, color: theme.color.textMuted },
  chipTextDone: { color: theme.color.success, fontWeight: '600' },
  waiting: { fontSize: theme.fontSize.sm, color: theme.color.warning },

  ratedRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  ratedText: { fontSize: theme.fontSize.sm, color: theme.color.text },

  partyRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  partyName: { flex: 1, fontSize: theme.fontSize.md, fontWeight: '600', color: theme.color.text },

  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  rowLabel: { fontSize: theme.fontSize.sm, color: theme.color.text },
  rowValue: { fontSize: theme.fontSize.sm, color: theme.color.text, fontWeight: '500' },
  rowStrong: { fontWeight: '700', fontSize: theme.fontSize.md },
  rowMuted: { color: theme.color.textMuted },

  actions: { gap: theme.spacing.sm, marginTop: theme.spacing.sm },

  safety: { backgroundColor: '#FFFBEB', borderColor: '#FDE68A', gap: 6 },
  safetyHead: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  safetyTitle: { fontSize: theme.fontSize.sm, fontWeight: '700', color: '#92400E' },
  safetyBody: { fontSize: theme.fontSize.xs, color: '#92400E', lineHeight: 18 },

  error: { color: theme.color.danger, fontSize: theme.fontSize.sm, textAlign: 'center' },
});
