/**
 * Chat (§23, §24).
 *
 * Text, images, and deliberate location sharing. When the thread is with a
 * seller's AI it is visually unmistakable — a banner, a distinct bubble, and
 * a route back to the human.
 */
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Linking, Platform,
  Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native';

import { theme, type Message } from '@siab/core';

import { Header } from '../../src/components/Header';
import { EmptyState, ErrorState, LoadingState } from '../../src/components/ui';
import { useT } from '../../src/hooks/useT';
import { apiFetch, errorKey } from '../../src/lib/api';
import { uploadChatImage } from '../../src/lib/upload';

type ChatMessage = Message & { isMine: boolean; isAi: boolean };

export default function Conversation() {
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const listRef = useRef<FlatList<ChatMessage>>(null);

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: conversations } = useQuery({
    queryKey: ['conversations'],
    queryFn: () => apiFetch<{ conversations: { id: string; kind: string; stallName: string | null; counterparty: { displayName: string } | null }[] }>('/conversations'),
  });
  const conversation = conversations?.conversations.find((c) => c.id === id);
  const isAiThread = conversation?.kind === 'ai';

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['messages', id],
    queryFn: () => apiFetch<{ messages: ChatMessage[] }>(`/conversations/${id}/messages`),
    // Poll while the thread is open. Realtime would be better; this is
    // reliable and cheap enough for launch.
    refetchInterval: 6000,
  });

  const send = useMutation({
    mutationFn: (body: unknown) =>
      apiFetch(`/conversations/${id}/messages`, { method: 'POST', body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['messages', id] });
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    },
    onError: (err) => setActionError(errorKey(err)),
  });

  const sendText = () => {
    const body = draft.trim();
    if (!body) return;
    setDraft('');
    send.mutate({ kind: 'text', body });
  };

  const sendImage = async () => {
    setActionError(null);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(t('settings.permissionPhotos'), t('settings.permissionPhotosWhy'));
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
    });
    if (picked.canceled || !picked.assets[0]) return;

    setSending(true);
    try {
      const asset = picked.assets[0];
      const storagePath = await uploadChatImage(id, {
        uri: asset.uri,
        ...(asset.mimeType ? { mimeType: asset.mimeType } : {}),
        ...(asset.fileSize ? { fileSize: asset.fileSize } : {}),
      });
      send.mutate({ kind: 'image', storagePath });
    } catch (err) {
      setActionError(errorKey(err));
    } finally {
      setSending(false);
    }
  };

  /**
   * Location is shared only after an explicit confirmation. Nothing in SIAB
   * attaches a location automatically.
   */
  const sendLocation = () => {
    const name = conversation?.counterparty?.displayName ?? conversation?.stallName ?? '';
    Alert.alert(t('chat.sendLocation'), t('chat.locationConsent', { name }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.confirm'),
        onPress: async () => {
          const perm = await Location.requestForegroundPermissionsAsync();
          if (!perm.granted) {
            Alert.alert(t('settings.permissionLocation'), t('settings.permissionLocationWhy'));
            return;
          }
          setSending(true);
          try {
            const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
            send.mutate({
              kind: 'location',
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
            });
          } catch (err) {
            setActionError(errorKey(err));
          } finally {
            setSending(false);
          }
        },
      },
    ]);
  };

  if (isLoading) return <><Header /><LoadingState /></>;
  if (error) return <><Header /><ErrorState messageKey={errorKey(error)} onRetry={() => void refetch()} /></>;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
    >
      <Header title={conversation?.stallName ?? conversation?.counterparty?.displayName ?? t('chat.title')} />

      {isAiThread ? (
        <View style={styles.aiBanner}>
          <Ionicons name="sparkles" size={16} color={theme.color.primary} />
          <Text style={styles.aiBannerText}>
            {t('chat.aiDisclaimer', { stall: conversation?.stallName ?? '' })}
          </Text>
        </View>
      ) : null}

      <FlatList
        ref={listRef}
        data={data?.messages ?? []}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.list}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        ListEmptyComponent={<EmptyState icon="chatbubbles-outline" title={t('empty.messages')} />}
        renderItem={({ item }) => <Bubble message={item} />}
      />

      {actionError ? <Text style={styles.error}>{t(actionError)}</Text> : null}

      <View style={styles.composer}>
        {!isAiThread ? (
          <>
            <Pressable onPress={sendImage} hitSlop={8} style={styles.composerButton} disabled={sending}>
              <Ionicons name="image-outline" size={22} color={theme.color.primary} />
            </Pressable>
            <Pressable onPress={sendLocation} hitSlop={8} style={styles.composerButton} disabled={sending}>
              <Ionicons name="location-outline" size={22} color={theme.color.primary} />
            </Pressable>
          </>
        ) : null}

        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={t('chat.placeholder')}
          placeholderTextColor={theme.color.textMuted}
          style={styles.composerInput}
          multiline
        />

        <Pressable
          onPress={sendText}
          disabled={!draft.trim() || send.isPending || sending}
          style={[styles.sendButton, (!draft.trim() || send.isPending) && styles.sendButtonDisabled]}
          accessibilityRole="button"
          accessibilityLabel={t('chat.send')}
        >
          {send.isPending || sending ? (
            <ActivityIndicator size="small" color={theme.color.onPrimary} />
          ) : (
            <Ionicons name="send" size={18} color={theme.color.onPrimary} />
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function Bubble({ message }: { message: ChatMessage }) {
  const t = useT();
  const mine = message.isMine;
  const ai = message.isAi;

  return (
    <View style={[styles.bubbleRow, mine ? styles.bubbleRowMine : styles.bubbleRowTheirs]}>
      <View
        style={[
          styles.bubble,
          mine ? styles.bubbleMine : ai ? styles.bubbleAi : styles.bubbleTheirs,
        ]}
      >
        {ai ? (
          <View style={styles.aiTag}>
            <Ionicons name="sparkles" size={11} color={theme.color.primary} />
            <Text style={styles.aiTagText}>{t('chat.aiBadge')}</Text>
          </View>
        ) : null}

        {message.kind === 'text' ? (
          <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>{message.body}</Text>
        ) : message.kind === 'image' && message.imageUrl ? (
          <Image source={{ uri: message.imageUrl }} style={styles.bubbleImage} contentFit="cover" />
        ) : message.kind === 'location' && message.latitude !== null ? (
          <Pressable
            onPress={() => {
              const url = Platform.select({
                ios: `maps://?ll=${message.latitude},${message.longitude}`,
                android: `geo:${message.latitude},${message.longitude}`,
                default: `https://www.google.com/maps?q=${message.latitude},${message.longitude}`,
              });
              void Linking.openURL(url);
            }}
            style={styles.locationBubble}
          >
            <Ionicons name="location" size={20} color={mine ? theme.color.onPrimary : theme.color.primary} />
            <View>
              <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>
                {t('chat.locationShared')}
              </Text>
              <Text style={[styles.locationLink, mine && styles.bubbleTextMine]}>
                {t('chat.openInMaps')}
              </Text>
            </View>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.color.background },
  aiBanner: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.md,
    backgroundColor: theme.color.primarySubtle,
    borderBottomWidth: 1, borderBottomColor: theme.color.border,
  },
  aiBannerText: { flex: 1, fontSize: theme.fontSize.xs, color: theme.color.primary, fontWeight: '500' },

  list: { padding: theme.spacing.lg, gap: theme.spacing.sm },
  bubbleRow: { flexDirection: 'row' },
  bubbleRowMine: { justifyContent: 'flex-end' },
  bubbleRowTheirs: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '80%', borderRadius: theme.radius.lg, padding: theme.spacing.md, gap: 4 },
  bubbleMine: { backgroundColor: theme.color.primary, borderBottomRightRadius: 4 },
  bubbleTheirs: {
    backgroundColor: theme.color.surface, borderBottomLeftRadius: 4,
    borderWidth: 1, borderColor: theme.color.border,
  },
  bubbleAi: {
    backgroundColor: theme.color.primarySubtle, borderBottomLeftRadius: 4,
    borderWidth: 1, borderStyle: 'dashed', borderColor: theme.color.primary,
  },
  aiTag: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  aiTagText: { fontSize: 10, color: theme.color.primary, fontWeight: '700', letterSpacing: 0.4 },
  bubbleText: { fontSize: theme.fontSize.sm, color: theme.color.text, lineHeight: 21 },
  bubbleTextMine: { color: theme.color.onPrimary },
  bubbleImage: { width: 200, height: 200, borderRadius: theme.radius.md },
  locationBubble: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
  locationLink: { fontSize: theme.fontSize.xs, color: theme.color.primary, fontWeight: '600' },

  composer: {
    flexDirection: 'row', alignItems: 'flex-end', gap: theme.spacing.sm,
    padding: theme.spacing.md, borderTopWidth: 1, borderTopColor: theme.color.border,
    backgroundColor: theme.color.surface,
  },
  composerButton: { padding: 8 },
  composerInput: {
    flex: 1, maxHeight: 110, borderWidth: 1, borderColor: theme.color.border,
    borderRadius: theme.radius.lg, paddingHorizontal: theme.spacing.lg, paddingVertical: 10,
    fontSize: theme.fontSize.md, color: theme.color.text,
  },
  sendButton: {
    width: 42, height: 42, borderRadius: 21, backgroundColor: theme.color.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  sendButtonDisabled: { opacity: 0.4 },
  error: { color: theme.color.danger, fontSize: theme.fontSize.xs, textAlign: 'center', paddingBottom: 4 },
});
