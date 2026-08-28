/**
 * A seller's public stall (§11).
 */
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import { theme, type Product } from '@siab/core';

import { Header } from '../../src/components/Header';
import { ProductCard } from '../../src/components/ProductCard';
import { ScoreBadge } from '../../src/components/ScoreBadge';
import { Button, Card, EmptyState, ErrorState, LoadingState } from '../../src/components/ui';
import { useT } from '../../src/hooks/useT';
import { apiFetch, errorKey } from '../../src/lib/api';
import { useSavedProducts } from '../../src/hooks/useSavedProducts';
import { useSession } from '../../src/lib/session';

interface StallResponse {
  stall: {
    sellerId: string; stallName: string; bio: string | null; logoUrl: string | null;
    bannerUrl: string | null; locationLabel: string | null; displayName: string;
    reputationScore: number; scoreBand: 'red' | 'orange' | 'green' | 'diamond';
  };
  products: Product[];
}

export default function Stall() {
  const t = useT();
  const router = useRouter();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { session, role } = useSession();
  const { savedIds, toggleSave } = useSavedProducts();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['stall', slug],
    queryFn: () => apiFetch<StallResponse>(`/stalls/${slug}`, { anonymous: !session }),
  });

  if (isLoading) return <><Header /><LoadingState /></>;
  if (error || !data) return <><Header /><ErrorState messageKey={errorKey(error)} onRetry={() => void refetch()} /></>;

  const s = data.stall;

  return (
    <View style={styles.container}>
      <Header title={s.stallName} />

      <FlatList
        data={data.products}
        keyExtractor={(p) => p.id}
        numColumns={2}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.headerBlock}>
            {s.bannerUrl ? (
              <Image source={{ uri: s.bannerUrl }} style={styles.banner} contentFit="cover" />
            ) : null}

            <Card style={styles.profileCard}>
              <View style={styles.profileRow}>
                {s.logoUrl ? (
                  <Image source={{ uri: s.logoUrl }} style={styles.logo} contentFit="cover" />
                ) : (
                  <View style={[styles.logo, styles.logoEmpty]}>
                    <Ionicons name="storefront-outline" size={24} color={theme.color.primary} />
                  </View>
                )}
                <View style={styles.profileText}>
                  <Text style={styles.stallName}>{s.stallName}</Text>
                  <ScoreBadge score={s.reputationScore} band={s.scoreBand} size="sm" showLabel />
                </View>
              </View>

              {s.bio ? <Text style={styles.bio}>{s.bio}</Text> : null}

              {s.locationLabel ? (
                <View style={styles.locationRow}>
                  <Ionicons name="location-outline" size={14} color={theme.color.textMuted} />
                  <Text style={styles.location}>{s.locationLabel}</Text>
                </View>
              ) : null}

              {session && role === 'buyer' ? (
                <View style={styles.stallActions}>
                  <Button
                    label={t('product.chatWithSeller')}
                    variant="secondary"
                    icon="chatbubble-outline"
                    onPress={async () => {
                      const res = await apiFetch<{ conversationId: string }>('/conversations', {
                        method: 'POST',
                        body: { sellerId: s.sellerId, kind: 'human' },
                      });
                      router.push(`/conversation/${res.conversationId}` as never);
                    }}
                  />
                  <Button
                    label={t('product.chatWithAi')}
                    variant="ghost"
                    icon="sparkles-outline"
                    onPress={async () => {
                      const res = await apiFetch<{ conversationId: string }>('/conversations', {
                        method: 'POST',
                        body: { sellerId: s.sellerId, kind: 'ai' },
                      });
                      router.push(`/conversation/${res.conversationId}` as never);
                    }}
                  />
                </View>
              ) : null}
            </Card>

            <Text style={styles.productsTitle}>{t('stall.products')}</Text>
          </View>
        }
        ListEmptyComponent={<EmptyState icon="pricetags-outline" title={t('empty.products')} />}
        renderItem={({ item }) => (
          <ProductCard
            product={item}
            saved={savedIds.has(item.id)}
            {...(role === 'buyer' ? { onToggleSave: () => void toggleSave(item.id) } : {})}
            onPress={() => router.push(`/product/${item.id}` as never)}
          />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.color.background },
  list: { padding: theme.spacing.lg, gap: theme.spacing.md },
  row: { gap: theme.spacing.md },
  headerBlock: { gap: theme.spacing.md, marginBottom: theme.spacing.md },
  banner: { width: '100%', height: 120, borderRadius: theme.radius.lg },
  profileCard: { gap: theme.spacing.md },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
  logo: { width: 56, height: 56, borderRadius: 28, backgroundColor: theme.color.surfaceMuted },
  logoEmpty: { alignItems: 'center', justifyContent: 'center', backgroundColor: theme.color.primarySubtle },
  profileText: { flex: 1, gap: 4 },
  stallName: { fontSize: theme.fontSize.lg, fontWeight: '700', color: theme.color.text },
  bio: { fontSize: theme.fontSize.sm, color: theme.color.text, lineHeight: 21 },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  location: { fontSize: theme.fontSize.xs, color: theme.color.textMuted },
  stallActions: { gap: theme.spacing.sm },
  productsTitle: { fontSize: theme.fontSize.lg, fontWeight: '700', color: theme.color.text },
});
