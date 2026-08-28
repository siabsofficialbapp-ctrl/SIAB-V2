/**
 * The two AI surfaces (§12, §14) and the seller's teaching interface.
 *
 * Both assistants are reached ONLY through this service. The Anthropic key
 * never leaves the server, and the seller identity behind every private call
 * is derived from the JWT by `requireSeller`.
 */
import type { FastifyInstance } from 'fastify';

import {
  askCoworkerSchema,
  askCustomerAiSchema,
  updateAiSettingsSchema,
  upsertKnowledgeSchema,
} from '@siab/core';

import { requireAuth, requireSeller } from '../auth.js';
import { badRequest, fromPostgrest, notFound, tooManyRequests } from '../errors.js';
import { askCoworker } from '../services/ai/coworkerAi.js';
import { askCustomerAi } from '../services/ai/customerAi.js';
import { anonClient, serviceClient, userClient } from '../supabase.js';

/**
 * Per-seller daily budget (§29). Counted server-side so a client cannot
 * spend someone else's allowance or its own beyond the cap.
 */
async function checkAndCountUsage(
  sellerId: string,
  surface: 'customer' | 'coworker',
  cap: number,
): Promise<void> {
  const db = serviceClient();
  const day = new Date().toISOString().slice(0, 10);

  const { data } = await db
    .from('ai_usage')
    .select('requests')
    .eq('seller_id', sellerId)
    .eq('day', day)
    .eq('surface', surface)
    .maybeSingle();

  const used = (data?.requests as number) ?? 0;
  if (used >= cap) {
    throw tooManyRequests('This assistant has reached its limit for today.');
  }

  await db
    .from('ai_usage')
    .upsert(
      { seller_id: sellerId, day, surface, requests: used + 1 },
      { onConflict: 'seller_id,day,surface' },
    );
}

async function recordTokens(
  sellerId: string,
  surface: 'customer' | 'coworker',
  input: number,
  output: number,
): Promise<void> {
  const db = serviceClient();
  const day = new Date().toISOString().slice(0, 10);
  const { data } = await db
    .from('ai_usage')
    .select('requests, input_tokens, output_tokens')
    .eq('seller_id', sellerId)
    .eq('day', day)
    .eq('surface', surface)
    .maybeSingle();
  await db.from('ai_usage').upsert(
    {
      seller_id: sellerId,
      day,
      surface,
      requests: (data?.requests as number) ?? 1,
      input_tokens: ((data?.input_tokens as number) ?? 0) + input,
      output_tokens: ((data?.output_tokens as number) ?? 0) + output,
    },
    { onConflict: 'seller_id,day,surface' },
  );
}

export async function aiRoutes(app: FastifyInstance): Promise<void> {
  // =========================================================================
  // Customer AI — the buyer-facing assistant
  // =========================================================================

  /** One-shot question, outside a stored thread. */
  app.post('/ai/customer/ask', async (req, reply) => {
    const ctx = await requireAuth(req, reply);
    const body = askCustomerAiSchema.parse(req.body);

    const admin = serviceClient();
    const [{ data: settings }, { data: stall }] = await Promise.all([
      admin.from('seller_ai_settings').select('*').eq('seller_id', body.sellerId).maybeSingle(),
      admin.from('seller_profiles').select('stall_name').eq('id', body.sellerId).maybeSingle(),
    ]);
    if (!stall) throw notFound('Stall');
    if (!settings?.enabled) throw badRequest('This seller has turned their assistant off.', 'ai.disabled');

    await checkAndCountUsage(body.sellerId, 'customer', (settings.daily_message_cap as number) ?? 500);

    const { data: profile } = await userClient(ctx.accessToken)
      .from('profiles')
      .select('locale')
      .eq('id', ctx.userId)
      .maybeSingle();

    let productTitle: string | undefined;
    if (body.productId) {
      const { data: p } = await admin.from('products').select('title').eq('id', body.productId).maybeSingle();
      productTitle = (p?.title as string) ?? undefined;
    }

    const result = await askCustomerAi({
      sellerId: body.sellerId,
      stallName: stall.stall_name as string,
      settings: {
        enabled: true,
        tone: (settings.tone as string) ?? 'friendly',
        instructions: (settings.instructions as string) ?? null,
        fallbackBehaviour:
          (settings.fallback_behaviour as 'defer_to_seller' | 'say_unknown') ?? 'defer_to_seller',
      },
      // The assistant reads its OWNER's catalogue, so it runs with the
      // service client — but it is only ever handed public-read tools.
      db: admin,
      locale: ((profile?.locale as 'en' | 'ar') ?? 'en'),
      history: [],
      message: body.message,
      ...(productTitle ? { productTitle } : {}),
    });

    await recordTokens(body.sellerId, 'customer', result.inputTokens, result.outputTokens);
    return { reply: result.reply };
  });

  // =========================================================================
  // Seller: teaching the Customer AI
  // =========================================================================

  app.get('/seller/ai/settings', async (req, reply) => {
    const seller = await requireSeller(req, reply);
    const db = userClient(seller.accessToken);

    let { data } = await db.from('seller_ai_settings').select('*').eq('seller_id', seller.sellerId).maybeSingle();
    if (!data) {
      const created = await db
        .from('seller_ai_settings')
        .insert({ seller_id: seller.sellerId })
        .select('*')
        .single();
      data = created.data;
    }

    return {
      settings: {
        enabled: data?.enabled ?? true,
        tone: data?.tone ?? 'friendly',
        instructions: data?.instructions ?? null,
        greetingEn: data?.greeting_en ?? null,
        greetingAr: data?.greeting_ar ?? null,
        fallbackBehaviour: data?.fallback_behaviour ?? 'defer_to_seller',
        dailyMessageCap: data?.daily_message_cap ?? 500,
      },
    };
  });

  app.patch('/seller/ai/settings', async (req, reply) => {
    const seller = await requireSeller(req, reply);
    const body = updateAiSettingsSchema.parse(req.body);

    const patch: Record<string, unknown> = {};
    if (body.enabled !== undefined) patch['enabled'] = body.enabled;
    if (body.tone !== undefined) patch['tone'] = body.tone;
    if (body.instructions !== undefined) patch['instructions'] = body.instructions;
    if (body.greetingEn !== undefined) patch['greeting_en'] = body.greetingEn;
    if (body.greetingAr !== undefined) patch['greeting_ar'] = body.greetingAr;
    if (body.fallbackBehaviour !== undefined) patch['fallback_behaviour'] = body.fallbackBehaviour;
    if (Object.keys(patch).length === 0) return { updated: false };

    const { error } = await userClient(seller.accessToken)
      .from('seller_ai_settings')
      .update(patch)
      .eq('seller_id', seller.sellerId);
    if (error) throw fromPostgrest(error);
    return { updated: true };
  });

  app.get('/seller/ai/knowledge', async (req, reply) => {
    const seller = await requireSeller(req, reply);
    const { data, error } = await userClient(seller.accessToken)
      .from('seller_ai_knowledge')
      .select('*')
      .eq('seller_id', seller.sellerId)
      .order('created_at', { ascending: false });
    if (error) throw fromPostgrest(error);
    return {
      knowledge: (data ?? []).map((k) => ({
        id: k.id,
        title: k.title,
        content: k.content,
        category: k.category,
        isActive: k.is_active,
        createdAt: k.created_at,
      })),
    };
  });

  app.post('/seller/ai/knowledge', async (req, reply) => {
    const seller = await requireSeller(req, reply);
    const body = upsertKnowledgeSchema.parse(req.body);
    const { data, error } = await userClient(seller.accessToken)
      .from('seller_ai_knowledge')
      .insert({
        seller_id: seller.sellerId,
        title: body.title,
        content: body.content,
        category: body.category,
        is_active: body.isActive,
      })
      .select('id')
      .single();
    if (error) throw fromPostgrest(error);
    // No retraining: the next message already sees this (§2).
    return { id: data.id, liveImmediately: true };
  });

  app.patch<{ Params: { id: string } }>('/seller/ai/knowledge/:id', async (req, reply) => {
    const seller = await requireSeller(req, reply);
    const body = upsertKnowledgeSchema.partial().parse(req.body);
    const patch: Record<string, unknown> = {};
    if (body.title !== undefined) patch['title'] = body.title;
    if (body.content !== undefined) patch['content'] = body.content;
    if (body.category !== undefined) patch['category'] = body.category;
    if (body.isActive !== undefined) patch['is_active'] = body.isActive;
    if (Object.keys(patch).length === 0) return { updated: false };

    const { error } = await userClient(seller.accessToken)
      .from('seller_ai_knowledge')
      .update(patch)
      .eq('id', req.params.id)
      .eq('seller_id', seller.sellerId);
    if (error) throw fromPostgrest(error);
    return { updated: true };
  });

  app.delete<{ Params: { id: string } }>('/seller/ai/knowledge/:id', async (req, reply) => {
    const seller = await requireSeller(req, reply);
    const { error } = await userClient(seller.accessToken)
      .from('seller_ai_knowledge')
      .delete()
      .eq('id', req.params.id)
      .eq('seller_id', seller.sellerId);
    if (error) throw fromPostgrest(error);
    return { deleted: true };
  });

  // =========================================================================
  // AI Coworker — private to the seller
  // =========================================================================

  app.get('/seller/coworker/conversations', async (req, reply) => {
    const seller = await requireSeller(req, reply);
    const { data, error } = await userClient(seller.accessToken)
      .from('ai_conversations')
      .select('id, title, updated_at')
      .eq('seller_id', seller.sellerId)
      .order('updated_at', { ascending: false })
      .limit(30);
    if (error) throw fromPostgrest(error);
    return { conversations: data ?? [] };
  });

  app.get<{ Params: { id: string } }>('/seller/coworker/conversations/:id', async (req, reply) => {
    const seller = await requireSeller(req, reply);
    const { data, error } = await userClient(seller.accessToken)
      .from('ai_messages')
      .select('id, role, content, tool_calls, created_at')
      .eq('ai_conversation_id', req.params.id)
      .order('created_at', { ascending: true });
    if (error) throw fromPostgrest(error);
    return { messages: data ?? [] };
  });

  /**
   * Ask the Coworker.
   *
   * `requireSeller` is what makes this safe: the seller id comes from the
   * verified token, is closed over by every tool, and cannot be influenced
   * by the message body.
   */
  app.post('/seller/coworker/ask', async (req, reply) => {
    const seller = await requireSeller(req, reply);
    const body = askCoworkerSchema.parse(req.body);
    const db = userClient(seller.accessToken);

    await checkAndCountUsage(seller.sellerId, 'coworker', 200);

    let conversationId = body.conversationId;
    if (!conversationId) {
      const { data, error } = await db
        .from('ai_conversations')
        .insert({ seller_id: seller.sellerId, title: body.message.slice(0, 60) })
        .select('id')
        .single();
      if (error) throw fromPostgrest(error);
      conversationId = data.id as string;
    }

    const { data: prior } = await db
      .from('ai_messages')
      .select('role, content')
      .eq('ai_conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(20);

    const { data: profile } = await db
      .from('profiles')
      .select('locale')
      .eq('id', seller.userId)
      .maybeSingle();

    await db.from('ai_messages').insert({
      ai_conversation_id: conversationId,
      role: 'user',
      content: body.message,
    });

    const result = await askCoworker({
      sellerId: seller.sellerId,
      stallName: seller.stallName,
      db,
      locale: ((profile?.locale as 'en' | 'ar') ?? 'en'),
      history: (prior ?? []).map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content as string,
      })),
      message: body.message,
    });

    // The tool audit is stored alongside the reply, so a figure the Coworker
    // quoted can always be traced back to the query that produced it.
    await db.from('ai_messages').insert({
      ai_conversation_id: conversationId,
      role: 'assistant',
      content: result.reply,
      tool_calls: result.actions.length ? result.actions : null,
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
    });

    await recordTokens(seller.sellerId, 'coworker', result.inputTokens, result.outputTokens);

    return {
      conversationId,
      reply: result.reply,
      actions: result.actions.map((a) => ({ name: a.name, ok: a.ok, summary: a.summary })),
    };
  });

  /** The public greeting shown before a buyer types anything. */
  app.get<{ Params: { sellerId: string } }>('/ai/customer/:sellerId/greeting', async (req) => {
    const { data } = await anonClient()
      .from('seller_ai_settings')
      .select('enabled, greeting_en, greeting_ar')
      .eq('seller_id', req.params.sellerId)
      .maybeSingle();
    return {
      enabled: data?.enabled ?? false,
      greetingEn: data?.greeting_en ?? null,
      greetingAr: data?.greeting_ar ?? null,
    };
  });
}
