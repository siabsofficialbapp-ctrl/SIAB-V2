-- ============================================================================
-- SIAB 0009 — stall views, notifications, and the analytics views (§16, §18)
--
-- Every number on the seller dashboard is computed here from real rows.
-- Nothing is stored as a pre-baked total that could drift from the truth.
-- ============================================================================

create table stall_views (
  id          uuid primary key default gen_random_uuid(),
  seller_id   uuid not null references seller_profiles(id) on delete cascade,
  -- Null for a signed-out visitor.
  viewer_id   uuid references profiles(id) on delete set null,
  -- Coarse dedupe key (hash of viewer/session + day) so one person refreshing
  -- twenty times is not twenty views.
  dedupe_key  text not null,
  created_at  timestamptz not null default now(),
  unique (seller_id, dedupe_key)
);

create index stall_views_seller_idx on stall_views (seller_id, created_at desc);

create table notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  kind        notification_kind not null,
  -- Localisation keys + params, not baked English strings (§7).
  title_key   text not null,
  body_key    text not null,
  params      jsonb not null default '{}'::jsonb,
  -- Deep-link target, e.g. {"screen":"order","id":"..."}
  target      jsonb,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index notifications_user_idx on notifications (user_id, created_at desc);
create index notifications_unread_idx on notifications (user_id) where read_at is null;

-- ---------------------------------------------------------------------------
-- Seller analytics. A view, not a table: it cannot go stale, and it cannot
-- be written to with a made-up number.
--
-- Revenue counts completed orders only — money that actually changed hands.
-- ---------------------------------------------------------------------------
create or replace view v_seller_analytics as
select
  sp.id as seller_id,

  coalesce(rev.gross_minor, 0)        as revenue_minor,
  coalesce(rev.vat_minor, 0)          as vat_minor,
  coalesce(rev.fee_minor, 0)          as platform_fee_minor,
  coalesce(cost.total_minor, 0)       as costs_minor,

  -- Net profit = revenue - VAT owed - platform fee - recorded costs.
  coalesce(rev.gross_minor, 0)
    - coalesce(rev.vat_minor, 0)
    - coalesce(rev.fee_minor, 0)
    - coalesce(cost.total_minor, 0)   as net_profit_minor,

  coalesce(rev.order_count, 0)        as completed_orders,
  case when coalesce(rev.order_count, 0) = 0 then 0
       else (rev.gross_minor / rev.order_count)::bigint
  end                                 as average_order_minor,

  coalesce(conv.count, 0)             as buyer_conversations,
  coalesce(views.count, 0)            as stall_views,
  coalesce(prod.active_count, 0)      as active_products,
  p.reputation_score,
  siab_score_band(p.reputation_score) as score_band

from seller_profiles sp
join profiles p on p.id = sp.id

left join lateral (
  select
    sum(o.total_minor)        as gross_minor,
    sum(o.vat_minor)          as vat_minor,
    sum(o.platform_fee_minor) as fee_minor,
    count(*)                  as order_count
  from orders o
  where o.seller_id = sp.id and o.status = 'completed'
) rev on true

left join lateral (
  select sum(sc.amount_minor) as total_minor
  from seller_costs sc where sc.seller_id = sp.id
) cost on true

left join lateral (
  select count(*) as count
  from conversations c where c.seller_id = sp.id and c.kind = 'human'
) conv on true

left join lateral (
  select count(*) as count
  from stall_views sv where sv.seller_id = sp.id
) views on true

left join lateral (
  select count(*) as active_count
  from products pr where pr.seller_id = sp.id and pr.status = 'active'
) prod on true;

-- ---------------------------------------------------------------------------
-- Public seller card: exactly what a buyer is allowed to see. Used by the
-- marketplace, product pages, and the Customer AI's context — so private
-- columns cannot leak into a public surface by accident (§44).
-- ---------------------------------------------------------------------------
create or replace view v_public_seller as
select
  sp.id                                 as seller_id,
  sp.stall_name,
  sp.stall_slug,
  sp.bio,
  sp.logo_url,
  sp.banner_url,
  case when sp.location_public then sp.location_label end as location_label,
  p.display_name,
  p.avatar_url,
  p.reputation_score,
  siab_score_band(p.reputation_score)   as score_band,
  case when p.email_public  then p.email  end as email,
  case when p.phone_public  then p.phone  end as phone,
  case when p.region_public then p.region end as region,
  sp.created_at
from seller_profiles sp
join profiles p on p.id = sp.id
where p.suspended_at is null;

-- Same idea for a buyer's public card (shown when a seller taps their name).
create or replace view v_public_buyer as
select
  p.id                                  as buyer_id,
  p.display_name,
  p.avatar_url,
  p.reputation_score,
  siab_score_band(p.reputation_score)   as score_band,
  case when p.email_public  then p.email  end as email,
  case when p.phone_public  then p.phone  end as phone,
  case when p.region_public then p.region end as region,
  p.created_at
from profiles p
where p.role = 'buyer' and p.suspended_at is null;
