/**
 * Session and onboarding state.
 *
 * One place decides where a signed-in user should be: verify email, accept
 * the Terms, choose a role, or into the app. Screens read `nextStep` rather
 * than each re-deriving the rule.
 */
import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { apiFetch } from './api';
import { supabase } from './supabase';

export type OnboardingStep = 'verify_email' | 'accept_terms' | 'choose_role' | 'done';

export interface OnboardingState {
  emailVerified: boolean;
  termsVersion: string | null;
  termsVersionId: string | null;
  termsAccepted: boolean;
  hasProfile: boolean;
  role: 'buyer' | 'seller' | null;
  stallName: string | null;
  nextStep: OnboardingStep;
}

interface SessionContextValue {
  session: Session | null;
  onboarding: OnboardingState | null;
  loading: boolean;
  role: 'buyer' | 'seller' | null;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [onboarding, setOnboarding] = useState<OnboardingState | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    setSession(data.session);

    if (!data.session) {
      setOnboarding(null);
      setLoading(false);
      return;
    }

    try {
      const state = await apiFetch<OnboardingState>('/onboarding/state');
      setOnboarding(state);
    } catch {
      // A failed check must not lock the user out of the app entirely; the
      // screens fall back to their own error states.
      setOnboarding(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      void refresh();
    });
    return () => sub.subscription.unsubscribe();
  }, [refresh]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setSession(null);
    setOnboarding(null);
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({ session, onboarding, loading, role: onboarding?.role ?? null, refresh, signOut }),
    [session, onboarding, loading, refresh, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}
