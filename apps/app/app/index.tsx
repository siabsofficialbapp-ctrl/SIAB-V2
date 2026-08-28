/**
 * The gate.
 *
 * Decides where a user belongs: sign in, verify email, accept the Terms,
 * choose a role, or into the marketplace. One place owns this rule.
 */
import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { theme } from '@siab/core';

import { useSession } from '../src/lib/session';

export default function Index() {
  const { session, onboarding, loading } = useSession();

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={theme.color.primary} />
      </View>
    );
  }

  if (!session) return <Redirect href="/(auth)/sign-in" />;

  switch (onboarding?.nextStep) {
    case 'verify_email': return <Redirect href="/(auth)/verify" />;
    case 'accept_terms': return <Redirect href="/(auth)/terms" />;
    case 'choose_role':  return <Redirect href="/(auth)/role" />;
    default:             return <Redirect href="/(tabs)/market" />;
  }
}
