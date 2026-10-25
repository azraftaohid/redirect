# Redirect — Backend Implementation Plan

Step-by-step specification for an LLM coding agent to implement the **Redirect** backend in `/home/azraftaohid/codes/redirect/`. The product concept is in `/home/azraftaohid/Documents/Notes/Main/Projects/Redirect Dev Notes/Concept.md`. If this plan and the concept disagree, the concept's intent wins; report the discrepancy.

Follow the phases in order. After each phase, run the verification listed for it before continuing.

---

## 0. Authoritative decisions (do not deviate or "improve")

| # | Decision |
| :-- | :-- |
| D1 | One Cloudflare Worker + Static Assets. `run_worker_first: true`; the Worker dispatches every request explicitly. |
| D2 | Assets config: `not_found_handling: "none"`, `html_handling: "none"` (exact file matching, no automatic index/trailing-slash behavior). Never use `single-page-application` mode. |
| D3 | Token auth is the only application-level auth. The Worker never reads or trusts Cloudflare Access headers/JWTs. Zero Trust is optional and external. |
| D4 | Tokens live in **KV** (`AUTH_TOKENS`), stored in plain text so the owner can read them in the Cloudflare dashboard. The owner must never be lockable out. |
| D5 | No caching layer in front of D1. No "edge-fast" optimizations. A redirect taking hundreds of milliseconds is acceptable. |
| D6 | Analytics = counters and daily rollups only (see Phase 3). **No raw per-click event table. No IP, User-Agent, city or device storage.** |
| D7 | Slugs are **case-sensitive** and **mutable**. Links are identified by stable `id`; API routes use `/links/:id`. |
| D8 | Only `api` and `app` are reserved slugs (case-insensitive check). |
| D9 | No private-IP/SSRF blocking (the Worker never fetches targets). Validate protocol, length and self-reference only. |
| D10 | No CORS (same-origin). Do not add CORS middleware or a `CORS_ORIGIN` variable. |
| D11 | Analytics failures must never affect a redirect. A D1 lookup failure returns `503`, never `404`. |
| D12 | Use `PATCH` for partial updates. Do not implement `PUT`. |

Non-goals: multi-user, multi-domain, aliases/redirect history, export/import endpoints (use `wrangler d1 export`), frontend implementation (separate plan), unique-visitor analytics.

---

## 1. Architecture

### Request dispatch (implement exactly in `src/index.ts`)

Evaluate in this order using `new URL(request.url).pathname`:

1. `/api/v1` or `/api/v1/*` → API router (Hono sub-app). Any other path starting with `/api` → JSON `404`.
2. `/app` → `308` redirect to `/app/`.
3. `/app/*` → `serveApp()` (Phase 7).
4. `/` → `rootHandler()`: valid `FALLBACK_URL` → `307`, else the 404 page.
5. Single segment (one optional trailing `/`) that matches `SLUG_REGEX` against the **raw** path (no `decodeURIComponent`) → redirect handler. Non-`GET`/`HEAD` → `405` with `Allow: GET, HEAD`.
6. Anything else → try `env.ASSETS.fetch(request)` for an exact static file (e.g. `/favicon.ico`); if it returns `404`, return the 404 page.

The 404 page = body of the `/404.html` asset with status `404` (`env.ASSETS.fetch(new Request(new URL('/404.html', request.url)))`); if that asset is missing, return plain text `Not found` with status `404`.

### Bindings and configuration

| Name | Type | Purpose |
| :-- | :-- | :-- |
| `DB` | D1 | Links and statistics. |
| `AUTH_TOKENS` | KV | Tokens (see Phase 4). |
| `ASSETS` | Fetcher | Static assets. |
| `API_KEY` | Secret, optional | Master token. When set, the initial-token mechanism is disabled. |
| `FALLBACK_URL` | Var, optional | Redirect target for unknown/disabled/expired slugs and for `/`. |
| `OWN_HOSTNAMES` | Var, optional | Comma-separated extra hostnames that count as "this redirector" for loop checks. |
| `ANALYTICS_ENABLED` | Var, default `"true"` | `"false"` disables all analytics writes. |
| `ANALYTICS_DIMENSIONS` | Var, default `""` | Comma-separated subset of `country`, `referrer`. Each adds one row written per counted click. |

Generate the `Env` type with `wrangler types` (committed as `worker-configuration.d.ts`); do not hand-write it.

---

## 2. Target repository layout

```text
/home/azraftaohid/codes/redirect/
├── .gitignore
├── README.md                    # runbook (Phase 9)
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── plan.md
├── packages/shared/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts
│       ├── constants.ts
│       ├── schemas.ts           # zod schemas + inferred types (single source of truth)
│       └── validation.ts        # slug / target URL validators
└── apps/
    ├── web/                     # frontend lives here later; only a stub package now
    │   └── package.json
    └── api/
        ├── package.json
        ├── tsconfig.json
        ├── vitest.config.ts
        ├── wrangler.jsonc
        ├── worker-configuration.d.ts   # generated, committed
        ├── .dev.vars.example
        ├── migrations/0001_initial.sql
        ├── scripts/ensure-assets.mjs
        ├── src/
        │   ├── index.ts         # dispatcher
        │   ├── errors.ts        # ApiError + error envelope
        │   ├── auth/
        │   │   ├── tokens.ts    # KV token logic
        │   │   └── middleware.ts
        │   ├── db/
        │   │   ├── links.ts
        │   │   └── stats.ts
        │   ├── routes/
        │   │   ├── links.ts
        │   │   ├── tokens.ts
        │   │   ├── stats.ts
        │   │   ├── redirect.ts
        │   │   └── app.ts       # serveApp + 404 page helper
        │   └── utils/
        │       ├── slug.ts      # Base62 generation
        │       ├── query.ts     # raw query merge
        │       └── analytics.ts # countable-click filter + recordClick
        └── test/
            ├── apply-migrations.ts
            ├── validation.test.ts
            ├── auth.test.ts
            ├── links.test.ts
            ├── redirect.test.ts
            ├── analytics.test.ts
            └── dispatch.test.ts
```

---

## 3. Phased implementation

### Phase 1 — Workspace

1. `git init` if not already a repository.
2. `pnpm-workspace.yaml` → `packages: ["packages/*", "apps/*"]`.
3. Root `package.json`: `private: true`, scripts `dev`, `build`, `test`, `typecheck`, `db:migrate:local`, `db:migrate:remote`, `deploy` that delegate with `pnpm --filter @redirect/api ...`. Set `packageManager` to the **installed** pnpm version (`pnpm --version`); do not invent a version.
4. `tsconfig.base.json`: `strict`, `target ES2022`, `module ESNext`, `moduleResolution Bundler`, `skipLibCheck`, `noUncheckedIndexedAccess`.
5. `.gitignore`: `node_modules/`, `.wrangler/`, `dist/`, `.dev.vars`, `*.tsbuildinfo`. Note `worker-configuration.d.ts` is **not** ignored.
6. Dependencies for `@redirect/api`: `hono`, `zod`, `@hono/zod-validator`, `@redirect/shared` (workspace); dev: `wrangler`, `typescript`, `vitest` and the Cloudflare Workers Vitest integration (see Phase 8 for the exact package/API; check the current docs at install time because the package and config API have changed between versions). Use current stable versions; do not pin invented numbers.
7. `apps/web/package.json`: a minimal stub (`name: "@redirect/web"`, `private: true`, a `build` script that echoes "frontend not implemented"), so `pnpm -r build` succeeds.

**Verify:** `pnpm install` succeeds.

### Phase 2 — Shared package (`@redirect/shared`)

Pure TypeScript, no Cloudflare types, usable by the future SPA.

**`constants.ts`**
- `RESERVED_SLUGS = ["api", "app"]` (compared lowercased).
- `SLUG_REGEX = /^[A-Za-z0-9_-]{1,64}$/`.
- `REDIRECT_STATUS_CODES = [301, 302, 307, 308] as const`, `DEFAULT_STATUS_CODE = 307`.
- `MAX_URL_LENGTH = 2048`, `MAX_TAGS = 10`, `MAX_TAG_LENGTH = 32`, `MAX_TITLE_LENGTH = 200`.
- `DEFAULT_SLUG_LENGTH = 6`.
- `ANALYTICS_DIMENSIONS = ["country", "referrer"] as const`.

**`validation.ts`**
- `validateSlug(slug)`: `{ ok: true } | { ok: false, error }`. Must match `SLUG_REGEX`; `slug.toLowerCase()` must not be in `RESERVED_SLUGS`. Case is otherwise preserved and significant.
- `validateTargetUrl(url, ownHostnames: string[])`:
  - length ≤ `MAX_URL_LENGTH`; parses with `new URL`;
  - protocol is exactly `http:` or `https:`;
  - lowercased `hostname` must not be in `ownHostnames` (loop prevention).
  - **No IP-range, `localhost` or `.local` blocking (D9).**
- `parseOwnHostnames(requestHostname, ownHostnamesVar)`: returns lowercased, trimmed, de-duplicated list including the request hostname.

**`schemas.ts`** (zod; export schemas and `z.infer` types)
- `slugSchema`, `targetUrlSchema` (string, trimmed, max length; hostname loop check is applied in the route because it needs the request context).
- `tagsSchema`: array of trimmed, lowercased strings, each 1–`MAX_TAG_LENGTH`, at most `MAX_TAGS`, de-duplicated.
- `createLinkSchema`: `targetUrl`; optional `slug`, `title` (≤ `MAX_TITLE_LENGTH`, nullable), `statusCode` (one of the allowed codes), `tags`, `isActive`, `forwardQuery`, `expiresAt` (nullable ISO-8601 string).
- `updateLinkSchema`: every field of `createLinkSchema` optional (including `slug`); at least one field required.
- `listLinksQuerySchema`: `search?`, `tag?`, `slug?` (exact, case-sensitive), `isActive?` (`"true"|"false"`), `sortBy?` (`createdAt|updatedAt|clickCount|slug`, default `createdAt`), `sortOrder?` (`asc|desc`, default `desc`), `limit?` (1–100, default 20), `offset?` (≥ 0, default 0).
- `statsQuerySchema`: `days?` (1–365, default 30).
- `createTokenSchema`: `name` (1–64 chars), `expiresAt?` (nullable ISO-8601).
- Types: `LinkRecord`, `TokenInfo`, `LinkStats`, `Paginated<T>`, `ApiErrorBody`.

**Verify:** `pnpm --filter @redirect/shared typecheck`.

### Phase 3 — D1 schema (`apps/api/migrations/0001_initial.sql`)

```sql
-- Links. slug uses SQLite's default BINARY collation => case-sensitive uniqueness (D7).
CREATE TABLE links (
  id              TEXT PRIMARY KEY,                 -- crypto.randomUUID()
  slug            TEXT NOT NULL UNIQUE,
  target_url      TEXT NOT NULL,
  title           TEXT,
  status_code     INTEGER NOT NULL DEFAULT 307 CHECK (status_code IN (301, 302, 307, 308)),
  tags            TEXT NOT NULL DEFAULT '[]',       -- JSON array, queried with json_each()
  is_active       INTEGER NOT NULL DEFAULT 1,
  forward_query   INTEGER NOT NULL DEFAULT 1,
  expires_at      TEXT,                             -- ISO-8601 UTC or NULL
  click_count     INTEGER NOT NULL DEFAULT 0,       -- NOT indexed (see cost rules)
  last_clicked_at TEXT,                             -- NOT indexed
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX idx_links_created_at ON links (created_at);

-- Clicks per link per UTC day. 1 row written per counted click.
CREATE TABLE link_daily_clicks (
  link_id TEXT NOT NULL REFERENCES links(id) ON DELETE CASCADE,
  day     TEXT NOT NULL,                            -- 'YYYY-MM-DD' (UTC)
  clicks  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (link_id, day)
) WITHOUT ROWID;

-- Optional breakdowns (only written when enabled via ANALYTICS_DIMENSIONS).
CREATE TABLE link_daily_dims (
  link_id TEXT NOT NULL REFERENCES links(id) ON DELETE CASCADE,
  day     TEXT NOT NULL,
  dim     TEXT NOT NULL CHECK (dim IN ('country', 'referrer')),
  value   TEXT NOT NULL,
  clicks  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (link_id, day, dim, value)
) WITHOUT ROWID;
```

**Cost rules (binding on the implementation):**
- Never add an index on `click_count`, `last_clicked_at`, or any column updated on the click path. Writing an indexed column costs at least one extra row written per click.
- Rollup tables stay `WITHOUT ROWID` with no secondary indexes.
- Do not create any table that stores one row per click.
- A counted click writes exactly: 1 (`links` update) + 1 (`link_daily_clicks` upsert) + 1 per enabled dimension. Phase 8 asserts this using D1's `meta.rows_written`.

**Verify:** `pnpm db:migrate:local` applies cleanly.

### Phase 4 — Authentication (KV)

**KV layout in `AUTH_TOKENS`**

| Key | Value | KV metadata |
| :-- | :-- | :-- |
| `initial_token` | the raw token string only (so the dashboard shows it directly) | `{ createdAt }` |
| `token:<token>` | JSON `{ id, name, createdAt, expiresAt }` | same object (for listing without per-key reads) |

- Token format: `rdir_` + 48 lowercase hex chars (24 random bytes from `crypto.getRandomValues`).
- `id` for regular tokens: 8 random hex chars.
- When a token has `expiresAt`, also pass the KV `expiration` option (absolute UNIX seconds) so KV cleans it up; still check `expiresAt` in code because KV expiry granularity is coarse.
- A manually created record (via the dashboard) must work: key `token:<any string matching TOKEN_REGEX>` with the JSON value above.

**`auth/tokens.ts`**
- `TOKEN_REGEX = /^[A-Za-z0-9_-]{16,128}$/`. Reject anything else **before** touching KV.
- `safeEqual(a: string, b: string)`: SHA-256 both strings, then `crypto.subtle.timingSafeEqual` on the digests. Use it for `API_KEY` and `initial_token` comparisons.
- `extractToken(request)`: `Authorization: Bearer <t>` takes precedence over `X-API-Key`.
- `authenticate(env, token)` evaluates in this order and returns `{ kind, id, name } | null`:
  1. `env.API_KEY` set and `safeEqual(token, env.API_KEY)` → `{ kind: "env", id: "env", name: "Environment API key" }`.
  2. `AUTH_TOKENS.get("token:" + token, "json")` exists and is not expired → `{ kind: "token", id, name }`.
  3. Only if `env.API_KEY` is **not** set: `AUTH_TOKENS.get("initial_token")` equals `token` (`safeEqual`) → `{ kind: "initial", id: "initial", name: "Initial token" }`.
- `ensureInitialToken(env)`: no-op if `env.API_KEY` is set; otherwise `get("initial_token")` and, if null, generate and `put` it with `{ metadata: { createdAt } }`. Wrap callers in try/catch. A race that generates two tokens is harmless (last write wins, nobody has seen the loser).
- `rotateInitialToken(env)`: generate and `put` a new `initial_token`, return it.

**`auth/middleware.ts`** (Hono middleware for every `/api/v1/*` route)
1. Extract token; if present and format-valid, `authenticate`.
2. On success: `c.set("principal", …)` and continue.
3. On failure (including a missing/invalid token): `await ensureInitialToken(env)` inside try/catch (never lets a KV error change the response), then return `401` `{ error: { code: "unauthorized", message: "…" } }` with header `WWW-Authenticate: Bearer`.

This lazy bootstrap is why any unauthenticated API request, or opening the app, creates the initial token. There is no startup hook in Workers; do not try to initialize at module scope.

**Token endpoints (`routes/tokens.ts`)**
- `GET /api/v1/auth/verify` → `200 { principal: { kind, id, name } }`. (Unauthenticated callers get the `401` above, which also bootstraps the initial token.)
- `GET /api/v1/tokens` → list regular tokens from `list({ prefix: "token:", cursor })` using key metadata (follow `cursor` until `list_complete`, cap 10 pages). Each item: `{ id, name, createdAt, expiresAt, preview }` where `preview` is `rdir_ab12…cd34`-style masking of the key. Never return full tokens here. If `API_KEY` is unset and `initial_token` exists, prepend `{ id: "initial", name: "Initial token", isInitial: true, createdAt, expiresAt: null, preview }`.
- `POST /api/v1/tokens` body `createTokenSchema` → `201` with the item **plus** the full `token` once (the dashboard remains the way to view it later).
- `DELETE /api/v1/tokens/:id` → find the key by `id` via the listing metadata, delete it, `200 { deleted: true }`; `404` if not found. `id === "initial"` → `409 { code: "initial_token_protected", message: "Rotate it with POST /api/v1/tokens/initial/rotate or delete the initial_token key in the Cloudflare dashboard." }`.
- `POST /api/v1/tokens/initial/rotate` → new initial token returned once; `409` if `API_KEY` is set (mechanism disabled).

**Documented behavior to reflect in tests and README:** KV is eventually consistent; revocation and new tokens can take about a minute. Do **not** write "last used" timestamps (each costs a KV write).

### Phase 5 — Links API (`/api/v1/links`, all authenticated)

Common: JSON only; every API response sets `Cache-Control: no-store`; errors use the envelope `{ "error": { "code": string, "message": string, "details"?: unknown } }`. Validation failures → `400 validation_error` with zod issues in `details`. Map `ApiError` and unexpected errors in `errors.ts` (unexpected → `500 internal_error`, log, no stack in body).

`LinkRecord` (camelCase): `id, slug, targetUrl, title, statusCode, tags (string[]), isActive (boolean), forwardQuery (boolean), expiresAt, clickCount, lastClickedAt, createdAt, updatedAt`.

Own-hostname set for loop checks = `parseOwnHostnames(new URL(c.req.url).hostname, env.OWN_HOSTNAMES)`.

- **`GET /links`**: `listLinksQuerySchema`.
  - `search`: `slug LIKE ? OR target_url LIKE ? OR title LIKE ?` with `%term%` and `ESCAPE '\'` (escape `%`, `_`, `\` in the term). Always bind parameters.
  - `tag`: `EXISTS (SELECT 1 FROM json_each(links.tags) WHERE value = ?)`.
  - `slug`: exact `slug = ?` (case-sensitive).
  - `sortBy` is mapped through a whitelist to a column name (`created_at|updated_at|click_count|slug`); never interpolate user input.
  - Add `id` as a final tiebreaker in `ORDER BY` for stable pagination.
  - Response `{ data: LinkRecord[], pagination: { total, limit, offset, hasMore } }`.
- **`POST /links`**: `createLinkSchema`.
  - Validate the target with `validateTargetUrl`; `slug` with `validateSlug` if provided.
  - If `slug` is omitted, generate (Base62, `DEFAULT_SLUG_LENGTH`, rejection sampling on random bytes so there is no modulo bias: accept bytes `< 248`, map `% 62`). On a unique-constraint collision retry up to 5 times, then increase the length by 1 and retry once more; if still failing, `500 slug_generation_failed`. Generated slugs must pass `validateSlug`.
  - A provided slug that already exists → `409 slug_taken`. Also translate a D1 `UNIQUE constraint failed: links.slug` error into `409 slug_taken` (race safety).
  - `expiresAt`, if given, must be a valid future timestamp (normalize to `toISOString()`).
  - Insert with `id = crypto.randomUUID()`, `created_at = updated_at = new Date().toISOString()`, `tags = JSON.stringify(tags)`. Return `201` with the record.
- **`GET /links/:id`** → record or `404 not_found`.
- **`PATCH /links/:id`**: `updateLinkSchema`.
  - Load the link (404 if missing). Re-validate only fields that were supplied.
  - **Slug change is supported.** Same validation and `409 slug_taken` handling; renaming to the identical current slug is a no-op. The old slug becomes free immediately and stops resolving (no alias). Statistics are preserved (they reference `id`).
  - `expiresAt: null` clears expiry. Update `updated_at`. Return the updated record.
- **`DELETE /links/:id`** → `200 { deleted: true, id }`; cascades to rollup tables (this deletion's row cost is accepted). `404` if missing.

### Phase 6 — Statistics (`GET /api/v1/links/:id/stats`)

`statsQuerySchema` (`days` default 30). Response:
```json
{
  "linkId": "…",
  "totalClicks": 123,
  "lastClickedAt": "…",
  "range": { "days": 30, "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" },
  "daily": [ { "day": "YYYY-MM-DD", "clicks": 5 } ],
  "dimensions": { "country": [ { "value": "BD", "clicks": 40 } ], "referrer": [] }
}
```
- `daily`: rows from `link_daily_clicks` within the range, ascending. Days with no clicks are omitted (the client zero-fills).
- `dimensions`: only keys listed in `ANALYTICS_DIMENSIONS` are included, each as the top 10 values by summed clicks over the range (`GROUP BY value ORDER BY SUM(clicks) DESC LIMIT 10`). If a dimension is disabled, omit it; do not return stale data from a prior configuration.
- `404 not_found` for an unknown `id`.

### Phase 7 — Redirect engine, app serving, and analytics

**`routes/redirect.ts`**
1. Query: `SELECT id, target_url, status_code, is_active, forward_query, expires_at FROM links WHERE slug = ?` (bind the raw slug; exact, case-sensitive). If the query throws → `503` plain text (D11), never `404`.
2. Not found, `is_active = 0`, or `expires_at <= now` → "miss" handling: if `FALLBACK_URL` parses and passes `validateTargetUrl(…, ownHostnames)` → `307` to it with `Cache-Control: no-store`; otherwise the 404 page.
3. Build the destination with `utils/query.ts#mergeQuery(targetUrl, incomingSearch, forward)`:
   - If `forward` is false or the incoming query is empty → return `target_url` unchanged.
   - Split the target on its first `#` to keep the fragment; take the query part (after `?`) verbatim.
   - Compute the target's key set by decoding keys with `URLSearchParams` (keys only; this is read-only and never re-serializes).
   - Split the incoming raw query on `&`; keep each raw pair whose decoded key is **not** in the target's key set; preserve order and duplicates; skip empty pairs.
   - Re-join: `base + (existingQuery ? "?" + existingQuery : "") + appended` using `?` or `&` appropriately, then the fragment. Never use `searchParams.set/append` on the final URL.
4. Response: `new Response(null, { status, headers })` with `Location`, and `Cache-Control` = `no-store` for `307`/`302`, `private, max-age=3600` for `301`/`308`.
5. Analytics (non-blocking): if the click is countable, `c.executionCtx.waitUntil(recordClick(...).catch(() => {}))`. Do not await it.

**`utils/analytics.ts`**
- `isCountableClick(request)`: `request.method === "GET"`; no `Sec-Purpose` or `Purpose` header containing `prefetch` or `prerender`; `User-Agent` does not match `/bot|crawl|spider|slurp|preview|facebookexternalhit|facebot|slackbot|whatsapp|telegrambot|discordbot|linkedinbot|embedly|skypeuripreview/i`. Keep the pattern in a named constant. Uncounted clicks still receive the redirect.
- `recordClick(env, linkId, request, now = new Date())` builds one `env.DB.batch([...])`:
  1. `UPDATE links SET click_count = click_count + 1, last_clicked_at = ? WHERE id = ?`
  2. `INSERT INTO link_daily_clicks (link_id, day, clicks) VALUES (?, ?, 1) ON CONFLICT (link_id, day) DO UPDATE SET clicks = clicks + 1` where `day` is the UTC date.
  3. For each enabled dimension, `INSERT INTO link_daily_dims (link_id, day, dim, value, clicks) VALUES (?, ?, ?, ?, 1) ON CONFLICT (link_id, day, dim, value) DO UPDATE SET clicks = clicks + 1`.
     - `country`: `request.cf?.country` as a 2-letter code, else `"XX"`.
     - `referrer`: the **hostname only** of the `Referer` header (lowercased, truncated to 64 chars), else `"(direct)"`. Never store full referrer URLs (they can carry tokens).
  - Return the batch results so tests can inspect `meta.rows_written`.
  - If `ANALYTICS_ENABLED === "false"`, return without writing. Unknown dimension names in `ANALYTICS_DIMENSIONS` are ignored.

**`routes/app.ts` — `serveApp(request, env)`** (path is `/app/…`)
1. `res = await env.ASSETS.fetch(request)`.
2. If `res.status === 404` and the method is `GET`/`HEAD` and the last path segment contains no `.` (this includes the bare `/app/`), fetch `new Request(new URL('/app/index.html', request.url))` and return it with status `200` (SPA fallback).
3. Otherwise return `res` (a missing file such as `/app/missing.js` stays `404`).
4. Add security headers by constructing `new Response(body, res)` (response headers from assets are immutable): `Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`. Keep these in one constant so the frontend plan can adjust them.

**Wrangler config (`apps/api/wrangler.jsonc`)**
```jsonc
{
  "$schema": "../../node_modules/wrangler/config-schema.json",
  "name": "redirect",
  "main": "src/index.ts",
  "compatibility_date": "2026-10-01",
  "workers_dev": false,
  "preview_urls": false,
  "routes": [
    // TODO(deployer): replace with your short domain.
    { "pattern": "redirect.example.com", "custom_domain": true }
  ],
  "observability": { "enabled": true },
  "assets": {
    "directory": "../web/dist",
    "binding": "ASSETS",
    "run_worker_first": true,
    "not_found_handling": "none",
    "html_handling": "none"
  },
  "d1_databases": [
    { "binding": "DB", "database_name": "redirect-db", "database_id": "REPLACE_ME", "migrations_dir": "migrations" }
  ],
  "kv_namespaces": [
    { "binding": "AUTH_TOKENS", "id": "REPLACE_ME" }
  ],
  "vars": {
    "ANALYTICS_ENABLED": "true",
    "ANALYTICS_DIMENSIONS": "",
    "OWN_HOSTNAMES": "",
    "FALLBACK_URL": ""
  }
}
```
Treat empty-string `FALLBACK_URL` / `OWN_HOSTNAMES` as unset. Local development does not need real D1/KV IDs.

**Asset directory bootstrap (`scripts/ensure-assets.mjs`)**
`../web/dist` is a gitignored build output and may not exist on a fresh clone. The script creates, **only if missing** (never overwriting real build output):
- `../web/dist/app/index.html` — a small placeholder page.
- `../web/dist/404.html` — a minimal "Not found" page.

Run it from `predev`, `pretest`, `predeploy` and `pretypecheck` scripts in `apps/api/package.json`.

### Phase 8 — Tests (real workerd runtime)

Use the Cloudflare **Workers Vitest integration** (workerd + Miniflare, with real D1/KV/assets bindings), **not** a hand-rolled SQLite/KV mock.

- Consult the current Cloudflare docs for the exact package and API before writing config. At the time of writing they describe a `cloudflareTest()` Vite plugin (with `wrangler: { configPath: "./wrangler.jsonc" }`), `readD1Migrations(path)` in config, and `applyD1Migrations(env.DB, env.TEST_MIGRATIONS)` in a `setupFiles` entry (`test/apply-migrations.ts`). Older versions used `defineWorkersConfig` with `poolOptions.workers`. Use whichever the installed version documents.
- Pass the migrations as a test binding (`TEST_MIGRATIONS`) and apply them in the setup file.
- Run the real worker via the integration's `SELF.fetch` (or equivalent) so the dispatcher, Hono routes, KV, D1 and `ASSETS` are exercised together. Because `pretest` ensures placeholder assets exist, `/app/…` tests work.

**Suites**
- `validation.test.ts`:
  - rejects `api`, `app`, `API`, `App`; accepts `docs` and `Docs` as distinct slugs; rejects `a/b`, `..`, `a b`, `%20`, empty, 65 chars;
  - accepts a private-IP target (`http://192.168.1.10/x`) and `http://nas.local` (D9);
  - rejects `javascript:`, `data:`, `file:`, over-long URLs, targets whose host equals the request host or a configured `OWN_HOSTNAMES` entry (case-insensitive).
- `auth.test.ts`:
  - unauthenticated API call → `401` **and** `initial_token` now exists in KV with the expected format;
  - `Authorization: Bearer` and `X-API-Key` both work with the initial token;
  - with `API_KEY` set: it authenticates, `initial_token` is **not** generated, and an existing `initial_token` is **not** accepted;
  - create/list (masked)/revoke a regular token; expired token rejected; token in an invalid format rejected without a KV read;
  - deleting `initial_token` from KV and making an API call regenerates it (recovery path);
  - `DELETE /tokens/initial` → `409`; `POST /tokens/initial/rotate` replaces the token and the old one stops working;
  - a manually written `token:<value>` record authenticates.
- `links.test.ts`: create with custom and generated slugs; duplicate → `409`; `Docs` vs `docs` coexist; **rename a slug** (old slug → 404 on redirect, new slug redirects, stats preserved, rename to an existing slug → `409`); list with search (including a literal `%`/`_` in the term), tag filter, `slug` exact filter, sorting, pagination; PATCH fields (status code, tags, `isActive`, `forwardQuery`, `expiresAt: null`); DELETE cascades to rollup rows; API responses carry `Cache-Control: no-store`.
- `redirect.test.ts`: default `307` with `Cache-Control: no-store`; `301`/`308` with `private, max-age=3600`; query merge cases (no target query, existing target query preserved byte-for-byte including `%20`/`+`, duplicate incoming keys kept, target-defined key wins, fragment preserved, `forwardQuery: false`); unknown/inactive/expired → `404` page, or `307` to a valid `FALLBACK_URL`; a `FALLBACK_URL` on the same host is ignored (404, no loop); `POST /slug` → `405`; percent-encoded slugs → `404`; a D1 failure on lookup → `503`.
- `analytics.test.ts`:
  - **cost budget:** call `recordClick` directly and assert the sum of `meta.rows_written` across the batch is `2` by default, `3` with `country`, `4` with `country,referrer`;
  - a counted `GET` increments `click_count`, `last_clicked_at` and the day's rollup (use `vi.waitFor` because the write runs in `waitUntil`);
  - `HEAD`, bot/preview user agents and prefetch requests still redirect but do not count;
  - `ANALYTICS_ENABLED="false"` writes nothing; a failing analytics batch does not change the redirect response;
  - dimension values: country defaults to `XX`; referrer stores only the hostname, `(direct)` when absent;
  - `/stats` returns the daily series and only the enabled dimensions.
- `dispatch.test.ts`: `/` → fallback or 404; `/app` → `308` to `/app/`; `/app/` and `/app/some/deep/route` → the index placeholder with `200` and security headers; `/app/missing.js` → `404`; `/api/unknown` → JSON `404`; `/favicon.ico` → asset if present else `404`; multi-segment unknown path → `404`.

### Phase 9 — README runbook (`/README.md`)

Write a README covering:
1. **Setup:** `pnpm install`; `wrangler d1 create redirect-db` and `wrangler kv namespace create AUTH_TOKENS`, paste the IDs into `wrangler.jsonc`; set the `routes` domain; `pnpm db:migrate:remote`; `pnpm deploy`.
2. **First run / getting your token:** call any API endpoint once (e.g. `curl -i https://<domain>/api/v1/auth/verify` → `401`), or open `/app/`. Then Cloudflare dashboard → Storage & Databases → KV → `AUTH_TOKENS` → key `initial_token`. Local dev: `pnpm --filter @redirect/api exec wrangler kv key get initial_token --binding AUTH_TOKENS --local`.
3. **Recovery / lockout:** delete the `initial_token` key (regenerates on the next API request) or set the `API_KEY` secret (`wrangler secret put API_KEY`); note that `API_KEY` disables the initial-token mechanism.
4. **Optional Zero Trust:** protect both `/app/*` and `/api/*`, leave `/` and `/:slug` public. Service-token headers for scripts. Verification: unauthenticated `curl -i https://<domain>/app/` and `/api/v1/auth/verify` return an Access login redirect, while `https://<domain>/<some-slug>` still returns the link's redirect. State plainly that the Worker ignores Access headers and always requires the token.
5. **Analytics cost table** (copy from the concept: rows written per click, free-tier clicks/day, paid cost) and how to enable `country`/`referrer` with the cost impact.
6. **Backups:** `wrangler d1 export`, D1 Time Travel.
7. **Known limitations** (eventual consistency of tokens, bots heuristic, no aliases after rename, permanent-redirect caching caveat).

---

## 4. Definition of done

From `/home/azraftaohid/codes/redirect/`:

- [ ] `pnpm install` succeeds.
- [ ] `pnpm typecheck` passes (runs `wrangler types` first).
- [ ] `pnpm test` passes every suite in Phase 8, including the `rows_written` budget assertions.
- [ ] `pnpm db:migrate:local` succeeds on a fresh local database.
- [ ] `pnpm dev` starts; manual smoke test with curl:
  - `curl -i localhost:8787/api/v1/auth/verify` → `401`; the initial token is then readable via the local KV command in the README;
  - create a link with that token, then `curl -i localhost:8787/<slug>` → `307` with `Location`, `Cache-Control: no-store`;
  - `curl -i "localhost:8787/<slug>?utm_source=x"` forwards the parameter;
  - `GET /api/v1/links/<id>/stats` shows the click after a moment;
  - `curl -i localhost:8787/app/` → `200` placeholder with security headers.
- [ ] No table stores one row per click; no index exists on counter columns; no CORS code; no Access-header handling in the Worker.
- [ ] README runbook written.
