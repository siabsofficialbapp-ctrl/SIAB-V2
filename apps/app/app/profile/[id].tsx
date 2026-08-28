/**
 * Someone's public profile — opened by tapping their name or avatar.
 *
 * Contact details appear only where that person has opted in; the API nulls
 * them out otherwise, so nothing private can slip through.
 */
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { theme } from '@siab/core';
import { formatDate } from '@siab/i18n';

import { Header } from '../../src/components/Header';
import { ScoreBadge } from '../../src/components/ScoreBadge';
import { Button, Card, ErrorState, LoadingState } from '../../src/components/ui';
import { useLocaleInfo, useT } from '../../src/hooks/useT';
import { apiFetch, errorKey } from '../../src/lib/api';

interface PublicProfile {
  id: string; role: 'buyer' | 'seller'; displayName: string; avatarUrl: string | null;
  reputationScore: number; scoreBand: 'red' | 'orange' | 'green' | 'diamond';
  email: string | null; phone: string | null; region: string | null; createdAt: string;
  stallName?: string; stallSlug?: string; bio?: string | null; logoUrl?: string | null;
}

export default function Profile() {
  const t = useT();
  const router = useRouter();
  const { locale } = useLocaleInfo();
  const { id } = useLocalSearchParams<{ id: string }>();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['profile', id],
    queryFn: () => apiFetch<{ profile: PublicProfile }>(`/profiles/${id}`, { anonymous: true }),
  });

  if (isLoading) return <><Header /><LoadingState /></>;
  if (error || !data) return <><Header /><ErrorState messageKey={errorKey(error)} onRetry={() => void refetch()} /></>;

  const p = data.profile;
  const hasContact = Boolean(p.email || p.phone || p.region);

  return (
    <View style={styles.container}>
      <Header title={t('profileView.title')} />

      <ScrollView contentContainerStyle={styles.content}>
        <Card style={styles.head}>
          {p.logoUrl || p.avatarUrl ? (
            <Image source={{ uri: (p.logoUrl ?? p.avatarUrl) as string }} style={styles.avatar} contentFit="cover" />
          ) : (
            <View style={[styles.avatar, styles.avatarEmpty]}>
              <Ionicons name="person-outline" size={30} color={theme.color.primary} />
            </View>
          )}

          <Text style={styles.name}>{p.stallName ?? p.displayName}</Text>
          {p.stallName ? <Text style={styles.realName}>{p.displayName}</Text> : null}

          <ScoreBadge score={p.reputationScore} band={p.scoreBand} size="lg" showLabel />

          {p.scoreBand === 'diamond' ? (
            <View style={styles.diamondNote}>
              <Ionicons name="diamond-outline" size={14} color={theme.color.primary} />
              <Text style={styles.diamondText}>{t('score.diamondPerk')}</Text>
            </View>
          ) : null}

          <Text style={styles.since}>
            {t('profileView.memberSince', { date: formatDate(p.createdAt, locale) })}
          </Text>
        </Card>

        {p.bio ? (
          <Card>
            <Text style={styles.sectionLabel}>{t('stall.about')}</Text>
            <Text style={styles.bio}>{p.bio}</Text>
          </Card>
        ) : null}

        <Card>
          <Text style={styles.sectionLabel}>{t('profileView.contact')}</Text>
          {hasContact ? (
            <>
              {p.email ? <ContactRow icon="mail-outline" value={p.email} /> : null}
              {p.phone ? <ContactRow icon="call-outline" value={p.phone} /> : null}
              {p.region ? <ContactRow icon="location-outline" value={p.region} /> : null}
            </>
          ) : (
            <Text style={styles.privateNote}>{t('profileView.privateNote')}</Text>
          )}
        </Card>

        {p.stallSlug ? (
          <Button
            label={t('profileView.viewStall')}
            onPress={() => router.push(`/stall/${p.stallSlug}` as never)}
            variant="secondary"
          />
        ) : null}
      </ScrollView>
    </View>
  );
}

function ContactRow({ icon, value }: { icon: keyof typeof Ionicons.glyphMap; value: string }) {
  return (
    <View style={styles.contactRow}>
      <Ionicons name={icon} size={18} color={theme.color.primary} />
      <Text style={styles.contactValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.color.background },
  content: { padding: theme.spacing.lg, gap: theme.spacing.md },
  head: { alignItems: 'center', gap: theme.spacing.sm },
  avatar: { width: 84, height: 84, borderRadius: 42, backgroundColor: theme.color.surfaceMuted },
  avatarEmpty: { alignItems: 'center', justifyContent: 'center', backgroundColor: theme.color.primarySubtle },
  name: { fontSize: theme.fontSize.xl, fontWeight: '700', color: theme.color.text, textAlign: 'center' },
  realName: { fontSize: theme.fontSize.sm, color: theme.color.textMuted },
  diamondNote: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: theme.color.primarySubtle, paddingHorizontal: theme.spacing.md, paddingVertical: 6,
    borderRadius: theme.radius.pill,
  },
  diamondText: { fontSize: theme.fontSize.xs, color: theme.color.primary, fontWeight: '600' },
  since: { fontSize: theme.fontSize.xs, color: theme.color.textMuted },
  sectionLabel: { fontSize: theme.fontSize.xs, color: theme.color.textMuted, fontWeight: '600', marginBottom: theme.spacing.sm },
  bio: { fontSize: theme.fontSize.sm, color: theme.color.text, lineHeight: 21 },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, paddingVertical: 6 },
  contactValue: { fontSize: theme.fontSize.sm, color: theme.color.text },
  privateNote: { fontSize: theme.fontSize.sm, color: theme.color.textMuted, fontStyle: 'italic' },
});
