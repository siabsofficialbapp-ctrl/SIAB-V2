/**
 * Teaching the Customer AI (§12).
 *
 * Nothing here retrains a model. Knowledge is stored and retrieved per
 * request, so an edit is live on the very next buyer message.
 */
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { theme } from '@siab/core';

import { Header } from '../../src/components/Header';
import { Button, Card, ErrorState, Field, LoadingState } from '../../src/components/ui';
import { useT } from '../../src/hooks/useT';
import { apiFetch, errorKey } from '../../src/lib/api';

type Tone = 'friendly' | 'professional' | 'concise' | 'detailed' | 'casual';
const TONES: Tone[] = ['friendly', 'professional', 'concise', 'detailed', 'casual'];

interface Settings {
  enabled: boolean; tone: Tone; instructions: string | null;
  greetingEn: string | null; greetingAr: string | null;
  fallbackBehaviour: 'defer_to_seller' | 'say_unknown';
}
interface Knowledge {
  id: string; title: string; content: string; category: string; isActive: boolean;
}

export default function Assistant() {
  const t = useT();
  const queryClient = useQueryClient();

  const [instructions, setInstructions] = useState('');
  const [greeting, setGreeting] = useState('');
  const [editing, setEditing] = useState<Knowledge | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftContent, setDraftContent] = useState('');
  const [error, setError] = useState<string | null>(null);

  const settingsQuery = useQuery({
    queryKey: ['seller', 'ai', 'settings'],
    queryFn: () => apiFetch<{ settings: Settings }>('/seller/ai/settings'),
  });
  const knowledgeQuery = useQuery({
    queryKey: ['seller', 'ai', 'knowledge'],
    queryFn: () => apiFetch<{ knowledge: Knowledge[] }>('/seller/ai/knowledge'),
  });

  useEffect(() => {
    if (!settingsQuery.data) return;
    setInstructions(settingsQuery.data.settings.instructions ?? '');
    setGreeting(settingsQuery.data.settings.greetingEn ?? '');
  }, [settingsQuery.data]);

  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch('/seller/ai/settings', { method: 'PATCH', body }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['seller', 'ai', 'settings'] }),
    onError: (err) => setError(errorKey(err)),
  });

  const saveKnowledge = useMutation({
    mutationFn: () => {
      const body = { title: draftTitle.trim(), content: draftContent.trim(), category: 'other', isActive: true };
      return editing
        ? apiFetch(`/seller/ai/knowledge/${editing.id}`, { method: 'PATCH', body })
        : apiFetch('/seller/ai/knowledge', { method: 'POST', body });
    },
    onSuccess: () => {
      setShowEditor(false);
      setEditing(null);
      setDraftTitle('');
      setDraftContent('');
      void queryClient.invalidateQueries({ queryKey: ['seller', 'ai', 'knowledge'] });
    },
    onError: (err) => setError(errorKey(err)),
  });

  const deleteKnowledge = useMutation({
    mutationFn: (id: string) => apiFetch(`/seller/ai/knowledge/${id}`, { method: 'DELETE' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['seller', 'ai', 'knowledge'] }),
  });

  if (settingsQuery.isLoading) return <><Header /><LoadingState /></>;
  if (settingsQuery.error || !settingsQuery.data) {
    return <><Header /><ErrorState messageKey={errorKey(settingsQuery.error)} onRetry={() => void settingsQuery.refetch()} /></>;
  }

  const s = settingsQuery.data.settings;

  return (
    <View style={styles.container}>
      <Header title={t('ai.customerTitle')} />

      <ScrollView contentContainerStyle={styles.content}>
        <Card>
          <View style={styles.enabledRow}>
            <View style={styles.enabledText}>
              <Text style={styles.cardTitle}>{s.enabled ? t('ai.enabled') : t('ai.disabled')}</Text>
              <Text style={styles.cardSub}>{t('ai.customerSubtitle')}</Text>
            </View>
            <Switch
              value={s.enabled}
              onValueChange={(v) => patch.mutate({ enabled: v })}
              trackColor={{ false: theme.color.border, true: theme.color.primary }}
              thumbColor={theme.color.surface}
            />
          </View>
        </Card>

        {/* Tone */}
        <Card>
          <Text style={styles.cardTitle}>{t('ai.tone')}</Text>
          <View style={styles.tones}>
            {TONES.map((tone) => (
              <Pressable
                key={tone}
                onPress={() => patch.mutate({ tone })}
                style={[styles.tonePill, s.tone === tone && styles.tonePillActive]}
              >
                <Text style={[styles.toneLabel, s.tone === tone && styles.toneLabelActive]}>
                  {t(`ai.tones.${tone}`)}
                </Text>
              </Pressable>
            ))}
          </View>
        </Card>

        {/* Instructions */}
        <Card>
          <Field
            label={t('ai.instructions')}
            hint={t('ai.instructionsHint')}
            value={instructions}
            onChangeText={setInstructions}
            multiline
            style={styles.textarea}
          />
          <Field
            label={t('ai.greeting')}
            value={greeting}
            onChangeText={setGreeting}
            multiline
            style={styles.textareaSmall}
          />
          <Button
            label={t('common.save')}
            onPress={() => patch.mutate({ instructions: instructions.trim() || null, greetingEn: greeting.trim() || null })}
            loading={patch.isPending}
          />
        </Card>

        {/* Fallback */}
        <Card>
          <Text style={styles.cardTitle}>{t('ai.fallback')}</Text>
          {(['defer_to_seller', 'say_unknown'] as const).map((option) => (
            <Pressable
              key={option}
              onPress={() => patch.mutate({ fallbackBehaviour: option })}
              style={styles.optionRow}
            >
              <Ionicons
                name={s.fallbackBehaviour === option ? 'radio-button-on' : 'radio-button-off'}
                size={20}
                color={s.fallbackBehaviour === option ? theme.color.primary : theme.color.borderStrong}
              />
              <Text style={styles.optionLabel}>
                {t(option === 'defer_to_seller' ? 'ai.fallbackDefer' : 'ai.fallbackUnknown')}
              </Text>
            </Pressable>
          ))}
        </Card>

        {/* Knowledge */}
        <Card>
          <View style={styles.knowledgeHead}>
            <Text style={styles.cardTitle}>{t('ai.knowledge')}</Text>
            <Pressable
              onPress={() => { setEditing(null); setDraftTitle(''); setDraftContent(''); setShowEditor(true); }}
              style={styles.addButton}
            >
              <Ionicons name="add" size={18} color={theme.color.primary} />
              <Text style={styles.addLabel}>{t('ai.addKnowledge')}</Text>
            </Pressable>
          </View>

          {(knowledgeQuery.data?.knowledge ?? []).length === 0 ? (
            <Text style={styles.emptyKnowledge}>{t('empty.knowledge')}</Text>
          ) : (
            (knowledgeQuery.data?.knowledge ?? []).map((k) => (
              <Pressable
                key={k.id}
                onPress={() => {
                  setEditing(k); setDraftTitle(k.title); setDraftContent(k.content); setShowEditor(true);
                }}
                style={styles.knowledgeRow}
              >
                <View style={styles.knowledgeText}>
                  <Text style={styles.knowledgeTitle}>{k.title}</Text>
                  <Text style={styles.knowledgeBody} numberOfLines={2}>{k.content}</Text>
                </View>
                <Pressable
                  hitSlop={8}
                  onPress={() =>
                    Alert.alert(t('common.delete'), k.title, [
                      { text: t('common.cancel'), style: 'cancel' },
                      { text: t('common.delete'), style: 'destructive', onPress: () => deleteKnowledge.mutate(k.id) },
                    ])
                  }
                >
                  <Ionicons name="trash-outline" size={18} color={theme.color.danger} />
                </Pressable>
              </Pressable>
            ))
          )}
        </Card>

        {error ? <Text style={styles.error}>{t(error)}</Text> : null}
      </ScrollView>

      <Modal visible={showEditor} transparent animationType="slide" onRequestClose={() => setShowEditor(false)}>
        <Pressable style={styles.backdrop} onPress={() => setShowEditor(false)}>
          <Pressable onPress={(e) => e.stopPropagation()} style={styles.sheet}>
            <Text style={styles.sheetTitle}>{t('ai.addKnowledge')}</Text>
            <Field label={t('ai.knowledgeTitle')} required value={draftTitle} onChangeText={setDraftTitle} />
            <Field
              label={t('ai.knowledgeContent')}
              required
              value={draftContent}
              onChangeText={setDraftContent}
              multiline
              style={styles.textarea}
            />
            <Button
              label={t('common.save')}
              onPress={() => saveKnowledge.mutate()}
              loading={saveKnowledge.isPending}
              disabled={!draftTitle.trim() || !draftContent.trim()}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.color.background },
  content: { padding: theme.spacing.lg, gap: theme.spacing.md, paddingBottom: theme.spacing.xxl },

  enabledRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
  enabledText: { flex: 1, gap: 2 },
  cardTitle: { fontSize: theme.fontSize.md, fontWeight: '700', color: theme.color.text },
  cardSub: { fontSize: theme.fontSize.xs, color: theme.color.textMuted },

  tones: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm, marginTop: theme.spacing.md },
  tonePill: {
    paddingHorizontal: theme.spacing.lg, paddingVertical: 8, borderRadius: theme.radius.pill,
    borderWidth: 1, borderColor: theme.color.border,
  },
  tonePillActive: { backgroundColor: theme.color.primary, borderColor: theme.color.primary },
  toneLabel: { fontSize: theme.fontSize.sm, color: theme.color.textMuted },
  toneLabelActive: { color: theme.color.onPrimary, fontWeight: '700' },

  textarea: { minHeight: 110, textAlignVertical: 'top' },
  textareaSmall: { minHeight: 70, textAlignVertical: 'top' },

  optionRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, paddingVertical: 10 },
  optionLabel: { flex: 1, fontSize: theme.fontSize.sm, color: theme.color.text },

  knowledgeHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: theme.spacing.sm },
  addButton: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  addLabel: { fontSize: theme.fontSize.sm, color: theme.color.primary, fontWeight: '600' },
  emptyKnowledge: { fontSize: theme.fontSize.sm, color: theme.color.textMuted, paddingVertical: theme.spacing.md },
  knowledgeRow: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md,
    paddingVertical: theme.spacing.md, borderTopWidth: 1, borderTopColor: theme.color.border,
  },
  knowledgeText: { flex: 1, gap: 2 },
  knowledgeTitle: { fontSize: theme.fontSize.sm, fontWeight: '600', color: theme.color.text },
  knowledgeBody: { fontSize: theme.fontSize.xs, color: theme.color.textMuted, lineHeight: 17 },

  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: theme.color.surface, padding: theme.spacing.xl,
    borderTopLeftRadius: theme.radius.xl, borderTopRightRadius: theme.radius.xl, gap: theme.spacing.md,
  },
  sheetTitle: { fontSize: theme.fontSize.xl, fontWeight: '700', color: theme.color.text },
  error: { color: theme.color.danger, fontSize: theme.fontSize.sm, textAlign: 'center' },
});
