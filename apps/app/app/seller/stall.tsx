/**
 * Editing the stall, including the opt-in public location (§22).
 *
 * SIAB publishes only the label the seller types — never their coordinates.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { theme } from '@siab/core';

import { Header } from '../../src/components/Header';
import { Button, Card, ErrorState, Field, LoadingState } from '../../src/components/ui';
import { useT } from '../../src/hooks/useT';
import { apiFetch, errorKey } from '../../src/lib/api';

interface MeResponse {
  stall: { stall_name: string; bio: string | null; location_label: string | null; location_public: boolean } | null;
}

export default function EditStall() {
  const t = useT();
  const queryClient = useQueryClient();

  const [stallName, setStallName] = useState('');
  const [bio, setBio] = useState('');
  const [locationLabel, setLocationLabel] = useState('');
  const [locationPublic, setLocationPublic] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const { data, isLoading, error: loadError, refetch } = useQuery({
    queryKey: ['me'],
    queryFn: () => apiFetch<MeResponse>('/me'),
  });

  useEffect(() => {
    if (!data?.stall) return;
    setStallName(data.stall.stall_name);
    setBio(data.stall.bio ?? '');
    setLocationLabel(data.stall.location_label ?? '');
    setLocationPublic(data.stall.location_public);
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      apiFetch('/seller/stall', {
        method: 'PATCH',
        body: {
          stallName: stallName.trim(),
          bio: bio.trim() || null,
          locationLabel: locationLabel.trim() || null,
          locationPublic,
        },
      }),
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (err) => setError(errorKey(err)),
  });

  if (isLoading) return <><Header /><LoadingState /></>;
  if (loadError) return <><Header /><ErrorState messageKey={errorKey(loadError)} onRetry={() => void refetch()} /></>;

  return (
    <View style={styles.container}>
      <Header title={t('stall.editStall')} />
      <ScrollView contentContainerStyle={styles.content}>
        <Card style={styles.card}>
          <Field label={t('stall.stallName')} required value={stallName} onChangeText={setStallName} />
          <Field
            label={t('stall.bio')}
            value={bio}
            onChangeText={setBio}
            multiline
            style={styles.textarea}
          />
        </Card>

        <Card style={styles.card}>
          <Field
            label={t('settings.locationLabel')}
            value={locationLabel}
            onChangeText={setLocationLabel}
            placeholder="Riyadh"
          />
          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>{t('settings.locationPublic')}</Text>
            <Switch
              value={locationPublic}
              onValueChange={setLocationPublic}
              trackColor={{ false: theme.color.border, true: theme.color.primary }}
              thumbColor={theme.color.surface}
            />
          </View>
          <Text style={styles.privacyNote}>{t('settings.locationPrivacyNote')}</Text>
        </Card>

        {error ? <Text style={styles.error}>{t(error)}</Text> : null}
        {saved ? <Text style={styles.saved}>{t('common.save')} ✓</Text> : null}

        <Button
          label={t('common.save')}
          onPress={() => save.mutate()}
          loading={save.isPending}
          disabled={stallName.trim().length < 2}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.color.background },
  content: { padding: theme.spacing.lg, gap: theme.spacing.md },
  card: { gap: theme.spacing.lg },
  textarea: { minHeight: 90, textAlignVertical: 'top' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  toggleLabel: { flex: 1, fontSize: theme.fontSize.sm, color: theme.color.text },
  privacyNote: { fontSize: theme.fontSize.xs, color: theme.color.textMuted, lineHeight: 17 },
  error: { color: theme.color.danger, fontSize: theme.fontSize.sm, textAlign: 'center' },
  saved: { color: theme.color.success, fontSize: theme.fontSize.sm, textAlign: 'center' },
});
