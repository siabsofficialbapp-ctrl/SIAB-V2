-- ============================================================================
-- SIAB 0011 — view security, grants, and Storage buckets + policies
--
-- Image upload is a two-step operation: put the object in Storage, then
-- insert the row that points at it. Both halves need permission, and a
-- missing Storage policy is the classic reason images silently fail to save.
-- Both halves are defined here.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- View security
--
-- Postgres runs a view as its OWNER by default, which bypasses RLS on the
-- underlying tables. That is exactly what we want for the two PUBLIC views
-- (they hand out only opted-in columns), and exactly what we must NOT have
-- for anything touching private business data.
-- ---------------------------------------------------------------------------
alter view v_seller_analytics            set (security_invoker = true);
alter view v_pending_reputation_actions  set (security_invoker = true);
-- v_public_seller / v_public_buyer intentionally stay owner-run.

revoke all on v_seller_analytics from anon;
grant select on v_seller_analytics           to authenticated, service_role;
grant select on v_pending_reputation_actions to authenticated, service_role;
grant select on v_public_seller              to anon, authenticated, service_role;
grant select on v_public_buyer               to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Seller analytics accessor. The Coworker AI reaches its owner's numbers
-- through this and nothing else, so the seller identity is decided by the
-- server, never supplied as an argument the model could tamper with (§30).
-- ---------------------------------------------------------------------------
create or replace function siab_seller_analytics(p_seller uuid)
returns setof v_seller_analytics
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (siab_is_service_role() or siab_uid() = p_seller) then
    raise exception 'not authorised to read analytics for seller %', p_seller
      using errcode = 'insufficient_privilege';
  end if;
  return query select * from v_seller_analytics v where v.seller_id = p_seller;
end;
$$;

revoke all on function siab_seller_analytics(uuid) from public, anon;
grant execute on function siab_seller_analytics(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Storage buckets
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('product-images', 'product-images', true,  5242880,
     array['image/jpeg','image/png','image/webp','image/heic']),
  ('stall-assets',   'stall-assets',   true,  5242880,
     array['image/jpeg','image/png','image/webp']),
  ('avatars',        'avatars',        true,  2097152,
     array['image/jpeg','image/png','image/webp']),
  ('chat-images',    'chat-images',    false, 5242880,
     array['image/jpeg','image/png','image/webp','image/heic'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- Storage policies
--
-- Path convention — the FIRST folder segment is always the owning id, which
-- is what these policies check:
--   product-images/{seller_id}/{product_id}/{uuid}.jpg
--   stall-assets/{seller_id}/{uuid}.jpg
--   avatars/{user_id}/{uuid}.jpg
--   chat-images/{conversation_id}/{uuid}.jpg
-- ---------------------------------------------------------------------------

-- Public buckets: anyone may read.
create policy "siab public read"
  on storage.objects for select
  using (bucket_id in ('product-images', 'stall-assets', 'avatars'));

-- Sellers write only inside their own folder.
create policy "siab seller writes own product images"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = siab_uid()::text
  );

create policy "siab seller updates own product images"
  on storage.objects for update to authenticated
  using (bucket_id = 'product-images' and (storage.foldername(name))[1] = siab_uid()::text);

create policy "siab seller deletes own product images"
  on storage.objects for delete to authenticated
  using (bucket_id = 'product-images' and (storage.foldername(name))[1] = siab_uid()::text);

create policy "siab seller writes own stall assets"
  on storage.objects for all to authenticated
  using (bucket_id = 'stall-assets' and (storage.foldername(name))[1] = siab_uid()::text)
  with check (bucket_id = 'stall-assets' and (storage.foldername(name))[1] = siab_uid()::text);

create policy "siab user writes own avatar"
  on storage.objects for all to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = siab_uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = siab_uid()::text);

-- Chat images are private: only the two people in that conversation.
create policy "siab chat image read by participants"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'chat-images'
    and siab_in_conversation(((storage.foldername(name))[1])::uuid)
  );

create policy "siab chat image write by participants"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'chat-images'
    and siab_in_conversation(((storage.foldername(name))[1])::uuid)
  );

-- ---------------------------------------------------------------------------
-- Column-level lockdown of the derived score.
--
-- Packaged as a function because Supabase re-issues default table grants when
-- new tables appear; re-run this after any such change.
-- ---------------------------------------------------------------------------
create or replace function siab_apply_column_grants()
returns void
language plpgsql
as $$
begin
  -- A table-level UPDATE grant implies every column, so it must be revoked
  -- before column-level grants mean anything.
  revoke update on profiles from anon, authenticated;

  -- Exactly the fields a user may edit about themselves. Everything omitted
  -- here is server-owned:
  --   reputation_score  derived from reputation_events (0006)
  --   role              set at signup; changing it is a deliberate,
  --                     server-side account operation (§1)
  --   email             changed only through Supabase's verified
  --                     email-change flow, which writes auth.users first
  --   suspended_at      administration only (§45)
  grant update (
    display_name, avatar_url, locale, phone, region,
    email_public, phone_public, region_public, updated_at
  ) on profiles to authenticated;
end;
$$;

select siab_apply_column_grants();
