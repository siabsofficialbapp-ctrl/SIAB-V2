/**
 * Sign in — Google or email + password. Real authentication against
 * Supabase; there is no bypass and no demo shortcut.
 */
import { makeRedirectUri } from 'expo-auth-session';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { theme } from '@siab/core';

import { Logo } from '../../src/components/Logo';
import { Button, Field } from '../../src/components/ui';
import { useT } from '../../src/hooks/useT';
import { supabase, isConfigured } from '../../src/lib/supabase';

export default function SignIn() {
  const t = useT();
  const router = useRouter();

  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!email.trim() || password.length < 8) {
      setError(t('error.generic'));
      return;
    }
    setBusy(true);
    try {
      const fn = mode === 'signin' ? supabase.auth.signInWithPassword : supabase.auth.signUp;
      const { error: authError } = await fn.call(supabase.auth, {
        email: email.trim().toLowerCase(),
        password,
      });
      if (authError) {
        setError(authError.message);
        return;
      }
      router.replace('/');
    } finally {
      setBusy(false);
    }
  };

  const withGoogle = async () => {
    setError(null);
    setBusy(true);
    try {
      const redirectTo = makeRedirectUri({ scheme: 'siab', path: 'auth/callback' });
      const { data, error: authError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo, skipBrowserRedirect: Platform.OS !== 'web' },
      });
      if (authError) {
        setError(authError.message);
        return;
      }
      if (Platform.OS !== 'web' && data.url) {
        const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
        if (result.type === 'success' && result.url) {
          // Supabase returns the session in the URL fragment.
          const fragment = result.url.split('#')[1] ?? '';
          const params = new URLSearchParams(fragment);
          const access_token = params.get('access_token');
          const refresh_token = params.get('refresh_token');
          if (access_token && refresh_token) {
            await supabase.auth.setSession({ access_token, refresh_token });
            router.replace('/');
          }
        }
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.brand}>
          <Logo size={92} />
          <Text style={styles.appName}>{t('common.appName')}</Text>
        </View>

        {!isConfigured ? (
          <View style={styles.warning}>
            <Text style={styles.warningText}>
              Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and
              EXPO_PUBLIC_SUPABASE_ANON_KEY in your .env file.
            </Text>
          </View>
        ) : null}

        <View style={styles.form}>
          <Button
            label={t('auth.continueWithGoogle')}
            onPress={withGoogle}
            variant="ghost"
            icon="logo-google"
            disabled={busy || !isConfigured}
          />

          <View style={styles.orRow}>
            <View style={styles.orLine} />
            <Text style={styles.orText}>—</Text>
            <View style={styles.orLine} />
          </View>

          <Field
            label={t('auth.email')}
            required
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            placeholder="you@example.com"
          />
          <Field
            label={t('auth.password')}
            required
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            {...(mode === 'signup' ? { hint: 'At least 8 characters' } : {})}
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Button
            label={mode === 'signin' ? t('auth.signIn') : t('auth.signUp')}
            onPress={submit}
            loading={busy}
            disabled={!isConfigured}
          />

          <Button
            label={mode === 'signin' ? t('auth.signUp') : t('auth.signIn')}
            onPress={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null); }}
            variant="ghost"
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: theme.color.background },
  container: { flexGrow: 1, justifyContent: 'center', padding: theme.spacing.xl, gap: theme.spacing.xxl },
  brand: { alignItems: 'center', gap: theme.spacing.md },
  appName: { fontSize: theme.fontSize.xxl, fontWeight: '700', color: theme.color.text, letterSpacing: 1 },
  form: { gap: theme.spacing.lg },
  orRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
  orLine: { flex: 1, height: 1, backgroundColor: theme.color.border },
  orText: { color: theme.color.textMuted },
  error: { color: theme.color.danger, fontSize: theme.fontSize.sm },
  warning: {
    backgroundColor: '#FEF3C7', borderRadius: theme.radius.md, padding: theme.spacing.lg,
    borderWidth: 1, borderColor: '#FCD34D',
  },
  warningText: { fontSize: theme.fontSize.sm, color: '#92400E' },
});
