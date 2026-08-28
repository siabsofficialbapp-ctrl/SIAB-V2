/**
 * Boot test.
 *
 * Proves the server actually assembles, that every route registers, and —
 * most importantly — that private endpoints reject an unauthenticated caller.
 * A typecheck cannot tell you any of that.
 *
 * Run with:  pnpm --filter @siab/api test
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import type { FastifyInstance } from 'fastify';

process.env['SUPABASE_URL'] ??= 'https://example.supabase.co';
process.env['SUPABASE_ANON_KEY'] ??= 'a'.repeat(40);
process.env['SUPABASE_SERVICE_ROLE_KEY'] ??= 'b'.repeat(40);
process.env['NODE_ENV'] = 'test';

let app: FastifyInstance;

describe('SIAB API', () => {
  before(async () => {
    const { buildServer } = await import('./index.js');
    app = await buildServer();
    await app.ready();
  });

  after(async () => {
    await app?.close();
  });

  test('health reports honestly which integrations are wired', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body) as {
      ok: boolean;
      integrations: { ai: boolean; email: boolean; payments: { provider: string; live: boolean } };
    };
    assert.equal(body.ok, true);
    // With no keys set these must report false rather than claiming to work.
    assert.equal(body.integrations.ai, false);
    assert.equal(body.integrations.email, false);
    assert.equal(body.integrations.payments.live, false, 'sandbox must never report itself as live');
  });

  test('every private endpoint rejects an unauthenticated caller', async () => {
    const guarded = [
      ['GET', '/me'],
      ['PATCH', '/me'],
      ['POST', '/me/email'],
      ['GET', '/onboarding/state'],
      ['POST', '/onboarding/role'],
      ['POST', '/terms/accept'],
      ['GET', '/saved'],
      ['GET', '/orders'],
      ['POST', '/orders'],
      ['GET', '/bids'],
      ['POST', '/bids'],
      ['GET', '/conversations'],
      ['GET', '/notifications'],
      ['GET', '/seller/products'],
      ['POST', '/seller/products'],
      ['GET', '/seller/analytics'],
      ['GET', '/seller/costs'],
      ['GET', '/seller/ai/settings'],
      ['GET', '/seller/ai/knowledge'],
      ['POST', '/seller/coworker/ask'],
      ['GET', '/seller/coworker/conversations'],
    ] as const;

    for (const [method, url] of guarded) {
      const res = await app.inject({ method, url, payload: {} });
      assert.equal(
        res.statusCode,
        401,
        `${method} ${url} returned ${res.statusCode}; every private route must require a token`,
      );
    }
  });

  test('errors carry a translation key so the client never shows raw English', async () => {
    const res = await app.inject({ method: 'GET', url: '/me' });
    const body = JSON.parse(res.body) as { error: { code: string; messageKey: string } };
    assert.equal(body.error.code, 'unauthorized');
    assert.equal(body.error.messageKey, 'error.unauthorized');
  });

  test('an unknown route is a clean 404, not a crash', async () => {
    const res = await app.inject({ method: 'GET', url: '/definitely-not-a-route' });
    assert.equal(res.statusCode, 404);
  });
});
