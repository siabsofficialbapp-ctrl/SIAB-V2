# SIAB — database reference

24 tables, 4 storage buckets, RLS on everything. Applied in order from
`supabase/migrations/`.

## Migration files

| File | Contents |
|---|---|
| `0001_foundation.sql` | Extensions, enums, `siab_uid()`, `updated_at` trigger |
| `0002_profiles.sql` | `profiles`, `seller_profiles`, `buyer_profiles`, score bands |
| `0003_terms.sql` | `terms_versions`, `terms_acceptances` |
| `0004_catalog.sql` | `categories`, `products`, `product_images`, `saved_products` |
| `0005_bids_orders.sql` | `bids`, `orders`, `order_events`, `payments` |
| `0006_reputation.sql` | `reputation_events` and the score machinery |
| `0007_messaging.sql` | `conversations`, `messages` |
| `0008_ai.sql` | AI settings, knowledge, threads, usage, `seller_costs` |
| `0009_analytics.sql` | `stall_views`, `notifications`, analytics + public views |
| `0010_rls.sql` | Row Level Security across every table |
| `0011_views_and_storage.sql` | View security, grants, storage buckets + policies |

## Conventions

**Money** — integer minor units (halalas) in `bigint` columns named
`*_minor`. Never floats. `price_minor` is VAT-inclusive.

**Identity** — `siab_uid()` wraps `auth.uid()`. Every policy uses it.

**Derived values** — computed by trigger or view, never stored by a client.
`profiles.reputation_score` is the clearest case: a projection of
`reputation_events`, protected by `REVOKE UPDATE` on the column.

**Audit trails are append-only.** `order_events` and `reputation_events` have
no UPDATE or DELETE policy at all.

## Image upload — the two-step rule

Images fail to save when only half the operation is permitted. Both halves are
defined:

1. **Upload the object** into the bucket, at a path whose first folder is the
   owning id — `product-images/{seller_id}/{product_id}/{uuid}.jpg`. The
   Storage policy checks that first segment against `siab_uid()`.
2. **Insert the row** in `product_images` pointing at that path.

If step 2 is skipped the file exists but nothing renders. Client code must do
both, and roll back the upload if the insert fails.

Buckets:

| Bucket | Public | Limit | Path |
|---|---|---|---|
| `product-images` | yes | 5 MB | `{seller_id}/{product_id}/{uuid}` |
| `stall-assets` | yes | 5 MB | `{seller_id}/{uuid}` |
| `avatars` | yes | 2 MB | `{user_id}/{uuid}` |
| `chat-images` | **no** | 5 MB | `{conversation_id}/{uuid}` |

## Views

| View | Runs as | Purpose |
|---|---|---|
| `v_public_seller` | owner | Exactly what a buyer may see of a seller |
| `v_public_buyer` | owner | Same for a buyer's public card |
| `v_seller_analytics` | **invoker** | Real revenue, profit, orders, views |
| `v_pending_reputation_actions` | **invoker** | Drives confirm + rate prompts |

The two public views run as owner *on purpose* — they select only opted-in
columns, so bypassing RLS is safe and cheap. Anything touching private data
runs as invoker, so RLS applies.

## Testing

```bash
./supabase/tests/run.sh
```

Spins up a throwaway cluster, shims the objects Supabase provides
(`auth.users`, `auth.uid()`, `storage.objects`, the three API roles), applies
every migration, and runs the suite. 20 assertions covering the score rules,
the mutual-confirmation gate, the cross-seller privacy boundary, and
marketplace integrity.
