/**
 * Profile, privacy toggles, the verified email-change flow, and the public
 * profile card shown when you tap someone's name (§33, §44).
 */
import type { FastifyInstance } from 'fastify';

import { requestEmailChangeSchema, scoreBand, updateProfileSchema } from '@siab/core';

import { requireAuth } from '../auth.js';
import { badRequest, fromPostgrest, notFound } from '../errors.js';
import { anonClient, serviceClient, userClient } from '../supabase.js';

export async function profileRoutes(app: FastifyInstance): Promise<void> {
  /** The signed-in user's own profile — every field, including private ones. */
  app.get('/me', async (req, reply) => {
    const ctx = await requireAuth(req, reply);
    const db = userClient(ctx.accessToken);

    const { data, error } = await db
      .from('profiles')
      .select('*')
      .eq('id', ctx.userId)
      .maybeSingle();
    if (error) throw fromPostgrest(error);
    if (!data) throw notFound('Profile');

    let stall = null;
    if (data.role === 'seller') {
      const { data: s } = await db
        .from('seller_profiles')
        .select('id, stall_name, stall_slug, bio, logo_url, banner_url, location_label, location_public')
        .eq('id', ctx.userId)
        .maybeSingle();
      stall = s;
    }

    return {
      profile: {
        id: data.id,
        role: data.role,
        displayName: data.display_name,
        avatarUrl: data.avatar_url,
        locale: data.locale,
        email: data.email,
        phone: data.phone,
        region: data.region,
        emailPublic: data.email_public,
        phonePublic: data.phone_public,
        regionPublic: data.region_public,
        reputationScore: data.reputation_score,
        scoreBand: scoreBand(data.reputation_score),
        emailVerified: ctx.emailVerified,
        createdAt: data.created_at,
      },
      stall,
    };
  });

  /**
   * Updates editable profile fields.
   *
   * `email` is absent by design: changing it requires verifying the new
   * address, which is a different flow entirely. `role` and `reputationScore`
   * are absent because the database revokes UPDATE on those columns.
   */
  app.patch('/me', async (req, reply) => {
    const ctx = await requireAuth(req, reply);
    const body = updateProfileSchema.parse(req.body);
    const db = userClient(ctx.accessToken);

    const patch: Record<string, unknown> = {};
    if (body.displayName !== undefined) patch['display_name'] = body.displayName;
    if (body.avatarUrl !== undefined) patch['avatar_url'] = body.avatarUrl;
    if (body.locale !== undefined) patch['locale'] = body.locale;
    if (body.phone !== undefined) patch['phone'] = body.phone;
    if (body.region !== undefined) patch['region'] = body.region;
    if (body.emailPublic !== undefined) patch['email_public'] = body.emailPublic;
    if (body.phonePublic !== undefined) patch['phone_public'] = body.phonePublic;
    if (body.regionPublic !== undefined) patch['region_public'] = body.regionPublic;

    if (Object.keys(patch).length === 0) return { updated: false };

    const { error } = await db.from('profiles').update(patch).eq('id', ctx.userId);
    if (error) throw fromPostgrest(error);
    return { updated: true };
  });

  /**
   * Starts an email change.
   *
   * Supabase sends a confirmation link to the NEW address and only swaps it
   * once that link is opened. Until then nothing changes — which is why the
   * old address cannot be stolen by typing a new one into a form.
   */
  app.post('/me/email', async (req, reply) => {
    const ctx = await requireAuth(req, reply);
    const { newEmail } = requestEmailChangeSchema.parse(req.body);

    if (newEmail.toLowerCase() === (ctx.email ?? '').toLowerCase()) {
      throw badRequest('That is already your email address.');
    }

    const { error } = await serviceClient().auth.admin.updateUserById(ctx.userId, {
      email: newEmail,
      // Forces the confirm-by-link flow rather than changing it outright.
      email_confirm: false,
    });
    if (error) throw badRequest(error.message);

    return {
      pending: true,
      pendingEmail: newEmail,
      messageKey: 'settings.emailChangePending',
    };
  });

  /** Re-syncs `profiles.email` after Supabase confirms a change. */
  app.post('/me/email/sync', async (req, reply) => {
    const ctx = await requireAuth(req, reply);
    if (!ctx.email) return { synced: false };
    const { error } = await serviceClient()
      .from('profiles')
      .update({ email: ctx.email })
      .eq('id', ctx.userId);
    if (error) throw fromPostgrest(error);
    return { synced: true, email: ctx.email };
  });

  /**
   * Anyone's public profile card — what you see when you tap a name or avatar
   * next to a message or an order.
   *
   * Contact fields are nulled out by the database view unless the member
   * opted in, so this handler cannot leak them even by mistake.
   */
  app.get<{ Params: { id: string } }>('/profiles/:id', async (req) => {
    const db = anonClient();

    const { data: seller } = await db
      .from('v_public_seller')
      .select('*')
      .eq('seller_id', req.params.id)
      .maybeSingle();

    if (seller) {
      return {
        profile: {
          id: seller.seller_id,
          role: 'seller',
          displayName: seller.display_name,
          avatarUrl: seller.avatar_url,
          reputationScore: seller.reputation_score,
          scoreBand: seller.score_band,
          email: seller.email,
          phone: seller.phone,
          region: seller.region,
          createdAt: seller.created_at,
          stallName: seller.stall_name,
          stallSlug: seller.stall_slug,
          bio: seller.bio,
          logoUrl: seller.logo_url,
          bannerUrl: seller.banner_url,
          locationLabel: seller.location_label,
        },
      };
    }

    const { data: buyer } = await db
      .from('v_public_buyer')
      .select('*')
      .eq('buyer_id', req.params.id)
      .maybeSingle();
    if (!buyer) throw notFound('Profile');

    return {
      profile: {
        id: buyer.buyer_id,
        role: 'buyer',
        displayName: buyer.display_name,
        avatarUrl: buyer.avatar_url,
        reputationScore: buyer.reputation_score,
        scoreBand: buyer.score_band,
        email: buyer.email,
        phone: buyer.phone,
        region: buyer.region,
        createdAt: buyer.created_at,
      },
    };
  });

  /** Notifications for the signed-in user. */
  app.get('/notifications', async (req, reply) => {
    const ctx = await requireAuth(req, reply);
    const { data, error } = await userClient(ctx.accessToken)
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw fromPostgrest(error);
    return {
      notifications: (data ?? []).map((n) => ({
        id: n.id,
        kind: n.kind,
        titleKey: n.title_key,
        bodyKey: n.body_key,
        params: n.params,
        target: n.target,
        readAt: n.read_at,
        createdAt: n.created_at,
      })),
      unread: (data ?? []).filter((n) => !n.read_at).length,
    };
  });

  app.post<{ Params: { id: string } }>('/notifications/:id/read', async (req, reply) => {
    const ctx = await requireAuth(req, reply);
    const { error } = await userClient(ctx.accessToken)
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', req.params.id);
    if (error) throw fromPostgrest(error);
    return { read: true };
  });
}
