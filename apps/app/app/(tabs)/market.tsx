/**
 * The marketplace.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';

import { theme, type Product } from '@siab/core';

import { Header } from '../../src/components/Header';
import { ProductCard } from '../../src/components/ProductCard';
import { EmptyState, ErrorState, LoadingState } from '../../src/components/ui';
import { useT } from '../../src/hooks/useT';
import { apiFetch, errorKey } from '../../src/lib/api';
import { useSavedProducts } from '../../src/hooks/useSavedProducts';

export default function Market() {
  const t = useT();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { savedIds, toggleSave } = useSavedProducts();

  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ['products', 'market'],
    queryFn: () => apiFetch<{ products: Product[] }>('/products', {
      anonymous: true,
      query: { sort: 'newest', limit: 30 },
    }),
  });

  return (
    <View style={styles.container}>
      <Header title={t('market.title')} />

      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState messageKey={errorKey(error)} onRetry={() => void refetch()} />
      ) : (
        <FlatList
          data={data?.products ?? []}
          keyExtractor={(p) => p.id}
          numColumns={2}
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor={theme.color.primary} />
          }
          ListEmptyComponent={<EmptyState icon="storefront-outline" title={t('empty.products')} />}
          renderItem={({ item }) => (
            <ProductCard
              product={item}
              saved={savedIds.has(item.id)}
              onToggleSave={() => {
                void toggleSave(item.id);
                void queryClient.invalidateQueries({ queryKey: ['saved'] });
              }}
              onPress={() => router.push(`/product/${item.id}` as never)}
            />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.color.background },
  list: { padding: theme.spacing.lg, gap: theme.spacing.md },
  row: { gap: theme.spacing.md },
});
