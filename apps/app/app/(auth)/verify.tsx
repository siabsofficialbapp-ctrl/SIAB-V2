/**
 * Email verification gate.
 *
 * SIAB requires a verified address before anyone can transact — this is a
 * real gate, not a dismissible notice.
 */
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { theme } from '@siab/core';

import { Logo } from '../../src/components/Logo';
import { Button } from '../../src/components/ui';
import { useT } from '../../src/hooks/useT';
import { useSession } from '../../src/lib/session';
import { supabase } from '../../src/lib/supabase';

export default function Verify() {
  const t = useT();
  const router = useRouter();
  const { session, refresh, signOut } = useSession();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const email = session?.user.email ?? '';

  const resend = async () => {
    setBusy(true);
    try {
      await supabase.auth.resend({ type: 'signup', email });
      setSent(true);
    } finally {
      setBusy(false);
    }
  };

  const recheck = async () => {
    setBusy(true);
    try {
      await supabase.auth.refreshSession();
      await refresh();
      router.replace('/');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <Logo size={80} />
      <Text style={styles.title}>{t('auth.verifyEmailTitle')}</Text>
      <Text style={styles.body}>{t('auth.verifyEmailBody', { email })}</Text>

      {sent ? <Text style={styles.sent}>{t('auth.verificationSent')}</Text> : null}

      <View style={styles.actions}>
        <Button label={t('common.continue')} onPress={recheck} loading={busy} />
        <Button label={t('auth.resendVerification')} onPress={resend} variant="ghost" disabled={busy} />
        <Button label={t('auth.signOut')} onPress={() => void signOut()} variant="ghost" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    padding: theme.spacing.xl, gap: theme.spacing.lg, backgroundColor: theme.color.background,
  },
  title: { fontSize: theme.fontSize.xl, fontWeight: '700', color: theme.color.text, textAlign: 'center' },
  body: { fontSize: theme.fontSize.md, color: theme.color.textMuted, textAlign: 'center', lineHeight: 24 },
  sent: { color: theme.color.success, fontSize: theme.fontSize.sm },
  actions: { alignSelf: 'stretch', gap: theme.spacing.md, marginTop: theme.spacing.lg },
});
