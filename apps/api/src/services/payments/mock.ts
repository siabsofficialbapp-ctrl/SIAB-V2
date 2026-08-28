/**
 * The sandbox provider.
 *
 * This is NOT a fake success button. It drives the same state machine a real
 * gateway drives — an intent is created, stays unpaid, and only moves when a
 * webhook says so. Orders, fees, VAT and analytics are all real; the only
 * thing missing is a bank.
 *
 * A payment is never reported as paid unless something told us it was paid.
 */
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import { loadEnv } from '../../env.js';
import { badRequest, forbidden } from '../../errors.js';
import type {
  CreateIntentInput,
  PaymentIntent,
  PaymentProvider,
  WebhookResult,
} from './provider.js';

export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock' as const;
  readonly configured = true;

  async createIntent(input: CreateIntentInput): Promise<PaymentIntent> {
    if (input.amountMinor <= 0) throw badRequest('Payment amount must be positive');
    return {
      providerPaymentId: `mock_${randomUUID()}`,
      // Deliberately NOT 'paid'. Nothing is paid until confirmed.
      status: 'unpaid',
      raw: { provider: 'mock', order: input.orderReference, amount_minor: input.amountMinor },
    };
  }

  async parseWebhook(rawBody: string, signature: string | undefined): Promise<WebhookResult> {
    const secret = loadEnv().PAYMENTS_WEBHOOK_SECRET;

    // Even in the sandbox the signature is checked, so the production path is
    // the path that gets exercised in development.
    if (secret) {
      if (!signature) throw forbidden('Missing webhook signature');
      const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
      const a = Buffer.from(expected);
      const b = Buffer.from(signature);
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        throw forbidden('Invalid webhook signature');
      }
    }

    let body: { payment_id?: string; status?: string };
    try {
      body = JSON.parse(rawBody);
    } catch {
      throw badRequest('Webhook body is not valid JSON');
    }

    if (!body.payment_id) throw badRequest('Webhook is missing payment_id');
    if (!['paid', 'failed', 'refunded'].includes(body.status ?? '')) {
      throw badRequest('Webhook status must be paid, failed or refunded');
    }

    return {
      providerPaymentId: body.payment_id,
      status: body.status as 'paid' | 'failed' | 'refunded',
      raw: body as Record<string, unknown>,
    };
  }
}
