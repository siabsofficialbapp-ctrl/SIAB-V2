/**
 * End-to-end smoke test against a LIVE SIAB deployment.
 *
 *   pnpm smoke                                    # tests localhost:8080
 *   API_URL=https://your.up.railway.app pnpm smoke
 *
 * This is the test that proves SIAB actually works. It drives a real buyer
 * and a real seller through the whole journey against your real Supabase:
 * sign up, verify, accept the Terms, choose roles, list a product, place an
 * order, walk the fulfilment pipeline, confirm the handover from both sides,
 * and rate each other — then checks the scores actually moved.
 *
 * It creates two throwaway users and deletes everything it made at the end,
 * even when it fails.
 *
 * Required environment:
 *   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
 * Optional:
 *   API_URL (default http://localhost:8080)
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const API_URL = (process.env['API_URL'] ?? 'http://localhost:8080').replace(/\/$/, '');
const SUPABASE_URL = process.env['SUPABASE_URL'];
const ANON_KEY = process.env['SUPABASE_ANON_KEY'];
const SERVICE_KEY = process.env['SUPABASE_SERVICE_ROLE_KEY'];

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
  console.error(
    'Missing configuration. Set SUPABASE_URL, SUPABASE_ANON_KEY and\n' +
    'SUPABASE_SERVICE_ROLE_KEY. See docs/DEPLOY.md.',
  );
  process.exit(1);
}

const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
const failures: string[] = [];

function ok(what: string, detail = ''): void {
  passed += 1;
  console.log(`  \x1b[32m✓\x1b[0m ${what}${detail ? `  \x1b[2m${detail}\x1b[0m` : ''}`);
}

function bad(what: string, detail: string): void {
  failed += 1;
  failures.push(`${what} — ${detail}`);
  console.log(`  \x1b[31m✗\x1b[0m ${what}\n      \x1b[31m${detail}\x1b[0m`);
}

function check(what: string, condition: boolean, detail = ''): boolean {
  if (condition) { ok(what, detail); return true; }
  bad(what, detail || 'condition was false');
  return false;
}

function section(name: string): void {
  console.log(`\n\x1b[1m${name}\x1b[0m`);
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

interface CallResult<T> { status: number; body: T }

async function call<T = unknown>(
  path: string,
  opts: { method?: string; token?: string; body?: unknown } = {},
): Promise<CallResult<T>> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.token) headers['authorization'] = `Bearer ${opts.token}`;

  const res = await fetch(`${API_URL}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });

  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, body: body as T };
}

function describe(result: CallResult<unknown>): string {
  const err = (result.body as { error?: { message?: string } })?.error;
  return `HTTP ${result.status}${err?.message ? ` — ${err.message}` : ''}`;
}

// ---------------------------------------------------------------------------
// Test users
// ---------------------------------------------------------------------------

const stamp = Date.now();
const BUYER_EMAIL = `smoke.buyer.${stamp}@siab-test.invalid`;
const SELLER_EMAIL = `smoke.seller.${stamp}@siab-test.invalid`;
const PASSWORD = `Smoke!${stamp}aA`;

const created: { userIds: string[]; productIds: string[]; orderIds: string[] } = {
  userIds: [], productIds: [], orderIds: [],
};

/** Creates a pre-verified user and returns an access token for them. */
async function makeUser(email: string): Promise<{ id: string; token: string }> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true, // skip the mailbox; verification itself is tested separately
    user_metadata: { smoke_test: true },
  });
  if (error || !data.user) throw new Error(`could not create ${email}: ${error?.message}`);
  created.userIds.push(data.user.id);

  const anon = createClient(SUPABASE_URL!, ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: session, error: signInError } = await anon.auth.signInWithPassword({
    email, password: PASSWORD,
  });
  if (signInError || !session.session) {
    throw new Error(`could not sign in ${email}: ${signInError?.message}`);
  }
  return { id: data.user.id, token: session.session.access_token };
}

async function cleanup(): Promise<void> {
  section('Cleaning up');
  for (const id of created.orderIds) {
    await admin.from('orders').delete().eq('id', id);
  }
  for (const id of created.productIds) {
    const { data: images } = await admin.from('product_images').select('storage_path').eq('product_id', id);
    const paths = (images ?? []).map((i) => i.storage_path as string);
    if (paths.length) await admin.storage.from('product-images').remove(paths);
    await admin.from('products').delete().eq('id', id);
  }
  for (const id of created.userIds) {
    // Deleting the auth user cascades to profile, stall, orders and messages.
    await admin.auth.admin.deleteUser(id).catch(() => undefined);
  }
  console.log(`  removed ${created.userIds.length} test user(s) and their data`);
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

async function run(): Promise<void> {
  console.log(`\n\x1b[1mSIAB smoke test\x1b[0m`);
  console.log(`  API      ${API_URL}`);
  console.log(`  Supabase ${SUPABASE_URL}`);

  // -- Reachability ---------------------------------------------------------
  section('1. The service is up');

  const health = await call<{
    ok: boolean;
    integrations: { database: boolean; ai: boolean; email: boolean; payments: { provider: string; live: boolean } };
  }>('/health');

  if (!check('health endpoint responds', health.status === 200, describe(health))) {
    console.log('\n  The API is not reachable. Check the URL and that the service is running.');
    return;
  }

  const integrations = health.body.integrations;
  ok('database configured', String(integrations.database));
  console.log(`      \x1b[2mai: ${integrations.ai} · email: ${integrations.email} · payments: ${integrations.payments.provider} (live: ${integrations.payments.live})\x1b[0m`);
  if (!integrations.ai) {
    console.log('      \x1b[33m! ANTHROPIC_API_KEY is not set, so the AI checks below will be skipped\x1b[0m');
  }

  // -- Public surface -------------------------------------------------------
  section('2. Anyone can see the marketplace');

  const terms = await call<{ terms: { id: string; version: string; body_en: string; body_ar: string } }>('/terms/current');
  const haveTerms = check('Terms are published', terms.status === 200, describe(terms));
  if (haveTerms) {
    check('Terms exist in English', (terms.body.terms.body_en?.length ?? 0) > 500);
    check('Terms exist in Arabic', (terms.body.terms.body_ar?.length ?? 0) > 500);
  } else {
    console.log('      \x1b[33m! Run `pnpm db:seed` to publish the Terms\x1b[0m');
  }

  const market = await call<{ products: { id: string; title: string; priceMinor: number; images: unknown[] }[] }>('/products');
  check('marketplace lists products without signing in', market.status === 200, describe(market));
  const productCount = market.body?.products?.length ?? 0;
  console.log(`      \x1b[2m${productCount} live product(s)\x1b[0m`);
  if (productCount > 0) {
    const withImages = market.body.products.filter((p) => (p.images?.length ?? 0) > 0).length;
    check(
      'products have images that resolved',
      withImages === productCount,
      `${withImages}/${productCount} have an image row — if this is short, the two-step upload is broken`,
    );
    const sample = market.body.products[0];
    if (sample) {
      const img = (sample.images as { url?: string }[])[0];
      if (img?.url) {
        const head = await fetch(img.url, { method: 'HEAD' });
        check('a product image is actually downloadable', head.ok, `HTTP ${head.status} on ${img.url}`);
      }
    }
  }

  // -- Authorisation --------------------------------------------------------
  section('3. Private data is refused to strangers');

  for (const path of ['/me', '/orders', '/seller/analytics', '/seller/coworker/conversations']) {
    const res = await call(path);
    check(`${path} rejects an unauthenticated caller`, res.status === 401, describe(res));
  }

  // -- Onboarding -----------------------------------------------------------
  section('4. A buyer and a seller can join');

  const buyer = await makeUser(BUYER_EMAIL);
  const seller = await makeUser(SELLER_EMAIL);
  ok('two test accounts created');

  const stateBefore = await call<{ nextStep: string }>('/onboarding/state', { token: buyer.token });
  check('a new account is sent to the Terms first', stateBefore.body?.nextStep === 'accept_terms',
    `nextStep was "${stateBefore.body?.nextStep}"`);

  if (haveTerms) {
    for (const [who, user] of [['buyer', buyer], ['seller', seller]] as const) {
      const res = await call('/terms/accept', {
        method: 'POST', token: user.token, body: { termsVersionId: terms.body.terms.id },
      });
      check(`${who} accepted the Terms`, res.status === 200, describe(res));
    }
  }

  // A seller must supply a stall name — this is the rule under test.
  const noStall = await call('/onboarding/role', {
    method: 'POST', token: seller.token, body: { role: 'seller', displayName: 'Smoke Seller' },
  });
  check('a seller CANNOT register without a stall name', noStall.status === 400, describe(noStall));

  const sellerRole = await call<{ stallSlug: string }>('/onboarding/role', {
    method: 'POST', token: seller.token,
    body: { role: 'seller', displayName: 'Smoke Seller', stallName: `Smoke Stall ${stamp}` },
  });
  check('seller registered with a stall name', sellerRole.status === 200, describe(sellerRole));

  const buyerRole = await call('/onboarding/role', {
    method: 'POST', token: buyer.token, body: { role: 'buyer', displayName: 'Smoke Buyer' },
  });
  check('buyer registered', buyerRole.status === 200, describe(buyerRole));

  const me = await call<{ profile: { reputationScore: number; scoreBand: string } }>('/me', { token: buyer.token });
  check('everyone starts at 100 points', me.body?.profile?.reputationScore === 100,
    `score was ${me.body?.profile?.reputationScore}`);
  check('100 points shows as orange', me.body?.profile?.scoreBand === 'orange',
    `band was ${me.body?.profile?.scoreBand}`);

  // -- Listing --------------------------------------------------------------
  section('5. A seller can list a product');

  const create = await call<{ productId: string }>('/seller/products', {
    method: 'POST', token: seller.token,
    body: {
      title: `Smoke Test Item ${stamp}`,
      description: 'Created by the SIAB smoke test. Safe to delete.',
      priceMinor: 23000, // SAR 230.00, VAT-inclusive
      quantity: 5,
      status: 'active',
      allowBidding: true,
    },
  });
  const productOk = check('product created', create.status === 200, describe(create));
  const productId = create.body?.productId;
  if (productId) created.productIds.push(productId);

  if (productOk && productId) {
    const pub = await call<{ product: { priceMinor: number; vatMinor?: number } }>(`/products/${productId}`);
    check('the product is publicly visible', pub.status === 200, describe(pub));
    check('a buyer sees exactly one price', pub.body?.product?.priceMinor === 23000,
      `priceMinor was ${pub.body?.product?.priceMinor}`);
    check('no VAT line is exposed to buyers',
      (pub.body?.product as Record<string, unknown>)?.['vatMinor'] === undefined,
      'a vatMinor field leaked into the buyer-facing product');
  }

  // -- Cross-seller privacy -------------------------------------------------
  section('6. The privacy rule holds');

  const foreignAnalytics = await call('/seller/analytics', { token: buyer.token });
  check('a buyer cannot read seller analytics', foreignAnalytics.status === 403,
    describe(foreignAnalytics));

  const foreignCoworker = await call('/seller/coworker/ask', {
    method: 'POST', token: buyer.token, body: { message: 'what is my revenue' },
  });
  check('a buyer cannot use the seller AI Coworker', foreignCoworker.status === 403,
    describe(foreignCoworker));

  // -- Ordering -------------------------------------------------------------
  section('7. An order runs the full pipeline');

  let orderId: string | undefined;
  if (productId) {
    const order = await call<{ orderId: string; totalMinor: number }>('/orders', {
      method: 'POST', token: buyer.token, body: { productId, quantity: 1 },
    });
    const orderOk = check('buyer placed an order', order.status === 200, describe(order));
    orderId = order.body?.orderId;
    if (orderId) created.orderIds.push(orderId);

    if (orderOk && orderId) {
      check('the order total matches the listed price', order.body.totalMinor === 23000,
        `total was ${order.body.totalMinor}`);

      // The seller walks it forward. Each step must be accepted in order.
      for (const to of ['confirmed', 'processing', 'shipped', 'delivered'] as const) {
        const res = await call(`/orders/${orderId}/advance`, {
          method: 'POST', token: seller.token, body: { to },
        });
        check(`seller moved the order to ${to}`, res.status === 200, describe(res));
      }

      // Skipping a step must be refused.
      const skip = await call(`/orders/${orderId}/advance`, {
        method: 'POST', token: seller.token, body: { to: 'confirmed' },
      });
      check('the pipeline cannot run backwards', skip.status === 409, describe(skip));
    }
  }

  // -- The score ------------------------------------------------------------
  section('8. The SIAB score works exactly as specified');

  if (orderId) {
    // Nobody may rate before both sides confirm.
    const early = await call(`/orders/${orderId}/rate`, {
      method: 'POST', token: buyer.token, body: { delta: 5 },
    });
    check('rating is BLOCKED before both sides confirm', early.status === 409, describe(early));

    const sellerConfirm = await call<{ ratingOpen: boolean }>(`/orders/${orderId}/confirm-handover`, {
      method: 'POST', token: seller.token,
    });
    check('seller confirmed they handed it over', sellerConfirm.status === 200, describe(sellerConfirm));
    check('one confirmation is NOT enough to open rating',
      sellerConfirm.body?.ratingOpen === false,
      'the rating window opened after only one side confirmed');

    const stillBlocked = await call(`/orders/${orderId}/rate`, {
      method: 'POST', token: buyer.token, body: { delta: 5 },
    });
    check('still blocked after one confirmation', stillBlocked.status === 409, describe(stillBlocked));

    const buyerConfirm = await call<{ ratingOpen: boolean }>(`/orders/${orderId}/confirm-handover`, {
      method: 'POST', token: buyer.token,
    });
    check('buyer confirmed they received it', buyerConfirm.status === 200, describe(buyerConfirm));
    check('BOTH confirmations open the rating window', buyerConfirm.body?.ratingOpen === true,
      'the window did not open after both confirmed');

    // Buyer adds 5 to the seller.
    const rateUp = await call(`/orders/${orderId}/rate`, {
      method: 'POST', token: buyer.token, body: { delta: 5 },
    });
    check('buyer gave the seller +5', rateUp.status === 200, describe(rateUp));

    // Rating twice must be refused.
    const twice = await call(`/orders/${orderId}/rate`, {
      method: 'POST', token: buyer.token, body: { delta: 5 },
    });
    check('the same person cannot rate the same order twice', twice.status === 409, describe(twice));

    // Seller deducts 5 from the buyer — the rating is mutual.
    const rateDown = await call(`/orders/${orderId}/rate`, {
      method: 'POST', token: seller.token, body: { delta: -5 },
    });
    check('seller gave the buyer −5', rateDown.status === 200, describe(rateDown));

    const sellerAfter = await call<{ profile: { reputationScore: number } }>('/me', { token: seller.token });
    check('the seller\'s score rose to 105', sellerAfter.body?.profile?.reputationScore === 105,
      `score was ${sellerAfter.body?.profile?.reputationScore}`);

    const buyerAfter = await call<{ profile: { reputationScore: number } }>('/me', { token: buyer.token });
    check('the buyer\'s score fell to 95', buyerAfter.body?.profile?.reputationScore === 95,
      `score was ${buyerAfter.body?.profile?.reputationScore}`);
  }

  // -- Analytics ------------------------------------------------------------
  section('9. Analytics reflect the real order');

  const analytics = await call<{ analytics: { revenueMinor: number; completedOrders: number; vatMinor: number } }>(
    '/seller/analytics', { token: seller.token },
  );
  if (check('seller can read their analytics', analytics.status === 200, describe(analytics))) {
    check('revenue counted the completed order', analytics.body.analytics.revenueMinor === 23000,
      `revenue was ${analytics.body.analytics.revenueMinor}`);
    check('the order count is right', analytics.body.analytics.completedOrders === 1,
      `count was ${analytics.body.analytics.completedOrders}`);
    // 230.00 inclusive of 15% => 30.00 VAT
    check('VAT was extracted from the price, not added', analytics.body.analytics.vatMinor === 3000,
      `VAT was ${analytics.body.analytics.vatMinor}, expected 3000`);
  }

  // -- The AI ---------------------------------------------------------------
  section('10. The AI assistants');

  if (!integrations.ai) {
    console.log('  \x1b[2m- skipped: ANTHROPIC_API_KEY is not set\x1b[0m');
  } else {
    const coworker = await call<{ reply: string; actions: unknown[] }>('/seller/coworker/ask', {
      method: 'POST', token: seller.token,
      body: { message: 'How much revenue do I have, and how many orders? Answer in one short sentence.' },
    });
    if (check('the AI Coworker answered', coworker.status === 200, describe(coworker))) {
      const reply = coworker.body.reply ?? '';
      check('it gave a real answer', reply.length > 10, `reply was "${reply}"`);
      check('it called a tool rather than guessing', (coworker.body.actions?.length ?? 0) > 0,
        'no tool calls recorded — the figure may be invented');
      console.log(`      \x1b[2m"${reply.slice(0, 160)}"\x1b[0m`);
    }

    const customer = await call<{ reply: string }>('/ai/customer/ask', {
      method: 'POST', token: buyer.token,
      body: { sellerId: seller.id, message: 'What do you sell and how much is it?' },
    });
    if (check('the Customer AI answered a buyer', customer.status === 200, describe(customer))) {
      console.log(`      \x1b[2m"${(customer.body.reply ?? '').slice(0, 160)}"\x1b[0m`);
    }
  }
}

// ---------------------------------------------------------------------------

/**
 * Wrapped in a function rather than using top-level await, so this runs
 * whether the toolchain treats the file as ESM or CommonJS.
 */
async function main(): Promise<void> {
  const start = Date.now();
  try {
    await run();
  } catch (err) {
    bad('the run threw', (err as Error).message);
  } finally {
    // Cleanup runs even on failure, so a broken run does not leave test
    // users and orders behind in your database.
    await cleanup().catch((err) => console.error('  cleanup failed:', (err as Error).message));
  }

  const seconds = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n${'─'.repeat(60)}`);
  if (failed === 0) {
    console.log(`\x1b[32m\x1b[1mAll ${passed} checks passed\x1b[0m in ${seconds}s`);
    console.log('SIAB is working end to end against your live deployment.\n');
    process.exit(0);
  }
  console.log(`\x1b[31m\x1b[1m${failed} failed\x1b[0m, ${passed} passed, in ${seconds}s\n`);
  for (const f of failures) console.log(`  \x1b[31m✗\x1b[0m ${f}`);
  console.log('');
  process.exit(1);
}

void main();
