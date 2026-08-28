# SIAB

An AI-native marketplace connecting buyers and sellers, built for Saudi Arabia.

Every seller on SIAB gets two AI systems: a **Customer AI** that answers their
buyers, and a private **AI Coworker** that helps them run the business. That
pairing — not the marketplace itself — is the product.

---

## Status

| Phase | Scope | State |
|---|---|---|
| 1 | Architecture | ✅ |
| 2 | Database schema, RLS, storage | ✅ 20 tests |
| 3 | Auth, roles, Terms gate, email verification | ✅ |
| 4 | Marketplace, products, stalls, images, search + filters | ✅ |
| 5 | Messaging: text, images, deliberate location sharing | ✅ |
| 6 | Bidding and the order pipeline | ✅ |
| 7 | The SIAB score and seller analytics | ✅ |
| 8 | Customer AI and AI Coworker | ✅ |
| 9 | English + Arabic with RTL | ✅ 385 messages, parity enforced |
| 10 | Production hardening | ⏳ needs your keys and a device run |

**49 automated checks pass:** 20 database, 18 domain logic, 7 localisation,
4 API boot/authorisation. Five packages typecheck with zero errors.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full design.

---

## What is built and proven

The database layer is complete and tested. Not "written and it looks right" —
executed against a real Postgres, with the security rules asserted:

```
Database (20)                                 Domain logic (18)
✓ everyone starts at 100, bands correct       ✓ VAT extracted from the price, not added
✓ rating blocked until both sides confirm     ✓ totals reconcile exactly at every price
✓ one-sided confirmation does not complete    ✓ score bands match the database exactly
✓ mutual confirmation completes the order     ✓ no actor can force an order to completed
✓ status changes written to the audit trail   ✓ the pipeline cannot be skipped or reversed
✓ +5 / −5 applied, rating is mutual           ✓ a rating is exactly +5, −5 or skip
✓ one rating per person per order             ✓ a seller cannot register without a stall
✓ only the two parties may rate
✓ score reproducible from the event log       Localisation (7)
✓ Seller B's costs invisible to Seller A      ✓ English and Arabic cover the same messages
✓ Seller B's AI knowledge invisible to A      ✓ placeholders match across both languages
✓ orders visible only to their two parties    ✓ Arabic supplies all six plural forms
✓ analytics rejects a foreign seller id       ✓ Arabic is right-to-left
✓ reputation_score not writable by a client
✓ self-bidding rejected                       API (4)
✓ bid seller must own the product             ✓ health reports integrations honestly
✓ only seller accounts may own a stall        ✓ 21 private endpoints all reject no-token
✓ card data rejected at the database layer    ✓ errors carry a translation key
```

Run them yourself:

```bash
./supabase/tests/run.sh                 # database + security
node --test --experimental-strip-types packages/core/src/core.test.ts
node --test --experimental-strip-types packages/i18n/src/i18n.test.ts
pnpm --filter @siab/api test            # API boot + authorisation
```

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

## Before it runs for real

Three things are needed from you, and the app is honest about all of them —
the health endpoint reports what is actually wired rather than pretending.

| What | Where | Without it |
|---|---|---|
| **Your logo** | replace `apps/app/assets/logo.png` | a placeholder mark is shown |
| Supabase project | `SUPABASE_*` in `.env` | the app cannot sign anyone in |
| Anthropic key | `ANTHROPIC_API_KEY` | both assistants are disabled |
| Brevo key | `BREVO_API_KEY` | verification email does not send |
| Payment provider | `PAYMENTS_PROVIDER` | sandbox only; no real money moves |

The logo must be a square PNG. It is masked into a circle in the app header
and used as the home-screen icon.

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
