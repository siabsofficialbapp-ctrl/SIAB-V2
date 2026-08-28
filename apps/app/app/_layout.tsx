/**
 * Root layout.
 *
 * Boots localisation before anything renders, so the first frame is already
 * in the right language and direction — no flash of English in an Arabic app.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { theme } from '@siab/core';

import { initI18n } from '../src/lib/i18n';
import { SessionProvider } from '../src/lib/session';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        // Do not retry a rejection the server meant; do retry a flaky network.
        const status = (error as { status?: number }).status;
        if (status && status >= 400 && status < 500) return false;
        return failureCount < 2;
      },
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

export default function RootLayout() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void initI18n().finally(() => setReady(true));
  }, []);

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.color.background }}>
        <ActivityIndicator size="large" color={theme.color.primary} />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <SessionProvider>
            <StatusBar style="dark" />
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: theme.color.background },
              }}
            />
          </SessionProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
