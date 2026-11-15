# Redirect

A simple, lightweight, cost-aware URL redirection and link management service built for Cloudflare Workers (`v0.3.0` — see [CHANGELOG.md](CHANGELOG.md)).

Designed as a single Cloudflare Worker with Static Assets, Redirect handles public link redirection with sub-second response times, provides a token-authenticated management API, and features a frontend management application served under `/app/`.

### Key Features

- **Edge Redirection Engine:** Case-sensitive, mutable single-segment slugs (`^[A-Za-z0-9_-]{1,64}$`), temporary/permanent redirect status codes (`301`, `302`, `307`, `308`), optional expiration timestamps, query parameter forwarding, and loop prevention against `OWN_HOSTNAMES`.
- **Management Web Console (`/app/`):** Dashboard for shortening, searching, filtering by tag/status, generating QR codes, viewing daily/country/referrer click analytics, importing links from JSON/CSV (with interactive field/constant mapping) and exporting versioned JSON, managing API tokens, and sharing URLs via PWA Web Share Target (`/app/share`).
- **Token-Authenticated REST API (`/api/v1/*`):** Full CRUD for links, analytics stats, token lifecycle management, cursor-paginated JSON export, and chunk-friendly batch JSON import.
- **Cost-Aware Analytics & Backups:** Daily D1 rollup aggregates (`link_daily_clicks`, optional `link_daily_dims`) with non-blocking `ctx.waitUntil()` writes, plus D1 SQLite export/Time Travel and portable links-only JSON export and JSON/CSV import.

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
- **Query preservation:** Incoming query parameters are merged while preserving target parameters (target parameters cannot be shadowed) and encoding byte-for-byte. Note: `forwardQuery` defaults to `true`; disable it per link if the destination treats arbitrary query parameters (e.g., `next` or `redirect_uri`) specially.

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

### Configure & Provision Cloudflare Resources

`apps/api/wrangler.jsonc` is kept free of account-specific IDs, personal domains, and environment values so you can deploy directly from a public repository and manage deployment settings in the Cloudflare Dashboard (`database_id` and KV `id` are omitted for Automatic Resource Provisioning, `routes` is omitted, and `"keep_vars": true` preserves Dashboard variables).

1. **Deploy & auto-provision resources (or pre-create them first):**

   - **Via Cloudflare Workers Builds (Git integration):**
     - **Root directory:** `/`
     - **Build command:** `pnpm run build`
     - **Deploy command:** `pnpm --filter @redirect/api run deploy`
     - **Preview Builds:** Disabled (`workers_dev: false` and `preview_urls: false` are set in `apps/api/wrangler.jsonc`)
     - **API token (Advanced settings):** Use a **user-scoped** API token with the **Edit Cloudflare Workers** permissions plus **Account → D1 → Edit** (Cloudflare's default auto-generated Workers Builds token lacks D1 permissions).

   - **Or from your local CLI:** Authenticate Wrangler (`pnpm --filter @redirect/api exec wrangler login`, or add `--device` in headless/container environments), then build and deploy:

     ```bash
     pnpm run build && pnpm --filter @redirect/api run deploy
     ```

     Wrangler will automatically create the `redirect-prod` D1 database and `redirect-auth-tokens` KV namespace on your account, bind them, and deploy the Worker.

     > **Note:** Interactive local `wrangler deploy` writes the provisioned IDs back into `apps/api/wrangler.jsonc`; discard that diff (`git checkout -- apps/api/wrangler.jsonc`) if you don't want IDs committed. In Workers Builds CI, writeback is skipped automatically.

   - **Pre-created / Dashboard-bound (zero-downtime migrations):** If you prefer to migrate D1 before the first deploy or bind an existing KV namespace via the Dashboard:

     ```bash
     # Optional: create D1 ahead of time (Wrangler connects by database_name on deploy)
     pnpm --filter @redirect/api exec wrangler d1 create redirect-prod
     pnpm db:migrate:remote

     # Optional: create a KV namespace (paste its id in wrangler.jsonc, or bind it to AUTH_TOKENS in the Dashboard after first deploy)
     pnpm --filter @redirect/api exec wrangler kv namespace create AUTH_TOKENS
     ```

2. **Configure your domain & variables in the Cloudflare Dashboard:**

   - **Custom Domain:** Go to **Workers & Pages → `redirect` → Settings → Domains & Routes** and add your short domain (e.g., `go.yourdomain.com`).
   - **Recommended SSL/TLS Settings:** Under **SSL/TLS → Edge Certificates** for your zone, enable **Always Use HTTPS** and **HTTP Strict Transport Security (HSTS)** so all dashboard sessions and redirect requests are upgraded cleanly over HTTPS.
   - **Environment Variables (optional):** Go to **Settings → Variables and Secrets** to set `FALLBACK_URL`, `OWN_HOSTNAMES`, `INITIAL_TOKEN`, `ANALYTICS_ENABLED`, or `ANALYTICS_DIMENSIONS` (`keep_vars: true` preserves them across deploys):
     - `OWN_HOSTNAMES`: Comma-separated list of additional hostnames pointing to this Worker (e.g. `www.go.example.com,redirect.yourname.workers.dev`) so loop prevention blocks redirects back to any alias or custom domain.
     - `INITIAL_TOKEN`: Set to `"disabled"` (case-insensitive) to disable automatic `initial_token` bootstrap and reject `initial_token` auth. Already-provisioned custom `token:*` tokens continue managing links and analytics, while `/api/v1/tokens*` token management is frozen until re-enabled (or managed/revoked with `API_KEY`).

3. **Apply database migrations:**

   - For remote production (run `pnpm --filter @redirect/api exec wrangler login` first if not authenticated):

     ```bash
     pnpm db:migrate:remote
     ```

   - For local development:

     ```bash
     pnpm db:migrate:local
     ```

---

## 2. First Run & Obtaining Your Token

Redirect employs a zero-lockout lazy bootstrapping mechanism for API authentication.

### Bootstrapping the Initial Token

1. Make an unauthenticated request to any API endpoint, or open `/app/`:

   ```bash
   curl -i https://<your-domain>/api/v1/auth/verify
   ```

   The API will respond with `401 Unauthorized`. This initial request triggers the Worker to automatically generate a secure token in the format `rdir_initial_<secret>` (32-character Base62 secret) and store it in KV under the key `initial_token`.

2. **Retrieve the token in production:**

   - Log in to the [Cloudflare Dashboard](https://dash.cloudflare.com/).
   - Navigate to **Storage & Databases** → **KV** → the namespace bound to `AUTH_TOKENS` (auto-provisioned as `redirect-auth-tokens`).
   - View the plaintext value of the `initial_token` key and copy it.

3. **Retrieve the token in local development (`pnpm dev`):**

   ```bash
   pnpm --filter @redirect/api exec wrangler kv key get initial_token --binding AUTH_TOKENS --local
   ```

### Token Storage Layout & Privileges

For transparent operator visibility, tokens are stored in Workers KV (`AUTH_TOKENS`) using a self-indexing layout:
- `initial_token`: Plaintext value `rdir_initial_<secret>` (32-char Base62 secret).
- `token:<id>`: Plaintext value `rdir_<id>_<secret>` (where `<id>` is 10 chars Base62 and `<secret>` is 32 chars Base62). Token metadata (`{ name, createdAt, expiresAt, preview }`) is stored in the KV metadata header, enabling fast direct lookups, instant 1-op revocations without listing, and efficient prefix enumeration.
- **Privilege Separation:** Only sessions authenticated with `initial_token` or master `API_KEY` can list, create, rotate, or revoke API tokens (`/api/v1/tokens`, `/api/v1/tokens/*`). Custom `token:<id>` tokens can manage links and view analytics, and receive `403 Forbidden` on token management routes. While `API_KEY` is configured (strict lockdown), creating custom tokens and rotating `initial_token` are disabled (`409 mechanism_disabled`), while listing and revoking leftover KV tokens remain active.
- **Lifecycle Hygiene:** Because `initial_token` never expires automatically, create expiring custom tokens *first* for day-to-day CLI/automation usage before setting `INITIAL_TOKEN=disabled` or enforcing `API_KEY` lockdown.

### Authenticating API Calls

Include the token in all API requests using either standard header:

```bash
# Using Authorization Bearer
curl -H "Authorization: Bearer <your-token>" https://<your-domain>/api/v1/auth/verify

# Or using X-API-Key
curl -H "X-API-Key: <your-token>" https://<your-domain>/api/v1/auth/verify
```

---

## 3. Recovery, Security Controls & Incident Response

The system is designed so that the owner can **never be locked out**:

1. **Regenerating Initial Token:**

   If you ever lose your tokens or revoke all keys, delete the `initial_token` key directly in the Cloudflare Dashboard (or via Wrangler KV). The very next unauthenticated `/api/v1/auth/verify` request will detect the absence and generate a brand-new `initial_token` (unless `API_KEY` is set or `INITIAL_TOKEN=disabled`).

2. **Rotating Initial Token:**

   Call the rotation endpoint with `initial_token` (returns `409 mechanism_disabled` if `API_KEY` is set or `INITIAL_TOKEN=disabled`):

   ```bash
   curl -X POST https://<your-domain>/api/v1/tokens/initial/rotate \
     -H "Authorization: Bearer <your-token>"
   ```

3. **Revoking Custom Tokens in Bulk:**

   To immediately invalidate custom `token:<id>` keys while keeping `initial_token` (or `API_KEY`) intact, click **Revoke All Custom** in **Settings → Active API Tokens** or call:

   ```bash
   curl -X DELETE https://<your-domain>/api/v1/tokens \
     -H "Authorization: Bearer <initial-or-api-key>"
   ```

   Each call deletes up to 500 custom keys (5 KV list pages × 100) and returns `{ deleted: true, count, truncated }`; if `truncated` is `true`, run it again until all custom tokens are cleared.

4. **Master `API_KEY` Secret (Strict Lockdown Mode):**

   You can configure a fixed master secret token:

   ```bash
   pnpm --filter @redirect/api exec wrangler secret put API_KEY
   ```

   > **Note:** When `API_KEY` is configured, Redirect enters **strict lockdown mode** — **only** `API_KEY` is accepted, and **both** `initial_token` and all custom KV tokens are rejected (`401 Unauthorized`). Creating custom tokens (`POST /api/v1/tokens`) and rotating `initial_token` (`POST /api/v1/tokens/initial/rotate`) return `409 mechanism_disabled`, while `GET /tokens` and `DELETE /tokens*` remain available to inspect and revoke leftover KV tokens. Removing the secret re-enables KV token authentication.

5. **Disabling `initial_token` (`INITIAL_TOKEN=disabled`):**

   If you rely exclusively on expiring custom tokens (or want to disable recovery bootstrap without enabling `API_KEY`), create your custom tokens first and verify you still have a valid custom token or Cloudflare Dashboard access, then set `INITIAL_TOKEN=disabled` in Cloudflare Dashboard Secrets/Variables. While disabled, existing custom `token:*` keys keep working for links and analytics, and `/api/v1/tokens*` management is frozen until re-enabled (or inspected/revoked via `API_KEY`).

### Rate Limiting & Edge Protections

- **Worker Rate Limit Bindings (`apps/api/wrangler.jsonc`):**
  - `API_LIMITER` (`120` requests / `60s` per normalized client IP or IPv6 `/64` prefix via `cf-connecting-ip`, location-local): protects `/api/v1/*` management endpoints, returning HTTP `429` (`rate_limited`, `Retry-After: 60`) when exceeded.
  - `CLICK_LIMITER` (`10` requests / `60s` per normalized client IP or IPv6 `/64` prefix, location-local): runs inside `ctx.waitUntil` for countable clicks when analytics is enabled, gating click analytics writes (`recordClick`) so excessive bursts never affect `30x` redirect resolution while bounding D1 write consumption per POP.
- **Recommended Free Zone WAF Rule:** In your Cloudflare Dashboard (**Security → Security rules / Rate limiting rules**), add the Free plan's 1 Zone WAF rate-limiting rule targeting `/api/v1/*` at a low threshold (e.g., 10–30 requests per 10 seconds per IP) for cross-POP protection before Worker execution.
- **Structured Audit Logs:** Mutations (`token.create`, `token.revoke`, `token.revoke_all`, `token.initial_rotate`, `link.create`, `link.update`, `link.delete`, `link.import`, and `auth.forbidden`) emit structured JSON audit events via `console.info` without secret values or spoofable envelope fields.

### Incident-Response Runbook

- **Compromised Custom Token:** Revoke the single token in **Settings → Active API Tokens** (`DELETE /api/v1/tokens/:id`) or revoke custom tokens via **Revoke All Custom** (`DELETE /api/v1/tokens`). Allow up to ~60 seconds for global KV propagation.
- **Compromised `initial_token`:** Rotate it via `POST /api/v1/tokens/initial/rotate` or delete `initial_token` in Dashboard KV; alternatively set `INITIAL_TOKEN=disabled` or configure an emergency `API_KEY` secret in Cloudflare Dashboard.
- **Compromised `API_KEY`:** Replace immediately with `wrangler secret put API_KEY` (or Cloudflare Dashboard Secrets), or delete `API_KEY` to fall back to `initial_token` + custom tokens.
- **Analytics Flood / D1 Quota Exhaustion:** Set `ANALYTICS_ENABLED=false` (case-insensitively accepts `false`, `0`, `off`, or `no`) in Dashboard Variables (applies immediately without redeploy via `keep_vars: true`), and enable or tighten your Cloudflare Zone WAF rate-limiting rule / Under Attack Mode. D1 free-tier quotas reset at `00:00 UTC`.
- **Malicious Short Link:** Delete or deactivate the link in `/app/` or via `DELETE /api/v1/links/:id`, and review Workers Logs for `link.*` / `token.*` / `auth.forbidden` JSON audit events.

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

Configure via Cloudflare Dashboard (**Settings → Variables and Secrets**), `apps/api/.dev.vars` locally, or `vars` in `apps/api/wrangler.jsonc`:

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

Because Redirect uses standard Cloudflare D1 SQLite storage, full-database backups and point-in-time recovery work directly through D1, alongside application-level links JSON/CSV import and JSON export:

1. **Export Database to SQL:**

   ```bash
   pnpm --filter @redirect/api exec wrangler d1 export redirect-prod --remote --output=./backup.sql
   ```

2. **D1 Time Travel (Point-in-Time Recovery):**

   D1 supports rolling back database state up to 30 days:

   ```bash
   # View bookmark timestamps
   pnpm --filter @redirect/api exec wrangler d1 time-travel info redirect-prod --remote

   # Restore database to a specific bookmark
   pnpm --filter @redirect/api exec wrangler d1 time-travel restore redirect-prod --remote --bookmark=<bookmark-id>
   ```

3. **Portable Links Export & Dynamic Import (Settings / API):**

   In addition to full-database D1 backups, Redirect supports links-only versioned JSON export and import (`version: 1`) from **Settings → Data Portability** or directly via the authenticated API, plus dynamic client-side JSON/CSV mapping in the web UI:

   - `GET /api/v1/links/export` — Streams links as cursor-paginated JSON (`limit` default `500`, max `1000`, optional `search`, `tag`, `isActive` filters). Exports exclude analytics (`clickCount`, daily aggregates) and API tokens.
   - `POST /api/v1/links/import` — Imports up to `500` links per request (`onConflict`: `"skip"` default, or `"overwrite"`).
     - **Skip (`onConflict: "skip"`):** Keeps existing links untouched and returns skipped slugs in `skippedSlugs` and per-item `results`.
     - **Overwrite (`onConflict: "overwrite"`):** Updates existing links by slug while preserving their `id`, `created_at`, and click analytics. Omitted optional fields preserve existing values on overwrite rather than resetting to defaults.
     - **Past `expiresAt` values:** Intentionally allowed on import for round-trip backup fidelity; expired links continue to evaluate expiration at redirect time.
     - **Web UI Importer (`Settings → Data Portability → Import Links (JSON / CSV)`):** Supports native `version: 1` Redirect exports (1-click fast path or customizable mapping), arbitrary JSON arrays or objects (with nested array property selector), and CSV files (RFC 4180 parser with auto/custom delimiter and header toggle). Users can map source fields or enter constant values per Redirect field, parse string dates or numeric/string epoch timestamps into UTC ISO strings, preview converted rows and pre-flight validation errors, and upload large datasets automatically in `200`-link chunks.

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

1. **Allow network access & MagicDNS hostnames:** `apps/web/vite.config.ts` configures `server.host: true` and `server.allowedHosts` (including `.local` and `.ts.net`, plus any comma-separated hosts configured in `ALLOWED_HOSTS` or `VITE_ALLOWED_HOSTS` via `.env*` or process environment). Only port `5173` needs to be reachable—Vite proxies `/api` and `/:slug` locally to `wrangler dev` on `http://127.0.0.1:8787`. Add any extra host aliases to `OWN_HOSTNAMES` in `apps/api/.dev.vars` if you want cross-alias loop prevention.
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
- **Auth & Tokens:** `GET /api/v1/auth/verify`, `GET /api/v1/tokens`, `POST /api/v1/tokens`, `DELETE /api/v1/tokens`, `DELETE /api/v1/tokens/:id`, `POST /api/v1/tokens/initial/rotate`

---

## 9. Changelog

See [CHANGELOG.md](CHANGELOG.md) for release history and notable changes.
