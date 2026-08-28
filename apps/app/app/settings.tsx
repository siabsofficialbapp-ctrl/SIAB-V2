/**
 * Settings (§33): profile, the verified email change, optional phone number,
 * language, privacy toggles, permissions, and location.
 */
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Alert, Linking, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View,
} from 'react-native';

import { theme } from '@siab/core';
import type { Locale } from '@siab/i18n';

import { Header } from '../src/components/Header';
import { ScoreBadge } from '../src/components/ScoreBadge';
import { Button, Card, Divider, ErrorState, Field, LoadingState } from '../src/components/ui';
import { useLocaleInfo, useT } from '../src/hooks/useT';
import { apiFetch, errorKey } from '../src/lib/api';
import { changeLocale } from '../src/lib/i18n';
import { useSession } from '../src/lib/session';

interface MeResponse {
  profile: {
    id: string; role: 'buyer' | 'seller'; displayName: string; email: string | null;
    phone: string | null; region: string | null; locale: Locale;
    emailPublic: boolean; phonePublic: boolean; regionPublic: boolean;
    reputationScore: number; emailVerified: boolean;
  };
  stall: { stall_name: string; location_label: string | null; location_public: boolean } | null;
}

type PermissionState = 'granted' | 'denied' | 'unknown';

export default function Settings() {
  const t = useT();
  const router = useRouter();
  const { locale } = useLocaleInfo();
  const { signOut } = useSession();
  const queryClient = useQueryClient();

  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [region, setRegion] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [emailPending, setEmailPending] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [permissions, setPermissions] = useState<Record<string, PermissionState>>({
    camera: 'unknown', photos: 'unknown', location: 'unknown',
  });

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['me'],
    queryFn: () => apiFetch<MeResponse>('/me'),
  });

  useEffect(() => {
    if (!data) return;
    setDisplayName(data.profile.displayName);
    setPhone(data.profile.phone ?? '');
    setRegion(data.profile.region ?? '');
  }, [data]);

  // Read the real permission state rather than guessing.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    void (async () => {
      const [cam, photos, loc] = await Promise.all([
        ImagePicker.getCameraPermissionsAsync(),
        ImagePicker.getMediaLibraryPermissionsAsync(),
        Location.getForegroundPermissionsAsync(),
      ]);
      setPermissions({
        camera: cam.granted ? 'granted' : 'denied',
        photos: photos.granted ? 'granted' : 'denied',
        location: loc.granted ? 'granted' : 'denied',
      });
    })();
  }, []);

  const save = useMutation({
    mutationFn: (patch: Record<string, unknown>) => apiFetch('/me', { method: 'PATCH', body: patch }),
    onSuccess: () => {
      setSaved(true);
      setSaveError(null);
      setTimeout(() => setSaved(false), 2000);
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (err) => setSaveError(errorKey(err)),
  });

  const requestEmailChange = useMutation({
    mutationFn: () => apiFetch<{ pendingEmail: string }>('/me/email', { method: 'POST', body: { newEmail: newEmail.trim() } }),
    onSuccess: (res) => { setEmailPending(res.pendingEmail); setNewEmail(''); },
    onError: (err) => setSaveError(errorKey(err)),
  });

  const switchLanguage = async (next: Locale) => {
    const { needsRestart } = await changeLocale(next);
    save.mutate({ locale: next });
    if (needsRestart) {
      // React Native cannot flip an already-mounted tree reliably. Say so
      // rather than leaving the layout half-mirrored.
      Alert.alert(t('settings.language'), t('common.continue'));
    }
  };

  const askPermission = async (which: 'camera' | 'photos' | 'location') => {
    const result = which === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : which === 'photos'
        ? await ImagePicker.requestMediaLibraryPermissionsAsync()
        : await Location.requestForegroundPermissionsAsync();

    setPermissions((p) => ({ ...p, [which]: result.granted ? 'granted' : 'denied' }));

    if (!result.granted && !result.canAskAgain) {
      Alert.alert(t('settings.permissions'), t('settings.permissionOpenSettings'), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('settings.permissionOpenSettings'), onPress: () => void Linking.openSettings() },
      ]);
    }
  };

  if (isLoading) return <><Header /><LoadingState /></>;
  if (error || !data) return <><Header /><ErrorState messageKey={errorKey(error)} onRetry={() => void refetch()} /></>;

  const p = data.profile;

  return (
    <View style={styles.container}>
      <Header title={t('settings.title')} />

      <ScrollView contentContainerStyle={styles.content}>
        {/* Identity */}
        <Card>
          <View style={styles.identity}>
            <View style={styles.identityText}>
              <Text style={styles.name}>{p.displayName}</Text>
              <Text style={styles.roleLabel}>{t(`role.${p.role}`)}</Text>
            </View>
            <ScoreBadge score={p.reputationScore} size="lg" showLabel />
          </View>
        </Card>

        {/* Profile */}
        <Section title={t('settings.profile')}>
          <Field label={t('settings.displayName')} required value={displayName} onChangeText={setDisplayName} />
          <Field
            label={t('settings.phone')}
            value={phone}
            onChangeText={setPhone}
            hint={t('settings.phoneHint')}
            placeholder="+9665XXXXXXXX"
            keyboardType="phone-pad"
          />
          <Field label={t('settings.region')} value={region} onChangeText={setRegion} placeholder="Riyadh" />
          <Button
            label={t('common.save')}
            onPress={() =>
              save.mutate({
                displayName: displayName.trim(),
                phone: phone.trim() || null,
                region: region.trim() || null,
              })
            }
            loading={save.isPending}
          />
          {saved ? <Text style={styles.savedNote}>{t('common.save')} ✓</Text> : null}
        </Section>

        {/* Email — a separate, verified flow */}
        <Section title={t('settings.email')}>
          <View style={styles.emailRow}>
            <Text style={styles.emailValue}>{p.email}</Text>
            {p.emailVerified ? (
              <Ionicons name="checkmark-circle" size={18} color={theme.color.success} />
            ) : (
              <Ionicons name="alert-circle" size={18} color={theme.color.warning} />
            )}
          </View>
          <Field
            label={t('settings.changeEmail')}
            value={newEmail}
            onChangeText={setNewEmail}
            hint={t('settings.changeEmailHint')}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="new@example.com"
          />
          <Button
            label={t('settings.changeEmail')}
            onPress={() => requestEmailChange.mutate()}
            variant="secondary"
            disabled={!newEmail.includes('@') || requestEmailChange.isPending}
            loading={requestEmailChange.isPending}
          />
          {emailPending ? (
            <Text style={styles.pendingNote}>
              {t('settings.emailChangePending', { email: emailPending })}
            </Text>
          ) : null}
        </Section>

        {/* Language */}
        <Section title={t('settings.language')}>
          <View style={styles.languageRow}>
            {(['en', 'ar'] as const).map((code) => (
              <Pressable
                key={code}
                onPress={() => void switchLanguage(code)}
                style={[styles.langButton, locale === code && styles.langButtonActive]}
              >
                <Text style={[styles.langLabel, locale === code && styles.langLabelActive]}>
                  {t(code === 'en' ? 'settings.languageEnglish' : 'settings.languageArabic')}
                </Text>
                {locale === code ? <Ionicons name="checkmark" size={18} color={theme.color.primary} /> : null}
              </Pressable>
            ))}
          </View>
        </Section>

        {/* Privacy */}
        <Section title={t('settings.privacy')} subtitle={t('settings.privacyHint')}>
          <Toggle
            label={t('settings.showEmail')}
            value={p.emailPublic}
            onChange={(v) => save.mutate({ emailPublic: v })}
          />
          <Divider />
          <Toggle
            label={t('settings.showPhone')}
            value={p.phonePublic}
            onChange={(v) => save.mutate({ phonePublic: v })}
          />
          <Divider />
          <Toggle
            label={t('settings.showRegion')}
            value={p.regionPublic}
            onChange={(v) => save.mutate({ regionPublic: v })}
          />
        </Section>

        {/* Permissions */}
        <Section title={t('settings.permissions')}>
          <PermissionRow
            icon="camera-outline"
            label={t('settings.permissionCamera')}
            why={t('settings.permissionCameraWhy')}
            state={permissions['camera'] ?? 'unknown'}
            onRequest={() => void askPermission('camera')}
          />
          <Divider />
          <PermissionRow
            icon="images-outline"
            label={t('settings.permissionPhotos')}
            why={t('settings.permissionPhotosWhy')}
            state={permissions['photos'] ?? 'unknown'}
            onRequest={() => void askPermission('photos')}
          />
          <Divider />
          <PermissionRow
            icon="location-outline"
            label={t('settings.permissionLocation')}
            why={t('settings.permissionLocationWhy')}
            state={permissions['location'] ?? 'unknown'}
            onRequest={() => void askPermission('location')}
          />
        </Section>

        {/* Location */}
        <Section title={t('settings.locations')} subtitle={t('settings.locationPrivacyNote')}>
          <Text style={styles.locationValue}>
            {data.stall?.location_label ?? (region || t('profileView.notShared'))}
          </Text>
          {data.stall ? (
            <Button
              label={t('stall.editStall')}
              onPress={() => router.push('/seller/stall' as never)}
              variant="ghost"
            />
          ) : null}
        </Section>

        {/* Legal */}
        <Section title={t('settings.legal')}>
          <LinkRow label={t('settings.terms')} onPress={() => router.push('/(auth)/terms' as never)} />
        </Section>

        {saveError ? <Text style={styles.error}>{t(saveError)}</Text> : null}

        <Button
          label={t('settings.signOut')}
          variant="danger"
          onPress={() =>
            Alert.alert(t('settings.signOut'), t('settings.signOutConfirm'), [
              { text: t('common.cancel'), style: 'cancel' },
              { text: t('settings.signOut'), style: 'destructive', onPress: () => void signOut() },
            ])
          }
        />
      </ScrollView>
    </View>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <Card style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
      <View style={styles.sectionBody}>{children}</View>
    </Card>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.toggleRow}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: theme.color.border, true: theme.color.primary }}
        thumbColor={theme.color.surface}
      />
    </View>
  );
}

function PermissionRow({ icon, label, why, state, onRequest }: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  why: string;
  state: PermissionState;
  onRequest: () => void;
}) {
  const t = useT();
  const granted = state === 'granted';
  return (
    <Pressable onPress={granted ? undefined : onRequest} style={styles.permissionRow}>
      <Ionicons name={icon} size={22} color={theme.color.primary} />
      <View style={styles.permissionText}>
        <Text style={styles.permissionLabel}>{label}</Text>
        <Text style={styles.permissionWhy}>{why}</Text>
      </View>
      <Text style={[styles.permissionState, granted ? styles.permissionGranted : styles.permissionDenied]}>
        {granted ? t('settings.permissionGranted') : t('settings.permissionDenied')}
      </Text>
    </Pressable>
  );
}

function LinkRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.linkRow}>
      <Text style={styles.linkLabel}>{label}</Text>
      <Ionicons name="chevron-forward" size={18} color={theme.color.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.color.background },
  content: { padding: theme.spacing.lg, gap: theme.spacing.md, paddingBottom: theme.spacing.xxl },

  identity: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
  identityText: { flex: 1, gap: 2 },
  name: { fontSize: theme.fontSize.lg, fontWeight: '700', color: theme.color.text },
  roleLabel: { fontSize: theme.fontSize.xs, color: theme.color.textMuted },

  section: { gap: 0 },
  sectionTitle: { fontSize: theme.fontSize.md, fontWeight: '700', color: theme.color.text },
  sectionSubtitle: { fontSize: theme.fontSize.xs, color: theme.color.textMuted, marginTop: 4, lineHeight: 18 },
  sectionBody: { gap: theme.spacing.md, marginTop: theme.spacing.md },

  emailRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  emailValue: { flex: 1, fontSize: theme.fontSize.md, color: theme.color.text },
  pendingNote: { fontSize: theme.fontSize.xs, color: theme.color.warning, lineHeight: 18 },
  savedNote: { fontSize: theme.fontSize.xs, color: theme.color.success, textAlign: 'center' },

  languageRow: { gap: theme.spacing.sm },
  langButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: theme.spacing.lg, borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: theme.color.border,
  },
  langButtonActive: { borderColor: theme.color.primary, backgroundColor: theme.color.primarySubtle },
  langLabel: { fontSize: theme.fontSize.md, color: theme.color.text },
  langLabelActive: { color: theme.color.primary, fontWeight: '600' },

  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.md },
  toggleLabel: { flex: 1, fontSize: theme.fontSize.sm, color: theme.color.text },

  permissionRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
  permissionText: { flex: 1, gap: 2 },
  permissionLabel: { fontSize: theme.fontSize.sm, fontWeight: '600', color: theme.color.text },
  permissionWhy: { fontSize: theme.fontSize.xs, color: theme.color.textMuted, lineHeight: 17 },
  permissionState: { fontSize: theme.fontSize.xs, fontWeight: '700' },
  permissionGranted: { color: theme.color.success },
  permissionDenied: { color: theme.color.textMuted },

  locationValue: { fontSize: theme.fontSize.md, color: theme.color.text },

  linkRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 },
  linkLabel: { fontSize: theme.fontSize.md, color: theme.color.text },

  error: { color: theme.color.danger, fontSize: theme.fontSize.sm, textAlign: 'center' },
});
