/**
 * First entry: terms, role selection, verification (§5, §6).
 */
import type { FastifyInstance } from 'fastify';

import { acceptTermsSchema, chooseRoleSchema } from '@siab/core';

import { requireAuth } from '../auth.js';
import { badRequest, conflict, fromPostgrest, notFound } from '../errors.js';
import { anonClient, serviceClient, userClient } from '../supabase.js';

/** Turns a stall name into a URL-safe slug, keeping Arabic letters intact. */
function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

export async function onboardingRoutes(app: FastifyInstance): Promise<void> {
  /** The Terms currently in force. Public: it is shown before sign-in. */
  app.get('/terms/current', async () => {
    const { data, error } = await anonClient()
      .from('terms_versions')
      .select('id, version, effective_at, body_en, body_ar')
      .eq('is_current', true)
      .maybeSingle();

    if (error) throw fromPostgrest(error);
    if (!data) throw notFound('Terms');
    return { terms: data };
  });

  /** Whether this user still needs to accept, and what is left of onboarding. */
  app.get('/onboarding/state', async (req, reply) => {
    const ctx = await requireAuth(req, reply);
    const db = userClient(ctx.accessToken);

    const [{ data: current }, { data: profile }] = await Promise.all([
      anonClient().from('terms_versions').select('id, version').eq('is_current', true).maybeSingle(),
      db.from('profiles').select('id, role, display_name, locale').eq('id', ctx.userId).maybeSingle(),
    ]);

    let termsAccepted = false;
    if (current) {
      const { data: acceptance } = await db
        .from('terms_acceptances')
        .select('id')
        .eq('user_id', ctx.userId)
        .eq('terms_version_id', current.id)
        .maybeSingle();
      termsAccepted = Boolean(acceptance);
    }

    let stallName: string | null = null;
    if (profile?.role === 'seller') {
      const { data: stall } = await db
        .from('seller_profiles')
        .select('stall_name')
        .eq('id', ctx.userId)
        .maybeSingle();
      stallName = (stall?.stall_name as string) ?? null;
    }

    return {
      emailVerified: ctx.emailVerified,
      termsVersion: current?.version ?? null,
      termsVersionId: current?.id ?? null,
      termsAccepted,
      hasProfile: Boolean(profile),
      role: profile?.role ?? null,
      stallName,
      // The client uses this to decide which screen to show next.
      nextStep: !ctx.emailVerified
        ? 'verify_email'
        : !termsAccepted
          ? 'accept_terms'
          : !profile
            ? 'choose_role'
            : 'done',
    };
  });

  /** Records acceptance with the version and a timestamp (§6). */
  app.post('/terms/accept', async (req, reply) => {
    const ctx = await requireAuth(req, reply);
    const body = acceptTermsSchema.parse(req.body);
    const db = userClient(ctx.accessToken);

    const { data: version } = await anonClient()
      .from('terms_versions')
      .select('id')
      .eq('id', body.termsVersionId)
      .eq('is_current', true)
      .maybeSingle();
    if (!version) throw badRequest('That version of the Terms is no longer current.');

    const { error } = await db.from('terms_acceptances').insert({
      user_id: ctx.userId,
      terms_version_id: body.termsVersionId,
      ip_address: req.ip,
      user_agent: String(req.headers['user-agent'] ?? '').slice(0, 500),
    });

    // Accepting twice is not an error worth showing the user.
    if (error && error.code !== '23505') throw fromPostgrest(error);
    return { accepted: true };
  });

  /**
   * Creates the profile and, for sellers, the stall.
   *
   * A seller account cannot exist without a stall name — the schema enforces
   * it, and so does this handler, which creates both rows or neither.
   */
  app.post('/onboarding/role', async (req, reply) => {
    const ctx = await requireAuth(req, reply);
    const body = chooseRoleSchema.parse(req.body);
    const db = userClient(ctx.accessToken);

    const { data: existing } = await db
      .from('profiles')
      .select('id, role')
      .eq('id', ctx.userId)
      .maybeSingle();
    if (existing) throw conflict('This account already has a role. Change it in Settings.');

    const { error: profileError } = await db.from('profiles').insert({
      id: ctx.userId,
      role: body.role,
      display_name: body.displayName,
      email: ctx.email,
    });
    if (profileError) throw fromPostgrest(profileError);

    if (body.role === 'seller') {
      let slug = slugify(body.stallName);
      if (!slug) slug = `stall-${ctx.userId.slice(0, 8)}`;

      // Slugs must be unique; append a short suffix rather than failing.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const candidate = attempt === 0 ? slug : `${slug}-${Math.random().toString(36).slice(2, 6)}`;
        const { error } = await db.from('seller_profiles').insert({
          id: ctx.userId,
          stall_name: body.stallName,
          stall_slug: candidate,
        });
        if (!error) {
          // Every seller gets an assistant, switched on, from the start.
          await serviceClient()
            .from('seller_ai_settings')
            .insert({ seller_id: ctx.userId })
            .select()
            .maybeSingle();
          return { role: 'seller', stallSlug: candidate };
        }
        if (error.code !== '23505') {
          // Roll the profile back so the user is not stranded with a
          // seller profile and no stall.
          await serviceClient().from('profiles').delete().eq('id', ctx.userId);
          throw fromPostgrest(error);
        }
      }
      await serviceClient().from('profiles').delete().eq('id', ctx.userId);
      throw conflict('Could not create a unique stall name. Please try a different one.');
    }

    await db.from('buyer_profiles').insert({ id: ctx.userId });
    return { role: 'buyer' };
  });

  /** Checks a stall name before the user commits to it. */
  app.get<{ Querystring: { name?: string } }>('/onboarding/stall-name-available', async (req) => {
    const name = (req.query.name ?? '').trim();
    if (name.length < 2) return { available: false, reason: 'too_short' };
    const { data } = await anonClient()
      .from('seller_profiles')
      .select('id')
      .eq('stall_slug', slugify(name))
      .maybeSingle();
    return { available: !data };
  });
}
