/**
 * Environment configuration, validated once at boot.
 *
 * The process refuses to start with a broken configuration rather than
 * failing later on a request. Secrets are read here and nowhere else.
 */
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),

  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),

  /**
   * Optional. When present, JWTs are verified locally (fast). When absent,
   * the token is verified by asking Supabase, which costs a round trip but
   * works without the secret to hand.
   */
  SUPABASE_JWT_SECRET: z.string().optional(),

  ANTHROPIC_API_KEY: z.string().optional(),
  SIAB_AI_MODEL: z.string().default('claude-opus-5'),

  BREVO_API_KEY: z.string().optional(),
  BREVO_SENDER_EMAIL: z.string().email().default('no-reply@siab.app'),
  BREVO_SENDER_NAME: z.string().default('SIAB'),

  API_ALLOWED_ORIGINS: z.string().default('http://localhost:8081'),
  API_PUBLIC_URL: z.string().url().default('http://localhost:8080'),

  PAYMENTS_PROVIDER: z.enum(['mock', 'moyasar', 'tap']).default('mock'),
  PAYMENTS_CURRENCY: z.literal('SAR').default('SAR'),
  PAYMENTS_WEBHOOK_SECRET: z.string().optional(),
  MOYASAR_SECRET_KEY: z.string().optional(),
  TAP_SECRET_KEY: z.string().optional(),

  SIAB_VAT_BPS: z.coerce.number().int().nonnegative().default(1500),
  SIAB_PLATFORM_FEE_BPS: z.coerce.number().int().nonnegative().default(100),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${detail}\n\nSee .env.example.`);
  }
  cached = parsed.data;
  return cached;
}

/** Test hook. Never called in production. */
export function resetEnv(): void {
  cached = null;
}

export function allowedOrigins(env: Env): string[] {
  return env.API_ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * A live payment gateway needs its key. Reported at boot so a
 * misconfiguration is loud, rather than surfacing as a failed checkout.
 */
export function paymentsConfigured(env: Env): boolean {
  switch (env.PAYMENTS_PROVIDER) {
    case 'moyasar': return Boolean(env.MOYASAR_SECRET_KEY);
    case 'tap': return Boolean(env.TAP_SECRET_KEY);
    case 'mock': return true;
  }
}

export function aiConfigured(env: Env): boolean {
  return Boolean(env.ANTHROPIC_API_KEY);
}

export function emailConfigured(env: Env): boolean {
  return Boolean(env.BREVO_API_KEY);
}
