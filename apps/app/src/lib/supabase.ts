/**
 * The client's Supabase connection.
 *
 * Carries the ANON key only. Every private read is protected by Row Level
 * Security on the server side; the client is never trusted with a key that
 * could bypass it.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

function envVar(name: string): string {
  const fromProcess = process.env[name];
  if (fromProcess) return fromProcess;
  const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string>;
  return extra[name] ?? '';
}

export const SUPABASE_URL = envVar('EXPO_PUBLIC_SUPABASE_URL');
export const SUPABASE_ANON_KEY = envVar('EXPO_PUBLIC_SUPABASE_ANON_KEY');
export const API_URL = envVar('EXPO_PUBLIC_API_URL') || 'http://localhost:8080';

export const isConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export const supabase = createClient(SUPABASE_URL || 'http://localhost', SUPABASE_ANON_KEY || 'anon', {
  auth: {
    // AsyncStorage on native; the web build uses the browser's own storage.
    ...(Platform.OS === 'web' ? {} : { storage: AsyncStorage }),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === 'web',
  },
});

export async function accessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
