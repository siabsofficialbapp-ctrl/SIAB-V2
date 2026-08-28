/**
 * Two kinds of Supabase client, and the difference matters enormously.
 *
 *   userClient(token)  — carries the caller's JWT. Row Level Security applies.
 *                        This is the default for anything touching user data.
 *
 *   serviceClient()    — carries the service-role key and BYPASSES RLS.
 *                        Only for operations the database cannot express as a
 *                        user: writing notifications for someone else,
 *                        recording a payment from a webhook, posting an AI
 *                        reply. Every use must be able to justify itself.
 *
 * The rule: reach for `userClient` first. If you find yourself using
 * `serviceClient` to read user data, you are about to write a privacy bug.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { loadEnv } from './env.js';

let service: SupabaseClient | null = null;

export function serviceClient(): SupabaseClient {
  if (service) return service;
  const env = loadEnv();
  service = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return service;
}

/**
 * A client acting AS the calling user. Every query runs under their RLS
 * policies, so a bug in route code cannot leak another user's rows.
 */
export function userClient(accessToken: string): SupabaseClient {
  const env = loadEnv();
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

/** Public read client, for signed-out marketplace browsing. */
export function anonClient(): SupabaseClient {
  const env = loadEnv();
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Resolves a storage object path to a public URL. */
export function publicUrl(bucket: string, path: string): string {
  const env = loadEnv();
  return `${env.SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
}

/**
 * A time-limited URL for a PRIVATE object (chat images). Generated per
 * request so a leaked link expires quickly.
 */
export async function signedUrl(bucket: string, path: string, seconds = 3600): Promise<string | null> {
  const { data, error } = await serviceClient().storage.from(bucket).createSignedUrl(path, seconds);
  if (error || !data) return null;
  return data.signedUrl;
}
