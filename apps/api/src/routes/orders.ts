/**
 * Bidding (§20), orders (§21), the fulfilment pipeline (§17), the mutual
 * handover confirmation, and the SIAB score.
 */
import type { FastifyInstance } from 'fastify';

import {
  advanceOrderSchema,
  canTransition,
  computeOrderTotals,
  createOrderSchema,
  formatMoney,
  generateOrderReference,
  placeBidSchema,
  rateOrderSchema,
  respondToBidSchema,
  type OrderStatus,
} from '@siab/core';

import { requireAuth, requireSeller, requireVerified } from '../auth.js';
import { badRequest, conflict, forbidden, fromPostgrest, notFound } from '../errors.js';
import { notify } from '../lib/notify.js';
import { paymentProvider } from '../services/payments/index.js';
import { serviceClient, userClient } from '../supabase.js';

export async function orderRoutes(app: FastifyInstance): Promise<void> {
  // =========================================================================
  // Bidding
  // =========================================================================

  app.post('/bids', async (req, reply) => {
    const ctx = await requireVerified(req, reply);
    const body = placeBidSchema.parse(req.body);
    const db = userClient(ctx.accessToken);

    const { data: product } = await db
      .from('products')
      .select('id, seller_id, title, allow_bidding, min_bid_minor, status')
      .eq('id', body.productId)
      .maybeSingle();
    if (!product) throw notFound('Product');
    if (product.status !== 'active') throw conflict('This product is not available.');
    if (!product.allow_bidding) throw conflict('This seller is not accepting offers.');
    if (product.seller_id === ctx.userId) throw forbidden('You cannot bid on your own product.');

    if (product.min_bid_minor && body.amountMinor < (product.min_bid_minor as number)) {
      throw badRequest('Your offer is below what this seller will consider.', 'bid.tooLow', {
        price: formatMoney(product.min_bid_minor as number),
      });
    }

    const { data, error } = await db
      .from('bids')
      .insert({
        product_id: body.productId,
        buyer_id: ctx.userId,
        seller_id: product.seller_id,
        amount_minor: body.amountMinor,
        quantity: body.quantity,
        message: body.message ?? null,
      })
      .select('id')
      .single();
    if (error) {
      if (error.code === '23505') throw conflict('You already have an open offer on this product.');
      throw fromPostgrest(error);
    }

    await notify({
      userId: product.seller_id as string,
      kind: 'bid_received',
      titleKey: 'notification.bidReceived',
      bodyKey: 'notification.bidReceivedBody',
      params: { product: product.title, amount: formatMoney(body.amountMinor) },
      target: { screen: 'bid', id: data.id },
    });

    return { bidId: data.id };
  });

  app.get('/bids', async (req, reply) => {
    const ctx = await requireAuth(req, reply);
    // RLS already limits this to bids the caller is party to.
    const { data, error } = await userClient(ctx.accessToken)
      .from('bids')
      .select('*, products ( title )')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw fromPostgrest(error);
    return {
      bids: (data ?? []).map((b) => ({
        id: b.id,
        productId: b.product_id,
        productTitle: (b as any).products?.title ?? null,
        buyerId: b.buyer_id,
        sellerId: b.seller_id,
        amountMinor: b.amount_minor,
        counterMinor: b.counter_minor,
        quantity: b.quantity,
        message: b.message,
        status: b.status,
        expiresAt: b.expires_at,
        createdAt: b.created_at,
        viewerIsSeller: b.seller_id === ctx.userId,
      })),
    };
  });

  /** Accept, decline, or counter. Sellers only. */
  app.post<{ Params: { id: string } }>('/bids/:id/respond', async (req, reply) => {
    const seller = await requireSeller(req, reply);
    const body = respondToBidSchema.parse(req.body);
    const db = userClient(seller.accessToken);

    const { data: bid } = await db
      .from('bids')
      .select('*, products ( title )')
      .eq('id', req.params.id)
      .maybeSingle();
    if (!bid) throw notFound('Offer');
    if (bid.seller_id !== seller.sellerId) throw forbidden();
    if (!['pending', 'countered'].includes(bid.status as string)) {
      throw conflict('This offer has already been dealt with.');
    }
    if (new Date(bid.expires_at as string) < new Date()) {
      await db.from('bids').update({ status: 'expired' }).eq('id', bid.id);
      throw conflict('This offer has expired.');
    }

    const productTitle = (bid as any).products?.title ?? 'your product';

    switch (body.action) {
      case 'accept': {
        const { error } = await db
          .from('bids')
          .update({ status: 'accepted', responded_at: new Date().toISOString() })
          .eq('id', bid.id);
        if (error) throw fromPostgrest(error);
        await notify({
          userId: bid.buyer_id as string,
          kind: 'bid_accepted',
          titleKey: 'notification.bidAccepted',
          bodyKey: 'notification.bidAcceptedBody',
          params: { name: seller.stallName, product: productTitle },
          target: { screen: 'bid', id: bid.id as string },
        });
        return { status: 'accepted' };
      }
      case 'reject': {
        const { error } = await db
          .from('bids')
          .update({ status: 'rejected', responded_at: new Date().toISOString() })
          .eq('id', bid.id);
        if (error) throw fromPostgrest(error);
        await notify({
          userId: bid.buyer_id as string,
          kind: 'bid_rejected',
          titleKey: 'notification.bidRejected',
          bodyKey: 'notification.bidRejectedBody',
          params: { name: seller.stallName, product: productTitle },
          target: { screen: 'bid', id: bid.id as string },
        });
        return { status: 'rejected' };
      }
      case 'counter': {
        const { error } = await db
          .from('bids')
          .update({
            status: 'countered',
            counter_minor: body.counterMinor,
            responded_at: new Date().toISOString(),
          })
          .eq('id', bid.id);
        if (error) throw fromPostgrest(error);
        await notify({
          userId: bid.buyer_id as string,
          kind: 'bid_countered',
          titleKey: 'notification.bidCountered',
          bodyKey: 'notification.bidCounteredBody',
          params: { name: seller.stallName, amount: formatMoney(body.counterMinor) },
          target: { screen: 'bid', id: bid.id as string },
        });
        return { status: 'countered' };
      }
    }
  });

  app.post<{ Params: { id: string } }>('/bids/:id/cancel', async (req, reply) => {
    const ctx = await requireAuth(req, reply);
    const db = userClient(ctx.accessToken);
    const { data: bid } = await db.from('bids').select('buyer_id, status').eq('id', req.params.id).maybeSingle();
    if (!bid) throw notFound('Offer');
    if (bid.buyer_id !== ctx.userId) throw forbidden('Only the buyer can withdraw an offer.');
    if (!['pending', 'countered'].includes(bid.status as string)) {
      throw conflict('This offer can no longer be withdrawn.');
    }
    const { error } = await db.from('bids').update({ status: 'cancelled' }).eq('id', req.params.id);
    if (error) throw fromPostgrest(error);
    return { status: 'cancelled' };
  });

  // =========================================================================
  // Orders
  // =========================================================================

  app.post('/orders', async (req, reply) => {
    const ctx = await requireVerified(req, reply);
    const body = createOrderSchema.parse(req.body);
    const db = userClient(ctx.accessToken);

    const { data: product } = await db
      .from('products')
      .select('id, seller_id, title, price_minor, quantity, status')
      .eq('id', body.productId)
      .maybeSingle();
    if (!product) throw notFound('Product');
    if (product.status !== 'active') throw conflict('This product is not available.');
    if (product.seller_id === ctx.userId) throw forbidden('You cannot order from yourself.');
    if ((product.quantity as number) < body.quantity) {
      throw conflict('There is not enough stock for that quantity.');
    }

    // An accepted offer sets the price; otherwise the listed price applies.
    let unitPriceMinor = product.price_minor as number;
    if (body.bidId) {
      const { data: bid } = await db
        .from('bids')
        .select('id, status, amount_minor, counter_minor, buyer_id, product_id')
        .eq('id', body.bidId)
        .maybeSingle();
      if (!bid) throw notFound('Offer');
      if (bid.buyer_id !== ctx.userId) throw forbidden();
      if (bid.product_id !== body.productId) throw badRequest('That offer is for a different product.');
      if (bid.status === 'accepted') unitPriceMinor = bid.amount_minor as number;
      else if (bid.status === 'countered' && bid.counter_minor) unitPriceMinor = bid.counter_minor as number;
      else throw conflict('That offer has not been accepted.');
    }

    const totals = computeOrderTotals(unitPriceMinor, body.quantity);

    // Retry on the astronomically unlikely reference collision.
    let created: { id: string; reference: string } | null = null;
    for (let attempt = 0; attempt < 5 && !created; attempt += 1) {
      const reference = generateOrderReference();
      const { data, error } = await db
        .from('orders')
        .insert({
          reference,
          buyer_id: ctx.userId,
          seller_id: product.seller_id,
          product_id: product.id,
          bid_id: body.bidId ?? null,
          product_title: product.title,
          quantity: body.quantity,
          total_minor: totals.totalMinor,
          vat_minor: totals.vatMinor,
          platform_fee_minor: totals.platformFeeMinor,
          status: 'awaiting_payment',
          payment_status: 'unpaid',
          handover_label: body.handoverLabel ?? null,
        })
        .select('id, reference')
        .single();
      if (!error) created = data as { id: string; reference: string };
      else if (error.code !== '23505') throw fromPostgrest(error);
    }
    if (!created) throw conflict('Could not create the order. Please try again.');

    // A payment intent exists from the outset, but nothing is marked paid
    // until the provider says so.
    try {
      const intent = await paymentProvider().createIntent({
        orderId: created.id,
        orderReference: created.reference,
        amountMinor: totals.totalMinor,
        currency: 'SAR',
        description: product.title as string,
        buyerEmail: ctx.email ?? undefined,
      });
      await serviceClient().from('payments').insert({
        order_id: created.id,
        provider: paymentProvider().name,
        provider_payment_id: intent.providerPaymentId,
        status: intent.status,
        amount_minor: totals.totalMinor,
        raw_response: intent.raw ?? null,
      });
    } catch (err) {
      // The order stands, unpaid. It must not silently look paid.
      app.log.warn({ err }, 'payment intent could not be created');
    }

    await db.from('bids').update({ status: 'accepted' }).eq('id', body.bidId ?? '').select();

    await notify({
      userId: product.seller_id as string,
      kind: 'order_placed',
      titleKey: 'notification.orderPlaced',
      bodyKey: 'notification.orderPlacedBody',
      params: { reference: created.reference, product: product.title },
      target: { screen: 'order', id: created.id },
    });

    return { orderId: created.id, reference: created.reference, totalMinor: totals.totalMinor };
  });

  /**
   * Orders for the caller.
   *
   * The VAT and fee breakdown is returned ONLY to the seller. A buyer's
   * response carries a single total, as Saudi consumer pricing expects.
   */
  app.get<{ Querystring: { status?: string; role?: string } }>('/orders', async (req, reply) => {
    const ctx = await requireAuth(req, reply);
    const db = userClient(ctx.accessToken);

    let q = db.from('orders').select('*').order('created_at', { ascending: false }).limit(100);
    if (req.query.status && req.query.status !== 'all') q = q.eq('status', req.query.status);

    const { data, error } = await q;
    if (error) throw fromPostgrest(error);

    const orders = data ?? [];
    const counterpartyIds = [
      ...new Set(orders.map((o) => (o.buyer_id === ctx.userId ? o.seller_id : o.buyer_id))),
    ] as string[];

    const [{ data: sellers }, { data: buyers }, { data: rated }] = await Promise.all([
      db.from('v_public_seller').select('*').in('seller_id', counterpartyIds),
      db.from('v_public_buyer').select('*').in('buyer_id', counterpartyIds),
      db.from('reputation_events').select('order_id').eq('rater_id', ctx.userId),
    ]);

    const people = new Map<string, any>();
    for (const s of sellers ?? []) people.set(s.seller_id, { ...s, id: s.seller_id, role: 'seller' });
    for (const b of buyers ?? []) people.set(b.buyer_id, { ...b, id: b.buyer_id, role: 'buyer' });
    const ratedOrders = new Set((rated ?? []).map((r) => r.order_id as string));

    return {
      orders: orders.map((o) => {
        const viewerIsSeller = o.seller_id === ctx.userId;
        const other = people.get(viewerIsSeller ? o.buyer_id : o.seller_id);
        return {
          id: o.id,
          reference: o.reference,
          buyerId: o.buyer_id,
          sellerId: o.seller_id,
          productId: o.product_id,
          productTitle: o.product_title,
          quantity: o.quantity,
          totalMinor: o.total_minor,
          // Seller-facing only.
          ...(viewerIsSeller
            ? { vatMinor: o.vat_minor, platformFeeMinor: o.platform_fee_minor }
            : {}),
          currency: o.currency,
          status: o.status,
          paymentStatus: o.payment_status,
          sellerConfirmedAt: o.seller_confirmed_at,
          buyerConfirmedAt: o.buyer_confirmed_at,
          completedAt: o.completed_at,
          handoverLabel: o.handover_label,
          createdAt: o.created_at,
          viewerIsSeller,
          viewerHasRated: ratedOrders.has(o.id as string),
          counterparty: other
            ? {
                id: other.id,
                displayName: other.display_name,
                avatarUrl: other.avatar_url,
                reputationScore: other.reputation_score,
                scoreBand: other.score_band,
                stallName: other.stall_name ?? null,
                stallSlug: other.stall_slug ?? null,
              }
            : null,
        };
      }),
    };
  });

  /** Moves the order along the pipeline. Sellers drive it (§17). */
  app.post<{ Params: { id: string } }>('/orders/:id/advance', async (req, reply) => {
    const ctx = await requireAuth(req, reply);
    const body = advanceOrderSchema.parse(req.body);
    const db = userClient(ctx.accessToken);

    const { data: order } = await db
      .from('orders')
      .select('id, reference, status, buyer_id, seller_id')
      .eq('id', req.params.id)
      .maybeSingle();
    if (!order) throw notFound('Order');

    const actor = order.seller_id === ctx.userId ? 'seller' : order.buyer_id === ctx.userId ? 'buyer' : null;
    if (!actor) throw forbidden();

    if (!canTransition(order.status as OrderStatus, body.to, actor)) {
      throw conflict(`An order that is ${order.status} cannot be moved to ${body.to} by the ${actor}.`);
    }

    const patch: Record<string, unknown> = { status: body.to };
    if (body.to === 'cancelled') {
      patch['cancelled_at'] = new Date().toISOString();
      patch['cancel_reason'] = body.note ?? null;
    }

    const { error } = await db.from('orders').update(patch).eq('id', order.id);
    if (error) throw fromPostgrest(error);

    const other = actor === 'seller' ? order.buyer_id : order.seller_id;
    await notify({
      userId: other as string,
      kind: 'order_status',
      titleKey: 'notification.orderStatus',
      bodyKey: 'notification.orderStatusBody',
      params: { reference: order.reference, status: body.to },
      target: { screen: 'order', id: order.id as string },
    });

    // Delivery is what opens the handover confirmation for both sides.
    if (body.to === 'delivered') {
      for (const uid of [order.buyer_id, order.seller_id] as string[]) {
        await notify({
          userId: uid,
          kind: 'handover_confirm_required',
          titleKey: 'notification.handoverRequired',
          bodyKey: 'notification.handoverRequiredBody',
          params: { reference: order.reference },
          target: { screen: 'order', id: order.id as string },
        });
      }
    }

    return { status: body.to };
  });

  /**
   * "I gave it" / "I received it".
   *
   * Each side writes only their OWN confirmation column. The database
   * completes the order once both are set — no client decides that.
   */
  app.post<{ Params: { id: string } }>('/orders/:id/confirm-handover', async (req, reply) => {
    const ctx = await requireAuth(req, reply);
    const db = userClient(ctx.accessToken);

    const { data: order } = await db
      .from('orders')
      .select('id, status, buyer_id, seller_id, seller_confirmed_at, buyer_confirmed_at')
      .eq('id', req.params.id)
      .maybeSingle();
    if (!order) throw notFound('Order');

    const isSeller = order.seller_id === ctx.userId;
    const isBuyer = order.buyer_id === ctx.userId;
    if (!isSeller && !isBuyer) throw forbidden();

    if (!['delivered', 'completed'].includes(order.status as string)) {
      throw conflict('This order is not ready to be confirmed yet.');
    }
    const already = isSeller ? order.seller_confirmed_at : order.buyer_confirmed_at;
    if (already) return { confirmed: true, alreadyConfirmed: true };

    const now = new Date().toISOString();
    const { data: updated, error } = await db
      .from('orders')
      .update(isSeller ? { seller_confirmed_at: now } : { buyer_confirmed_at: now })
      .eq('id', order.id)
      .select('status, seller_confirmed_at, buyer_confirmed_at')
      .single();
    if (error) throw fromPostgrest(error);

    const bothConfirmed = Boolean(updated.seller_confirmed_at && updated.buyer_confirmed_at);
    return {
      confirmed: true,
      bothConfirmed,
      // Only now may either side rate.
      ratingOpen: updated.status === 'completed',
      status: updated.status,
    };
  });

  /**
   * The rating: +5, -5, or skip.
   *
   * The database refuses anything filed against an order that is not
   * completed, and refuses a second attempt. This handler only has to name
   * the counterparty correctly.
   */
  app.post<{ Params: { id: string } }>('/orders/:id/rate', async (req, reply) => {
    const ctx = await requireAuth(req, reply);
    const { delta } = rateOrderSchema.parse({ ...(req.body as object), orderId: req.params.id });
    const db = userClient(ctx.accessToken);

    const { data: order } = await db
      .from('orders')
      .select('id, status, buyer_id, seller_id, reference')
      .eq('id', req.params.id)
      .maybeSingle();
    if (!order) throw notFound('Order');

    const isSeller = order.seller_id === ctx.userId;
    const isBuyer = order.buyer_id === ctx.userId;
    if (!isSeller && !isBuyer) throw forbidden();

    if (order.status !== 'completed') {
      throw conflict('Both of you must confirm the handover before rating.', 'handover.explain');
    }

    const rateeId = (isSeller ? order.buyer_id : order.seller_id) as string;

    const { error } = await db.from('reputation_events').insert({
      order_id: order.id,
      rater_id: ctx.userId,
      ratee_id: rateeId,
      delta,
    });
    if (error) {
      if (error.code === '23505') throw conflict('You have already rated this order.', 'score.alreadyRated');
      throw fromPostgrest(error);
    }

    if (delta !== 0) {
      const { data: after } = await serviceClient()
        .from('profiles')
        .select('reputation_score')
        .eq('id', rateeId)
        .maybeSingle();
      await notify({
        userId: rateeId,
        kind: 'reputation_received',
        titleKey: 'notification.reputationReceived',
        bodyKey: 'notification.reputationReceivedBody',
        params: { score: after?.reputation_score ?? null },
        target: { screen: 'order', id: order.id as string },
      });
    }

    return { rated: true, delta };
  });

  /** Payment provider callback. The only thing that may mark an order paid. */
  app.post('/payments/webhook', { config: { rawBody: true } }, async (req) => {
    const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
    const signature = req.headers['x-siab-signature'] as string | undefined;

    const result = await paymentProvider().parseWebhook(raw, signature);
    const db = serviceClient();

    const { data: payment } = await db
      .from('payments')
      .select('id, order_id')
      .eq('provider_payment_id', result.providerPaymentId)
      .maybeSingle();
    if (!payment) throw notFound('Payment');

    await db
      .from('payments')
      .update({ status: result.status, raw_response: result.raw })
      .eq('id', payment.id);

    // A successful payment confirms the order; a failure leaves it untouched
    // and unpaid, never "successful anyway".
    if (result.status === 'paid') {
      await db
        .from('orders')
        .update({ payment_status: 'paid', status: 'confirmed' })
        .eq('id', payment.order_id)
        .eq('status', 'awaiting_payment');
    } else if (result.status === 'refunded') {
      await db.from('orders').update({ payment_status: 'refunded' }).eq('id', payment.order_id);
    } else {
      await db.from('orders').update({ payment_status: 'failed' }).eq('id', payment.order_id);
    }

    return { received: true };
  });
}
