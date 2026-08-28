# SIAB

An AI-native marketplace connecting buyers and sellers, built for Saudi Arabia.

Every seller on SIAB gets two AI systems: a **Customer AI** that answers their
buyers, and a private **AI Coworker** that helps them run the business. That
pairing — not the marketplace itself — is the product.

---

## Status

| Phase | Scope | State |
|---|---|---|
| 1 | Architecture | ✅ done |
| 2 | Database schema, RLS, storage, tests | ✅ done — 20 tests passing |
| 3 | Auth, roles, Terms gate, email verification | ⏳ next |
| 4–10 | Marketplace, chat, bidding, orders, score, AI, Arabic, hardening | planned |

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full design.

---

## What is built and proven

The database layer is complete and tested. Not "written and it looks right" —
executed against a real Postgres, with the security rules asserted:

```
✓ everyone starts at 100, bands correct       ✓ Seller B's costs invisible to Seller A
✓ rating blocked until both sides confirm     ✓ Seller B's AI knowledge invisible to Seller A
✓ one-sided confirmation does not complete    ✓ orders visible only to their two parties
✓ mutual confirmation completes the order     ✓ analytics accessor rejects a foreign seller id
✓ status changes written to the audit trail   ✓ reputation_score not writable by a client
✓ +5 / −5 applied, rating is mutual           ✓ self-bidding rejected
✓ one rating per person per order             ✓ bid seller must own the product
✓ only the two parties may rate               ✓ only seller accounts may own a stall
✓ score reproducible from the event log       ✓ card data rejected at the database layer
```

Run them yourself: `./supabase/tests/run.sh`

---

## The SIAB score

There are no star ratings. Every member — buyer and seller — starts at **100**,
shown next to their name and coloured by band:

| below 60 | 60–150 | 151–500 | 501+ |
|---|---|---|---|
| 🔴 red | 🟠 orange | 🟢 green | 💎 diamond blue |

After a delivered order, both sides confirm the handover — the seller confirms
they gave it, the buyer confirms they received it. Only once **both** have
confirmed may each give the other **+5**, **−5**, or skip. One judgement per
person per order.

Diamond members (501+) receive special treatment from SIAB.

---

## Getting started

### Prerequisites

- Node 20+ and pnpm 10+
- A Supabase project (the free tier is enough)
- Postgres 16 + PostGIS locally, if you want to run the database tests

### Setup

```bash
pnpm install
cp .env.example .env      # then fill it in — see the comments in that file
```

### Database

```bash
# Point the Supabase CLI at your project, then:
supabase db push          # applies supabase/migrations in order
pnpm db:seed              # 5 clearly-labelled demo products with images
```

### Run

```bash
pnpm dev                  # starts the API and the Expo app
```

### Test

```bash
./supabase/tests/run.sh   # database + security suite
pnpm test                 # application tests
```

---

## Repository layout

```
apps/app/        Expo universal client — iOS, Android, web from one codebase
apps/api/        Fastify service on Railway; holds every secret and AI call
packages/core/   Shared types, zod schemas, money and score logic
packages/i18n/   English and Arabic resources
supabase/        Migrations, RLS policies, storage buckets, tests, seed
docs/            Architecture and companion documents
```

---

## Security posture

The client is a rendering layer with no authority. Everything that matters is
enforced in Postgres or in the API:

- **Row Level Security on every table**, default deny.
- **Seller A's AI cannot reach Seller B's data** — not because a prompt says
  so, but because RLS returns no rows and no tool accepts a seller id as an
  argument.
- **Derived values are not writable.** The score is a projection of the
  reputation event log, protected by a column-level privilege.
- **No secrets in the client.** It carries the Supabase anon key and nothing
  else. AI keys, the service-role key and payment keys live only in the API.
- **No card data.** A database constraint rejects PAN/CVV-shaped payloads.

---

## Contributing notes

- Money is always integer halalas (`bigint`). Never floats.
- No inline English strings in components — everything goes through i18n.
- Anything security-relevant belongs in `supabase/migrations/` or `apps/api/`.
- Never commit `.env`.

---

## Legal

The Terms & Conditions are drafted to fit Saudi law (E-Commerce Law, PDPL,
15% VAT). They are written in good faith but **require review by a qualified
Saudi lawyer before real users sign up.**
