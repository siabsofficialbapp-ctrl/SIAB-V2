/**
 * The AI Coworker (§14).
 *
 * Private to the seller. It can analyse their business and manage their
 * catalogue. Actions it takes are surfaced explicitly under the reply, so
 * the seller always sees what it actually did — not just what it said.
 */
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from 'react-native';

import { theme } from '@siab/core';

import { Header } from '../../src/components/Header';
import { useT } from '../../src/hooks/useT';
import { apiFetch, errorKey } from '../../src/lib/api';

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  actions?: { name: string; ok: boolean; summary: string }[];
}

const EXAMPLE_KEYS = [
  'ai.coworkerExamples.revenue',
  'ai.coworkerExamples.bestSeller',
  'ai.coworkerExamples.slow',
  'ai.coworkerExamples.compare',
  'ai.coworkerExamples.create',
];

export default function Coworker() {
  const t = useT();
  const queryClient = useQueryClient();
  const scrollRef = useRef<ScrollView>(null);

  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);

  const ask = useMutation({
    mutationFn: (message: string) =>
      apiFetch<{ conversationId: string; reply: string; actions: { name: string; ok: boolean; summary: string }[] }>(
        '/seller/coworker/ask',
        { method: 'POST', body: { message, ...(conversationId ? { conversationId } : {}) } },
      ),
    onSuccess: (res) => {
      setConversationId(res.conversationId);
      setTurns((prev) => [...prev, { role: 'assistant', content: res.reply, actions: res.actions }]);
      // A catalogue change should be visible immediately elsewhere in the app.
      if (res.actions.some((a) => ['create_product', 'update_product', 'delete_product'].includes(a.name))) {
        void queryClient.invalidateQueries({ queryKey: ['seller', 'products'] });
        void queryClient.invalidateQueries({ queryKey: ['products'] });
      }
      void queryClient.invalidateQueries({ queryKey: ['seller', 'analytics'] });
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    },
    onError: (err) => setError(errorKey(err)),
  });

  const send = (text: string) => {
    const message = text.trim();
    if (!message) return;
    setError(null);
    setDraft('');
    setTurns((prev) => [...prev, { role: 'user', content: message }]);
    ask.mutate(message);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Header title={t('ai.coworkerTitle')} />

      <ScrollView ref={scrollRef} contentContainerStyle={styles.content}>
        {turns.length === 0 ? (
          <View style={styles.intro}>
            <View style={styles.introIcon}>
              <Ionicons name="briefcase-outline" size={28} color={theme.color.primary} />
            </View>
            <Text style={styles.introTitle}>{t('ai.coworkerTitle')}</Text>
            <Text style={styles.introBody}>{t('ai.coworkerSubtitle')}</Text>

            <View style={styles.privacyNote}>
              <Ionicons name="lock-closed-outline" size={14} color={theme.color.success} />
              <Text style={styles.privacyText}>{t('ai.privacyNote')}</Text>
            </View>

            <View style={styles.examples}>
              {EXAMPLE_KEYS.map((key) => (
                <Pressable key={key} onPress={() => send(t(key))} style={styles.example}>
                  <Text style={styles.exampleText}>{t(key)}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {turns.map((turn, i) => (
          <View key={i} style={[styles.turn, turn.role === 'user' ? styles.turnUser : styles.turnAi]}>
            <Text style={[styles.turnText, turn.role === 'user' && styles.turnTextUser]}>
              {turn.content}
            </Text>

            {/* What it actually did, not just what it claimed. */}
            {turn.actions?.length ? (
              <View style={styles.actions}>
                {turn.actions.map((a, j) => (
                  <View key={j} style={styles.action}>
                    <Ionicons
                      name={a.ok ? 'checkmark-circle' : 'alert-circle'}
                      size={13}
                      color={a.ok ? theme.color.success : theme.color.danger}
                    />
                    <Text style={styles.actionText}>{a.summary}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        ))}

        {ask.isPending ? (
          <View style={[styles.turn, styles.turnAi, styles.thinking]}>
            <ActivityIndicator size="small" color={theme.color.primary} />
            <Text style={styles.thinkingText}>{t('ai.thinking')}</Text>
          </View>
        ) : null}

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{t(error)}</Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.composer}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={t('ai.coworkerPlaceholder')}
          placeholderTextColor={theme.color.textMuted}
          style={styles.input}
          multiline
        />
        <Pressable
          onPress={() => send(draft)}
          disabled={!draft.trim() || ask.isPending}
          style={[styles.sendButton, (!draft.trim() || ask.isPending) && styles.sendDisabled]}
        >
          <Ionicons name="send" size={18} color={theme.color.onPrimary} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.color.background },
  content: { padding: theme.spacing.lg, gap: theme.spacing.md, paddingBottom: theme.spacing.xl },

  intro: { alignItems: 'center', gap: theme.spacing.md, paddingVertical: theme.spacing.xl },
  introIcon: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: theme.color.primarySubtle,
    alignItems: 'center', justifyContent: 'center',
  },
  introTitle: { fontSize: theme.fontSize.xl, fontWeight: '700', color: theme.color.text },
  introBody: { fontSize: theme.fontSize.sm, color: theme.color.textMuted, textAlign: 'center' },
  privacyNote: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#DCFCE7', paddingHorizontal: theme.spacing.md, paddingVertical: 6,
    borderRadius: theme.radius.pill,
  },
  privacyText: { fontSize: theme.fontSize.xs, color: theme.color.success, fontWeight: '600' },
  examples: { alignSelf: 'stretch', gap: theme.spacing.sm, marginTop: theme.spacing.md },
  example: {
    padding: theme.spacing.md, borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: theme.color.border, backgroundColor: theme.color.surface,
  },
  exampleText: { fontSize: theme.fontSize.sm, color: theme.color.text },

  turn: { padding: theme.spacing.md, borderRadius: theme.radius.lg, maxWidth: '92%' },
  turnUser: { alignSelf: 'flex-end', backgroundColor: theme.color.primary },
  turnAi: {
    alignSelf: 'flex-start', backgroundColor: theme.color.surface,
    borderWidth: 1, borderColor: theme.color.border,
  },
  turnText: { fontSize: theme.fontSize.sm, color: theme.color.text, lineHeight: 22 },
  turnTextUser: { color: theme.color.onPrimary },

  actions: {
    marginTop: theme.spacing.sm, paddingTop: theme.spacing.sm,
    borderTopWidth: 1, borderTopColor: theme.color.border, gap: 4,
  },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actionText: { fontSize: theme.fontSize.xs, color: theme.color.textMuted },

  thinking: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  thinkingText: { fontSize: theme.fontSize.sm, color: theme.color.textMuted },

  errorBox: { backgroundColor: '#FEE2E2', padding: theme.spacing.md, borderRadius: theme.radius.md },
  errorText: { fontSize: theme.fontSize.sm, color: theme.color.danger },

  composer: {
    flexDirection: 'row', alignItems: 'flex-end', gap: theme.spacing.sm,
    padding: theme.spacing.md, borderTopWidth: 1, borderTopColor: theme.color.border,
    backgroundColor: theme.color.surface,
  },
  input: {
    flex: 1, maxHeight: 110, borderWidth: 1, borderColor: theme.color.border,
    borderRadius: theme.radius.lg, paddingHorizontal: theme.spacing.lg, paddingVertical: 10,
    fontSize: theme.fontSize.md, color: theme.color.text,
  },
  sendButton: {
    width: 42, height: 42, borderRadius: 21, backgroundColor: theme.color.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  sendDisabled: { opacity: 0.4 },
});
