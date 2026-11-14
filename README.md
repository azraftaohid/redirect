# Redirect

A simple, lightweight, cost-aware URL redirection and link management service built for Cloudflare Workers (`v0.2.3` — see [CHANGELOG.md](CHANGELOG.md)).

Designed as a single Cloudflare Worker with Static Assets, Redirect handles public link redirection with sub-second response times, provides a token-authenticated management API, and features a frontend management application served under `/app/`.

### Key Features

- **Edge Redirection Engine:** Case-sensitive, mutable single-segment slugs (`^[A-Za-z0-9_-]{1,64}$`), temporary/permanent redirect status codes (`301`, `302`, `303`, `307`, `308`), optional expiration timestamps, query parameter forwarding, and loop prevention against `OWN_HOSTNAMES`.
- **Management Web Console (`/app/`):** Dashboard for shortening, searching, filtering by tag/status, generating QR codes, viewing daily/country/referrer click analytics, importing/exporting links as versioned JSON, managing API tokens, and sharing URLs via PWA Web Share Target (`/app/share`).
- **Token-Authenticated REST API (`/api/v1/*`):** Full CRUD for links, analytics stats, token lifecycle management, cursor-paginated JSON export, and chunk-friendly batch JSON import.
- **Cost-Aware Analytics & Backups:** Daily D1 rollup aggregates (`link_daily_clicks`, optional `link_daily_dims`) with non-blocking `ctx.waitUntil()` writes, plus D1 SQLite export/Time Travel and portable links-only JSON export/import.

---

## Architecture & Request Routing

Every incoming request is dispatched by the Worker (`run_worker_first: true`) according to strict URL pathname precedence:

```text
[Incoming Request]
   ├── /api/v1/*          ──► Management REST API (Token auth required)
   ├── /app               ──► HTTP 308 redirect to /app/
   ├── /app/*             ──► Frontend SPA (Static assets; SPA fallback to /app/index.html)
   ├── /                  ──► Root handler (HTTP 307 to FALLBACK_URL if set, else 404)
   ├── /:slug             ──► Redirection engine (D1 database lookup)
   └── anything else      ──► Exact static asset if present (e.g. /favicon.ico), else 404 page
```

- **Reserved top-level paths:** Only `api` and `app` are reserved (case-insensitive).
- **Slug format:** Single-segment `^[A-Za-z0-9_-]{1,64}$` (case-sensitive and mutable).
- **Loop prevention:** Targets cannot redirect to the redirector host or configured `OWN_HOSTNAMES`.
- **Query preservation:** Incoming query parameters are merged while preserving target parameters and encoding byte-for-byte.

---

## 1. Setup & Deployment

### Prerequisites

- Node.js 20+
- `pnpm` (v12)
- Cloudflare account with Wrangler authenticated (`pnpm --filter @redirect/api exec wrangler login`)

### Installation

Clone the repository and install workspace dependencies:

```bash
pnpm install
```

### Provision Cloudflare Resources

1. **Create the D1 database:**

   ```bash
   pnpm --filter @redirect/api exec wrangler d1 create redirect-db
   ```

   Copy the returned `database_id`.

2. **Create the KV namespace:**

   ```bash
   pnpm --filter @redirect/api exec wrangler kv namespace create AUTH_TOKENS
   ```

   Copy the returned namespace `id`.

3. **Configure `apps/api/wrangler.jsonc`:**

   Open `apps/api/wrangler.jsonc` and paste your IDs:

   ```jsonc
   "d1_databases": [
     {
       "binding": "DB",
       "database_name": "redirect-db",
       "database_id": "<PASTE_D1_DATABASE_ID_HERE>",
       "migrations_dir": "migrations"
     }
   ],
   "kv_namespaces": [
     {
       "binding": "AUTH_TOKENS",
       "id": "<PASTE_KV_NAMESPACE_ID_HERE>"
     }
   ],
   "routes": [
     { "pattern": "go.yourdomain.com", "custom_domain": true }
   ]
   ```

4. **Apply database migrations:**

   - For remote production:

     ```bash
     pnpm db:migrate:remote
     ```

   - For local development:

     ```bash
     pnpm db:migrate:local
     ```

5. **Deploy the Worker:**

   ```bash
   pnpm deploy
   ```

---

## 2. First Run & Obtaining Your Token

Redirect employs a zero-lockout lazy bootstrapping mechanism for API authentication.

### Bootstrapping the Initial Token

1. Make an unauthenticated request to any API endpoint, or open `/app/`:

   ```bash
   curl -i https://<your-domain>/api/v1/auth/verify
   ```

   The API will respond with `401 Unauthorized`. This initial request triggers the Worker to automatically generate a secure token in the format `rdir_initial_<secret>` (48-character Base62 secret) and store it in KV under the key `initial_token`.

2. **Retrieve the token in production:**

   - Log in to the [Cloudflare Dashboard](https://dash.cloudflare.com/).
   - Navigate to **Storage & Databases** → **KV** → `AUTH_TOKENS`.
   - View the plaintext value of the `initial_token` key and copy it.

3. **Retrieve the token in local development (`pnpm dev`):**

   ```bash
   pnpm --filter @redirect/api exec wrangler kv key get initial_token --binding AUTH_TOKENS --local
   ```

### Token Storage Layout in KV

For transparent operator visibility, tokens are stored in Workers KV (`AUTH_TOKENS`) using a self-indexing layout:
- `initial_token`: Plaintext value `rdir_initial_<secret>`.
- `token:<id>`: Plaintext value `rdir_<id>_<secret>` (where `<id>` is 10 chars Base62 and `<secret>` is 32 chars Base62). Token metadata (`{ name, createdAt, expiresAt, preview }`) is stored in the KV metadata header, enabling fast direct lookups, instant 1-op revocations without listing, and efficient prefix enumeration.

### Authenticating API Calls

Include the token in all API requests using either standard header:

```bash
# Using Authorization Bearer
curl -H "Authorization: Bearer <your-token>" https://<your-domain>/api/v1/auth/verify

# Or using X-API-Key
curl -H "X-API-Key: <your-token>" https://<your-domain>/api/v1/auth/verify
```

---

## 3. Recovery & Lockout Prevention

The system is designed so that the owner can **never be locked out**:

1. **Regenerating Initial Token:**

   If you ever lose your tokens or revoke all keys, delete the `initial_token` key directly in the Cloudflare Dashboard (or via Wrangler KV). The very next unauthenticated API request will detect the absence and generate a brand-new `initial_token`.

2. **Rotating Initial Token:**

   Call the rotation endpoint with your existing token:

   ```bash
   curl -X POST https://<your-domain>/api/v1/tokens/initial/rotate \
     -H "Authorization: Bearer <your-token>"
   ```

3. **Master `API_KEY` Secret:**

   You can optionally configure a fixed secret token:

   ```bash
   pnpm --filter @redirect/api exec wrangler secret put API_KEY
   ```

   > **Note:** When `API_KEY` is configured, the dynamic `initial_token` mechanism is completely disabled and only the secret is accepted. Removing the secret re-enables `initial_token`.

---

## 4. Optional Cloudflare Zero Trust Hardening

Cloudflare Zero Trust (Access) can be layered on top for additional security, but is **entirely optional**. The API and frontend are fully secured by token authentication on their own.

### Recommended Configuration

When configuring Cloudflare Access:

- **Protect:** `/app/*` and `/api/*`
- **Leave Public:** `/` and `/:slug` (public redirect matching)

### Rules & Integration

1. **Zero Trust Independence:** The Worker ignores Cloudflare Access headers and JWTs; it always requires a valid token on `/api/v1/*`.

2. **Workers.dev Safety:** Ensure `workers_dev: false` and `preview_urls: false` in `wrangler.jsonc` so that requests cannot bypass Access path policies.

3. **Automated Scripts & CLI:** When accessing `/api/*` behind Zero Trust, pass Access Service Token headers in addition to the bearer token:

   ```bash
   curl -H "CF-Access-Client-Id: <service-token-id>" \
        -H "CF-Access-Client-Secret: <service-token-secret>" \
        -H "Authorization: Bearer <api-token>" \
        https://<your-domain>/api/v1/links
   ```

4. **Verification:**

   - Unauthenticated `curl -i https://<your-domain>/app/` and `/api/v1/auth/verify` return an Access login redirect (302).
   - Public short link `curl -i https://<your-domain>/<some-slug>` returns the 307 redirect immediately without prompting for Access.

---

## 5. Analytics & D1 Cost Budget

Redirect stores analytics counters and daily rollups directly in Cloudflare D1. To maintain strict cost control on Cloudflare's serverless billing, **no per-click event table** is used, and counter columns are never indexed.

### Billing & Write Budget

Cloudflare D1 bills by **rows written** (Free tier: 100,000 writes/day; Paid Workers: 50M writes/month included, then \$1.00 per 1M writes).

| Metric | Storage Target | Rows Written per Click | Default |
| :--- | :--- | :--- | :--- |
| **Total clicks & last clicked** | 2 unindexed columns on `links` row | 1 | **Enabled** |
| **Clicks per UTC day** | `link_daily_clicks` (upserted by link ID and date) | 1 | **Enabled** |
| **Daily clicks by country** | `link_daily_dims` (`dim = 'country'`) | +1 | Optional |
| **Daily clicks by referrer host** | `link_daily_dims` (`dim = 'referrer'`) | +1 | Optional |

### Usage & Cost Comparison

| Configuration | Rows / Click | Free-Tier Clicks / Day | Paid Cost per 1M Clicks |
| :--- | :--- | :--- | :--- |
| **Default** (Total + Daily rollup) | **2** | **~50,000** | **\$2.00** |
| **+ Country** | **3** | **~33,000** | **\$3.00** |
| **+ Country & Referrer** | **4** | **~25,000** | **\$4.00** |

### Enabling Optional Dimensions

In `apps/api/wrangler.jsonc` (or via Cloudflare Dashboard environment variables):

```jsonc
"vars": {
  "ANALYTICS_ENABLED": "true",
  "ANALYTICS_DIMENSIONS": "country,referrer"
}
```

- `country`: Derived from Cloudflare request metadata (`request.cf.country`). Defaults to `"XX"`.
- `referrer`: Stores **only the sanitized hostname** of the `Referer` header (e.g., `twitter.com`), or `"(direct)"`. Full URLs with query parameters or tokens are stripped.

### Reliability

Analytics writes run inside `ctx.waitUntil()` as a single non-blocking batch. If D1 limits are reached or an analytics query fails, the redirect response is unaffected.

---

## 6. Backups & Disaster Recovery

Because Redirect uses standard Cloudflare D1 SQLite storage, full-database backups and point-in-time recovery work directly through D1, alongside application-level links JSON export/import:

1. **Export Database to SQL:**

   ```bash
   pnpm --filter @redirect/api exec wrangler d1 export redirect-db --remote --output=./backup.sql
   ```

2. **D1 Time Travel (Point-in-Time Recovery):**

   D1 supports rolling back database state up to 30 days:

   ```bash
   # View bookmark timestamps
   pnpm --filter @redirect/api exec wrangler d1 time-travel info redirect-db --remote

   # Restore database to a specific bookmark
   pnpm --filter @redirect/api exec wrangler d1 time-travel restore redirect-db --remote --bookmark=<bookmark-id>
   ```

3. **Portable Links JSON Export & Import (Settings / API):**

   In addition to full-database D1 backups, Redirect supports links-only versioned JSON export and import (`version: 1`) from **Settings → Data Portability** or directly via the authenticated API:

   - `GET /api/v1/links/export` — Streams links as cursor-paginated JSON (`limit` default `200`, max `500`, optional `search`, `tag`, `isActive` filters). Exports exclude analytics (`clickCount`, daily aggregates) and API tokens.
   - `POST /api/v1/links/import` — Imports up to `500` links per request (`onConflict`: `"skip"` default, or `"overwrite"`).
     - **Skip (`onConflict: "skip"`):** Keeps existing links untouched and returns skipped slugs in `skippedSlugs` and per-item `results`.
     - **Overwrite (`onConflict: "overwrite"`):** Updates existing links by slug while preserving their `id`, `created_at`, and click analytics. Omitted optional fields preserve existing values on overwrite rather than resetting to defaults.
     - **Past `expiresAt` values:** Intentionally allowed on import for round-trip backup fidelity; expired links continue to evaluate expiration at redirect time.
     - Larger files sent from the web UI are automatically chunked into `200`-link requests.

---

## 7. Known Limitations & Design Trade-offs

- **Single Domain / Single User:** Designed for individual users and private homelabs. Multi-tenant isolation is not implemented.
- **Eventual Consistency of Tokens:** Workers KV propagates updates globally within approximately 60 seconds. Newly created or revoked tokens may take up to a minute to reflect across all edge locations.
- **Bot Detection Heuristic:** Non-GET methods, prefetch/prerender headers (`Sec-Purpose`, `Purpose`), and common crawler User-Agents are excluded from click counts. However, crawlers that disguise their User-Agent may still register clicks.
- **Slug Renaming & Aliasing:** Links can have their slugs renamed at any time. When a slug is changed, the old slug is immediately freed and returns 404. No automatic alias forwarding is maintained.
- **Permanent Redirects (301 / 308) Caching:** Permanent redirect status codes carry `Cache-Control: private, max-age=3600`. Visitors' browsers will cache the target, which prevents repeated clicks from reaching the Worker and being counted. Use the default temporary redirect (`307`) unless permanent redirection is specifically required.

---

## 8. Development & Testing

```bash
# Build all packages and assets
pnpm build

# Run TypeScript typechecks
pnpm typecheck

# Run test suite (Vitest + real Workers runtime via workerd)
pnpm test

# Run local development server
pnpm dev
```

### Local Network & Tailscale Testing (HTTPS)

By default, Vite binds to `localhost`, and browsers restrict Secure Context APIs (`navigator.clipboard` for copying short links/tokens/QR images, Service Worker registration, and PWA/Web Share Target) over plain HTTP on non-`localhost` addresses.

1. **Allow network access & MagicDNS hostnames:** `apps/web/vite.config.ts` configures `server.host: true` and `server.allowedHosts` (including `.local` and `.ts.net`). Only port `5173` needs to be reachable—Vite proxies `/api` and `/:slug` locally to `wrangler dev` on `http://127.0.0.1:8787`. Add any extra host aliases to `OWN_HOSTNAMES` in `apps/api/.dev.vars` if you want cross-alias loop prevention.
2. **Expose over HTTPS with Tailscale Serve:** On the host machine logged into Tailscale (even when `pnpm dev` runs inside a container such as `code-server` with port `5173` published to the host), run:

   ```bash
   tailscale serve --bg 5173
   ```

   Open `https://<machine>.<tailnet>.ts.net/app/` from any device on your tailnet. Manage or stop the proxy with `tailscale serve status` and `tailscale serve reset`.
   - **Built Worker / Service Worker testing:** `sw.js` only registers in production builds—run `pnpm build && pnpm --filter @redirect/api exec wrangler dev` and point `tailscale serve --bg 8787` at port `8787`.
   - **SSH tunnel alternative:** Run `ssh -L 5173:127.0.0.1:5173 <host>` from another machine and open `http://localhost:5173/app/`.

### API Endpoints Reference

All `/api/v1/*` endpoints require a valid bearer token (`Authorization: Bearer <token>` or `X-API-Key: <token>`):

- **Links & Transfer:** `GET /api/v1/links`, `POST /api/v1/links`, `GET /api/v1/links/export`, `POST /api/v1/links/import`, `GET /api/v1/links/:id`, `PATCH /api/v1/links/:id`, `DELETE /api/v1/links/:id`
- **Analytics:** `GET /api/v1/links/:id/stats`
- **Auth & Tokens:** `GET /api/v1/auth/verify`, `GET /api/v1/tokens`, `POST /api/v1/tokens`, `DELETE /api/v1/tokens/:id`, `POST /api/v1/tokens/initial/rotate`

---

## 9. Changelog

See [CHANGELOG.md](CHANGELOG.md) for release history and notable changes.
