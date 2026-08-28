-- ============================================================================
-- SIAB 0002 — profiles, roles, privacy flags, reputation score
-- ============================================================================

-- ---------------------------------------------------------------------------
-- profiles — one row per auth.users row. One account, one role (§1).
-- ---------------------------------------------------------------------------
create table profiles (
  id                  uuid primary key references auth.users(id) on delete cascade,
  role                siab_role   not null,
  display_name        text        not null check (length(btrim(display_name)) between 2 and 60),
  avatar_url          text,
  locale              siab_locale not null default 'en',

  -- Contact. `email` mirrors auth.users.email for display; changing it goes
  -- through Supabase's verified email-change flow, never a direct update here.
  email               citext,
  phone               text check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
  region              text,

  -- Privacy: nothing contactable is public unless the user opts in (§44).
  email_public        boolean not null default false,
  phone_public        boolean not null default false,
  region_public       boolean not null default false,

  -- Reputation (§ SIAB score). Everyone starts at 100.
  -- Maintained exclusively by trigger from `reputation_events` — never
  -- written directly by a client.
  reputation_score    integer not null default 100,

  -- Role changes are deliberate and rate-limited, not casual toggling (§1).
  role_changed_at     timestamptz,

  suspended_at        timestamptz,
  suspension_reason   text,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index profiles_role_idx on profiles (role);
create index profiles_score_idx on profiles (reputation_score desc);

create trigger profiles_touch
  before update on profiles
  for each row execute function siab_touch_updated_at();

comment on column profiles.reputation_score is
  'SIAB score. Starts at 100. Moves in steps of +5/-5 from reputation_events. '
  'Bands: <60 red, 60-150 orange, 151-500 green, 501+ diamond blue.';

-- ---------------------------------------------------------------------------
-- Score bands. Single source of truth — the UI reads this, it does not
-- reimplement the thresholds.
-- ---------------------------------------------------------------------------
create or replace function siab_score_band(score integer)
returns text
language sql
immutable
as $$
  select case
    when score < 60  then 'red'
    when score <= 150 then 'orange'
    when score <= 500 then 'green'
    else 'diamond'
  end;
$$;

-- ---------------------------------------------------------------------------
-- seller_profiles — the public stall (§11). A seller cannot exist without a
-- stall name (explicit requirement), enforced by NOT NULL + the signup flow.
-- ---------------------------------------------------------------------------
create table seller_profiles (
  id                  uuid primary key references profiles(id) on delete cascade,
  stall_name          text not null check (length(btrim(stall_name)) between 2 and 60),
  stall_slug          citext not null unique,
  bio                 text check (bio is null or length(bio) <= 1000),
  logo_url            text,
  banner_url          text,

  -- Seller-chosen public location. Deliberately coarse: a display label and
  -- an approximate point. Exact coordinates are never published (§22).
  location_label      text,
  location_point      geography(Point, 4326),
  location_public     boolean not null default false,

  business_name       text,
  vat_number          text,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index seller_profiles_location_idx on seller_profiles using gist (location_point);

create trigger seller_profiles_touch
  before update on seller_profiles
  for each row execute function siab_touch_updated_at();

-- Guard: only a profile whose role is 'seller' may own a stall.
create or replace function siab_assert_seller()
returns trigger
language plpgsql
as $$
begin
  if not exists (select 1 from profiles p where p.id = new.id and p.role = 'seller') then
    raise exception 'profile % is not a seller', new.id using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger seller_profiles_role_guard
  before insert or update on seller_profiles
  for each row execute function siab_assert_seller();

-- ---------------------------------------------------------------------------
-- buyer_profiles — light for now; exists so buyer-only settings have a home.
-- ---------------------------------------------------------------------------
create table buyer_profiles (
  id                  uuid primary key references profiles(id) on delete cascade,
  default_region      text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create trigger buyer_profiles_touch
  before update on buyer_profiles
  for each row execute function siab_touch_updated_at();
