/**
 * Secure tools for the AI Coworker (§30).
 *
 * THE INVARIANT: every tool closes over a `sellerId` that came from the
 * caller's verified JWT. No tool takes a seller id as an argument, so there
 * is no field for a model — or a prompt injection inside a buyer's message —
 * to populate with someone else's id.
 *
 * Behind that, the queries run through a user-scoped Supabase client, so Row
 * Level Security is a second, independent barrier. Both would have to fail
 * for a leak to occur.
 */
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { SupabaseClient } from '@supabase/supabase-js';
// The SDK's betaZodTool helper is typed against Zod v4, which the installed
// zod package exposes at this subpath. The rest of SIAB uses the classic v3
// API; the two coexist fine because schemas never cross between them.
import { z } from 'zod/v4';

import { formatMoney, computeOrderTotals } from '@siab/core';

export interface ToolContext {
  /** From the JWT. Never from a request body or a model argument. */
  sellerId: string;
  /** RLS-scoped client for this seller. */
  db: SupabaseClient;
  locale: 'en' | 'ar';
}

/** Actions the Coworker took that the caller may want to surface in the UI. */
export interface ToolAudit {
  name: string;
  input: unknown;
  ok: boolean;
  summary: string;
}

const money = (minor: number, locale: 'en' | 'ar') => formatMoney(minor, locale);

export function buildCoworkerTools(ctx: ToolContext, audit: ToolAudit[]) {
  const record = (name: string, input: unknown, ok: boolean, summary: string) => {
    audit.push({ name, input, ok, summary });
  };

  // -------------------------------------------------------------------------
  // Read tools — the seller's own business
  // -------------------------------------------------------------------------

  const getAnalytics = betaZodTool({
    name: 'get_seller_analytics',
    description:
      'Get the seller\'s own headline business figures: revenue, net profit, ' +
      'average order value, completed orders, buyer conversations, stall views, ' +
      'live product count and SIAB score. All computed from real orders.',
    inputSchema: z.object({}),
    run: async () => {
      // Calls the SECURITY DEFINER accessor, which itself re-checks that the
      // caller owns this seller id before returning anything.
      const { data, error } = await ctx.db.rpc('siab_seller_analytics', { p_seller: ctx.sellerId });
      if (error) {
        record('get_seller_analytics', {}, false, error.message);
        return `Could not read analytics: ${error.message}`;
      }
      const a = Array.isArray(data) ? data[0] : data;
      if (!a) return 'No analytics available yet — there are no completed orders.';

      record('get_seller_analytics', {}, true, 'read analytics');
      return JSON.stringify({
        revenue: money(a.revenue_minor, ctx.locale),
        net_profit: money(a.net_profit_minor, ctx.locale),
        vat_collected: money(a.vat_minor, ctx.locale),
        platform_fees: money(a.platform_fee_minor, ctx.locale),
        recorded_costs: money(a.costs_minor, ctx.locale),
        completed_orders: a.completed_orders,
        average_order: money(a.average_order_minor, ctx.locale),
        buyer_conversations: a.buyer_conversations,
        stall_views: a.stall_views,
        live_products: a.active_products,
        siab_score: a.reputation_score,
        score_band: a.score_band,
      });
    },
  });

  const getOrders = betaZodTool({
    name: 'get_seller_orders',
    description:
      'List the seller\'s own orders, most recent first. Use to answer questions ' +
      'about recent sales, order status, or which products are selling.',
    inputSchema: z.object({
      status: z
        .enum(['awaiting_payment', 'confirmed', 'processing', 'shipped', 'delivered', 'completed', 'cancelled'])
        .optional()
        .describe('Filter to one status'),
      since: z.string().optional().describe('ISO date; only orders created on or after it'),
      limit: z.number().int().min(1).max(100).default(20),
    }),
    run: async (input) => {
      let q = ctx.db
        .from('orders')
        .select('reference, product_title, quantity, total_minor, status, payment_status, created_at, completed_at')
        .eq('seller_id', ctx.sellerId)
        .order('created_at', { ascending: false })
        .limit(input.limit);

      if (input.status) q = q.eq('status', input.status);
      if (input.since) q = q.gte('created_at', input.since);

      const { data, error } = await q;
      if (error) {
        record('get_seller_orders', input, false, error.message);
        return `Could not read orders: ${error.message}`;
      }
      record('get_seller_orders', input, true, `read ${data?.length ?? 0} orders`);
      return JSON.stringify(
        (data ?? []).map((o) => ({
          reference: o.reference,
          product: o.product_title,
          quantity: o.quantity,
          total: money(o.total_minor, ctx.locale),
          status: o.status,
          payment: o.payment_status,
          placed: o.created_at,
        })),
      );
    },
  });

  const getProducts = betaZodTool({
    name: 'get_seller_products',
    description: 'List the seller\'s own products with prices, stock and status.',
    inputSchema: z.object({
      status: z.enum(['draft', 'active', 'paused', 'sold_out', 'removed']).optional(),
      limit: z.number().int().min(1).max(100).default(50),
    }),
    run: async (input) => {
      let q = ctx.db
        .from('products')
        .select('id, title, price_minor, quantity, status, created_at')
        .eq('seller_id', ctx.sellerId)
        .order('created_at', { ascending: false })
        .limit(input.limit);
      if (input.status) q = q.eq('status', input.status);

      const { data, error } = await q;
      if (error) {
        record('get_seller_products', input, false, error.message);
        return `Could not read products: ${error.message}`;
      }
      record('get_seller_products', input, true, `read ${data?.length ?? 0} products`);
      return JSON.stringify(
        (data ?? []).map((p) => ({
          id: p.id,
          title: p.title,
          price: money(p.price_minor, ctx.locale),
          price_minor: p.price_minor,
          stock: p.quantity,
          status: p.status,
        })),
      );
    },
  });

  const getSalesByProduct = betaZodTool({
    name: 'get_sales_by_product',
    description:
      'Units sold and revenue per product, from completed orders only. Use for ' +
      '"which product sold the most" and "which products are performing poorly".',
    inputSchema: z.object({ since: z.string().optional() }),
    run: async (input) => {
      let q = ctx.db
        .from('orders')
        .select('product_title, quantity, total_minor')
        .eq('seller_id', ctx.sellerId)
        .eq('status', 'completed');
      if (input.since) q = q.gte('created_at', input.since);

      const { data, error } = await q;
      if (error) {
        record('get_sales_by_product', input, false, error.message);
        return `Could not read sales: ${error.message}`;
      }

      const totals = new Map<string, { units: number; revenue: number }>();
      for (const row of data ?? []) {
        const key = row.product_title as string;
        const cur = totals.get(key) ?? { units: 0, revenue: 0 };
        cur.units += row.quantity as number;
        cur.revenue += row.total_minor as number;
        totals.set(key, cur);
      }

      const ranked = [...totals.entries()]
        .map(([title, v]) => ({ product: title, units: v.units, revenue: money(v.revenue, ctx.locale), revenue_minor: v.revenue }))
        .sort((a, b) => b.revenue_minor - a.revenue_minor);

      record('get_sales_by_product', input, true, `ranked ${ranked.length} products`);
      // Products with zero sales are the interesting half of "performing poorly",
      // so they are listed explicitly rather than being absent.
      const { data: all } = await ctx.db
        .from('products')
        .select('title')
        .eq('seller_id', ctx.sellerId)
        .eq('status', 'active');
      const sold = new Set(ranked.map((r) => r.product));
      const neverSold = (all ?? []).map((p) => p.title as string).filter((t) => !sold.has(t));

      return JSON.stringify({ sold: ranked, never_sold: neverSold });
    },
  });

  const getCosts = betaZodTool({
    name: 'get_seller_costs',
    description: 'The seller\'s own recorded costs, used in the net profit figure.',
    inputSchema: z.object({ limit: z.number().int().min(1).max(100).default(50) }),
    run: async (input) => {
      const { data, error } = await ctx.db
        .from('seller_costs')
        .select('label, amount_minor, incurred_on')
        .eq('seller_id', ctx.sellerId)
        .order('incurred_on', { ascending: false })
        .limit(input.limit);
      if (error) return `Could not read costs: ${error.message}`;
      record('get_seller_costs', input, true, `read ${data?.length ?? 0} costs`);
      return JSON.stringify(
        (data ?? []).map((c) => ({ label: c.label, amount: money(c.amount_minor, ctx.locale), date: c.incurred_on })),
      );
    },
  });

  const getConversations = betaZodTool({
    name: 'get_buyer_conversation_stats',
    description:
      'How many buyers have been in touch, and how recently. Returns counts and ' +
      'timestamps only — never the contents of private messages.',
    inputSchema: z.object({}),
    run: async () => {
      const { data, error } = await ctx.db
        .from('conversations')
        .select('kind, last_message_at')
        .eq('seller_id', ctx.sellerId);
      if (error) return `Could not read conversations: ${error.message}`;

      const human = (data ?? []).filter((c) => c.kind === 'human');
      const ai = (data ?? []).filter((c) => c.kind === 'ai');
      record('get_buyer_conversation_stats', {}, true, 'read conversation counts');
      return JSON.stringify({
        direct_conversations: human.length,
        assistant_conversations: ai.length,
        most_recent: human.map((c) => c.last_message_at).filter(Boolean).sort().at(-1) ?? null,
      });
    },
  });

  // -------------------------------------------------------------------------
  // Public marketplace — competitor comparison (§14)
  //
  // Reads ONLY the public product view. Another seller's costs, margins and
  // private analytics are not reachable here by construction.
  // -------------------------------------------------------------------------

  const comparePublicPrices = betaZodTool({
    name: 'compare_public_prices',
    description:
      'Compare the seller\'s prices against other sellers\' PUBLIC listings for ' +
      'similar products. Only publicly visible marketplace data is available — ' +
      'no other seller\'s private figures exist to be read.',
    inputSchema: z.object({
      query: z.string().min(1).describe('Product keywords to compare, e.g. "leather wallet"'),
      limit: z.number().int().min(1).max(30).default(15),
    }),
    run: async (input) => {
      const { data, error } = await ctx.db
        .from('products')
        .select('title, price_minor, seller_id, seller_profiles!inner(stall_name)')
        .eq('status', 'active')
        .ilike('title', `%${input.query}%`)
        .limit(input.limit);
      if (error) {
        record('compare_public_prices', input, false, error.message);
        return `Could not search listings: ${error.message}`;
      }

      const rows = (data ?? []).map((p) => ({
        title: p.title as string,
        price_minor: p.price_minor as number,
        price: money(p.price_minor as number, ctx.locale),
        stall: (p.seller_profiles as unknown as { stall_name: string })?.stall_name ?? 'unknown',
        is_mine: p.seller_id === ctx.sellerId,
      }));

      const others = rows.filter((r) => !r.is_mine).map((r) => r.price_minor);
      const stats = others.length
        ? {
            count: others.length,
            cheapest: money(Math.min(...others), ctx.locale),
            dearest: money(Math.max(...others), ctx.locale),
            average: money(Math.round(others.reduce((a, b) => a + b, 0) / others.length), ctx.locale),
          }
        : null;

      record('compare_public_prices', input, true, `compared ${rows.length} listings`);
      return JSON.stringify({ market: stats, listings: rows });
    },
  });

  // -------------------------------------------------------------------------
  // Write tools — the Coworker manages the seller's own catalogue
  //
  // Scoped by `seller_id = ctx.sellerId` on every statement, so even a
  // hallucinated product id cannot touch another stall's row.
  // -------------------------------------------------------------------------

  const createProduct = betaZodTool({
    name: 'create_product',
    description:
      'Create a new product in the seller\'s own stall. Price is in SAR and is ' +
      'VAT-inclusive — it is the price the buyer pays. New products are created ' +
      'as drafts unless publish is true.',
    inputSchema: z.object({
      title: z.string().min(2).max(140),
      description: z.string().max(5000).optional(),
      price_sar: z.number().positive().describe('VAT-inclusive price in SAR, e.g. 249.99'),
      quantity: z.number().int().min(0).default(1),
      publish: z.boolean().default(false),
    }),
    run: async (input) => {
      const priceMinor = Math.round(input.price_sar * 100);
      const { data, error } = await ctx.db
        .from('products')
        .insert({
          seller_id: ctx.sellerId,
          title: input.title,
          description: input.description ?? null,
          price_minor: priceMinor,
          quantity: input.quantity,
          status: input.publish ? 'active' : 'draft',
        })
        .select('id, title, status')
        .single();

      if (error) {
        record('create_product', input, false, error.message);
        return `Could not create the product: ${error.message}`;
      }
      record('create_product', input, true, `created "${data.title}"`);
      return JSON.stringify({
        created: true,
        id: data.id,
        title: data.title,
        status: data.status,
        note: 'The product has no photos yet. Remind the seller to add one — listings with photos sell far better.',
      });
    },
  });

  const updateProduct = betaZodTool({
    name: 'update_product',
    description: 'Update one of the seller\'s own products. Only the fields supplied are changed.',
    inputSchema: z.object({
      product_id: z.string().uuid(),
      title: z.string().min(2).max(140).optional(),
      description: z.string().max(5000).optional(),
      price_sar: z.number().positive().optional(),
      quantity: z.number().int().min(0).optional(),
      status: z.enum(['draft', 'active', 'paused', 'sold_out']).optional(),
    }),
    run: async (input) => {
      const patch: Record<string, unknown> = {};
      if (input.title !== undefined) patch['title'] = input.title;
      if (input.description !== undefined) patch['description'] = input.description;
      if (input.price_sar !== undefined) patch['price_minor'] = Math.round(input.price_sar * 100);
      if (input.quantity !== undefined) patch['quantity'] = input.quantity;
      if (input.status !== undefined) patch['status'] = input.status;

      if (Object.keys(patch).length === 0) return 'Nothing to update — no fields were supplied.';

      const { data, error } = await ctx.db
        .from('products')
        .update(patch)
        .eq('id', input.product_id)
        .eq('seller_id', ctx.sellerId) // belt and braces alongside RLS
        .select('id, title, price_minor, quantity, status')
        .maybeSingle();

      if (error) {
        record('update_product', input, false, error.message);
        return `Could not update the product: ${error.message}`;
      }
      if (!data) {
        record('update_product', input, false, 'not found');
        return 'No product with that id exists in this stall.';
      }
      record('update_product', input, true, `updated "${data.title}"`);
      return JSON.stringify({
        updated: true,
        id: data.id,
        title: data.title,
        price: money(data.price_minor, ctx.locale),
        stock: data.quantity,
        status: data.status,
      });
    },
  });

  const deleteProduct = betaZodTool({
    name: 'delete_product',
    description:
      'Remove one of the seller\'s own products from the marketplace. This is a ' +
      'soft delete: the listing stops being visible but order history is preserved.',
    inputSchema: z.object({ product_id: z.string().uuid() }),
    run: async (input) => {
      const { data, error } = await ctx.db
        .from('products')
        .update({ status: 'removed' })
        .eq('id', input.product_id)
        .eq('seller_id', ctx.sellerId)
        .select('id, title')
        .maybeSingle();

      if (error) {
        record('delete_product', input, false, error.message);
        return `Could not remove the product: ${error.message}`;
      }
      if (!data) return 'No product with that id exists in this stall.';
      record('delete_product', input, true, `removed "${data.title}"`);
      return JSON.stringify({ removed: true, id: data.id, title: data.title });
    },
  });

  const recordCost = betaZodTool({
    name: 'record_cost',
    description:
      'Record a business cost so net profit stays accurate. Costs are private ' +
      'to the seller and are subtracted from revenue in the analytics.',
    inputSchema: z.object({
      label: z.string().min(1).max(200),
      amount_sar: z.number().nonnegative(),
      incurred_on: z.string().optional().describe('ISO date; defaults to today'),
    }),
    run: async (input) => {
      const { error } = await ctx.db.from('seller_costs').insert({
        seller_id: ctx.sellerId,
        label: input.label,
        amount_minor: Math.round(input.amount_sar * 100),
        ...(input.incurred_on ? { incurred_on: input.incurred_on } : {}),
      });
      if (error) {
        record('record_cost', input, false, error.message);
        return `Could not record the cost: ${error.message}`;
      }
      record('record_cost', input, true, `recorded "${input.label}"`);
      return JSON.stringify({ recorded: true });
    },
  });

  const estimateMargin = betaZodTool({
    name: 'estimate_margin',
    description:
      'Work out what the seller actually keeps from a given sale price, after ' +
      '15% Saudi VAT and the SIAB platform fee.',
    inputSchema: z.object({
      price_sar: z.number().positive(),
      unit_cost_sar: z.number().nonnegative().optional(),
    }),
    run: async (input) => {
      const t = computeOrderTotals(Math.round(input.price_sar * 100));
      const costMinor = Math.round((input.unit_cost_sar ?? 0) * 100);
      record('estimate_margin', input, true, 'computed margin');
      return JSON.stringify({
        buyer_pays: money(t.totalMinor, ctx.locale),
        vat_included: money(t.vatMinor, ctx.locale),
        siab_fee: money(t.platformFeeMinor, ctx.locale),
        you_receive: money(t.sellerNetMinor, ctx.locale),
        your_cost: money(costMinor, ctx.locale),
        profit_per_unit: money(t.sellerNetMinor - costMinor, ctx.locale),
      });
    },
  });

  return [
    getAnalytics,
    getOrders,
    getProducts,
    getSalesByProduct,
    getCosts,
    getConversations,
    comparePublicPrices,
    createProduct,
    updateProduct,
    deleteProduct,
    recordCost,
    estimateMargin,
  ];
}

/**
 * Read-only tools for the CUSTOMER AI (§13).
 *
 * A far smaller surface: the seller's public listings and the knowledge they
 * chose to publish. There is deliberately no analytics tool, no order tool,
 * and no write tool here — the buyer-facing assistant has nothing to leak
 * because nothing private is within its reach.
 */
export function buildCustomerTools(ctx: { sellerId: string; db: SupabaseClient; locale: 'en' | 'ar' }) {
  const lookUpProducts = betaZodTool({
    name: 'look_up_products',
    description:
      'Search this seller\'s live products for current names, prices and stock. ' +
      'Always use this before quoting a price — never rely on memory.',
    inputSchema: z.object({
      query: z.string().optional().describe('Keywords; omit to list everything'),
      limit: z.number().int().min(1).max(20).default(10),
    }),
    run: async (input) => {
      let q = ctx.db
        .from('products')
        .select('title, description, price_minor, quantity, status')
        .eq('seller_id', ctx.sellerId)
        .eq('status', 'active')
        .limit(input.limit);
      if (input.query) q = q.ilike('title', `%${input.query}%`);

      const { data, error } = await q;
      if (error) return 'Product information is unavailable right now.';
      if (!data?.length) return JSON.stringify({ products: [], note: 'No matching products are listed.' });

      return JSON.stringify({
        products: data.map((p) => ({
          name: p.title,
          description: p.description,
          price: money(p.price_minor as number, ctx.locale),
          in_stock: (p.quantity as number) > 0,
          quantity_available: p.quantity,
        })),
      });
    },
  });

  const searchKnowledge = betaZodTool({
    name: 'search_seller_knowledge',
    description:
      'Search what the seller has taught you: policies, delivery, returns, and ' +
      'answers to common questions. Use this before saying you do not know.',
    inputSchema: z.object({ query: z.string().min(1), limit: z.number().int().min(1).max(10).default(5) }),
    run: async (input) => {
      const { data, error } = await ctx.db
        .from('seller_ai_knowledge')
        .select('title, content, category')
        .eq('seller_id', ctx.sellerId)
        .eq('is_active', true)
        .textSearch('search_tsv', input.query, { type: 'websearch', config: 'simple' })
        .limit(input.limit);

      if (error || !data?.length) {
        // Fall back to listing everything — these knowledge bases are small,
        // and a failed full-text match should not read as "I don't know".
        const { data: all } = await ctx.db
          .from('seller_ai_knowledge')
          .select('title, content, category')
          .eq('seller_id', ctx.sellerId)
          .eq('is_active', true)
          .limit(20);
        return JSON.stringify({ entries: all ?? [] });
      }
      return JSON.stringify({ entries: data });
    },
  });

  return [lookUpProducts, searchKnowledge];
}
