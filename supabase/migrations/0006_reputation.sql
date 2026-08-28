-- ============================================================================
-- SIAB 0006 — the SIAB score
--
-- Replaces star ratings entirely. Every member starts at 100.
-- After an order completes, EACH side may move the other by +5, -5, or skip.
-- The rating window only opens once BOTH parties have confirmed the handover
-- (seller: "I gave it", buyer: "I received it") — enforced in 0005.
--
-- Bands: <60 red | 60-150 orange | 151-500 green | 501+ diamond blue
-- ============================================================================

create table reputation_events (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references orders(id) on delete cascade,
  rater_id    uuid not null references profiles(id) on delete cascade,
  ratee_id    uuid not null references profiles(id) on delete cascade,

  -- +5 add, -5 deduct, 0 skip. A skip is recorded so the app stops asking
  -- and so the window can be closed cleanly.
  delta       smallint not null check (delta in (-5, 0, 5)),

  created_at  timestamptz not null default now(),

  -- One judgement per person per order. This is the anti-abuse rule (§19):
  -- you cannot rate the same transaction twice.
  unique (order_id, rater_id),
  constraint reputation_no_self check (rater_id <> ratee_id)
);

create index reputation_events_ratee_idx on reputation_events (ratee_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Validity: the order must be completed, and the rater/ratee must be its two
-- parties, facing the right way round.
-- ---------------------------------------------------------------------------
create or replace function siab_assert_reputation_valid()
returns trigger
language plpgsql
as $$
declare
  o record;
begin
  select o2.buyer_id, o2.seller_id, o2.status
    into o
    from orders o2
   where o2.id = new.order_id;

  if o is null then
    raise exception 'order % does not exist', new.order_id;
  end if;

  if o.status <> 'completed' then
    raise exception 'order % is not completed; both parties must confirm the handover first', new.order_id
      using errcode = 'check_violation';
  end if;

  if not (
       (new.rater_id = o.buyer_id  and new.ratee_id = o.seller_id)
    or (new.rater_id = o.seller_id and new.ratee_id = o.buyer_id)
  ) then
    raise exception 'rater and ratee are not the two parties of order %', new.order_id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger reputation_events_validity
  before insert on reputation_events
  for each row execute function siab_assert_reputation_valid();

-- ---------------------------------------------------------------------------
-- Apply the delta to the running score. The score is a materialised
-- projection of this table — clients never write profiles.reputation_score.
-- Floored at 0: a score below zero carries no extra meaning, since anything
-- under 60 is already red.
-- ---------------------------------------------------------------------------
create or replace function siab_apply_reputation_delta()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.delta <> 0 then
    update profiles
       set reputation_score = greatest(0, reputation_score + new.delta)
     where id = new.ratee_id;
  end if;
  return new;
end;
$$;

create trigger reputation_events_apply
  after insert on reputation_events
  for each row execute function siab_apply_reputation_delta();

-- ---------------------------------------------------------------------------
-- Recompute a score from scratch. Used by tests and by any future correction
-- (e.g. an admin voiding a fraudulent rating).
-- ---------------------------------------------------------------------------
create or replace function siab_recompute_score(p_user uuid)
returns integer
language sql
security definer
set search_path = public
as $$
  with total as (
    select coalesce(sum(delta), 0)::integer as s
    from reputation_events where ratee_id = p_user
  )
  update profiles
     set reputation_score = greatest(0, 100 + (select s from total))
   where id = p_user
  returning reputation_score;
$$;

-- ---------------------------------------------------------------------------
-- What is still awaiting this user's action? Drives the "please confirm"
-- prompt and the rating prompt in the app.
-- ---------------------------------------------------------------------------
create or replace view v_pending_reputation_actions as
select
  o.id                                        as order_id,
  o.reference,
  u.user_id,
  case when u.user_id = o.buyer_id then o.seller_id else o.buyer_id end as counterparty_id,
  case when u.user_id = o.buyer_id then 'buyer' else 'seller' end       as viewer_side,
  -- Has this user confirmed the handover yet?
  case when u.user_id = o.buyer_id
       then o.buyer_confirmed_at is not null
       else o.seller_confirmed_at is not null
  end                                         as has_confirmed,
  o.status = 'completed'                      as rating_open,
  exists (
    select 1 from reputation_events re
     where re.order_id = o.id and re.rater_id = u.user_id
  )                                           as has_rated
from orders o
cross join lateral (values (o.buyer_id), (o.seller_id)) as u(user_id)
where o.status in ('delivered', 'completed');
