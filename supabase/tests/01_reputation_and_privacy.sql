-- ============================================================================
-- SIAB test 01 — the SIAB score, the mutual-confirmation gate, and the
-- absolute privacy rule. Run against a database with all migrations applied.
-- Any failure raises and aborts.
-- ============================================================================
\set ON_ERROR_STOP on

-- Supabase grants these by default; the shim must match.
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on all tables in schema public to anon;
grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to authenticated, service_role;
-- Re-apply the column lockdown, exactly as production does after Supabase
-- re-issues its default grants.
select siab_apply_column_grants();

begin;

-- ---------------------------------------------------------------------------
-- Fixtures: one buyer, two sellers.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'buyer@test.sa'),
  ('22222222-2222-2222-2222-222222222222', 'sellera@test.sa'),
  ('33333333-3333-3333-3333-333333333333', 'sellerb@test.sa');

insert into profiles (id, role, display_name, email) values
  ('11111111-1111-1111-1111-111111111111', 'buyer',  'Buyer One',  'buyer@test.sa'),
  ('22222222-2222-2222-2222-222222222222', 'seller', 'Seller A',   'sellera@test.sa'),
  ('33333333-3333-3333-3333-333333333333', 'seller', 'Seller B',   'sellerb@test.sa');

insert into seller_profiles (id, stall_name, stall_slug) values
  ('22222222-2222-2222-2222-222222222222', 'Stall A', 'stall-a'),
  ('33333333-3333-3333-3333-333333333333', 'Stall B', 'stall-b');

-- Seller B's private business data — Seller A must never reach this.
insert into seller_costs (seller_id, label, amount_minor)
  values ('33333333-3333-3333-3333-333333333333', 'B secret cost', 999900);
insert into seller_ai_knowledge (seller_id, title, content)
  values ('33333333-3333-3333-3333-333333333333', 'B secret', 'B private supplier list');

do $$
declare v integer;
begin
  -- 1. Everyone starts at 100.
  select reputation_score into v from profiles where id = '11111111-1111-1111-1111-111111111111';
  if v <> 100 then raise exception 'TEST 1 FAILED: new member score is %, expected 100', v; end if;

  -- 2. Score bands match the spec.
  if siab_score_band(59)  <> 'red'     then raise exception 'TEST 2 FAILED: 59 should be red'; end if;
  if siab_score_band(60)  <> 'orange'  then raise exception 'TEST 2 FAILED: 60 should be orange'; end if;
  if siab_score_band(100) <> 'orange'  then raise exception 'TEST 2 FAILED: 100 should be orange'; end if;
  if siab_score_band(150) <> 'orange'  then raise exception 'TEST 2 FAILED: 150 should be orange'; end if;
  if siab_score_band(151) <> 'green'   then raise exception 'TEST 2 FAILED: 151 should be green'; end if;
  if siab_score_band(500) <> 'green'   then raise exception 'TEST 2 FAILED: 500 should be green'; end if;
  if siab_score_band(501) <> 'diamond' then raise exception 'TEST 2 FAILED: 501 should be diamond'; end if;
  raise notice 'TEST 1-2 passed: start score 100, bands correct';
end $$;

-- ---------------------------------------------------------------------------
-- An order, walked through the pipeline.
-- ---------------------------------------------------------------------------
insert into products (id, seller_id, title, price_minor, status)
values ('aaaaaaaa-0000-0000-0000-000000000001',
        '22222222-2222-2222-2222-222222222222', 'Test Item', 20000, 'active');

insert into orders (id, reference, buyer_id, seller_id, product_id, product_title, total_minor, status)
values ('bbbbbbbb-0000-0000-0000-000000000001', 'SIAB-TEST01',
        '11111111-1111-1111-1111-111111111111',
        '22222222-2222-2222-2222-222222222222',
        'aaaaaaaa-0000-0000-0000-000000000001', 'Test Item', 20000, 'delivered');

do $$
declare v text; n integer;
begin
  -- 3. Rating is refused before both parties confirm the handover.
  begin
    insert into reputation_events (order_id, rater_id, ratee_id, delta)
    values ('bbbbbbbb-0000-0000-0000-000000000001',
            '11111111-1111-1111-1111-111111111111',
            '22222222-2222-2222-2222-222222222222', 5);
    raise exception 'TEST 3 FAILED: rating was allowed before mutual confirmation';
  exception when check_violation then
    raise notice 'TEST 3 passed: rating blocked until both sides confirm';
  end;

  -- 4. One side confirming is not enough.
  update orders set seller_confirmed_at = now()
   where id = 'bbbbbbbb-0000-0000-0000-000000000001';
  select status into v from orders where id = 'bbbbbbbb-0000-0000-0000-000000000001';
  if v <> 'delivered' then raise exception 'TEST 4 FAILED: order completed on one confirmation (status %)', v; end if;
  raise notice 'TEST 4 passed: one-sided confirmation does not complete the order';

  -- 5. Both sides confirming completes it and opens the rating window.
  update orders set buyer_confirmed_at = now()
   where id = 'bbbbbbbb-0000-0000-0000-000000000001';
  select status into v from orders where id = 'bbbbbbbb-0000-0000-0000-000000000001';
  if v <> 'completed' then raise exception 'TEST 5 FAILED: expected completed, got %', v; end if;
  raise notice 'TEST 5 passed: mutual confirmation completes the order';

  -- 6. The transition was recorded in the audit trail.
  select count(*) into n from order_events
   where order_id = 'bbbbbbbb-0000-0000-0000-000000000001' and to_status = 'completed';
  if n <> 1 then raise exception 'TEST 6 FAILED: completion not logged (% rows)', n; end if;
  raise notice 'TEST 6 passed: status change written to order_events';
end $$;

do $$
declare v integer;
begin
  -- 7. Buyer adds 5 to the seller.
  insert into reputation_events (order_id, rater_id, ratee_id, delta)
  values ('bbbbbbbb-0000-0000-0000-000000000001',
          '11111111-1111-1111-1111-111111111111',
          '22222222-2222-2222-2222-222222222222', 5);
  select reputation_score into v from profiles where id = '22222222-2222-2222-2222-222222222222';
  if v <> 105 then raise exception 'TEST 7 FAILED: expected 105, got %', v; end if;
  raise notice 'TEST 7 passed: +5 applied to seller score';

  -- 8. The same person cannot rate the same order twice.
  begin
    insert into reputation_events (order_id, rater_id, ratee_id, delta)
    values ('bbbbbbbb-0000-0000-0000-000000000001',
            '11111111-1111-1111-1111-111111111111',
            '22222222-2222-2222-2222-222222222222', 5);
    raise exception 'TEST 8 FAILED: duplicate rating on the same order was allowed';
  exception when unique_violation then
    raise notice 'TEST 8 passed: one rating per person per order';
  end;

  -- 9. The seller rates the buyer back, deducting 5.
  insert into reputation_events (order_id, rater_id, ratee_id, delta)
  values ('bbbbbbbb-0000-0000-0000-000000000001',
          '22222222-2222-2222-2222-222222222222',
          '11111111-1111-1111-1111-111111111111', -5);
  select reputation_score into v from profiles where id = '11111111-1111-1111-1111-111111111111';
  if v <> 95 then raise exception 'TEST 9 FAILED: expected 95, got %', v; end if;
  raise notice 'TEST 9 passed: -5 applied, rating is mutual';

  -- 10. A stranger cannot rate someone else's order.
  begin
    insert into reputation_events (order_id, rater_id, ratee_id, delta)
    values ('bbbbbbbb-0000-0000-0000-000000000001',
            '33333333-3333-3333-3333-333333333333',
            '22222222-2222-2222-2222-222222222222', -5);
    raise exception 'TEST 10 FAILED: an outsider rated an order they were not part of';
  exception when check_violation then
    raise notice 'TEST 10 passed: only the two parties may rate';
  end;

  -- 11. Recomputing from the event log reproduces the same score.
  if siab_recompute_score('22222222-2222-2222-2222-222222222222') <> 105 then
    raise exception 'TEST 11 FAILED: recomputed score does not match';
  end if;
  raise notice 'TEST 11 passed: score is reproducible from reputation_events';
end $$;

-- ---------------------------------------------------------------------------
-- The absolute privacy rule, enforced as a real user (RLS active).
-- ---------------------------------------------------------------------------
do $$
declare n integer; v integer;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);

  -- 12. Seller A cannot see Seller B's costs.
  select count(*) into n from seller_costs
   where seller_id = '33333333-3333-3333-3333-333333333333';
  if n <> 0 then raise exception 'TEST 12 FAILED: Seller A read % of Seller B''s cost rows', n; end if;
  raise notice 'TEST 12 passed: Seller B''s private costs are invisible to Seller A';

  -- 13. Seller A cannot see Seller B's AI knowledge base.
  select count(*) into n from seller_ai_knowledge
   where seller_id = '33333333-3333-3333-3333-333333333333';
  if n <> 0 then raise exception 'TEST 13 FAILED: Seller A read Seller B''s AI knowledge'; end if;
  raise notice 'TEST 13 passed: Seller B''s AI knowledge is invisible to Seller A';

  -- 14. Seller A cannot see an order they are not part of.
  select count(*) into n from orders
   where seller_id = '33333333-3333-3333-3333-333333333333';
  if n <> 0 then raise exception 'TEST 14 FAILED: Seller A read Seller B''s orders'; end if;
  raise notice 'TEST 14 passed: order visibility is limited to its two parties';

  -- 15. The analytics accessor refuses to answer for another seller —
  --     this is the function the Coworker AI calls (§30).
  begin
    perform * from siab_seller_analytics('33333333-3333-3333-3333-333333333333');
    raise exception 'TEST 15 FAILED: Seller A pulled Seller B''s analytics';
  exception when insufficient_privilege then
    raise notice 'TEST 15 passed: analytics accessor rejects a foreign seller id';
  end;

  -- 16. A client cannot hand itself a score.
  begin
    update profiles set reputation_score = 9999
     where id = '22222222-2222-2222-2222-222222222222';
    raise exception 'TEST 16 FAILED: score was writable directly';
  exception when insufficient_privilege then
    raise notice 'TEST 16 passed: reputation_score cannot be set by a client';
  end;

  reset role;
end $$;

-- ---------------------------------------------------------------------------
-- Marketplace integrity
-- ---------------------------------------------------------------------------
do $$
begin
  -- 17. A seller cannot bid on their own product.
  begin
    insert into bids (product_id, buyer_id, seller_id, amount_minor)
    values ('aaaaaaaa-0000-0000-0000-000000000001',
            '22222222-2222-2222-2222-222222222222',
            '22222222-2222-2222-2222-222222222222', 15000);
    raise exception 'TEST 17 FAILED: seller bid on their own product';
  exception when check_violation then
    raise notice 'TEST 17 passed: self-bidding rejected';
  end;

  -- 18. A bid cannot be routed to a seller who does not own the product.
  begin
    insert into bids (product_id, buyer_id, seller_id, amount_minor)
    values ('aaaaaaaa-0000-0000-0000-000000000001',
            '11111111-1111-1111-1111-111111111111',
            '33333333-3333-3333-3333-333333333333', 15000);
    raise exception 'TEST 18 FAILED: bid accepted with a forged seller id';
  exception when check_violation then
    raise notice 'TEST 18 passed: bid seller must own the product';
  end;

  -- 19. A stall cannot be opened on a buyer account.
  begin
    insert into seller_profiles (id, stall_name, stall_slug)
    values ('11111111-1111-1111-1111-111111111111', 'Fake Stall', 'fake-stall');
    raise exception 'TEST 19 FAILED: a buyer opened a stall';
  exception when check_violation then
    raise notice 'TEST 19 passed: only seller accounts may own a stall';
  end;

  -- 20. Payment rows reject anything that looks like card data.
  begin
    insert into payments (order_id, provider, amount_minor, raw_response)
    values ('bbbbbbbb-0000-0000-0000-000000000001', 'mock', 20000,
            '{"card_number":"4111111111111111"}'::jsonb);
    raise exception 'TEST 20 FAILED: card data was stored';
  exception when check_violation then
    raise notice 'TEST 20 passed: card data rejected at the database layer';
  end;
end $$;

rollback;
