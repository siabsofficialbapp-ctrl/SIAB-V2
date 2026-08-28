-- ============================================================================
-- SIAB 0008 — the two AI systems (§12, §14)
--
--   AI #1  Customer AI  — public-facing, answers buyers on the seller's behalf
--   AI #2  AI Coworker  — private, analyses the seller's own business
--
-- The permission boundary between them is enforced by RLS (0010) and by the
-- API's tool layer, never by prompt text alone (§15).
-- ============================================================================

create table seller_ai_settings (
  seller_id       uuid primary key references seller_profiles(id) on delete cascade,
  enabled         boolean not null default true,

  -- Personality knobs the seller sets in the UI (§12).
  tone            text not null default 'friendly'
                    check (tone in ('friendly', 'professional', 'concise', 'detailed', 'casual')),
  -- Free-form seller instructions. Treated as DATA by the API, never spliced
  -- into the system prompt as trusted instruction.
  instructions    text check (instructions is null or length(instructions) <= 4000),
  greeting_en     text,
  greeting_ar     text,

  -- Guardrail: what the AI may do when it does not know (§12).
  fallback_behaviour text not null default 'defer_to_seller'
                    check (fallback_behaviour in ('defer_to_seller', 'say_unknown')),

  daily_message_cap integer not null default 500 check (daily_message_cap > 0),

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger seller_ai_settings_touch
  before update on seller_ai_settings
  for each row execute function siab_touch_updated_at();

-- ---------------------------------------------------------------------------
-- seller_ai_knowledge — what the seller has taught their Customer AI.
-- Retrieved at request time and passed as context (RAG), never fine-tuned (§2).
-- ---------------------------------------------------------------------------
create table seller_ai_knowledge (
  id          uuid primary key default gen_random_uuid(),
  seller_id   uuid not null references seller_profiles(id) on delete cascade,
  title       text not null check (length(btrim(title)) between 1 and 200),
  content     text not null check (length(content) between 1 and 8000),
  -- 'faq' | 'policy' | 'shipping' | 'returns' | 'product' | 'other'
  category    text not null default 'other',
  is_active   boolean not null default true,

  search_tsv  tsvector generated always as (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(content, '')), 'B')
  ) stored,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index seller_ai_knowledge_seller_idx on seller_ai_knowledge (seller_id) where is_active;
create index seller_ai_knowledge_search_idx on seller_ai_knowledge using gin (search_tsv);

create trigger seller_ai_knowledge_touch
  before update on seller_ai_knowledge
  for each row execute function siab_touch_updated_at();

-- ---------------------------------------------------------------------------
-- ai_conversations — the Coworker's private threads. (Customer-AI threads
-- live in `conversations` with kind='ai' so the buyer sees one inbox.)
-- ---------------------------------------------------------------------------
create table ai_conversations (
  id          uuid primary key default gen_random_uuid(),
  seller_id   uuid not null references seller_profiles(id) on delete cascade,
  title       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index ai_conversations_seller_idx on ai_conversations (seller_id, updated_at desc);

create trigger ai_conversations_touch
  before update on ai_conversations
  for each row execute function siab_touch_updated_at();

create table ai_messages (
  id                  uuid primary key default gen_random_uuid(),
  ai_conversation_id  uuid not null references ai_conversations(id) on delete cascade,
  role                text not null check (role in ('user', 'assistant')),
  content             text not null,
  -- Which secure tools ran, and with what result. Kept for auditability:
  -- if the Coworker ever reports a number, we can prove where it came from.
  tool_calls          jsonb,
  input_tokens        integer,
  output_tokens       integer,
  created_at          timestamptz not null default now()
);

create index ai_messages_conversation_idx on ai_messages (ai_conversation_id, created_at);

-- ---------------------------------------------------------------------------
-- ai_usage — per-seller rate limiting and cost control (§29).
-- ---------------------------------------------------------------------------
create table ai_usage (
  seller_id     uuid not null references seller_profiles(id) on delete cascade,
  day           date not null default current_date,
  surface       text not null check (surface in ('customer', 'coworker')),
  requests      integer not null default 0,
  input_tokens  bigint  not null default 0,
  output_tokens bigint  not null default 0,
  primary key (seller_id, day, surface)
);

-- ---------------------------------------------------------------------------
-- seller_costs — what the seller spent, so "net profit" is a real number (§16).
-- ---------------------------------------------------------------------------
create table seller_costs (
  id            uuid primary key default gen_random_uuid(),
  seller_id     uuid not null references seller_profiles(id) on delete cascade,
  -- Optional link: cost of goods for one specific order.
  order_id      uuid references orders(id) on delete set null,
  label         text not null,
  amount_minor  bigint not null check (amount_minor >= 0),
  currency      char(3) not null default 'SAR',
  incurred_on   date not null default current_date,
  created_at    timestamptz not null default now()
);

create index seller_costs_seller_idx on seller_costs (seller_id, incurred_on desc);
