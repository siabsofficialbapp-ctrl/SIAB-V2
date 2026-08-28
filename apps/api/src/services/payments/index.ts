/**
 * Provider selection. Adding Moyasar or Tap means adding one file and one
 * case here — order, fee and analytics logic does not change.
 */
import { loadEnv, paymentsConfigured } from '../../env.js';
import { serviceUnavailable } from '../../errors.js';
import { MockPaymentProvider } from './mock.js';
import type { PaymentProvider } from './provider.js';

let provider: PaymentProvider | null = null;

export function paymentProvider(): PaymentProvider {
  if (provider) return provider;
  const env = loadEnv();

  if (!paymentsConfigured(env)) {
    throw serviceUnavailable(
      `Payment provider "${env.PAYMENTS_PROVIDER}" is selected but its API key is not set.`,
      'payment.comingSoon',
    );
  }

  switch (env.PAYMENTS_PROVIDER) {
    case 'mock':
      provider = new MockPaymentProvider();
      break;
    case 'moyasar':
    case 'tap':
      // Deliberately explicit rather than silently falling back to the mock:
      // a half-wired gateway must never look like a working one.
      throw serviceUnavailable(
        `The ${env.PAYMENTS_PROVIDER} adapter is not implemented yet. ` +
          'Set PAYMENTS_PROVIDER=mock until it is.',
        'payment.comingSoon',
      );
  }
  return provider;
}

export * from './provider.js';
