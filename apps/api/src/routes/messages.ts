/**
 * Buyer↔seller chat (§23) and buyer↔Customer-AI chat (§24).
 *
 * Location is only ever sent as a deliberate act — there is no code path that
 * attaches a location to a message the user did not explicitly send (§22).
 */
import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';

import { sendMessageSchema, startConversationSchema } from '@siab/core';

import { requireAuth } from '../auth.js';
import { badRequest, forbidden, fromPostgrest, notFound } from '../errors.js';
import { notify } from '../lib/notify.js';
import { askCustomerAi } from '../services/ai/customerAi.js';
import { serviceClient, signedUrl, userClient } from '../supabase.js';

const CHAT_BUCKET = 'chat-images';
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];

/** Turns a PostGIS point into plain lat/lng for the client. */
function pointToLatLng(point: unknown): { latitude: number; longitude: number } | null {
  if (!point) return null;
  if (typeof point === 'object' && point !== null && 'coordinates' in point) {
    const coords = (point as { coordinates: number[] }).coordinates;
    if (Array.isArray(coords) && coords.length >= 2) {
      return { longitude: coords[0] as number, latitude: coords[1] as number };
    }
  }
  return null;
}

export async function messageRoutes(app: FastifyInstance): Promise<void> {
  app.get('/conversations', async (req, reply) => {
    const ctx = await requireAuth(req, reply);
    const db = userClient(ctx.accessToken);

    const { data, error } = await db
      .from('conversations')
      .select('*, seller_profiles ( stall_name, stall_slug, logo_url )')
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(100);
    if (error) throw fromPostgrest(error);

    const conversations = data ?? [];
    const otherIds = [
      ...new Set(conversations.map((c) => (c.buyer_id === ctx.userId ? c.seller_id : c.buyer_id))),
    ] as string[];

    const [{ data: buyers }, { data: sellers }] = await Promise.all([
      db.from('v_public_buyer').select('*').in('buyer_id', otherIds),
      db.from('v_public_seller').select('*').in('seller_id', otherIds),
    ]);
    const people = new Map<string, any>();
    for (const b of buyers ?? []) people.set(b.buyer_id, { ...b, id: b.buyer_id });
    for (const s of sellers ?? []) people.set(s.seller_id, { ...s, id: s.seller_id });

    return {
      conversations: conversations.map((c) => {
        const viewerIsSeller = c.seller_id === ctx.userId;
        const other = people.get(viewerIsSeller ? c.buyer_id : c.seller_id);
        return {
          id: c.id,
          kind: c.kind,
          buyerId: c.buyer_id,
          sellerId: c.seller_id,
          productId: c.product_id,
          lastMessageAt: c.last_message_at,
          viewerIsSeller,
          stallName: (c as any).seller_profiles?.stall_name ?? null,
          counterparty: other
            ? {
                id: other.id,
                displayName: other.display_name,
                avatarUrl: other.avatar_url,
                reputationScore: other.reputation_score,
                scoreBand: other.score_band,
                stallName: other.stall_name ?? null,
              }
            : null,
        };
      }),
    };
  });

  /** Opens (or reuses) a thread. `kind` picks the human or the AI. */
  app.post('/conversations', async (req, reply) => {
    const ctx = await requireAuth(req, reply);
    const body = startConversationSchema.parse(req.body);
    const db = userClient(ctx.accessToken);

    if (body.sellerId === ctx.userId) throw badRequest('You cannot message your own stall.');

    const { data: existing } = await db
      .from('conversations')
      .select('id')
      .eq('kind', body.kind)
      .eq('buyer_id', ctx.userId)
      .eq('seller_id', body.sellerId)
      .is('product_id', body.productId ?? null)
      .maybeSingle();
    if (existing) return { conversationId: existing.id, created: false };

    const { data, error } = await db
      .from('conversations')
      .insert({
        kind: body.kind,
        buyer_id: ctx.userId,
        seller_id: body.sellerId,
        product_id: body.productId ?? null,
      })
      .select('id')
      .single();
    if (error) throw fromPostgrest(error);
    return { conversationId: data.id, created: true };
  });

  app.get<{ Params: { id: string } }>('/conversations/:id/messages', async (req, reply) => {
    const ctx = await requireAuth(req, reply);
    const db = userClient(ctx.accessToken);

    const { data, error } = await db
      .from('messages')
      .select('*')
      .eq('conversation_id', req.params.id)
      .order('created_at', { ascending: true })
      .limit(200);
    if (error) throw fromPostgrest(error);

    // Chat images live in a PRIVATE bucket, so each needs a short-lived URL.
    const messages = await Promise.all(
      (data ?? []).map(async (m) => {
        const latLng = pointToLatLng(m.location_point);
        return {
          id: m.id,
          conversationId: m.conversation_id,
          senderId: m.sender_id,
          kind: m.kind,
          body: m.body,
          imageUrl: m.storage_path ? await signedUrl(CHAT_BUCKET, m.storage_path as string) : null,
          latitude: latLng?.latitude ?? null,
          longitude: latLng?.longitude ?? null,
          locationLabel: m.location_label,
          readAt: m.read_at,
          createdAt: m.created_at,
          isMine: m.sender_id === ctx.userId,
          isAi: m.sender_id === null,
        };
      }),
    );

    // Mark the other side's messages read.
    await db
      .from('messages')
      .update({ read_at: new Date().toISOString() })
      .eq('conversation_id', req.params.id)
      .neq('sender_id', ctx.userId)
      .is('read_at', null);

    return { messages };
  });

  app.post<{ Params: { id: string } }>('/conversations/:id/messages', async (req, reply) => {
    const ctx = await requireAuth(req, reply);
    const body = sendMessageSchema.parse(req.body);
    const db = userClient(ctx.accessToken);

    const { data: conversation } = await db
      .from('conversations')
      .select('id, kind, buyer_id, seller_id, product_id')
      .eq('id', req.params.id)
      .maybeSingle();
    if (!conversation) throw notFound('Conversation');

    const row: Record<string, unknown> = {
      conversation_id: conversation.id,
      sender_id: ctx.userId,
      kind: body.kind,
    };

    if (body.kind === 'text') row['body'] = body.body;
    if (body.kind === 'image') {
      if (!body.storagePath.startsWith(`${conversation.id}/`)) {
        throw badRequest('That image path does not belong to this conversation.');
      }
      row['storage_path'] = body.storagePath;
    }
    if (body.kind === 'location') {
      // Stored as a PostGIS point. Only ever reaches here because the user
      // tapped "send location" — nothing sends it in the background.
      row['location_point'] = `SRID=4326;POINT(${body.longitude} ${body.latitude})`;
      row['location_label'] = body.label ?? null;
    }

    const { data, error } = await db.from('messages').insert(row).select('id, created_at').single();
    if (error) throw fromPostgrest(error);

    const other = conversation.buyer_id === ctx.userId ? conversation.seller_id : conversation.buyer_id;

    // On an AI thread the assistant answers; on a human thread the person is notified.
    if (conversation.kind === 'ai' && body.kind === 'text') {
      const aiReply = await replyAsCustomerAi({
        conversationId: conversation.id as string,
        sellerId: conversation.seller_id as string,
        buyerToken: ctx.accessToken,
        message: body.body,
        productId: conversation.product_id as string | null,
      });
      return { messageId: data.id, aiReply };
    }

    await notify({
      userId: other as string,
      kind: 'message',
      titleKey: 'notification.newMessage',
      bodyKey: 'notification.newMessageBody',
      params: { preview: body.kind === 'text' ? body.body.slice(0, 80) : `[${body.kind}]` },
      target: { screen: 'conversation', id: conversation.id as string },
    });

    return { messageId: data.id };
  });

  /** A signed upload URL for a chat image, inside this conversation's folder. */
  app.post<{ Params: { id: string }; Body: { contentType?: string } }>(
    '/conversations/:id/images/upload-url',
    async (req, reply) => {
      const ctx = await requireAuth(req, reply);
      const contentType = req.body?.contentType ?? 'image/jpeg';
      if (!ALLOWED_IMAGE_TYPES.includes(contentType)) {
        throw badRequest('Unsupported image type', 'error.imageWrongType');
      }

      const db = userClient(ctx.accessToken);
      const { data: conversation } = await db
        .from('conversations')
        .select('id')
        .eq('id', req.params.id)
        .maybeSingle();
      if (!conversation) throw forbidden();

      const ext = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
      const path = `${req.params.id}/${randomUUID()}.${ext}`;

      const { data, error } = await db.storage.from(CHAT_BUCKET).createSignedUploadUrl(path);
      if (error) throw badRequest(`Could not prepare the upload: ${error.message}`, 'error.uploadFailed');
      return { uploadUrl: data.signedUrl, token: data.token, path, bucket: CHAT_BUCKET };
    },
  );
}

/**
 * Runs the Customer AI and writes its reply into the thread.
 *
 * Note which client is used where: the assistant reads the seller's public
 * catalogue and knowledge through a SERVICE client scoped by seller id — it
 * must see the seller's listings, not the buyer's view of the world — but it
 * is handed no tool that can read anything private.
 */
async function replyAsCustomerAi(input: {
  conversationId: string;
  sellerId: string;
  buyerToken: string;
  message: string;
  productId: string | null;
}): Promise<{ text: string } | { error: string }> {
  const admin = serviceClient();

  const [{ data: settings }, { data: stall }, { data: history }, { data: product }] = await Promise.all([
    admin.from('seller_ai_settings').select('*').eq('seller_id', input.sellerId).maybeSingle(),
    admin.from('seller_profiles').select('stall_name').eq('id', input.sellerId).maybeSingle(),
    admin
      .from('messages')
      .select('sender_id, body, kind')
      .eq('conversation_id', input.conversationId)
      .eq('kind', 'text')
      .order('created_at', { ascending: false })
      .limit(12),
    input.productId
      ? admin.from('products').select('title').eq('id', input.productId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  if (!settings?.enabled) {
    return { error: 'ai.disabled' };
  }

  // Oldest first, excluding the message we just stored (it is passed separately).
  const turns = (history ?? [])
    .slice(1)
    .reverse()
    .map((m) => ({
      role: (m.sender_id === null ? 'assistant' : 'user') as 'assistant' | 'user',
      content: (m.body as string) ?? '',
    }))
    .filter((m) => m.content.length > 0);

  try {
    const result = await askCustomerAi({
      sellerId: input.sellerId,
      stallName: (stall?.stall_name as string) ?? 'this stall',
      settings: {
        enabled: Boolean(settings.enabled),
        tone: (settings.tone as string) ?? 'friendly',
        instructions: (settings.instructions as string) ?? null,
        fallbackBehaviour: (settings.fallback_behaviour as 'defer_to_seller' | 'say_unknown') ?? 'defer_to_seller',
      },
      db: admin,
      locale: 'en',
      history: turns,
      message: input.message,
      ...(product?.title ? { productTitle: product.title as string } : {}),
    });

    // sender_id NULL marks a message as written by the assistant.
    await admin.from('messages').insert({
      conversation_id: input.conversationId,
      sender_id: null,
      kind: 'text',
      body: result.reply,
    });

    return { text: result.reply };
  } catch (err) {
    // The buyer's message is already saved. The assistant failing must not
    // lose it, and must not look like the seller ignoring them.
    return { error: (err as Error).message };
  }
}
