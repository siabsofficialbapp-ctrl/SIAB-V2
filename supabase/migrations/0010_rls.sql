-- ============================================================================
-- SIAB 0010 — Row Level Security
--
-- This file is the real privacy boundary (§15, §28, §44). The client is never
-- trusted; the AI is never trusted. If a rule matters, it is written here.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Is the current connection the API service (service role), rather than an
-- end user? Used to let the backend act on a seller's behalf after it has
-- authenticated them itself.
create or replace function siab_is_service_role()
returns boolean
language sql
stable
as $$
  select coalesce(auth.role() = 'service_role', false);
$$;

-- Does the current user own this stall?
create or replace function siab_owns_stall(p_seller uuid)
returns boolean
language sql
stable
as $$
  select siab_uid() = p_seller;
$$;

-- Is the current user a party to this order?
create or replace function siab_in_order(p_order uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from orders o
    where o.id = p_order and (o.buyer_id = siab_uid() or o.seller_id = siab_uid())
  );
$$;

-- Is the current user a party to this conversation?
create or replace function siab_in_conversation(p_conversation uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from conversations c
    where c.id = p_conversation and (c.buyer_id = siab_uid() or c.seller_id = siab_uid())
  );
$$;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere. Default deny; every allowance below is explicit.
-- ---------------------------------------------------------------------------
alter table profiles             enable row level security;
alter table seller_profiles      enable row level security;
alter table buyer_profiles       enable row level security;
alter table terms_versions       enable row level security;
alter table terms_acceptances    enable row level security;
alter table categories           enable row level security;
alter table products             enable row level security;
alter table product_images       enable row level security;
alter table saved_products       enable row level security;
alter table bids                 enable row level security;
alter table orders               enable row level security;
alter table order_events         enable row level security;
alter table payments             enable row level security;
alter table reputation_events    enable row level security;
alter table conversations        enable row level security;
alter table messages             enable row level security;
alter table seller_ai_settings   enable row level security;
alter table seller_ai_knowledge  enable row level security;
alter table ai_conversations     enable row level security;
alter table ai_messages          enable row level security;
alter table ai_usage             enable row level security;
alter table seller_costs         enable row level security;
alter table stall_views          enable row level security;
alter table notifications        enable row level security;

-- ---------------------------------------------------------------------------
-- profiles
-- A user reads and edits only their own row. Everyone else sees them through
-- v_public_seller / v_public_buyer, which expose only opted-in fields.
-- ---------------------------------------------------------------------------
create policy profiles_select_self on profiles
  for select using (id = siab_uid() or siab_is_service_role());

create policy profiles_update_self on profiles
  for update using (id = siab_uid()) with check (id = siab_uid());

create policy profiles_insert_self on profiles
  for insert with check (id = siab_uid());

-- The score is a projection of reputation_events, so no client may write it.
-- This is enforced with a COLUMN-LEVEL privilege rather than a trigger flag:
-- a privilege cannot be talked around from inside a session, and the
-- reputation trigger is SECURITY DEFINER so it still applies deltas.
-- (Applied in 0011, after all grants have been issued.)

-- ---------------------------------------------------------------------------
-- seller_profiles / buyer_profiles
-- Stalls are public by design (they are shopfronts); only the owner writes.
-- ---------------------------------------------------------------------------
create policy seller_profiles_select_all on seller_profiles for select using (true);
create policy seller_profiles_write_own  on seller_profiles
  for all using (siab_owns_stall(id)) with check (siab_owns_stall(id));

create policy buyer_profiles_own on buyer_profiles
  for all using (id = siab_uid() or siab_is_service_role())
  with check (id = siab_uid());

-- ---------------------------------------------------------------------------
-- Terms: everyone may read them; acceptances are private to the user.
-- ---------------------------------------------------------------------------
create policy terms_versions_read on terms_versions for select using (true);

create policy terms_acceptances_own on terms_acceptances
  for select using (user_id = siab_uid() or siab_is_service_role());
create policy terms_acceptances_insert on terms_acceptances
  for insert with check (user_id = siab_uid());

-- ---------------------------------------------------------------------------
-- Catalog
-- ---------------------------------------------------------------------------
create policy categories_read on categories for select using (true);

-- A product is visible to the world once active; drafts belong to the owner.
create policy products_select_public on products
  for select using (status = 'active' or seller_id = siab_uid() or siab_is_service_role());

create policy products_write_own on products
  for all using (siab_owns_stall(seller_id)) with check (siab_owns_stall(seller_id));

create policy product_images_select on product_images
  for select using (
    exists (select 1 from products p
             where p.id = product_id
               and (p.status = 'active' or p.seller_id = siab_uid() or siab_is_service_role()))
  );

create policy product_images_write_own on product_images
  for all using (
    exists (select 1 from products p where p.id = product_id and p.seller_id = siab_uid())
  ) with check (
    exists (select 1 from products p where p.id = product_id and p.seller_id = siab_uid())
  );

create policy saved_products_own on saved_products
  for all using (buyer_id = siab_uid()) with check (buyer_id = siab_uid());

-- ---------------------------------------------------------------------------
-- Bids — visible to the two parties only. A buyer must never see what other
-- buyers offered, or bidding becomes an information leak.
-- ---------------------------------------------------------------------------
create policy bids_select_parties on bids
  for select using (buyer_id = siab_uid() or seller_id = siab_uid() or siab_is_service_role());

create policy bids_insert_buyer on bids
  for insert with check (buyer_id = siab_uid());

-- The seller responds (accept/reject/counter); the buyer may only cancel.
create policy bids_update_parties on bids
  for update using (buyer_id = siab_uid() or seller_id = siab_uid())
  with check (buyer_id = siab_uid() or seller_id = siab_uid());

-- ---------------------------------------------------------------------------
-- Orders and everything hanging off them
-- ---------------------------------------------------------------------------
create policy orders_select_parties on orders
  for select using (buyer_id = siab_uid() or seller_id = siab_uid() or siab_is_service_role());

create policy orders_insert_buyer on orders
  for insert with check (buyer_id = siab_uid() or siab_is_service_role());

create policy orders_update_parties on orders
  for update using (buyer_id = siab_uid() or seller_id = siab_uid() or siab_is_service_role())
  with check (buyer_id = siab_uid() or seller_id = siab_uid() or siab_is_service_role());

create policy order_events_select on order_events
  for select using (siab_in_order(order_id) or siab_is_service_role());

create policy payments_select on payments
  for select using (siab_in_order(order_id) or siab_is_service_role());
-- Payments are written by the API only, after the provider confirms.
create policy payments_write_service on payments
  for all using (siab_is_service_role()) with check (siab_is_service_role());

-- ---------------------------------------------------------------------------
-- Reputation — readable by the two parties; the resulting score is public
-- through the profile views. You may only file your own judgement.
-- ---------------------------------------------------------------------------
create policy reputation_select on reputation_events
  for select using (rater_id = siab_uid() or ratee_id = siab_uid() or siab_is_service_role());

create policy reputation_insert_self on reputation_events
  for insert with check (rater_id = siab_uid());

-- No edits, no deletes: a rating is a historical fact.

-- ---------------------------------------------------------------------------
-- Messaging
-- ---------------------------------------------------------------------------
create policy conversations_parties on conversations
  for select using (buyer_id = siab_uid() or seller_id = siab_uid() or siab_is_service_role());

create policy conversations_insert on conversations
  for insert with check (buyer_id = siab_uid() or seller_id = siab_uid() or siab_is_service_role());

create policy messages_select_parties on messages
  for select using (siab_in_conversation(conversation_id) or siab_is_service_role());

-- You may only send as yourself. The AI posts via the service role.
create policy messages_insert_self on messages
  for insert with check (
    (sender_id = siab_uid() and siab_in_conversation(conversation_id))
    or siab_is_service_role()
  );

create policy messages_update_read on messages
  for update using (siab_in_conversation(conversation_id))
  with check (siab_in_conversation(conversation_id));

-- ---------------------------------------------------------------------------
-- AI configuration and private business data
--
-- THE ABSOLUTE PRIVACY RULE (§15): every one of these tables is scoped to the
-- owning seller. Seller A's Coworker runs as Seller A and therefore cannot
-- read Seller B's rows — not because a prompt asked it not to, but because
-- the database will not return them.
-- ---------------------------------------------------------------------------
create policy seller_ai_settings_own on seller_ai_settings
  for all using (siab_owns_stall(seller_id) or siab_is_service_role())
  with check (siab_owns_stall(seller_id) or siab_is_service_role());

create policy seller_ai_knowledge_own on seller_ai_knowledge
  for all using (siab_owns_stall(seller_id) or siab_is_service_role())
  with check (siab_owns_stall(seller_id) or siab_is_service_role());

create policy ai_conversations_own on ai_conversations
  for all using (siab_owns_stall(seller_id) or siab_is_service_role())
  with check (siab_owns_stall(seller_id) or siab_is_service_role());

create policy ai_messages_own on ai_messages
  for all using (
    exists (select 1 from ai_conversations c
             where c.id = ai_conversation_id
               and (c.seller_id = siab_uid() or siab_is_service_role()))
  ) with check (
    exists (select 1 from ai_conversations c
             where c.id = ai_conversation_id
               and (c.seller_id = siab_uid() or siab_is_service_role()))
  );

create policy ai_usage_own on ai_usage
  for all using (siab_owns_stall(seller_id) or siab_is_service_role())
  with check (siab_is_service_role());

create policy seller_costs_own on seller_costs
  for all using (siab_owns_stall(seller_id) or siab_is_service_role())
  with check (siab_owns_stall(seller_id) or siab_is_service_role());

-- ---------------------------------------------------------------------------
-- Analytics and notifications
-- ---------------------------------------------------------------------------
-- Raw view rows are private; the counted total reaches the seller through
-- v_seller_analytics. A seller does not get a log of who looked at their stall.
create policy stall_views_owner on stall_views
  for select using (siab_owns_stall(seller_id) or siab_is_service_role());
create policy stall_views_insert on stall_views
  for insert with check (true);

create policy notifications_own on notifications
  for select using (user_id = siab_uid() or siab_is_service_role());
create policy notifications_update_own on notifications
  for update using (user_id = siab_uid()) with check (user_id = siab_uid());
create policy notifications_insert_service on notifications
  for insert with check (siab_is_service_role());
