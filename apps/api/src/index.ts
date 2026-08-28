/**
 * SIAB API — bootstrap.
 *
 * Runs on Railway. Holds every secret: the Supabase service-role key, the
 * Anthropic key, the Brevo key and any payment credentials. None of these
 * reach the client, which carries only the Supabase anon key.
 */
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { ZodError } from 'zod';

import { aiConfigured, allowedOrigins, emailConfigured, loadEnv, paymentsConfigured } from './env.js';
import { ApiError } from './errors.js';
import { aiRoutes } from './routes/ai.js';
import { analyticsRoutes } from './routes/analytics.js';
import { messageRoutes } from './routes/messages.js';
import { onboardingRoutes } from './routes/onboarding.js';
import { orderRoutes } from './routes/orders.js';
import { productRoutes } from './routes/products.js';
import { profileRoutes } from './routes/profile.js';

export async function buildServer() {
  const env = loadEnv();

  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'production' ? 'info' : 'debug',
      // Never log an Authorization header or a token.
      redact: ['req.headers.authorization', 'req.headers.cookie', '*.accessToken', '*.apiKey'],
    },
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
  });

  await app.register(helmet, { contentSecurityPolicy: false });

  await app.register(cors, {
    origin: (origin, cb) => {
      // Native apps send no Origin header.
      if (!origin) return cb(null, true);
      cb(null, allowedOrigins(env).includes(origin));
    },
    credentials: true,
  });

  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
    // Per user when signed in, per IP otherwise, so one heavy user cannot
    // rate-limit a whole shared network.
    keyGenerator: (req) => req.auth?.userId ?? req.ip,
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ApiError) {
      return reply.status(err.statusCode).send(err.toJSON());
    }
    if (err instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: 'validation_failed',
          message: 'Some of the details you sent are not valid.',
          messageKey: 'error.generic',
          details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      });
    }
    if ((err as { statusCode?: number }).statusCode === 429) {
      return reply.status(429).send({
        error: { code: 'rate_limited', message: 'Too many requests.', messageKey: 'error.serverBusy' },
      });
    }

    req.log.error({ err }, 'unhandled error');
    // Internal detail never reaches the client.
    return reply.status(500).send({
      error: { code: 'internal', message: 'Something went wrong.', messageKey: 'error.generic' },
    });
  });

  /**
   * Health check. Reports honestly which integrations are actually wired,
   * so a missing key is visible rather than surfacing later as a broken
   * feature the app claims to have.
   */
  app.get('/health', async () => ({
    ok: true,
    service: 'siab-api',
    environment: env.NODE_ENV,
    integrations: {
      database: true,
      ai: aiConfigured(env),
      email: emailConfigured(env),
      payments: { provider: env.PAYMENTS_PROVIDER, configured: paymentsConfigured(env), live: env.PAYMENTS_PROVIDER !== 'mock' },
    },
  }));

  await app.register(onboardingRoutes);
  await app.register(profileRoutes);
  await app.register(productRoutes);
  await app.register(orderRoutes);
  await app.register(messageRoutes);
  await app.register(aiRoutes);
  await app.register(analyticsRoutes);

  return app;
}

async function main(): Promise<void> {
  const env = loadEnv();
  const app = await buildServer();

  if (!aiConfigured(env)) app.log.warn('ANTHROPIC_API_KEY is not set — both assistants are disabled.');
  if (!emailConfigured(env)) app.log.warn('BREVO_API_KEY is not set — verification email will not send.');
  if (env.PAYMENTS_PROVIDER === 'mock') app.log.warn('Payments are in sandbox mode. No real money will move.');

  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      app.log.info(`${signal} received, shutting down`);
      void app.close().then(() => process.exit(0));
    });
  }
}

// Only start a server when run directly; tests import buildServer instead.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '')) {
  void main();
}
