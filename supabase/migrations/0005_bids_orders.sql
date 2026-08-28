-- ============================================================================
-- SIAB 0005 — bidding (§20), orders (§21), fulfilment pipeline (§17)
-- ============================================================================

create table bids (
  id              uuid primary key default gen_random_uuid(),
  product_id      uuid not null references products(id) on delete cascade,
  buyer_id        uuid not null references profiles(id) on delete cascade,
  seller_id       uuid not null references seller_profiles(id) on delete cascade,

  amount_minor    bigint not null check (amount_minor > 0),
  currency        char(3) not null default 'SAR' check (currency = 'SAR'),
  quantity        integer not null default 1 check (quantity > 0),
  message         text check (message is null or length(message) <= 500),

  status          bid_status not null default 'pending',
  -- Set when the seller counters rather than accepting or rejecting outright.
  counter_minor   bigint check (counter_minor is null or counter_minor > 0),
  -- A bid that supersedes this one (buyer re-offered after a counter).
  supersedes_id   uuid references bids(id) on delete set null,

  expires_at      timestamptz not null default now() + interval '7 days',
  responded_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index bids_product_idx on bids (product_id, created_at desc);
create index bids_buyer_idx   on bids (buyer_id, created_at desc);
create index bids_seller_idx  on bids (seller_id, status, created_at desc);

-- A buyer may hold only one live offer per product at a time.
create unique index bids_one_open_per_buyer_product
  on bids (product_id, buyer_id)
  where status in ('pending', 'countered');

create trigger bids_touch
  before update on bids
  for each row execute function siab_touch_updated_at();

-- The seller on a bid must actually own the product. Prevents a forged
-- seller_id from routing someone else's bid into your inbox.
create or replace function siab_assert_bid_consistency()
returns trigger
language plpgsql
as $$
declare
  v_seller uuid;
  v_allows boolean;
begin
  select p.seller_id, p.allow_bidding into v_seller, v_allows
  from products p where p.id = new.product_id;

  if v_seller is null then
    raise exception 'product % does not exist', new.product_id;
  end if;
  if v_seller <> new.seller_id then
    raise exception 'bid seller does not own the product' using errcode = 'check_violation';
  end if;
  if not v_allows then
    raise exception 'bidding is disabled for this product' using errcode = 'check_violation';
  end if;
  if new.buyer_id = v_seller then
    raise exception 'a seller cannot bid on their own product' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger bids_consistency_guard
  before insert on bids
  for each row execute function siab_assert_bid_consistency();

-- ---------------------------------------------------------------------------
-- orders
-- Totals are snapshotted at purchase time: a later price edit by the seller
-- must never rewrite the history of a completed sale.
-- ---------------------------------------------------------------------------
create table orders (
  id                  uuid primary key default gen_random_uuid(),
  -- Human-facing reference, e.g. SIAB-7F3K2Q.
  reference           text not null unique,

  buyer_id            uuid not null references profiles(id) on delete restrict,
  seller_id           uuid not null references seller_profiles(id) on delete restrict,
  product_id          uuid references products(id) on delete set null,
  bid_id              uuid references bids(id) on delete set null,

  -- Snapshot of what was bought, so the order survives product deletion.
  product_title       text not null,
  quantity            integer not null default 1 check (quantity > 0),

  -- VAT-inclusive total the buyer agreed to pay.
  total_minor         bigint not null check (total_minor >= 0),
  -- Derived breakdown, for the seller's books only.
  vat_minor           bigint not null default 0 check (vat_minor >= 0),
  platform_fee_minor  bigint not null default 0 check (platform_fee_minor >= 0),
  currency            char(3) not null default 'SAR' check (currency = 'SAR'),

  status              order_status   not null default 'awaiting_payment',
  payment_status      payment_status not null default 'unpaid',

  -- Handover confirmation (§ mutual confirmation). Both sides must confirm
  -- before the order completes and the score window opens.
  seller_confirmed_at timestamptz,
  buyer_confirmed_at  timestamptz,
  completed_at        timestamptz,

  cancelled_at        timestamptz,
  cancel_reason       text,

  -- Where the handover happens. Never a raw GPS trail — one agreed point.
  handover_label      text,
  handover_point      geography(Point, 4326),

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint orders_distinct_parties check (buyer_id <> seller_id)
);

create index orders_buyer_idx   on orders (buyer_id, created_at desc);
create index orders_seller_idx  on orders (seller_id, status, created_at desc);
create index orders_status_idx  on orders (status);

create trigger orders_touch
  before update on orders
  for each row execute function siab_touch_updated_at();

-- ---------------------------------------------------------------------------
-- order_events — immutable audit trail. Every status change lands here (§17).
-- ---------------------------------------------------------------------------
create table order_events (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references orders(id) on delete cascade,
  from_status order_status,
  to_status   order_status not null,
  actor_id    uuid references profiles(id) on delete set null,
  note        text,
  created_at  timestamptz not null default now()
);

create index order_events_order_idx on order_events (order_id, created_at);

-- Record every transition automatically. No code path can forget to.
create or replace function siab_log_order_event()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    insert into order_events (order_id, from_status, to_status, actor_id)
    values (new.id, null, new.status, siab_uid());
  elsif new.status is distinct from old.status then
    insert into order_events (order_id, from_status, to_status, actor_id)
    values (new.id, old.status, new.status, siab_uid());
  end if;
  return new;
end;
$$;

create trigger orders_log_events
  after insert or update on orders
  for each row execute function siab_log_order_event();

-- ---------------------------------------------------------------------------
-- Completion: when both parties have confirmed the handover, the order
-- becomes 'completed' and the rating window opens. Enforced in the database
-- so no client can shortcut it.
-- ---------------------------------------------------------------------------
create or replace function siab_maybe_complete_order()
returns trigger
language plpgsql
as $$
begin
  if new.seller_confirmed_at is not null
     and new.buyer_confirmed_at is not null
     and new.completed_at is null
     and new.status <> 'cancelled'
  then
    new.completed_at := now();
    new.status := 'completed';
  end if;
  return new;
end;
$$;

create trigger orders_complete_on_mutual_confirm
  before update on orders
  for each row execute function siab_maybe_complete_order();

-- ---------------------------------------------------------------------------
-- payments — provider-agnostic. SIAB stores references, never card data (§25).
-- ---------------------------------------------------------------------------
create table payments (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid not null references orders(id) on delete cascade,
  provider            text not null,             -- 'mock' | 'moyasar' | 'tap' | ...
  provider_payment_id text,
  status              payment_status not null default 'unpaid',
  amount_minor        bigint not null check (amount_minor >= 0),
  currency            char(3) not null default 'SAR',
  -- Non-sensitive provider echo only. A CHECK guards the obvious mistakes.
  raw_response        jsonb,
  error_message       text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (provider, provider_payment_id)
);

create index payments_order_idx on payments (order_id, created_at desc);

create trigger payments_touch
  before update on payments
  for each row execute function siab_touch_updated_at();

alter table payments add constraint payments_no_pan
  check (raw_response is null or not (raw_response::text ~* '"(card_?number|pan|cvv|cvc)"'));
