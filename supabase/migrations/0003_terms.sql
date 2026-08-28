-- ============================================================================
-- SIAB 0003 — Terms & Conditions versioning and acceptance (§6)
-- ============================================================================

create table terms_versions (
  id            uuid primary key default gen_random_uuid(),
  version       text not null unique,          -- e.g. '2026-08-28.1'
  effective_at  timestamptz not null default now(),
  -- Full text per locale. Both must be present before a version goes live.
  body_en       text not null,
  body_ar       text not null,
  -- When true, every user must re-accept before entering the app.
  requires_reacceptance boolean not null default true,
  is_current    boolean not null default false,
  created_at    timestamptz not null default now()
);

-- Exactly one current version at a time.
create unique index terms_versions_single_current
  on terms_versions ((true)) where is_current;

create table terms_acceptances (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references profiles(id) on delete cascade,
  terms_version_id  uuid not null references terms_versions(id) on delete restrict,
  accepted_at       timestamptz not null default now(),
  -- Evidence of consent. Kept minimal and never exposed publicly.
  ip_address        inet,
  user_agent        text,
  unique (user_id, terms_version_id)
);

create index terms_acceptances_user_idx on terms_acceptances (user_id, accepted_at desc);

-- Has this user accepted the version currently in force?
create or replace function siab_has_accepted_current_terms(p_user uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from terms_acceptances ta
    join terms_versions tv on tv.id = ta.terms_version_id
    where ta.user_id = p_user and tv.is_current
  );
$$;
