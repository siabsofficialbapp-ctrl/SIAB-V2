import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeOrderTotals, vatFromInclusive, platformFee, riyalsToMinor } from './money.ts';
import { scoreBand, applyDelta, canRate, STARTING_SCORE } from './score.ts';
import { canTransition, pendingAction, pipelineIndex, generateOrderReference } from './orders.ts';
import { chooseRoleSchema, rateOrderSchema, placeBidSchema } from './schemas.ts';

// ---------------------------------------------------------------------------
// Money — VAT must come OUT of the displayed price, not go on top of it.
// ---------------------------------------------------------------------------
test('VAT is extracted from a VAT-inclusive price', () => {
  // 115.00 SAR inclusive of 15% VAT => 15.00 VAT, 100.00 net.
  assert.equal(vatFromInclusive(11500), 1500);
});

test('a round riyal price yields the expected breakdown', () => {
  const t = computeOrderTotals(riyalsToMinor(230));
  assert.equal(t.totalMinor, 23000);
  assert.equal(t.vatMinor, 3000); // 230 inclusive => 30 VAT
  assert.equal(t.platformFeeMinor, 230); // 1% of 230.00
  assert.equal(t.sellerNetMinor, 23000 - 3000 - 230);
});

test('totals always reconcile exactly, with no lost halalas', () => {
  for (const price of [1, 7, 99, 333, 12345, 999999]) {
    for (const qty of [1, 2, 3, 7]) {
      const t = computeOrderTotals(price, qty);
      assert.equal(
        t.vatMinor + t.platformFeeMinor + t.sellerNetMinor,
        t.totalMinor,
        `breakdown does not sum for price=${price} qty=${qty}`,
      );
    }
  }
});

test('platform fee is 1% and rounds to whole halalas', () => {
  assert.equal(platformFee(10000), 100);
  assert.equal(platformFee(1), 0);
});

test('money rejects nonsense', () => {
  assert.throws(() => computeOrderTotals(-1));
  assert.throws(() => computeOrderTotals(100, 0));
  assert.throws(() => riyalsToMinor(Number.NaN));
});

// ---------------------------------------------------------------------------
// Score — thresholds must match siab_score_band() in the database.
// ---------------------------------------------------------------------------
test('score bands match the database thresholds exactly', () => {
  assert.equal(scoreBand(0), 'red');
  assert.equal(scoreBand(59), 'red');
  assert.equal(scoreBand(60), 'orange');
  assert.equal(scoreBand(STARTING_SCORE), 'orange');
  assert.equal(scoreBand(150), 'orange');
  assert.equal(scoreBand(151), 'green');
  assert.equal(scoreBand(500), 'green');
  assert.equal(scoreBand(501), 'diamond');
});

test('score is floored at zero', () => {
  assert.equal(applyDelta(3, -5), 0);
  assert.equal(applyDelta(0, -5), 0);
  assert.equal(applyDelta(100, 5), 105);
  assert.equal(applyDelta(100, 0), 100);
});

test('rating is impossible until both sides have confirmed', () => {
  const base = { status: 'delivered', sellerConfirmedAt: null, buyerConfirmedAt: null };
  assert.equal(canRate(base), false);
  assert.equal(canRate({ ...base, sellerConfirmedAt: 'now' }), false);
  assert.equal(canRate({ ...base, sellerConfirmedAt: 'now', buyerConfirmedAt: 'now' }), false,
    'delivered is not enough — the database must have moved it to completed');
  assert.equal(
    canRate({ status: 'completed', sellerConfirmedAt: 'now', buyerConfirmedAt: 'now' }),
    true,
  );
});

// ---------------------------------------------------------------------------
// Order lifecycle
// ---------------------------------------------------------------------------
test('only the seller drives the fulfilment pipeline', () => {
  assert.equal(canTransition('confirmed', 'processing', 'seller'), true);
  assert.equal(canTransition('confirmed', 'processing', 'buyer'), false);
  assert.equal(canTransition('shipped', 'delivered', 'seller'), true);
});

test('the pipeline cannot be skipped or run backwards', () => {
  assert.equal(canTransition('confirmed', 'delivered', 'seller'), false);
  assert.equal(canTransition('shipped', 'processing', 'seller'), false);
  assert.equal(canTransition('delivered', 'shipped', 'seller'), false);
});

test('no actor can mark an order completed — only mutual confirmation does', () => {
  for (const from of ['confirmed', 'processing', 'shipped', 'delivered'] as const) {
    for (const by of ['buyer', 'seller'] as const) {
      assert.equal(canTransition(from, 'completed', by), false,
        `${by} was able to force ${from} -> completed`);
    }
  }
});

test('terminal states accept nothing further', () => {
  assert.equal(canTransition('completed', 'cancelled', 'seller'), false);
  assert.equal(canTransition('cancelled', 'confirmed', 'seller'), false);
});

test('pendingAction walks a buyer through confirm then rate', () => {
  const o = { status: 'delivered' as const, sellerConfirmedAt: null, buyerConfirmedAt: null };
  assert.equal(pendingAction(o, 'buyer', false), 'confirm_handover');

  const buyerDone = { ...o, buyerConfirmedAt: 'now' };
  assert.equal(pendingAction(buyerDone, 'buyer', false), 'awaiting_other');

  const both = { status: 'completed' as const, sellerConfirmedAt: 'now', buyerConfirmedAt: 'now' };
  assert.equal(pendingAction(both, 'buyer', false), 'rate');
  assert.equal(pendingAction(both, 'buyer', true), 'none');
  assert.equal(pendingAction(both, 'seller', false), 'rate', 'the seller rates the buyer too');
});

test('pipeline index drives the tracker', () => {
  assert.equal(pipelineIndex('confirmed'), 0);
  assert.equal(pipelineIndex('delivered'), 3);
  assert.equal(pipelineIndex('completed'), 3);
  assert.equal(pipelineIndex('awaiting_payment'), -1);
});

test('order references avoid ambiguous characters', () => {
  for (let i = 0; i < 200; i += 1) {
    const ref = generateOrderReference();
    assert.match(ref, /^SIAB-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
  }
});

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------
test('a seller cannot register without a stall name', () => {
  assert.equal(
    chooseRoleSchema.safeParse({ role: 'seller', displayName: 'Ahmed' }).success,
    false,
  );
  assert.equal(
    chooseRoleSchema.safeParse({ role: 'seller', displayName: 'Ahmed', stallName: 'Souq A' }).success,
    true,
  );
  // A buyer needs no stall.
  assert.equal(chooseRoleSchema.safeParse({ role: 'buyer', displayName: 'Ahmed' }).success, true);
});

test('a rating is exactly +5, -5, or skip', () => {
  const id = '11111111-1111-1111-1111-111111111111';
  for (const delta of [5, -5, 0]) {
    assert.equal(rateOrderSchema.safeParse({ orderId: id, delta }).success, true);
  }
  for (const delta of [1, -1, 4, 10, 2.5]) {
    assert.equal(rateOrderSchema.safeParse({ orderId: id, delta }).success, false,
      `delta ${delta} should be rejected`);
  }
});

test('bids must be positive whole halalas', () => {
  const productId = '11111111-1111-1111-1111-111111111111';
  assert.equal(placeBidSchema.safeParse({ productId, amountMinor: 100 }).success, true);
  assert.equal(placeBidSchema.safeParse({ productId, amountMinor: 0 }).success, false);
  assert.equal(placeBidSchema.safeParse({ productId, amountMinor: -5 }).success, false);
  assert.equal(placeBidSchema.safeParse({ productId, amountMinor: 1.5 }).success, false);
});
