/**
 * An order, redesigned from scratch.
 *
 * The old design buried the state. This one leads with the one thing that
 * matters — what is happening now and what YOU have to do about it — then
 * the pipeline, then the money.
 */
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  FULFILMENT_PIPELINE, ORDER_STATUS_COLOR, formatMoney, pendingAction, pipelineIndex,
  theme, type Order, type OrderStatus,
} from '@siab/core';

import { useLocaleInfo, useT } from '../hooks/useT';
import { ScoreBadge } from './ScoreBadge';

interface OrderCardProps {
  order: Order & { viewerIsSeller?: boolean; viewerHasRated?: boolean };
  onPress: () => void;
}

export function OrderCard({ order, onPress }: OrderCardProps) {
  const t = useT();
  const { locale } = useLocaleInfo();

  const viewer = order.viewerIsSeller ? 'seller' : 'buyer';
  const action = pendingAction(
    {
      status: order.status,
      sellerConfirmedAt: order.sellerConfirmedAt,
      buyerConfirmedAt: order.buyerConfirmedAt,
    },
    viewer,
    Boolean(order.viewerHasRated),
  );

  const statusColor = ORDER_STATUS_COLOR[order.status] ?? theme.color.textMuted;
  const stage = pipelineIndex(order.status);

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      {/* What you must do, if anything — the loudest thing on the card. */}
      {action === 'confirm_handover' ? (
        <View style={[styles.callout, styles.calloutAction]}>
          <Ionicons name="hand-left-outline" size={16} color={theme.color.onPrimary} />
          <Text style={styles.calloutActionText}>
            {viewer === 'seller' ? t('handover.sellerPrompt') : t('handover.buyerPrompt')}
          </Text>
        </View>
      ) : action === 'rate' ? (
        <View style={[styles.callout, styles.calloutRate]}>
          <Ionicons name="star-outline" size={16} color={theme.color.onPrimary} />
          <Text style={styles.calloutActionText}>{t('score.rateTitle')}</Text>
        </View>
      ) : action === 'awaiting_other' ? (
        <View style={[styles.callout, styles.calloutWaiting]}>
          <Ionicons name="hourglass-outline" size={16} color={theme.color.warning} />
          <Text style={styles.calloutWaitingText}>
            {viewer === 'seller' ? t('handover.waitingOnBuyer') : t('handover.waitingOnSeller')}
          </Text>
        </View>
      ) : null}

      <View style={styles.head}>
        <View style={styles.headText}>
          <Text style={styles.reference}>{order.reference}</Text>
          <Text style={styles.product} numberOfLines={1}>{order.productTitle}</Text>
        </View>
        <View style={[styles.statusPill, { backgroundColor: `${statusColor}1A`, borderColor: statusColor }]}>
          <Text style={[styles.statusText, { color: statusColor }]}>
            {t(`order.status.${order.status}`)}
          </Text>
        </View>
      </View>

      {/* Pipeline tracker — four dots, filled to the current stage. */}
      {order.status !== 'cancelled' && order.status !== 'awaiting_payment' ? (
        <View style={styles.pipeline}>
          {FULFILMENT_PIPELINE.map((step: OrderStatus, i) => {
            const done = i <= stage;
            return (
              <View key={step} style={styles.pipelineStep}>
                <View style={styles.pipelineTrack}>
                  {i > 0 ? <View style={[styles.pipelineLine, done && styles.pipelineLineDone]} /> : <View style={styles.pipelineSpacer} />}
                  <View style={[styles.pipelineDot, done && styles.pipelineDotDone]}>
                    {done ? <Ionicons name="checkmark" size={10} color={theme.color.onPrimary} /> : null}
                  </View>
                  {i < FULFILMENT_PIPELINE.length - 1
                    ? <View style={[styles.pipelineLine, i < stage && styles.pipelineLineDone]} />
                    : <View style={styles.pipelineSpacer} />}
                </View>
                <Text style={[styles.pipelineLabel, done && styles.pipelineLabelDone]} numberOfLines={1}>
                  {t(`order.tabs.${step}`)}
                </Text>
              </View>
            );
          })}
        </View>
      ) : null}

      <View style={styles.foot}>
        <View style={styles.party}>
          {order.counterparty ? (
            <>
              <Text style={styles.partyLabel}>
                {viewer === 'seller' ? t('order.buyer') : t('order.seller')}
              </Text>
              <Text style={styles.partyName} numberOfLines={1}>
                {(order.counterparty as { stallName?: string }).stallName ?? order.counterparty.displayName}
              </Text>
              <ScoreBadge score={order.counterparty.reputationScore} size="sm" />
            </>
          ) : null}
        </View>
        <Text style={styles.total}>{formatMoney(order.totalMinor, locale)}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.color.border,
    overflow: 'hidden',
  },
  pressed: { borderColor: theme.color.primary },

  callout: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, paddingHorizontal: theme.spacing.lg, paddingVertical: 10 },
  calloutAction: { backgroundColor: theme.color.primary },
  calloutRate: { backgroundColor: theme.color.success },
  calloutWaiting: { backgroundColor: '#FEF3C7' },
  calloutActionText: { flex: 1, color: theme.color.onPrimary, fontSize: theme.fontSize.xs, fontWeight: '600' },
  calloutWaitingText: { flex: 1, color: '#92400E', fontSize: theme.fontSize.xs, fontWeight: '600' },

  head: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.md, padding: theme.spacing.lg, paddingBottom: theme.spacing.md },
  headText: { flex: 1, gap: 2 },
  reference: { fontSize: theme.fontSize.xs, color: theme.color.textMuted, fontWeight: '600', letterSpacing: 0.5 },
  product: { fontSize: theme.fontSize.md, fontWeight: '700', color: theme.color.text },
  statusPill: { borderWidth: 1, borderRadius: theme.radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  statusText: { fontSize: theme.fontSize.xs, fontWeight: '700' },

  pipeline: { flexDirection: 'row', paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.md },
  pipelineStep: { flex: 1, alignItems: 'center', gap: 4 },
  pipelineTrack: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch' },
  pipelineLine: { flex: 1, height: 2, backgroundColor: theme.color.border },
  pipelineLineDone: { backgroundColor: theme.color.primary },
  pipelineSpacer: { flex: 1 },
  pipelineDot: {
    width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: theme.color.border,
    backgroundColor: theme.color.surface, alignItems: 'center', justifyContent: 'center',
  },
  pipelineDotDone: { backgroundColor: theme.color.primary, borderColor: theme.color.primary },
  pipelineLabel: { fontSize: 10, color: theme.color.textMuted },
  pipelineLabelDone: { color: theme.color.primary, fontWeight: '600' },

  foot: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.md,
    borderTopWidth: 1, borderTopColor: theme.color.border, backgroundColor: theme.color.surfaceMuted,
  },
  party: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  partyLabel: { fontSize: theme.fontSize.xs, color: theme.color.textMuted },
  partyName: { fontSize: theme.fontSize.sm, fontWeight: '600', color: theme.color.text, maxWidth: 120 },
  total: { fontSize: theme.fontSize.lg, fontWeight: '700', color: theme.color.text },
});
