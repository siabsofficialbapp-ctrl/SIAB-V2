/**
 * The payment boundary.
 *
 * SIAB never handles a card number. A provider is asked to create an intent
 * and later tells us what happened; we store references and statuses only.
 *
 * Stripe is deliberately absent: it does not support Saudi merchant accounts.
 * Moyasar and Tap are the realistic options for a Saudi launch, and both slot
 * in behind this interface without touching order logic.
 */

export type ProviderName = 'mock' | 'moyasar' | 'tap';

export interface PaymentIntent {
  providerPaymentId: string;
  status: 'unpaid' | 'authorized' | 'paid' | 'failed';
  /** Where to send the buyer to complete payment, when the provider needs it. */
  redirectUrl?: string;
  raw?: Record<string, unknown>;
}

export interface CreateIntentInput {
  orderId: string;
  orderReference: string;
  amountMinor: number;
  currency: 'SAR';
  description: string;
  buyerEmail?: string;
}

export interface WebhookResult {
  providerPaymentId: string;
  status: 'paid' | 'failed' | 'refunded';
  raw: Record<string, unknown>;
}

export interface PaymentProvider {
  readonly name: ProviderName;
  /** False when the provider is selected but its key is missing. */
  readonly configured: boolean;
  createIntent(input: CreateIntentInput): Promise<PaymentIntent>;
  /** Verifies the signature and extracts the outcome. Throws if unverified. */
  parseWebhook(rawBody: string, signature: string | undefined): Promise<WebhookResult>;
}
