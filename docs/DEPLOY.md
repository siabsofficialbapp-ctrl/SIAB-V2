# Deploying SIAB

Two things get deployed, and they are separate:

| Piece | Where | What it is |
|---|---|---|
| **API** | Railway | The Node server. Holds every secret. |
| **Database, auth, storage** | Supabase | Managed. Nothing to deploy — you push migrations to it. |
| **App** | Expo / EAS | iOS, Android and web from one codebase. Not on Railway. |

**The Expo app must not be deployed to Railway.** It is not a server. Railway
runs `apps/api` only, which is why the build command targets that package
explicitly.

---

## 1. Supabase — do this first

The API cannot start without it.

1. Create a project at [supabase.com](https://supabase.com) — the free tier is enough.
   Choose a region close to Saudi Arabia (Frankfurt `eu-central-1` is usually
   the lowest latency available).
2. Apply the schema:

   ```bash
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase db push
   ```

   That creates all 24 tables, the Row Level Security policies, and the four
   storage buckets.
3. Collect three values from **Settings → API**:
   - Project URL
   - `anon` public key
   - `service_role` secret key ← **server only, never in the app**

4. Seed the demo data (optional but recommended, it proves storage works):

   ```bash
   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... pnpm db:seed
   ```

---

## 2. Railway — the API

### Create the service

1. New Project → **Deploy from GitHub repo** → pick `SIAB-V2`.
2. Branch: `claude/continue-session-70zgug` (or `main` once you rename it).
3. **Leave the root directory as `/`.** Do not set it to `apps/api` — the API
   imports the `@siab/core` workspace package, which only resolves from the
   repository root.

Everything else is already configured in `railway.json`:

```
build   pnpm install --frozen-lockfile --prod=false && pnpm build
start   node apps/api/dist/index.js
health  /health
```

### Variables

Railway → your service → **Variables** → paste these in.

**Required — the service will refuse to start without them.** That refusal is
deliberate: a half-configured server that boots is worse than one that says
plainly what is missing.

| Variable | Value | Where to find it |
|---|---|---|
| `SUPABASE_URL` | `https://xxxx.supabase.co` | Supabase → Settings → API |
| `SUPABASE_ANON_KEY` | `eyJ...` | Supabase → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJ...` | Supabase → Settings → API → **secret** |

**Strongly recommended**

| Variable | Value | Without it |
|---|---|---|
| `NODE_ENV` | `production` | verbose debug logging |
| `API_ALLOWED_ORIGINS` | your web app's URL, comma-separated | the web build cannot call the API |
| `SUPABASE_JWT_SECRET` | Supabase → Settings → API → JWT Secret | every request costs an extra round trip to verify the token |

**Features — each one is optional, and the API says honestly when it is missing**

| Variable | Value | Without it |
|---|---|---|
| `ANTHROPIC_API_KEY` | `sk-ant-...` | both AI assistants are disabled |
| `SIAB_AI_MODEL` | `claude-opus-5` | defaults to this anyway |
| `BREVO_API_KEY` | from Brevo → SMTP & API | no verification email sends |
| `BREVO_SENDER_EMAIL` | `no-reply@yourdomain.com` | uses the default |
| `PAYMENTS_PROVIDER` | `mock` | defaults to `mock` — sandbox, no real money |

**Do not set `PORT`.** Railway injects it, and the API reads it.

### Copy-paste block

Railway's variable editor accepts raw `KEY=value` lines. Fill in and paste:

```
SUPABASE_URL=https://YOUR-PROJECT.supabase.co
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_JWT_SECRET=
NODE_ENV=production
API_ALLOWED_ORIGINS=http://localhost:8081
ANTHROPIC_API_KEY=
SIAB_AI_MODEL=claude-opus-5
BREVO_API_KEY=
BREVO_SENDER_EMAIL=no-reply@siab.app
BREVO_SENDER_NAME=SIAB
PAYMENTS_PROVIDER=mock
PAYMENTS_CURRENCY=SAR
SIAB_VAT_BPS=1500
SIAB_PLATFORM_FEE_BPS=100
```

### Confirm it worked

Railway → Settings → Networking → **Generate Domain**, then:

```bash
curl https://YOUR-SERVICE.up.railway.app/health
```

You should get back something like:

```json
{
  "ok": true,
  "service": "siab-api",
  "environment": "production",
  "integrations": {
    "database": true,
    "ai": true,
    "email": true,
    "payments": { "provider": "mock", "configured": true, "live": false }
  }
}
```

Read the `integrations` block carefully — it reports what is **actually**
wired. If `ai` is `false`, the key did not take effect, whatever the
dashboard shows.

---

## 3. The app

The app is not deployed to Railway. It needs the API's public URL:

```
EXPO_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJ...
EXPO_PUBLIC_API_URL=https://YOUR-SERVICE.up.railway.app
```

Only `EXPO_PUBLIC_*` values may live in the app. Anything shipped to a phone
can be read out of the bundle, so the service-role key, the Anthropic key and
the Brevo key must never appear here.

```bash
pnpm dev:app            # local development
npx expo export -p web  # static web build
npx eas build -p ios    # store builds
npx eas build -p android
```

Add the deployed web URL to `API_ALLOWED_ORIGINS` on Railway, or the browser
will block the calls with a CORS error.

---

## Troubleshooting

**"No start command detected"** — Railway is building from the wrong
directory. Root directory must be `/`, not `apps/api`.

**Service boots then immediately dies** — almost always a missing required
variable. The logs name it exactly; look for `Invalid environment
configuration`.

**`ai: false` in health despite setting the key** — Railway needs a redeploy
after variables change. Deployments → ⋮ → Redeploy.

**CORS errors from the web app** — add its origin to `API_ALLOWED_ORIGINS`,
comma-separated, no trailing slash.

**Images upload but never appear** — the storage bucket policies were not
applied. Re-run `npx supabase db push`; migration `0011` creates them.
