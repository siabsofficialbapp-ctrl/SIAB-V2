/**
 * Seller Insights & Analytics (§16, §18).
 *
 * Every figure is read from `v_seller_analytics`, which is a VIEW over real
 * orders, costs, conversations and views. Nothing here is stored, cached or
 * seeded — if a number is wrong, the underlying rows are wrong.
 */
import type { FastifyInstance } from 'fastify';

import { createCostSchema, scoreBand } from '@siab/core';

import { requireSeller } from '../auth.js';
import { fromPostgrest } from '../errors.js';
import { userClient } from '../supabase.js';

export async function analyticsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/seller/analytics', async (req, reply) => {
    const seller = await requireSeller(req, reply);
    const db = userClient(seller.accessToken);

    // The SECURITY DEFINER accessor re-checks ownership itself, so this is
    // safe even if the route were somehow reached with the wrong id.
    const { data, error } = await db.rpc('siab_seller_analytics', { p_seller: seller.sellerId });
    if (error) throw fromPostgrest(error);

    const a = (Array.isArray(data) ? data[0] : data) as Record<string, number> | undefined;

    const empty = {
      revenueMinor: 0, vatMinor: 0, platformFeeMinor: 0, costsMinor: 0, netProfitMinor: 0,
      completedOrders: 0, averageOrderMinor: 0, buyerConversations: 0, stallViews: 0,
      activeProducts: 0, reputationScore: 100,
    };
    const m = a
      ? {
          revenueMinor: a['revenue_minor'] ?? 0,
          vatMinor: a['vat_minor'] ?? 0,
          platformFeeMinor: a['platform_fee_minor'] ?? 0,
          costsMinor: a['costs_minor'] ?? 0,
          netProfitMinor: a['net_profit_minor'] ?? 0,
          completedOrders: a['completed_orders'] ?? 0,
          averageOrderMinor: a['average_order_minor'] ?? 0,
          buyerConversations: a['buyer_conversations'] ?? 0,
          stallViews: a['stall_views'] ?? 0,
          activeProducts: a['active_products'] ?? 0,
          reputationScore: a['reputation_score'] ?? 100,
        }
      : empty;

    // Recent orders for the dashboard strip.
    const { data: recent } = await db
      .from('orders')
      .select('id, reference, product_title, total_minor, status, created_at')
      .eq('seller_id', seller.sellerId)
      .order('created_at', { ascending: false })
      .limit(5);

    return {
      analytics: { sellerId: seller.sellerId, ...m, scoreBand: scoreBand(m.reputationScore) },
      recentOrders: (recent ?? []).map((o) => ({
        id: o.id,
        reference: o.reference,
        productTitle: o.product_title,
        totalMinor: o.total_minor,
        status: o.status,
        createdAt: o.created_at,
      })),
      // The client shows this so nobody mistakes these for illustrative figures.
      computedFrom: 'completed orders, recorded costs, conversations and stall views',
    };
  });

  app.get('/seller/costs', async (req, reply) => {
    const seller = await requireSeller(req, reply);
    const { data, error } = await userClient(seller.accessToken)
      .from('seller_costs')
      .select('id, label, amount_minor, order_id, incurred_on, created_at')
      .eq('seller_id', seller.sellerId)
      .order('incurred_on', { ascending: false })
      .limit(200);
    if (error) throw fromPostgrest(error);
    return {
      costs: (data ?? []).map((c) => ({
        id: c.id,
        label: c.label,
        amountMinor: c.amount_minor,
        orderId: c.order_id,
        incurredOn: c.incurred_on,
      })),
    };
  });

  app.post('/seller/costs', async (req, reply) => {
    const seller = await requireSeller(req, reply);
    const body = createCostSchema.parse(req.body);
    const { data, error } = await userClient(seller.accessToken)
      .from('seller_costs')
      .insert({
        seller_id: seller.sellerId,
        label: body.label,
        amount_minor: body.amountMinor,
        order_id: body.orderId ?? null,
        ...(body.incurredOn ? { incurred_on: body.incurredOn } : {}),
      })
      .select('id')
      .single();
    if (error) throw fromPostgrest(error);
    return { id: data.id };
  });

  app.delete<{ Params: { id: string } }>('/seller/costs/:id', async (req, reply) => {
    const seller = await requireSeller(req, reply);
    const { error } = await userClient(seller.accessToken)
      .from('seller_costs')
      .delete()
      .eq('id', req.params.id)
      .eq('seller_id', seller.sellerId);
    if (error) throw fromPostgrest(error);
    return { deleted: true };
  });

  /** Stall editing, including the opt-in public location (§22). */
  app.patch('/seller/stall', async (req, reply) => {
    const seller = await requireSeller(req, reply);
    const body = req.body as Record<string, unknown>;

    const patch: Record<string, unknown> = {};
    if (typeof body['stallName'] === 'string') patch['stall_name'] = body['stallName'];
    if (typeof body['bio'] === 'string' || body['bio'] === null) patch['bio'] = body['bio'];
    if (typeof body['logoUrl'] === 'string' || body['logoUrl'] === null) patch['logo_url'] = body['logoUrl'];
    if (typeof body['bannerUrl'] === 'string' || body['bannerUrl'] === null) patch['banner_url'] = body['bannerUrl'];
    if (typeof body['locationLabel'] === 'string' || body['locationLabel'] === null) {
      patch['location_label'] = body['locationLabel'];
    }
    if (typeof body['locationPublic'] === 'boolean') patch['location_public'] = body['locationPublic'];

    if (Object.keys(patch).length === 0) return { updated: false };

    const { error } = await userClient(seller.accessToken)
      .from('seller_profiles')
      .update(patch)
      .eq('id', seller.sellerId);
    if (error) throw fromPostgrest(error);
    return { updated: true };
  });
}
