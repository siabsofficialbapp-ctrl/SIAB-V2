-- ============================================================================
-- SIAB 0004 — categories, products, images, saved items
-- ============================================================================

create table categories (
  id          uuid primary key default gen_random_uuid(),
  slug        citext not null unique,
  name_en     text not null,
  name_ar     text not null,
  parent_id   uuid references categories(id) on delete set null,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

create index categories_parent_idx on categories (parent_id, sort_order);

-- ---------------------------------------------------------------------------
-- products
-- Money is stored in minor units (halalas) as bigint — never floats.
-- `price_minor` is the VAT-INCLUSIVE price the buyer sees, which is what
-- Saudi consumer-pricing rules require. The VAT split is derived for the
-- seller's books, never shown in the buyer's product UI.
-- ---------------------------------------------------------------------------
create table products (
  id              uuid primary key default gen_random_uuid(),
  seller_id       uuid not null references seller_profiles(id) on delete cascade,
  category_id     uuid references categories(id) on delete set null,

  title           text not null check (length(btrim(title)) between 2 and 140),
  description     text check (description is null or length(description) <= 5000),

  price_minor     bigint not null check (price_minor >= 0),
  currency        char(3) not null default 'SAR' check (currency = 'SAR'),

  quantity        integer not null default 1 check (quantity >= 0),
  status          product_status not null default 'draft',
  allow_bidding   boolean not null default true,
  -- Offers below this are auto-rejected. NULL = accept any offer.
  min_bid_minor   bigint check (min_bid_minor is null or min_bid_minor >= 0),

  location_label  text,
  location_point  geography(Point, 4326),
  location_public boolean not null default false,

  -- Generated search vector. Arabic and English share one column; Postgres
  -- 'simple' config avoids English-only stemming mangling Arabic tokens.
  search_tsv      tsvector generated always as (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(description, '')), 'B')
  ) stored,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index products_seller_idx    on products (seller_id, created_at desc);
create index products_status_idx    on products (status) where status = 'active';
create index products_category_idx  on products (category_id) where status = 'active';
create index products_price_idx     on products (price_minor) where status = 'active';
create index products_search_idx    on products using gin (search_tsv);
create index products_title_trgm_idx on products using gin (title gin_trgm_ops);
create index products_location_idx  on products using gist (location_point);

create trigger products_touch
  before update on products
  for each row execute function siab_touch_updated_at();

-- ---------------------------------------------------------------------------
-- product_images — rows are created only after the file exists in Storage.
-- `storage_path` is the object key inside the `product-images` bucket.
-- ---------------------------------------------------------------------------
create table product_images (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references products(id) on delete cascade,
  storage_path  text not null,
  width         integer,
  height        integer,
  bytes         integer,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  unique (product_id, storage_path)
);

create index product_images_product_idx on product_images (product_id, sort_order);

-- ---------------------------------------------------------------------------
-- saved_products — the buyer's "save for later" place.
-- ---------------------------------------------------------------------------
create table saved_products (
  buyer_id    uuid not null references profiles(id) on delete cascade,
  product_id  uuid not null references products(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (buyer_id, product_id)
);

create index saved_products_buyer_idx on saved_products (buyer_id, created_at desc);
