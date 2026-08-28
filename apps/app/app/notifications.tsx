/**
 * Notifications (§26).
 *
 * Rows carry translation KEYS, so a notification written while the app was
 * in English still reads correctly after switching to Arabic.
 */
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { theme, type Notification } from '@siab/core';

import { Header } from '../src/components/Header';
import { EmptyState, ErrorState, LoadingState } from '../src/components/ui';
import { useT } from '../src/hooks/useT';
import { apiFetch, errorKey } from '../src/lib/api';

const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  message: 'chatbubble-outline',
  bid_received: 'pricetag-outline',
  bid_accepted: 'checkmark-circle-outline',
  bid_rejected: 'close-circle-outline',
  bid_countered: 'swap-horizontal-outline',
  order_placed: 'receipt-outline',
  order_status: 'sync-outline',
  handover_confirm_required: 'hand-left-outline',
  reputation_received: 'star-outline',
  system: 'information-circle-outline',
};

export default function Notifications() {
  const t = useT();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => apiFetch<{ notifications: Notification[]; unread: number }>('/notifications'),
  });

  const markRead = useMutation({
    mutationFn: (id: string) => apiFetch(`/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const open = (n: Notification) => {
    if (!n.readAt) markRead.mutate(n.id);
    if (!n.target) return;
    const { screen, id } = n.target;
    if (screen === 'order' && id) router.push(`/order/${id}` as never);
    else if (screen === 'conversation' && id) router.push(`/conversation/${id}` as never);
    else if (screen === 'bid') router.push('/(tabs)/orders' as never);
  };

  return (
    <View style={styles.container}>
      <Header title={t('nav.notifications')} />

      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState messageKey={errorKey(error)} onRetry={() => void refetch()} />
      ) : (
        <FlatList
          data={data?.notifications ?? []}
          keyExtractor={(n) => n.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor={theme.color.primary} />
          }
          ListEmptyComponent={<EmptyState icon="notifications-outline" title={t('empty.notifications')} />}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => open(item)}
              style={({ pressed }) => [styles.row, !item.readAt && styles.rowUnread, pressed && styles.rowPressed]}
            >
              <View style={[styles.icon, !item.readAt && styles.iconUnread]}>
                <Ionicons
                  name={ICONS[item.kind] ?? 'notifications-outline'}
                  size={18}
                  color={item.readAt ? theme.color.textMuted : theme.color.primary}
                />
              </View>
              <View style={styles.rowText}>
                <Text style={[styles.title, !item.readAt && styles.titleUnread]}>
                  {t(item.titleKey, item.params)}
                </Text>
                <Text style={styles.body} numberOfLines={2}>
                  {t(item.bodyKey, item.params)}
                </Text>
              </View>
              {!item.readAt ? <View style={styles.dot} /> : null}
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.color.background },
  list: { padding: theme.spacing.lg, gap: theme.spacing.sm },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md,
    padding: theme.spacing.lg, borderRadius: theme.radius.lg,
    backgroundColor: theme.color.surface, borderWidth: 1, borderColor: theme.color.border,
  },
  rowUnread: { borderColor: theme.color.primary, backgroundColor: theme.color.primarySubtle },
  rowPressed: { opacity: 0.9 },
  icon: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: theme.color.surfaceMuted,
    alignItems: 'center', justifyContent: 'center',
  },
  iconUnread: { backgroundColor: theme.color.surface },
  rowText: { flex: 1, gap: 2 },
  title: { fontSize: theme.fontSize.sm, color: theme.color.text },
  titleUnread: { fontWeight: '700' },
  body: { fontSize: theme.fontSize.xs, color: theme.color.textMuted, lineHeight: 17 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.color.primary },
});
