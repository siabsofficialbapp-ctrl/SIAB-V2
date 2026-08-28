/**
 * Orders, with the pipeline tabs of §17.
 */
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ORDER_TABS, theme, type Order, type OrderTab } from '@siab/core';

import { Header } from '../../src/components/Header';
import { OrderCard } from '../../src/components/OrderCard';
import { EmptyState, ErrorState, LoadingState } from '../../src/components/ui';
import { useT } from '../../src/hooks/useT';
import { apiFetch, errorKey } from '../../src/lib/api';

export default function Orders() {
  const t = useT();
  const router = useRouter();
  const [tab, setTab] = useState<OrderTab>('all');

  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ['orders', tab],
    queryFn: () => apiFetch<{ orders: Order[] }>('/orders', { query: { status: tab } }),
  });

  return (
    <View style={styles.container}>
      <Header title={t('order.title')} />

      <View style={styles.tabsWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
          {ORDER_TABS.map((key) => (
            <Pressable
              key={key}
              onPress={() => setTab(key)}
              style={[styles.tab, tab === key && styles.tabActive]}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === key }}
            >
              <Text style={[styles.tabLabel, tab === key && styles.tabLabelActive]}>
                {t(`order.tabs.${key}`)}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState messageKey={errorKey(error)} onRetry={() => void refetch()} />
      ) : (
        <FlatList
          data={data?.orders ?? []}
          keyExtractor={(o) => o.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor={theme.color.primary} />
          }
          ListEmptyComponent={<EmptyState icon="receipt-outline" title={t('empty.orders')} />}
          renderItem={({ item }) => (
            <OrderCard order={item} onPress={() => router.push(`/order/${item.id}` as never)} />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.color.background },
  tabsWrap: { borderBottomWidth: 1, borderBottomColor: theme.color.border, backgroundColor: theme.color.surface },
  tabs: { paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.md, gap: theme.spacing.sm },
  tab: {
    paddingHorizontal: theme.spacing.lg, paddingVertical: 8, borderRadius: theme.radius.pill,
    borderWidth: 1, borderColor: theme.color.border,
  },
  tabActive: { backgroundColor: theme.color.primary, borderColor: theme.color.primary },
  tabLabel: { fontSize: theme.fontSize.sm, color: theme.color.textMuted, fontWeight: '500' },
  tabLabelActive: { color: theme.color.onPrimary, fontWeight: '700' },
  list: { padding: theme.spacing.lg, gap: theme.spacing.md },
});
