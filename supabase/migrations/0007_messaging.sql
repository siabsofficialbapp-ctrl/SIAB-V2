-- ============================================================================
-- SIAB 0007 — buyer/seller chat (§23) and buyer↔AI chat (§24)
-- ============================================================================

create table conversations (
  id            uuid primary key default gen_random_uuid(),
  kind          conversation_kind not null default 'human',
  buyer_id      uuid not null references profiles(id) on delete cascade,
  seller_id     uuid not null references seller_profiles(id) on delete cascade,
  product_id    uuid references products(id) on delete set null,
  last_message_at timestamptz,
  created_at    timestamptz not null default now(),
  constraint conversations_distinct check (buyer_id <> seller_id)
);

-- One human thread and one AI thread per buyer/seller/product triple.
create unique index conversations_unique_thread
  on conversations (kind, buyer_id, seller_id, coalesce(product_id, '00000000-0000-0000-0000-000000000000'::uuid));

create index conversations_buyer_idx  on conversations (buyer_id, last_message_at desc nulls last);
create index conversations_seller_idx on conversations (seller_id, last_message_at desc nulls last);

create table messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  sender_id       uuid references profiles(id) on delete set null,  -- null = the AI
  kind            message_kind not null default 'text',

  body            text check (body is null or length(body) <= 4000),
  -- Image messages: object key in the `chat-images` bucket.
  storage_path    text,
  -- Location messages. Deliberate act only — never sent automatically (§23).
  location_point  geography(Point, 4326),
  location_label  text,

  read_at         timestamptz,
  created_at      timestamptz not null default now(),

  constraint messages_payload_matches_kind check (
    (kind = 'text'     and body is not null) or
    (kind = 'image'    and storage_path is not null) or
    (kind = 'location' and location_point is not null) or
    (kind = 'system'   and body is not null)
  )
);

create index messages_conversation_idx on messages (conversation_id, created_at desc);
create index messages_unread_idx on messages (conversation_id) where read_at is null;

-- Keep conversations.last_message_at current so inbox sorting is cheap.
create or replace function siab_touch_conversation()
returns trigger
language plpgsql
as $$
begin
  update conversations set last_message_at = new.created_at where id = new.conversation_id;
  return new;
end;
$$;

create trigger messages_touch_conversation
  after insert on messages
  for each row execute function siab_touch_conversation();
