-- ============================================================================
-- SIAB 0001 — extensions, enums, shared helpers
-- ============================================================================

create extension if not exists "pgcrypto";
create extension if not exists "citext";       -- case-insensitive email / slug
create extension if not exists "pg_trgm";      -- fuzzy product search
create extension if not exists "unaccent";     -- accent-insensitive search
create extension if not exists "postgis";      -- geography(Point) for locations

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type siab_role            as enum ('buyer', 'seller');
create type siab_locale          as enum ('en', 'ar');

create type product_status       as enum ('draft', 'active', 'paused', 'sold_out', 'removed');

create type bid_status           as enum ('pending', 'accepted', 'rejected', 'countered', 'expired', 'cancelled');

-- The fulfilment pipeline of §17, plus the mutual-confirmation terminal state.
create type order_status         as enum (
  'awaiting_payment',
  'confirmed',
  'processing',
  'shipped',
  'delivered',
  'completed',
  'cancelled'
);

create type payment_status       as enum ('unpaid', 'authorized', 'paid', 'failed', 'refunded', 'cash_on_handover');

create type message_kind         as enum ('text', 'image', 'location', 'system');

create type conversation_kind    as enum ('human', 'ai');

create type notification_kind    as enum (
  'message', 'bid_received', 'bid_accepted', 'bid_rejected', 'bid_countered',
  'order_placed', 'order_status', 'handover_confirm_required', 'reputation_received',
  'system'
);

-- ---------------------------------------------------------------------------
-- Shared trigger: keep updated_at honest
-- ---------------------------------------------------------------------------
create or replace function siab_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Who am I? Used throughout RLS. Wraps Supabase's auth.uid() so that the
-- API service (which connects with the service role and sets the claim
-- explicitly) and end-user sessions resolve identity the same way.
-- ---------------------------------------------------------------------------
create or replace function siab_uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    auth.uid(),
    nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  );
$$;
