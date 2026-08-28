/**
 * Product page (§9).
 *
 * Two clearly separated ways to talk: to the seller, or to the seller's AI.
 * The AI route is visually distinct so nobody mistakes it for the person.
 */
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View,
} from 'react-native';

import { formatMoney, riyalsToMinor, theme, type Product } from '@siab/core';

import { Header } from '../../src/components/Header';
import { ScoreBadge } from '../../src/components/ScoreBadge';
import { Button, Card, ErrorState, LoadingState } from '../../src/components/ui';
import { useLocaleInfo, useT } from '../../src/hooks/useT';
import { apiFetch, errorKey } from '../../src/lib/api';
import { useSavedProducts } from '../../src/hooks/useSavedProducts';
import { useSession } from '../../src/lib/session';

export default function ProductDetail() {
  const t = useT();
  const router = useRouter();
  const { locale } = useLocaleInfo();
  const { width } = useWindowDimensions();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session, role } = useSession();
  const { savedIds, toggleSave } = useSavedProducts();

  const [imageIndex, setImageIndex] = useState(0);
  const [showOffer, setShowOffer] = useState(false);
  const [offer, setOffer] = useState('');
  const [offerMessage, setOfferMessage] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['product', id],
    queryFn: () => apiFetch<{ product: Product }>(`/products/${id}`, { anonymous: true }),
  });

  const startChat = useMutation({
    mutationFn: async (kind: 'human' | 'ai') => {
      const res = await apiFetch<{ conversationId: string }>('/conversations', {
        method: 'POST',
        body: { sellerId: data!.product.sellerId, productId: id, kind },
      });
      return res.conversationId;
    },
    onSuccess: (conversationId) => router.push(`/conversation/${conversationId}` as never),
    onError: (err) => setActionError(errorKey(err)),
  });

  const placeBid = useMutation({
    mutationFn: () =>
      apiFetch('/bids', {
        method: 'POST',
        body: {
          productId: id,
          amountMinor: riyalsToMinor(Number(offer)),
          ...(offerMessage.trim() ? { message: offerMessage.trim() } : {}),
        },
      }),
    onSuccess: () => { setShowOffer(false); setOffer(''); setOfferMessage(''); },
    onError: (err) => setActionError(errorKey(err)),
  });

  const buyNow = useMutation({
    mutationFn: () =>
      apiFetch<{ orderId: string }>('/orders', { method: 'POST', body: { productId: id, quantity: 1 } }),
    onSuccess: (res) => router.push(`/order/${res.orderId}` as never),
    onError: (err) => setActionError(errorKey(err)),
  });

  if (isLoading) return <><Header /><LoadingState /></>;
  if (error || !data) return <><Header /><ErrorState messageKey={errorKey(error)} onRetry={() => void refetch()} /></>;

  const p = data.product;
  const isMine = session?.user.id === p.sellerId;
  const canBuy = Boolean(session) && role === 'buyer' && !isMine && p.quantity > 0;
  const saved = savedIds.has(p.id);

  return (
    <View style={styles.container}>
      <Header title={p.title} />

      <ScrollView contentContainerStyle={styles.content}>
        {/* Gallery */}
        <View style={styles.gallery}>
          {p.images.length ? (
            <>
              <ScrollView
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                onMomentumScrollEnd={(e) =>
                  setImageIndex(Math.round(e.nativeEvent.contentOffset.x / width))
                }
              >
                {p.images.map((img) => (
                  <Image
                    key={img.id}
                    source={{ uri: img.url }}
                    style={{ width, height: width }}
                    contentFit="cover"
                    transition={150}
                  />
                ))}
              </ScrollView>
              {p.images.length > 1 ? (
                <View style={styles.dots}>
                  {p.images.map((img, i) => (
                    <View key={img.id} style={[styles.dot, i === imageIndex && styles.dotActive]} />
                  ))}
                </View>
              ) : null}
            </>
          ) : (
            <View style={[styles.noImage, { width, height: width * 0.6 }]}>
              <Ionicons name="image-outline" size={40} color={theme.color.textMuted} />
            </View>
          )}
        </View>

        <View style={styles.body}>
          {/* One price. VAT is inside it and is never itemised for a buyer. */}
          <View style={styles.priceRow}>
            <Text style={styles.price}>{formatMoney(p.priceMinor, locale)}</Text>
            {role === 'buyer' ? (
              <Pressable onPress={() => void toggleSave(p.id)} hitSlop={10} style={styles.saveButton}>
                <Ionicons
                  name={saved ? 'bookmark' : 'bookmark-outline'}
                  size={22}
                  color={saved ? theme.color.primary : theme.color.text}
                />
              </Pressable>
            ) : null}
          </View>

          <Text style={styles.title}>{p.title}</Text>

          <View style={styles.metaRow}>
            <View style={[styles.stockPill, p.quantity > 0 ? styles.stockIn : styles.stockOut]}>
              <Text style={[styles.stockText, p.quantity > 0 ? styles.stockTextIn : styles.stockTextOut]}>
                {p.quantity > 0 ? t('product.quantityLeft', { count: p.quantity }) : t('product.soldOut')}
              </Text>
            </View>
            {p.locationLabel ? (
              <View style={styles.metaItem}>
                <Ionicons name="location-outline" size={14} color={theme.color.textMuted} />
                <Text style={styles.metaText}>{p.locationLabel}</Text>
              </View>
            ) : null}
          </View>

          {p.description ? (
            <Card>
              <Text style={styles.sectionLabel}>{t('product.description')}</Text>
              <Text style={styles.description}>{p.description}</Text>
            </Card>
          ) : null}

          {/* Seller — tapping opens their public profile */}
          {p.seller ? (
            <Card onPress={() => router.push(`/stall/${p.seller!.stallSlug}` as never)}>
              <Text style={styles.sectionLabel}>{t('product.seller')}</Text>
              <View style={styles.sellerRow}>
                {p.seller.logoUrl ? (
                  <Image source={{ uri: p.seller.logoUrl }} style={styles.sellerLogo} contentFit="cover" />
                ) : (
                  <View style={[styles.sellerLogo, styles.sellerLogoEmpty]}>
                    <Ionicons name="storefront-outline" size={18} color={theme.color.primary} />
                  </View>
                )}
                <View style={styles.sellerText}>
                  <Text style={styles.sellerName}>{p.seller.stallName}</Text>
                  {'reputationScore' in p.seller && typeof p.seller.reputationScore === 'number' ? (
                    <ScoreBadge score={p.seller.reputationScore} size="sm" showLabel />
                  ) : null}
                </View>
                <Ionicons name="chevron-forward" size={18} color={theme.color.textMuted} />
              </View>
            </Card>
          ) : null}

          {/* Talk to a person, or talk to the AI — clearly different things */}
          {!isMine && session ? (
            <View style={styles.chatButtons}>
              <Button
                label={t('product.chatWithSeller')}
                onPress={() => startChat.mutate('human')}
                variant="secondary"
                icon="chatbubble-outline"
                disabled={startChat.isPending}
              />
              <Pressable
                onPress={() => startChat.mutate('ai')}
                disabled={startChat.isPending}
                style={({ pressed }) => [styles.aiButton, pressed && styles.aiButtonPressed]}
              >
                <Ionicons name="sparkles" size={18} color={theme.color.primary} />
                <View style={styles.aiButtonText}>
                  <Text style={styles.aiButtonLabel}>{t('product.chatWithAi')}</Text>
                  <Text style={styles.aiButtonBadge}>{t('chat.aiBadge')}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={theme.color.primary} />
              </Pressable>
            </View>
          ) : null}

          {actionError ? <Text style={styles.error}>{t(actionError)}</Text> : null}
        </View>
      </ScrollView>

      {/* Buy / offer */}
      {canBuy ? (
        <View style={styles.footer}>
          {p.allowBidding ? (
            <Button
              label={t('product.makeOffer')}
              onPress={() => setShowOffer(true)}
              variant="secondary"
              style={styles.footerButton}
            />
          ) : null}
          <Button
            label={t('product.buyNow')}
            onPress={() => buyNow.mutate()}
            loading={buyNow.isPending}
            style={styles.footerButton}
          />
        </View>
      ) : null}

      <Modal visible={showOffer} transparent animationType="slide" onRequestClose={() => setShowOffer(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setShowOffer(false)}>
          <Pressable onPress={(e) => e.stopPropagation()} style={styles.sheet}>
            <Text style={styles.sheetTitle}>{t('bid.title')}</Text>
            <Text style={styles.sheetHint}>
              {t('bid.listedAt', { price: formatMoney(p.priceMinor, locale) })}
            </Text>
            {p.minBidMinor ? (
              <Text style={styles.sheetHint}>
                {t('bid.tooLow', { price: formatMoney(p.minBidMinor, locale) })}
              </Text>
            ) : null}

            <TextInput
              value={offer}
              onChangeText={(v) => setOffer(v.replace(/[^0-9.]/g, ''))}
              placeholder={t('bid.yourOffer')}
              placeholderTextColor={theme.color.textMuted}
              keyboardType="decimal-pad"
              style={styles.sheetInput}
            />
            <TextInput
              value={offerMessage}
              onChangeText={setOfferMessage}
              placeholder={t('bid.message')}
              placeholderTextColor={theme.color.textMuted}
              multiline
              style={[styles.sheetInput, styles.sheetTextarea]}
            />

            <Button
              label={t('bid.submit')}
              onPress={() => placeBid.mutate()}
              loading={placeBid.isPending}
              disabled={!offer || Number(offer) <= 0}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.color.background },
  content: { paddingBottom: theme.spacing.xxl },
  gallery: { position: 'relative', backgroundColor: theme.color.surfaceMuted },
  noImage: { alignItems: 'center', justifyContent: 'center' },
  dots: { position: 'absolute', bottom: 12, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.6)' },
  dotActive: { backgroundColor: theme.color.primary, width: 18 },

  body: { padding: theme.spacing.lg, gap: theme.spacing.md },
  priceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  price: { fontSize: theme.fontSize.xxl, fontWeight: '700', color: theme.color.primary },
  saveButton: { padding: 6 },
  title: { fontSize: theme.fontSize.xl, fontWeight: '700', color: theme.color.text, lineHeight: 30 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, flexWrap: 'wrap' },
  stockPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: theme.radius.pill, borderWidth: 1 },
  stockIn: { backgroundColor: '#DCFCE7', borderColor: theme.color.success },
  stockOut: { backgroundColor: '#FEE2E2', borderColor: theme.color.danger },
  stockText: { fontSize: theme.fontSize.xs, fontWeight: '600' },
  stockTextIn: { color: theme.color.success },
  stockTextOut: { color: theme.color.danger },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: theme.fontSize.xs, color: theme.color.textMuted },

  sectionLabel: { fontSize: theme.fontSize.xs, color: theme.color.textMuted, marginBottom: 6, fontWeight: '600' },
  description: { fontSize: theme.fontSize.sm, color: theme.color.text, lineHeight: 22 },

  sellerRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
  sellerLogo: { width: 44, height: 44, borderRadius: 22, backgroundColor: theme.color.surfaceMuted },
  sellerLogoEmpty: { alignItems: 'center', justifyContent: 'center', backgroundColor: theme.color.primarySubtle },
  sellerText: { flex: 1, gap: 4 },
  sellerName: { fontSize: theme.fontSize.md, fontWeight: '600', color: theme.color.text },

  chatButtons: { gap: theme.spacing.sm },
  aiButton: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md,
    padding: theme.spacing.lg, borderRadius: theme.radius.md,
    borderWidth: 1, borderStyle: 'dashed', borderColor: theme.color.primary,
    backgroundColor: theme.color.primarySubtle,
  },
  aiButtonPressed: { opacity: 0.85 },
  aiButtonText: { flex: 1 },
  aiButtonLabel: { fontSize: theme.fontSize.md, fontWeight: '600', color: theme.color.primary },
  aiButtonBadge: { fontSize: theme.fontSize.xs, color: theme.color.textMuted },

  footer: {
    flexDirection: 'row', gap: theme.spacing.md,
    padding: theme.spacing.lg, borderTopWidth: 1, borderTopColor: theme.color.border,
    backgroundColor: theme.color.surface,
  },
  footerButton: { flex: 1 },

  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: theme.color.surface, padding: theme.spacing.xl,
    borderTopLeftRadius: theme.radius.xl, borderTopRightRadius: theme.radius.xl, gap: theme.spacing.md,
  },
  sheetTitle: { fontSize: theme.fontSize.xl, fontWeight: '700', color: theme.color.text },
  sheetHint: { fontSize: theme.fontSize.xs, color: theme.color.textMuted },
  sheetInput: {
    borderWidth: 1, borderColor: theme.color.border, borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.lg, paddingVertical: 12,
    fontSize: theme.fontSize.md, color: theme.color.text,
  },
  sheetTextarea: { minHeight: 80, textAlignVertical: 'top' },
  error: { color: theme.color.danger, fontSize: theme.fontSize.sm },
});
