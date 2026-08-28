import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { theme } from '@siab/core';

import { Header } from '../../src/components/Header';
import { ScoreBadge } from '../../src/components/ScoreBadge';
import { EmptyState, ErrorState, LoadingState } from '../../src/components/ui';
import { useT } from '../../src/hooks/useT';
import { apiFetch, errorKey } from '../../src/lib/api';

interface ConversationRow {
  id: string;
  kind: 'human' | 'ai';
  lastMessageAt: string | null;
  stallName: string | null;
  counterparty: { id: string; displayName: string; reputationScore: number; stallName: string | null } | null;
}

export default function Messages() {
  const t = useT();
  const router = useRouter();

  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ['conversations'],
    queryFn: () => apiFetch<{ conversations: ConversationRow[] }>('/conversations'),
  });

  return (
    <View style={styles.container}>
      <Header title={t('chat.title')} />

      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState messageKey={errorKey(error)} onRetry={() => void refetch()} />
      ) : (
        <FlatList
          data={data?.conversations ?? []}
          keyExtractor={(c) => c.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor={theme.color.primary} />
          }
          ListEmptyComponent={<EmptyState icon="chatbubbles-outline" title={t('empty.messages')} />}
          renderItem={({ item }) => {
            const name = item.counterparty?.stallName ?? item.stallName ?? item.counterparty?.displayName ?? '';
            return (
              <Pressable
                onPress={() => router.push(`/conversation/${item.id}` as never)}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              >
                <View style={[styles.avatar, item.kind === 'ai' && styles.avatarAi]}>
                  <Ionicons
                    name={item.kind === 'ai' ? 'sparkles' : 'person-outline'}
                    size={20}
                    color={theme.color.primary}
                  />
                </View>
                <View style={styles.rowText}>
                  <View style={styles.rowTitleLine}>
                    <Text style={styles.rowName} numberOfLines={1}>{name}</Text>
                    {item.kind === 'ai' ? (
                      <View style={styles.aiPill}>
                        <Text style={styles.aiPillText}>{t('chat.aiBadge')}</Text>
                      </View>
                    ) : null}
                  </View>
                  {item.counterparty ? (
                    <ScoreBadge score={item.counterparty.reputationScore} size="sm" />
                  ) : null}
                </View>
                <Ionicons name="chevron-forward" size={18} color={theme.color.textMuted} />
              </Pressable>
            );
          }}
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
  rowPressed: { borderColor: theme.color.primary },
  avatar: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: theme.color.surfaceMuted,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarAi: { backgroundColor: theme.color.primarySubtle, borderWidth: 1, borderStyle: 'dashed', borderColor: theme.color.primary },
  rowText: { flex: 1, gap: 4 },
  rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  rowName: { flex: 1, fontSize: theme.fontSize.md, fontWeight: '600', color: theme.color.text },
  aiPill: { backgroundColor: theme.color.primarySubtle, paddingHorizontal: 8, paddingVertical: 2, borderRadius: theme.radius.pill },
  aiPillText: { fontSize: 10, color: theme.color.primary, fontWeight: '700' },
});
