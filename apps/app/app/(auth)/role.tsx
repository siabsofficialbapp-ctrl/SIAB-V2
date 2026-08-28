/**
 * Role selection (§5).
 *
 * A seller cannot get past this screen without a stall name. The name is
 * checked for availability as it is typed, so nobody reaches submit only to
 * be told it is taken.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { theme } from '@siab/core';

import { Button, Field } from '../../src/components/ui';
import { useT } from '../../src/hooks/useT';
import { apiFetch, errorKey } from '../../src/lib/api';
import { useSession } from '../../src/lib/session';

type Role = 'buyer' | 'seller';

export default function RoleSelect() {
  const t = useT();
  const router = useRouter();
  const { refresh } = useSession();

  const [role, setRole] = useState<Role | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [stallName, setStallName] = useState('');
  const [stallAvailable, setStallAvailable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Debounced availability check.
  useEffect(() => {
    if (role !== 'seller' || stallName.trim().length < 2) {
      setStallAvailable(null);
      return;
    }
    const handle = setTimeout(async () => {
      try {
        const res = await apiFetch<{ available: boolean }>('/onboarding/stall-name-available', {
          query: { name: stallName.trim() },
        });
        setStallAvailable(res.available);
      } catch {
        setStallAvailable(null);
      }
    }, 400);
    return () => clearTimeout(handle);
  }, [role, stallName]);

  const nameOk = displayName.trim().length >= 2;
  const stallOk = role !== 'seller' || (stallName.trim().length >= 2 && stallAvailable !== false);
  const canSubmit = role !== null && nameOk && stallOk && !busy;

  const submit = async () => {
    if (!role) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/onboarding/role', {
        method: 'POST',
        body: role === 'seller'
          ? { role, displayName: displayName.trim(), stallName: stallName.trim() }
          : { role, displayName: displayName.trim() },
      });
      await refresh();
      router.replace('/');
    } catch (err) {
      setError(errorKey(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{t('role.title')}</Text>
        <Text style={styles.subtitle}>{t('role.subtitle')}</Text>

        <View style={styles.choices}>
          <RoleCard
            selected={role === 'buyer'}
            onPress={() => setRole('buyer')}
            icon="bag-handle-outline"
            title={t('role.buyer')}
            description={t('role.buyerDescription')}
          />
          <RoleCard
            selected={role === 'seller'}
            onPress={() => setRole('seller')}
            icon="storefront-outline"
            title={t('role.seller')}
            description={t('role.sellerDescription')}
          />
        </View>

        {role ? (
          <View style={styles.form}>
            <Field
              label={t('role.displayName')}
              required
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="Ahmed"
              autoCapitalize="words"
            />

            {role === 'seller' ? (
              <Field
                label={t('role.stallName')}
                required
                value={stallName}
                onChangeText={setStallName}
                hint={t('role.stallNameHint')}
                {...(stallAvailable === false ? { error: t('role.stallNameTaken') } : {})}
                autoCapitalize="words"
              />
            ) : null}

            {error ? <Text style={styles.error}>{t(error)}</Text> : null}

            <Button label={t('common.continue')} onPress={submit} disabled={!canSubmit} loading={busy} />

            {role === 'seller' && stallName.trim().length < 2 ? (
              <Text style={styles.requiredNote}>{t('role.stallNameRequired')}</Text>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function RoleCard({ selected, onPress, icon, title, description }: {
  selected: boolean;
  onPress: () => void;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={[styles.roleCard, selected && styles.roleCardSelected]}
    >
      <View style={[styles.roleIcon, selected && styles.roleIconSelected]}>
        <Ionicons name={icon} size={26} color={selected ? theme.color.onPrimary : theme.color.primary} />
      </View>
      <View style={styles.roleText}>
        <Text style={styles.roleTitle}>{title}</Text>
        <Text style={styles.roleDescription}>{description}</Text>
      </View>
      <Ionicons
        name={selected ? 'radio-button-on' : 'radio-button-off'}
        size={22}
        color={selected ? theme.color.primary : theme.color.borderStrong}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: theme.color.background },
  container: { flexGrow: 1, padding: theme.spacing.xl, gap: theme.spacing.lg, justifyContent: 'center' },
  title: { fontSize: theme.fontSize.xxl, fontWeight: '700', color: theme.color.text },
  subtitle: { fontSize: theme.fontSize.sm, color: theme.color.textMuted, lineHeight: 22 },
  choices: { gap: theme.spacing.md, marginTop: theme.spacing.md },
  roleCard: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.lg,
    padding: theme.spacing.lg, borderRadius: theme.radius.lg,
    borderWidth: 2, borderColor: theme.color.border, backgroundColor: theme.color.surface,
  },
  roleCardSelected: { borderColor: theme.color.primary, backgroundColor: theme.color.primarySubtle },
  roleIcon: {
    width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center',
    backgroundColor: theme.color.primarySubtle,
  },
  roleIconSelected: { backgroundColor: theme.color.primary },
  roleText: { flex: 1, gap: 4 },
  roleTitle: { fontSize: theme.fontSize.md, fontWeight: '700', color: theme.color.text },
  roleDescription: { fontSize: theme.fontSize.xs, color: theme.color.textMuted, lineHeight: 18 },
  form: { gap: theme.spacing.lg, marginTop: theme.spacing.lg },
  error: { color: theme.color.danger, fontSize: theme.fontSize.sm },
  requiredNote: { fontSize: theme.fontSize.xs, color: theme.color.textMuted, textAlign: 'center' },
});
