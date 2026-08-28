/**
 * Authentication.
 *
 * The caller's identity comes from their Supabase JWT and nothing else. No
 * route ever accepts a user id, seller id, or role as a parameter — that is
 * the whole basis of the privacy model (§30). If a handler needs to know who
 * is asking, it asks here.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { createRemoteJWKSet, jwtVerify } from 'jose';

import { loadEnv } from './env.js';
import { forbidden, unauthorized } from './errors.js';
import { serviceClient, userClient } from './supabase.js';

export interface AuthContext {
  userId: string;
  email: string | null;
  emailVerified: boolean;
  accessToken: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

function bearer(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

/**
 * Verifies a Supabase access token.
 *
 * Prefers local verification via the project's JWKS (no round trip). Falls
 * back to asking Supabase directly, which always works but costs latency.
 */
async function verifyToken(token: string): Promise<AuthContext | null> {
  const env = loadEnv();

  try {
    jwks ??= createRemoteJWKSet(new URL(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`));
    const { payload } = await jwtVerify(token, jwks, { issuer: `${env.SUPABASE_URL}/auth/v1` });
    if (typeof payload.sub !== 'string') return null;
    return {
      userId: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : null,
      // Supabase stamps this once the verification link is opened.
      emailVerified: Boolean(
        (payload as Record<string, unknown>)['email_verified'] ??
          (payload as Record<string, unknown>)['user_metadata'],
      ),
      accessToken: token,
    };
  } catch {
    // Local verification failed — fall through and ask Supabase.
  }

  const { data, error } = await serviceClient().auth.getUser(token);
  if (error || !data.user) return null;
  return {
    userId: data.user.id,
    email: data.user.email ?? null,
    emailVerified: Boolean(data.user.email_confirmed_at),
    accessToken: token,
  };
}

/** Attaches auth when a valid token is present; never rejects. */
export async function optionalAuth(req: FastifyRequest): Promise<void> {
  const token = bearer(req);
  if (!token) return;
  const ctx = await verifyToken(token);
  if (ctx) req.auth = ctx;
}

/** Rejects the request unless a valid token is present. */
export async function requireAuth(req: FastifyRequest, _reply: FastifyReply): Promise<AuthContext> {
  const token = bearer(req);
  if (!token) throw unauthorized();
  const ctx = await verifyToken(token);
  if (!ctx) throw unauthorized('Your session has expired. Please sign in again.');
  req.auth = ctx;
  return ctx;
}

/**
 * Requires a verified email address. Account verification is a real gate,
 * not decoration: an unverified account cannot transact.
 */
export async function requireVerified(req: FastifyRequest, reply: FastifyReply): Promise<AuthContext> {
  const ctx = await requireAuth(req, reply);
  if (!ctx.emailVerified) {
    throw forbidden('Please verify your email address before continuing.');
  }
  return ctx;
}

export interface SellerContext extends AuthContext {
  sellerId: string;
  stallName: string;
}

/**
 * Requires that the caller owns a stall, and returns its id.
 *
 * Note the seller id is READ FROM THE DATABASE for the authenticated user —
 * it is never taken from the request. This is the single most important line
 * in the AI permission model: there is no way for a caller, or a model, to
 * name a different seller.
 */
export async function requireSeller(req: FastifyRequest, reply: FastifyReply): Promise<SellerContext> {
  const ctx = await requireAuth(req, reply);
  const db = userClient(ctx.accessToken);

  const { data, error } = await db
    .from('seller_profiles')
    .select('id, stall_name')
    .eq('id', ctx.userId)
    .maybeSingle();

  if (error) throw forbidden('Could not confirm your seller account');
  if (!data) throw forbidden('This action is only available to sellers');

  return { ...ctx, sellerId: data.id as string, stallName: data.stall_name as string };
}

/** The caller's role, or null when signed out. */
export async function currentRole(ctx: AuthContext): Promise<'buyer' | 'seller' | null> {
  const { data } = await userClient(ctx.accessToken)
    .from('profiles')
    .select('role')
    .eq('id', ctx.userId)
    .maybeSingle();
  return (data?.role as 'buyer' | 'seller' | undefined) ?? null;
}
