# Redirect — Implementation Plan

Step-by-step specification for an LLM coding agent to implement the **Redirect** platform (Backend + Frontend) in `/home/azraftaohid/codes/redirect/`. The product concept is in `/home/azraftaohid/Documents/Notes/Main/Projects/Redirect Dev Notes/Concept.md`. If this plan and the concept disagree, the concept's intent wins; report the discrepancy.

Follow the phases in order. After each phase, run the verification listed for it before continuing.

---

## Project Status Overview

| Part | Scope | Status |
| :--- | :--- | :--- |
| **Part I** | Monorepo, `@redirect/shared`, & `@redirect/api` (Phases 1–9) | ✅ **Completed** (49/49 tests passing) |
| **Part II** | `@redirect/web` Frontend SPA & PWA (Phases F1–F8) | 📋 **Ready for Implementation** |

---

## 0. Authoritative Decisions (Do Not Deviate or "Improve")

### Backend & Platform Decisions (`D1`–`D12`)

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

### Frontend Decisions (`F1`–`F13`)

| # | Decision |
| :-- | :-- |
| F1 | **Subpath isolation under `/app/`.** Vite builds with `base: "/app/"` and `build.outDir: "dist/app"`, producing `apps/web/dist/app/index.html` and `apps/web/dist/app/assets/*`. A standalone `404.html` is emitted to `apps/web/dist/404.html`. No root `/index.html` or root `/assets/*` directory may exist. |
| F2 | **Strict `/app/` Service Worker scope.** The service worker MUST be served from `/app/sw.js` and registered with `{ scope: "/app/" }`. Never register a root-scoped service worker, as it would intercept short links (`/:slug`). |
| F3 | **Zero Trust-compatible Web App Manifest & standard PNG icons.** Link manifest with `<link rel="manifest" href="/app/manifest.webmanifest" crossorigin="use-credentials">`. Include standard raster PNGs (`icon-192.png`, `icon-512.png`, `apple-touch-icon.png`) to fulfill Chromium installability criteria and iOS homescreen requirements. |
| F4 | **Strict CSP compliance.** All `/app/*` responses carry `Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'`. Do not load external scripts, external icon/font CDNs, or use inline `<script>` tags. |
| F5 | **Single source of truth via `@redirect/shared`.** Import constants, Zod schemas, `validateSlug`, `validateTargetUrl`, `generateRandomSlug`, and TypeScript interfaces (`LinkRecord`, `LinkStats`, `TokenInfo`, `Paginated<T>`, `ApiErrorBody`) directly from `@redirect/shared`. Do not duplicate validation regexes or types. |
| F6 | **Token persistence & lazy bootstrap.** Store the bearer token in `localStorage` (`redirect_auth_token`). When `/app/` loads without a stored token, fire one background `GET /api/v1/auth/verify` (ignoring the expected `401`) so the Worker lazily generates `initial_token` in KV on first visit. |
| F7 | **Zero Trust expired-session detection.** All API calls use `redirect: "manual"`. If a `/api/v1/*` call returns `res.type === "opaqueredirect"` (status 0), throws a CORS `TypeError` while `navigator.onLine` is true, or returns `text/html`, raise `AccessSessionExpiredError`. Do **not** wipe the stored bearer token in `localStorage`; surface a prompt reloading the page to re-authenticate with Access. |
| F8 | **Client-side analytics zero-filling & dynamic dimensions.** Zero-fill missing UTC days in `LinkStats.daily` on the client. Render `country` and `referrer` breakdown sections **only** when those keys exist on `LinkStats.dimensions`. |
| F9 | **Client-side QR generation.** Generate QR codes locally in the browser as `<svg>` / `data:image/png` (no third-party QR API requests). |
| F10 | **UI component architecture, routing & charting.** React + TypeScript + Vite + Tailwind CSS + shadcn/ui components (`class-variance-authority`, Radix Dialog, Alert Dialog, Dropdown Menu, Switch, Label, Sonner toast). Use `wouter` (~1.5 KB, with `base: "/app"`) for routing. Use styled native `<select>` for status codes and sorts (avoiding Radix Select portal focus traps, heavy bundle, and jsdom polyfill friction). Use responsive single-tree row components rather than duplicate table/card render trees. For link analytics, render the daily clicks time-series chart with a lightweight, self-contained SVG component (columns for 7/30 days, area sparkline for 90/365 days, UTC days axis) avoiding heavy charting libraries (e.g. Recharts). |
| F11 | **Service Worker cache & offline contract.** In `public/sw.js` (scoped to `/app/`), version cache (`redirect-app-v1`), precache `/app/index.html` on `install` with `skipWaiting()`, and cleanup old caches in `activate`. For `/app/` navigations: network-first; if network response is an opaque redirect, redirected, or non-200, pass it directly to the browser (never cache, never fall back to cache) so expired Access sessions can reach the login page; fall back to cached `/app/index.html` **only** if network `fetch` throws (offline). Serve `/app/assets/*` with `Cache-Control: public, max-age=31536000, immutable`. |
| F12 | **Shared slug generator & date timezone safety.** Base62 `generateRandomSlug` lives in `@redirect/shared` so both API and UI use the identical canonical generator. For HTML5 `<input type="datetime-local">`, use explicit helpers converting to/from local time (`YYYY-MM-DDTHH:mm`) and UTC ISO-8601 strings to prevent timezone offset truncation. |
| F13 | **KV replication grace window & token safety.** KV writes take up to 60s to propagate across Cloudflare edge PoPs. After rotating `initial_token` or creating a token, surface the token in a dedicated copy modal. Do not aggressively wipe `localStorage` on a single transient 401 if a token was rotated or set within the last 60 seconds; display a retry prompt. |

Non-goals: multi-user, multi-domain, aliases/redirect history, export/import endpoints (use `wrangler d1 export`), unique-visitor analytics.

---

## 1. Architecture

### Request Dispatch (`apps/api/src/index.ts`)

Evaluated in this exact order using `new URL(request.url).pathname`:

1. `/api/v1` or `/api/v1/*` → API router (Hono sub-app). Any other path starting with `/api` → JSON `404`.
2. `/app` → `308` redirect to `/app/` (preserving query string).
3. `/app/*` → `serveApp()`.
4. `/` → `handleRoot()`: valid `FALLBACK_URL` → `307`, else the 404 page.
5. Single segment (one optional trailing `/`) that matches `SLUG_REGEX` against the **raw** path (no `decodeURIComponent`) → `handleRedirect()`. Non-`GET`/`HEAD` → `405` with `Allow: GET, HEAD`.
6. Anything else → try `env.ASSETS.fetch(request)` for an exact static file (e.g. `/favicon.ico`); if it returns `404`, return the 404 page.

The 404 page = body of the `/404.html` asset with status `404` (`env.ASSETS.fetch(new Request(new URL('/404.html', request.url)))`); if that asset is missing, return plain text `Not found` with status `404`.

### Bindings and Configuration

| Name | Type | Purpose |
| :-- | :-- | :-- |
| `DB` | D1 | Links and statistics. |
| `AUTH_TOKENS` | KV | Tokens (see Phase 4). |
| `ASSETS` | Fetcher | Static assets built from `apps/web/dist`. |
| `API_KEY` | Secret, optional | Master token. When set, the initial-token mechanism is disabled. |
| `FALLBACK_URL` | Var, optional | Redirect target for unknown/disabled/expired slugs and for `/`. |
| `OWN_HOSTNAMES` | Var, optional | Comma-separated extra hostnames that count as "this redirector" for loop checks. |
| `ANALYTICS_ENABLED` | Var, default `"true"` | `"false"` disables all analytics writes. |
| `ANALYTICS_DIMENSIONS` | Var, default `""` | Comma-separated subset of `country`, `referrer`. Each adds one row written per counted click. |

---

## 2. Target Repository Layout

```text
/home/azraftaohid/codes/redirect/
├── .gitignore
├── README.md                          # operational runbook (completed)
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── plan.md
├── packages/shared/                   # ✅ completed (slug.ts moved in F1)
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts
│       ├── constants.ts
│       ├── schemas.ts                 # zod schemas + inferred types
│       ├── validation.ts              # slug / target URL validators
│       └── slug.ts                    # canonical Base62 generation
└── apps/
    ├── api/                           # ✅ completed
    │   ├── package.json
    │   ├── tsconfig.json
    │   ├── vitest.config.ts
    │   ├── wrangler.jsonc
    │   ├── worker-configuration.d.ts
    │   ├── .dev.vars.example
    │   ├── migrations/0001_initial.sql
    │   ├── scripts/
    │   │   ├── ensure-assets.mjs      # dev/test asset stub
    │   │   └── verify-dist.mjs        # predeploy build verifier
    │   ├── src/
    │   │   ├── index.ts               # request dispatcher
    │   │   ├── types.ts
    │   │   ├── errors.ts              # ApiError + error envelope
    │   │   ├── auth/
    │   │   │   ├── tokens.ts          # KV token logic
    │   │   │   └── middleware.ts
    │   │   ├── db/
    │   │   │   ├── links.ts
    │   │   │   └── stats.ts
    │   │   ├── routes/
    │   │   │   ├── links.ts
    │   │   │   ├── tokens.ts
    │   │   │   ├── stats.ts
    │   │   │   ├── redirect.ts
    │   │   │   └── app.ts             # serveApp + 404 page helper
    │   │   └── utils/
    │   │       ├── query.ts           # raw query merge
    │   │       └── analytics.ts       # countable-click filter + recordClick
    │   └── test/
    │       ├── apply-migrations.ts
    │       ├── validation.test.ts
    │       ├── auth.test.ts
    │       ├── links.test.ts
    │       ├── redirect.test.ts
    │       ├── analytics.test.ts
    │       └── dispatch.test.ts
    └── web/                           # 📋 Part II target layout
        ├── package.json
        ├── tsconfig.json
        ├── vite.config.ts
        ├── vitest.config.ts
        ├── index.html                 # SPA entry (manifest with crossorigin="use-credentials")
        ├── 404.html                   # standalone root 404 template copied to dist/404.html
        ├── public/
        │   ├── manifest.webmanifest   # served at /app/manifest.webmanifest
        │   ├── sw.js                  # served at /app/sw.js (scope: /app/)
        │   ├── icon-192.svg           # vector icon
        │   ├── icon-512.svg
        │   ├── icon-192.png           # raster PNG icons for Chromium PWA installability
        │   ├── icon-512.png
        │   └── apple-touch-icon.png   # iOS Safari homescreen icon
        ├── src/
        │   ├── main.tsx               # React root + SW registration
        │   ├── App.tsx                # AuthGate wrapper + wouter switch + layout shell
        │   ├── lib/
        │   │   └── utils.ts           # cn helper (clsx + tailwind-merge)
        │   ├── styles/
        │   │   └── globals.css        # Tailwind CSS + shadcn theme variables (dark/light)
        │   ├── api/
        │   │   └── client.ts          # Typed API client + Access redirect detection
        │   ├── context/
        │   │   └── AuthContext.tsx    # Token state, verify, login, logout, bootstrap ping
        │   ├── utils/
        │   │   ├── stats.ts           # zeroFillDailySeries, formatUtcDay, country formatter
        │   │   ├── dates.ts           # local datetime-local <-> ISO UTC converters
        │   │   ├── share.ts           # extractSharedPayload for Web Share Target
        │   │   └── qr.ts              # Client-side SVG/Canvas QR generator
        │   ├── components/
        │   │   ├── ui/                # shadcn/ui components (Radix primitives + native select)
        │   │   │   ├── button.tsx
        │   │   │   ├── input.tsx
        │   │   │   ├── label.tsx
        │   │   │   ├── dialog.tsx
        │   │   │   ├── alert-dialog.tsx
        │   │   │   ├── card.tsx
        │   │   │   ├── badge.tsx
        │   │   │   ├── switch.tsx
        │   │   │   ├── dropdown-menu.tsx
        │   │   │   ├── select.tsx     # Tailwind-styled accessible native <select>
        │   │   │   └── sonner.tsx
        │   │   ├── Layout.tsx         # Navigation bar, principal indicator, mobile nav
        │   │   ├── AuthGate.tsx       # Unlock screen + first-run KV recovery guide
        │   │   ├── AccessExpiredBanner.tsx
        │   │   ├── LinkRow.tsx        # Responsive link row (desktop table / mobile card)
        │   │   ├── LinkFormModal.tsx  # Create & Edit (with mutable slug & status warnings)
        │   │   ├── QrCodeModal.tsx    # SVG preview + PNG/SVG download + copy
        │   │   └── DailyChart.tsx     # Lean SVG time-series chart (no Recharts)
        │   └── pages/
        │       ├── DashboardPage.tsx  # Quick shorten, search/tag/sort toolbar, links list
        │       ├── LinkStatsPage.tsx  # Daily SVG chart + conditional dimension breakdowns
        │       ├── ShareTargetPage.tsx# /app/share one-tap mobile shortening flow
        │       └── SettingsPage.tsx   # Token management, initial token rotation, revoke
        └── test/
            ├── setup.ts               # jsdom polyfills (ResizeObserver, matchMedia)
            ├── share.test.ts
            ├── stats.test.ts
            ├── client.test.ts
            └── components.test.tsx
```

---

## 3. Part I — Backend Implementation (Completed)

All backend phases have been implemented, verified, and committed:

- [x] **Phase 1 — Workspace (`04645dc`):** Monorepo configured with `pnpm-workspace.yaml`, `tsconfig.base.json`, root scripts, and package skeletons.
- [x] **Phase 2 — Shared Package `@redirect/shared` (`04645dc`):** Constants (`RESERVED_SLUGS`, `SLUG_REGEX`, `REDIRECT_STATUS_CODES`, limits), validators (`validateSlug`, `validateTargetUrl`, `parseOwnHostnames`), and Zod schemas/types (`createLinkSchema`, `updateLinkSchema`, `listLinksQuerySchema`, `statsQuerySchema`, `createTokenSchema`, `LinkRecord`, `LinkStats`, `TokenInfo`).
- [x] **Phase 3 — D1 Schema (`e3ee70e`):** `apps/api/migrations/0001_initial.sql` with `links`, `link_daily_clicks` (`WITHOUT ROWID`), and `link_daily_dims` (`WITHOUT ROWID`). Unindexed counter columns enforce the strict write-cost budget.
- [x] **Phase 4 — Authentication in KV (`e3ee70e`, `e6b28d3`):** Plaintext recovery-friendly KV storage, SHA-256 constant-time `safeEqual`, hoisted `BEARER_REGEX`, lazy `ensureInitialToken` on `401`, `/api/v1/auth/verify`, and `/api/v1/tokens` CRUD + `/api/v1/tokens/initial/rotate`.
- [x] **Phase 5 — Links API (`e3ee70e`):** Full CRUD at `/api/v1/links` and `/api/v1/links/:id`, unbiased Base62 random slug generator with collision retries, escaped `LIKE` search, `json_each` tag filtering, and mutable slug support.
- [x] **Phase 6 — Statistics API (`e3ee70e`, `f6e4b5c`):** `GET /api/v1/links/:id/stats` returning total clicks, date range, daily series, and only enabled dimensions from `ANALYTICS_DIMENSIONS`.
- [x] **Phase 7 — Redirect Engine, App Serving & Analytics (`f6e4b5c`):** Top-level dispatcher in `src/index.ts`, byte-for-byte `mergeQuery`, bot/prefetch filter `isCountableClick`, batched `recordClick` via `ctx.waitUntil`, `serveApp` with SPA fallback and `APP_SECURITY_HEADERS`, and `503` on D1 lookup errors.
- [x] **Phase 8 — Backend Test Suites (`f6e4b5c`):** 49 tests across 6 suites (`validation.test.ts`, `auth.test.ts`, `links.test.ts`, `redirect.test.ts`, `analytics.test.ts`, `dispatch.test.ts`) running on `@cloudflare/vitest-pool-workers`.
- [x] **Phase 9 — README Runbook (`606bc5b`):** Root `README.md` covering setup, token bootstrap/recovery, optional Zero Trust, D1 analytics cost table, backups, and limitations.

### Backend Definition of Done (Verified)

- [x] `pnpm install` succeeds.
- [x] `pnpm typecheck` passes across all workspace packages.
- [x] `pnpm test` passes all 49 tests across all 6 suites, including `meta.rows_written` budget assertions (2 default, 3 with country, 4 with country + referrer).
- [x] `pnpm db:migrate:local` succeeds on a local database.
- [x] No table stores one row per click; no index exists on counter columns; no CORS code; no Access-header handling in the Worker.
- [x] `README.md` runbook written and formatted.

---

## 4. Part II — Frontend Implementation Plan (`apps/web`)

Follow Phases **F1** through **F8** in order.

### Phase F1 — Frontend Workspace, Build Pipeline & Static 404 Page

Configure `apps/web` as a React + TypeScript + Vite package that outputs directly into the asset structure expected by `apps/api/wrangler.jsonc` (`../web/dist`).

1. **Move Canonical Slug Generator to `@redirect/shared`:**
   - Create `packages/shared/src/slug.ts` exporting `ALPHABET` and `generateRandomSlug(length = 6)`.
   - Re-export `generateRandomSlug` from `packages/shared/src/index.ts`.
   - Update `apps/api/src/utils/slug.ts` to re-export from `@redirect/shared`.
   - Add `"build": "tsc --noEmit"` (or `"build": "tsc"`) to `packages/shared/package.json`.

2. **`apps/web/package.json`:**
   - Dependencies: `react`, `react-dom`, `@redirect/shared` (`workspace:*`), `wouter`, `lucide-react`, `clsx`, `tailwind-merge`, `class-variance-authority`, `@radix-ui/react-dialog`, `@radix-ui/react-alert-dialog`, `@radix-ui/react-dropdown-menu`, `@radix-ui/react-switch`, `@radix-ui/react-label`, `sonner`, `qrcode`.
     *(Note: Decision F10 avoids `@radix-ui/react-select` to prevent portal focus traps, heavy bundle, and jsdom polyfill issues; link redirect status code uses styled native `<select>`.)*
   - DevDependencies: `typescript`, `vite`, `@vitejs/plugin-react`, `tailwindcss`, `@tailwindcss/vite` (or Tailwind PostCSS), `@types/react`, `@types/react-dom`, `@types/node`, `@types/qrcode`, `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`.
   - Scripts:
     - `"dev": "vite"`
     - `"build": "tsc --noEmit && vite build"`
     - `"typecheck": "tsc --noEmit"`
     - `"test": "vitest run"`

3. **`apps/web/tsconfig.json` & Path Aliases:**
   - Extend `../../tsconfig.base.json`.
   - Set `"jsx": "react-jsx"`, `"lib": ["ES2022", "DOM", "DOM.Iterable"]`.
   - Configure `"baseUrl": "."` and `"paths": { "@/*": ["./src/*"] }` for `@/` path alias.

4. **`apps/web/vite.config.ts`:**
   - Set `base: "/app/"`.
   - Set `build.outDir: "dist/app"` and `build.emptyOutDir: true`.
   - Configure path alias: `resolve: { alias: { "@": path.resolve(__dirname, "./src") } }`.
   - Configure `server`:
     - `port: 5173`
     - Proxy configuration:
       - Proxy `/api` to `http://127.0.0.1:8787`.
       - Proxy single-segment root slugs `/:slug` to `http://127.0.0.1:8787` (bypassing `/app`, `/@*`, `/src`, `/node_modules`, and asset paths with file extensions) so clicking or testing generated short links works seamlessly on localhost:5173.
   - Add a small Vite `closeBundle` plugin hook in `vite.config.ts` that copies `apps/web/404.html` to `apps/web/dist/404.html` on every build so the root 404 asset is always present alongside `dist/app/`.

5. **Standalone `apps/web/404.html`:**
   - Self-contained HTML + inline CSS (no external JS/CSS dependencies so it works for any invalid root `/:slug` path without extra asset requests).
   - Clean dark/light adaptive layout displaying `"404 Not Found — The requested short link does not exist, has expired, or has been disabled."`

6. **`apps/web/index.html` & Test Title Alignment:**
   - Title: `Redirect — Link Manager`.
   - Viewport meta, theme-color meta, icon links (`/app/icon-192.svg`, `/app/icon-192.png`, `/app/apple-touch-icon.png`).
   - Manifest link with credentials:
     `<link rel="manifest" href="/app/manifest.webmanifest" crossorigin="use-credentials" />` (Decision F3).
   - `<div id="root"></div>` and `<script type="module" src="/src/main.tsx"></script>`.
   - Update `apps/api/scripts/ensure-assets.mjs` placeholder title to `<title>Redirect — Link Manager</title>`.
   - Decouple `apps/api/test/dispatch.test.ts` to assert `expect(htmlRoot).toContain("<title>Redirect")` and `expect(htmlRoot).toContain('<div id="root">')` so tests verify structure rather than brittle exact title copy.

7. **Distribution Verification & Scripts (`apps/api/scripts/verify-dist.mjs`):**
   - Create `apps/api/scripts/verify-dist.mjs`:
     - Asserts `apps/web/dist/app/index.html`, `apps/web/dist/app/manifest.webmanifest`, `apps/web/dist/app/sw.js`, and `apps/web/dist/404.html` exist.
     - Asserts `apps/web/dist/index.html` and `apps/web/dist/assets/` do NOT exist at root of `dist`.
     - Asserts `apps/web/dist/app/index.html` contains no inline `<script>` tags (enforcing strict CSP compliance).
   - In `apps/api/package.json`: change `"predeploy"` from `node scripts/ensure-assets.mjs` to `node scripts/verify-dist.mjs` to prevent accidentally deploying an unbuilt placeholder to production.
   - In root `package.json`:
     - `"dev": "pnpm --parallel --filter @redirect/api --filter @redirect/web dev"`
     - `"build": "pnpm --filter @redirect/web build && pnpm --filter @redirect/api build"`
     - `"test": "pnpm --filter @redirect/api test && pnpm --filter @redirect/web test"`
     - `"deploy": "pnpm --filter @redirect/web build && pnpm --filter @redirect/api deploy"`

**Verify Phase F1:**
- `pnpm install` succeeds.
- `pnpm --filter @redirect/web build` succeeds and produces `apps/web/dist/app/index.html`, `apps/web/dist/app/assets/*`, and `apps/web/dist/404.html`.
- `node apps/api/scripts/verify-dist.mjs` passes.
- `pnpm --filter @redirect/api test` passes all tests.

---

### Phase F2 — API Client, Auth Context & Zero Trust Resilience

Implement a strictly typed API client and authentication state layer in `apps/web/src/api/` and `apps/web/src/context/`.

1. **Token Storage (`src/api/client.ts`):**
   - Storage key constant: `AUTH_TOKEN_STORAGE_KEY = "redirect_auth_token"`.
   - Helpers: `getStoredToken(): string | null`, `setStoredToken(token: string): void`, `clearStoredToken(): void`.

2. **Error Classes (`src/api/client.ts`):**
   - `ApiClientError extends Error`:
     - `status: number`
     - `code: string` (from `ApiErrorBody["error"]["code"]`, e.g. `"unauthorized"`, `"slug_taken"`, `"validation_error"`, `"initial_token_protected"`, `"mechanism_disabled"`)
     - `details?: unknown`
   - `AccessSessionExpiredError extends Error`:
     - Thrown when an API call fails due to Cloudflare Zero Trust Access session expiration:
       - `response.type === "opaqueredirect"` or `response.status === 0` (browser blocked follow or returned opaque redirect under `redirect: "manual"`), OR
       - `fetch` throws a `TypeError` while `navigator.onLine === true` (cross-origin IdP redirect blocked by CORS), OR
       - `response.headers.get("content-type")?.includes("text/html")` on status < 500 (Access HTML login page returned).
       *(Note: HTML responses with status ≥ 500 represent Worker crashes or Cloudflare edge gateway errors, and throw `ApiClientError(status, "server_error")` instead).*
     - **Important (Decision F7):** Never call `clearStoredToken()` when `AccessSessionExpiredError` occurs.

3. **Typed API Methods (`src/api/client.ts`):**
   - All requests set `Accept: "application/json"`, `credentials: "same-origin"`, `redirect: "manual"`, and `Authorization: Bearer ${token}` (when a token is available or passed explicitly).
   - Endpoints:
     - `verifyAuth(candidateToken?: string)` → `GET /api/v1/auth/verify` → `{ principal: { kind: "env" | "token" | "initial"; id: string; name: string } }`
     - `bootstrapInitialTokenPing()` → `GET /api/v1/auth/verify` without an `Authorization` header (swallows the expected `401` response; used once on mount when no token is stored so the Worker's `authMiddleware` executes `ensureInitialToken(env)`).
     - `listLinks(query: Partial<ListLinksQuery>)` → `GET /api/v1/links?...` → `Paginated<LinkRecord>`
     - `getLink(id: string)` → `GET /api/v1/links/:id` → `LinkRecord`
     - `createLink(input: CreateLinkInput)` → `POST /api/v1/links` → `LinkRecord`
     - `updateLink(id: string, input: UpdateLinkInput)` → `PATCH /api/v1/links/:id` → `LinkRecord`
     - `deleteLink(id: string)` → `DELETE /api/v1/links/:id` → `{ deleted: true; id: string }`
     - `getLinkStats(id: string, days?: number)` → `GET /api/v1/links/:id/stats?days=...` → `LinkStats`
     - `listTokens()` → `GET /api/v1/tokens` → `{ data: TokenInfo[] }`
     - `createToken(input: CreateTokenInput)` → `POST /api/v1/tokens` → `TokenInfo & { token: string }`
     - `deleteToken(id: string)` → `DELETE /api/v1/tokens/:id` → `{ deleted: true; id: string }`
     - `rotateInitialToken()` → `POST /api/v1/tokens/initial/rotate` → `{ token: string; id: "initial"; name: string; isInitial: true; preview: string }`

4. **Auth Context (`src/context/AuthContext.tsx`) & Unlock Screen (`src/components/AuthGate.tsx`):**
   - State: `status: "loading" | "unauthenticated" | "authenticated"`, `principal`, `accessExpired: boolean`, `error: string | null`.
   - Track `lastTokenSetAt` timestamp.
   - On mount:
     - If `getStoredToken()` exists: call `verifyAuth()`.
       - On `200`: set `status = "authenticated"` and `principal`.
       - On `401`:
         - If `Date.now() - lastTokenSetAt < 60_000` (KV replication grace period): do NOT wipe token; show toast *"KV propagation in progress across edge locations. Click to retry."* and keep state as `"authenticated"`.
         - Otherwise: call `clearStoredToken()`, set `status = "unauthenticated"`.
       - On `AccessSessionExpiredError`: keep token in `localStorage`, set `accessExpired = true`.
     - If no stored token exists: set `status = "unauthenticated"` and fire `bootstrapInitialTokenPing()` once in the background (Decision F6).
   - `login(rawToken: string)`: trims input, calls `verifyAuth(rawToken)`, and on success stores the token in `localStorage`, records `lastTokenSetAt = Date.now()`, and transitions to `"authenticated"`.
   - `updateActiveToken(newToken: string)`: updates `localStorage` in-place and records `lastTokenSetAt = Date.now()` (used when rotating `initial_token`).
   - `logout()`: clears `localStorage` and resets state to `"unauthenticated"`.
   - **`AuthGate.tsx` UI:**
     - Clean password/token input with show/hide toggle and "Unlock" submit button.
     - Collapsible **"Where do I find my token?"** section explaining:
       1. **API_KEY mode:** If you set the `API_KEY` environment secret in `wrangler.jsonc` or Cloudflare dashboard, enter that secret value.
       2. **Production KV:** Cloudflare Dashboard → **Storage & Databases** → **KV** → `AUTH_TOKENS` → key `initial_token`.
       3. **Local dev:** `pnpm --filter @redirect/api exec wrangler kv key get initial_token --binding AUTH_TOKENS --local`.
       4. **Recovery:** Deleting `initial_token` in KV regenerates it automatically on the next visit to `/app/`.

**Verify Phase F2:**
- `pnpm --filter @redirect/web typecheck` passes.

---

### Phase F3 — App Shell, History Router & Design System

Build a responsive, accessible UI shell scoped under `/app/` using Tailwind CSS and shadcn/ui.

1. **Router & Subpath Isolation (`src/App.tsx` via `wouter`):**
   - Use `wouter` configured with base path `/app` (`<Router base="/app">`):
     - Route `/` (maps to `/app/` and `/app`) → `DashboardPage`
     - Route `/links/:id` → `LinkStatsPage`
     - Route `/share` → `ShareTargetPage` (Web Share Target destination)
     - Route `/settings` → `SettingsPage` (KV API token management)
     - Default wildcard `*` → in-app 404 view displaying `"Page Not Found"` with a button back to `/app/`.
   - `wouter` handles `<Link href="...">` pushState navigation, query strings, and back/forward browser history seamlessly with minimal footprint (~1.5 KB).

2. **Design System & Styling (`src/lib/utils.ts` & `src/styles/globals.css`):**
   - Implement `cn(...inputs)` utility in `src/lib/utils.ts` combining `clsx` and `tailwind-merge`.
   - Configure Tailwind CSS and shadcn CSS variables in `src/styles/globals.css` (`--background`, `--foreground`, `--card`, `--primary`, `--muted`, `--border`, `--radius`) supporting automatic dark/light mode via `@media (prefers-color-scheme: dark)` and `color-scheme: light dark`.
   - System font stack (`system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`) and monospace font stack (`ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`) for slugs, URLs, and tokens — zero external font requests (Decision F4).
   - Responsive layout:
     - Desktop: sticky top navigation bar (`Links`, `Tokens & Settings`, active principal badge, `Lock / Sign out`), max-width container (`1100px`).
     - Mobile: compact header + touch-friendly controls (minimum `44px` tap targets) for effortless mobile use.

3. **Core shadcn/ui Primitives (`src/components/ui/`):**
   - Add core components: `button.tsx`, `input.tsx`, `label.tsx`, `dialog.tsx`, `alert-dialog.tsx`, `card.tsx`, `badge.tsx`, `switch.tsx`, `dropdown-menu.tsx`, `select.tsx` (accessible Tailwind-styled native `<select>`), `sonner.tsx`.
   - Setup `<Toaster />` from `sonner` at the root layout for non-blocking feedback (`"Short link copied to clipboard"`, `"Link updated"`).
   - `AccessExpiredBanner.tsx`: banner shown when `accessExpired` is true, offering a one-click `"Reload & Re-authenticate"` button (`window.location.reload()`) without clearing the stored token.

**Verify Phase F3:**
- `pnpm --filter @redirect/web typecheck` passes.

---

### Phase F4 — Links Dashboard: Create, Edit, Rename, Filter & QR Code

Implement the primary link management workflow in `src/pages/DashboardPage.tsx`, `src/components/LinkFormModal.tsx`, and `src/components/QrCodeModal.tsx`.

1. **Quick Shorten Bar (Top of Dashboard):**
   - Single-line form on desktop (stacked on mobile): `Target URL` input + optional `Custom slug` input + `"Shorten"` button + `"More options…"` button (which opens `LinkFormModal` pre-filled with the current inputs).
   - Validates `targetUrl` with `validateTargetUrl(url, [window.location.hostname])` and `slug` (if non-empty) with `validateSlug(slug)` from `@redirect/shared`.
   - On creation (`POST /api/v1/links`):
     - Attempts copying the new short URL (`${window.location.origin}/${created.slug}`) to clipboard with toast notification (safely handled with try/catch fallback), triggers a list refetch (`loadLinks()`, preserving pagination and sort order), and shows a quick action to view its QR code.

2. **Full Create / Edit Modal (`src/components/LinkFormModal.tsx`):**
   - Supports both **Create** (`POST /api/v1/links`) and **Edit** (`PATCH /api/v1/links/:id`).
   - Fields:
     - `targetUrl` (required, validated against `validateTargetUrl(val, [window.location.hostname])`).
     - `slug` (optional on create — blank auto-generates 6-char Base62; required on edit):
       - Uses `generateRandomSlug` from `@redirect/shared`.
       - **Case-sensitive hint:** `"Case-sensitive (e.g. Docs and docs are distinct)."`.
       - **Mutable slug warning on Edit:** When `slug !== originalLink.slug`, display an inline warning alert: `"Renaming the slug frees '/<oldSlug>' immediately. The old link will return 404 (no redirect alias is kept). Click statistics will be preserved."`
     - `title` (optional, max `MAX_TITLE_LENGTH` = 200 chars).
     - `tags` (comma/Enter-separated chip input; normalized trimmed lowercase, max `MAX_TAGS` = 10 tags, each ≤ `MAX_TAG_LENGTH` = 32 chars).
     - `statusCode` styled native `<select>` (Decision F10):
       - `307 — Temporary Redirect (Default, preserves method)`
       - `302 — Found (Temporary)`
       - `308 — Permanent Redirect (Preserves method)`
       - `301 — Moved Permanently`
       - **Caching warning:** When `301` or `308` is selected, display an inline note: `"Browsers cache permanent redirects (max-age=3600). Repeat clicks from the same browser will not be counted in analytics, and target changes propagate slowly."`
     - `forwardQuery` checkbox (default `true`: `"Forward incoming query parameters to target URL"`).
     - `isActive` checkbox (default `true`: `"Link is active and resolves redirects"`).
     - `expiresAt` (`<input type="datetime-local">` + `"Clear expiry"` button):
       - Uses `src/utils/dates.ts`: converts backend UTC ISO string to local `YYYY-MM-DDTHH:mm` for `<input>` prefill (`toLocalDatetimeInputValue(link.expiresAt)`), and converts local `<input>` value back to UTC ISO-8601 on submit (`fromLocalDatetimeInputValue(val)`), or sends `null` on edit when cleared.
   - Error handling:
     - `409 slug_taken`: highlight the `slug` input with `"This slug is already in use."`
     - `400 invalid_target_url` / `invalid_slug` / `invalid_expiry` / `validation_error`: display the server message inline.

3. **Search, Filter & Sort Toolbar (`src/pages/DashboardPage.tsx`):**
   - Synchronize filter state bidirectionally with URL search parameters (`?search=&tag=&status=&sortBy=&sortOrder=&page=`):
     - Search input (`300ms` debounce).
     - Active Tag filter badge (with `"× Clear"` button) + suggestions from known tags.
     - Status filter segmented control: `All` (`undefined`), `Active` (`"true"`), `Disabled` (`"false"`).
     - Sort selector (styled native `<select>`):
       - Newest first (`sortBy=createdAt`, `sortOrder=desc`)
       - Oldest first (`sortBy=createdAt`, `sortOrder=asc`)
       - Most clicked (`sortBy=clickCount`, `sortOrder=desc`)
       - Recently updated (`sortBy=updatedAt`, `sortOrder=desc`)
       - Slug A–Z (`sortBy=slug`, `sortOrder=asc`)

4. **Responsive Links List & Single-Tree Row Component (`src/components/LinkRow.tsx`):**
   - Render links using a single responsive `LinkRow` component (avoids duplicate desktop/mobile trees, duplicate DOM nodes, and duplicate event handlers):
     - **Desktop view:** Tabular row with short URL, target & title, badges/tags, metrics, and inline action buttons.
     - **Mobile view:** Card-style layout with minimum 44px tap targets.
   - Each link displays:
     - Short URL (`/${link.slug}`) in bold monospace + **Copy** button + external test link (`href="/${link.slug}" target="_blank" rel="noopener noreferrer"`).
     - Title (if set) and `targetUrl`.
     - Status badges: `Disabled` (`!link.isActive`), `Expired` (past `expiresAt`), `Expires <date>`, and HTTP status pill (`307`, etc.).
     - Tag chips (clicking a tag applies the tag filter).
     - Metrics summary: **`<N> clicks`** (links to `/app/links/${link.id}`) and `Last clicked <relative time>`.
     - Action buttons:
       - **Primary (always visible):** **Copy** short URL and **Stats** (navigates to `/app/links/${link.id}`).
       - **Secondary (inline on desktop, grouped in shadcn `DropdownMenu` on mobile):** **QR Code** (`QrCodeModal`), **Edit** (`LinkFormModal`), and **Delete** (confirms via shadcn `AlertDialog` → `DELETE /api/v1/links/:id`).
       - **Enable / Disable** quick toggle: shadcn `Switch` (`PATCH /api/v1/links/:id` with `{ isActive: !link.isActive }`).
   - Pagination footer: `"Showing X–Y of Z links"` with `Previous` and `Next` buttons (`limit = 20`).

5. **Client-Side QR Code Modal (`src/components/QrCodeModal.tsx` & `src/utils/qr.ts`):**
   - Uses shadcn `Dialog` primitive.
   - Generates a QR code for `${window.location.origin}/${link.slug}` locally in the browser (`qrcode.toString(..., { type: "svg" })` and `qrcode.toDataURL(..., { width: 512, margin: 2 })`).
   - Renders the crisp SVG preview inline.
   - Provides **"Download PNG"**, **"Download SVG"**, and **"Copy Short Link"** buttons.

**Verify Phase F4:**
- `pnpm --filter @redirect/web typecheck` and `pnpm --filter @redirect/web build` succeed.

---

### Phase F5 — Link Analytics & Time-Series Visualization

Implement `src/pages/LinkStatsPage.tsx`, `src/components/DailyChart.tsx`, and `src/utils/stats.ts`.

1. **Zero-Fill & UTC Date Utilities (`src/utils/stats.ts`):**
   - `zeroFillDailySeries(daily: Array<{ day: string; clicks: number }>, from: string, to: string): Array<{ day: string; clicks: number }>`
     - Iterates day-by-day in UTC from `from` (`YYYY-MM-DD`) to `to` (`YYYY-MM-DD`) inclusive using `Date.UTC`, looking up click counts from a `Map` and defaulting missing days to `0`.
   - `formatUtcDay(dayStr: string): string`:
     - Parses `[year, month, day]` and formats with `new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" })` to strictly prevent negative UTC timezones (e.g. UTC-5) from shifting dates backwards by one calendar day.
   - `formatCountryName(code: string): string`:
     - Returns `"Unknown / Unspecified"` for `"XX"`.
     - Uses `new Intl.DisplayNames(["en"], { type: "region" }).of(code)` (with try/catch fallback to `code`) so `"BD"` displays as `"Bangladesh (BD)"`, `"US"` as `"United States (US)"`, etc.

2. **Statistics Page (`src/pages/LinkStatsPage.tsx`):**
   - Loads `getLink(id)` and `getLinkStats(id, days)` in parallel.
   - Header: Back to Links button, short link `/${link.slug}` with Copy & QR buttons, target URL, and Edit Link button.
   - Period selector pills: `7 days`, `30 days` (default), `90 days`, `365 days`.
   - Summary KPI cards using shadcn `<Card>`:
     - **Total All-Time Clicks** (`stats.totalClicks`)
     - **Clicks in Period** (sum of `daily` over the selected range)
     - **Peak Day in Period** (max day and count)
     - **Last Clicked** (formatted timestamp or `"Never"`)
   - **Daily Clicks SVG Chart (`src/components/DailyChart.tsx`, Decision F10):**
     - Custom lightweight SVG component avoiding heavy charting libraries (e.g. Recharts):
       - Clearly label the horizontal axis as **"UTC Days"**.
       - **7 and 30 day ranges:** Render discrete vertical SVG column bars with minimum spacing and tap/hover tooltips showing `YYYY-MM-DD: N clicks`.
       - **90 and 365 day ranges:** Render an SVG continuous area/sparkline `<path>` with touch/mouse scrubbing indicator (avoids sub-pixel <0.8px bars on mobile screens where 365 discrete columns are unreadable).
       - Horizontal reference gridlines and dynamic Y-axis scale labels.
   - **Conditional Dimension Breakdowns (Decision F8):**
     - Check `stats.dimensions?.country` and `stats.dimensions?.referrer`.
     - If `stats.dimensions?.country` is defined: render **Top Countries** card (list of top 10 values with horizontal proportion bars and click counts, or `"No country data in this period"` if empty array).
     - If `stats.dimensions?.referrer` is defined: render **Top Referrers** card (list of top 10 hostnames / `(direct)` with proportion bars and click counts).
     - If neither is defined in `stats.dimensions`, do not render the breakdown section (show a subtle footer note that `country` and `referrer` dimensions can be enabled via `ANALYTICS_DIMENSIONS` in `wrangler.jsonc`).

**Verify Phase F5:**
- `pnpm --filter @redirect/web typecheck` passes.

---

### Phase F6 — PWA, Service Worker (`/app/` Scope) & Web Share Target

Implement installable PWA support and mobile one-tap link shortening under `/app/`.

1. **Web App Manifest (`apps/web/public/manifest.webmanifest`):**
   ```json
   {
     "id": "/app/",
     "name": "Redirect — Link Manager",
     "short_name": "Redirect",
     "description": "Manage short links, QR codes, and click analytics.",
     "start_url": "/app/",
     "scope": "/app/",
     "display": "standalone",
     "background_color": "#0f172a",
     "theme_color": "#2563eb",
     "icons": [
       {
         "src": "/app/icon-192.png",
         "sizes": "192x192",
         "type": "image/png",
         "purpose": "any"
       },
       {
         "src": "/app/icon-512.png",
         "sizes": "512x512",
         "type": "image/png",
         "purpose": "any"
       },
       {
         "src": "/app/icon-512.png",
         "sizes": "512x512",
         "type": "image/png",
         "purpose": "maskable"
       },
       {
         "src": "/app/icon-192.svg",
         "sizes": "192x192",
         "type": "image/svg+xml",
         "purpose": "any"
       }
     ],
     "share_target": {
       "action": "/app/share",
       "method": "GET",
       "enctype": "application/x-www-form-urlencoded",
       "params": {
         "title": "title",
         "text": "text",
         "url": "url"
       }
     }
   }
   ```
   *(Note: Chromium PWA installability requires at least one 192x192 and 512x512 PNG. `apple-touch-icon.png` is provided in `public/` and linked in `index.html` for iOS homescreen).*

2. **Service Worker (`apps/web/public/sw.js` & Registration in `src/main.tsx`):**
   - **Registration (`src/main.tsx`):**
     ```ts
     if ("serviceWorker" in navigator && import.meta.env.PROD) {
       window.addEventListener("load", () => {
         navigator.serviceWorker
           .register("/app/sw.js", { scope: "/app/" })
           .catch(() => {});
       });
     }
     ```
   - **Worker Implementation (`public/sw.js`, Decisions F2 & F11):**
     - Versioned cache name: `const CACHE_NAME = "redirect-app-v1";`.
     - `install` lifecycle event: precache `/app/index.html` and call `self.skipWaiting()`.
     - `activate` lifecycle event: clean up any older cache keys and call `self.clients.claim()`.
     - `fetch` lifecycle event:
       - Scope check: only handle `GET` requests whose pathname starts with `"/app/"`. Bypass everything else (never intercept `/api/*` or root `/:slug`).
       - For `/app/assets/*` (hashed immutable Vite bundles): cache-first with network fallback.
       - For navigation requests under `/app/*`:
         - Network-first: attempt `fetch(event.request)`.
         - If the response is an opaque redirect (`response.type === "opaqueredirect"`), redirected (`response.redirected`), or non-200 (`response.status !== 200`): **pass it directly through to the browser** (do NOT cache it, and do NOT fall back to cached `/app/index.html`, ensuring expired Cloudflare Access sessions can navigate to the login screen).
         - If `response.status === 200`: clone response, store in cache for `/app/index.html`, and return.
         - Only when network `fetch` throws (offline error) fall back to `caches.match("/app/index.html")`.
   - **Worker Asset Caching Header (`apps/api/src/routes/app.ts`):**
     - For requests under `/app/assets/*`, append `Cache-Control: public, max-age=31536000, immutable`.

3. **Share Payload Extractor (`src/utils/share.ts`) & Page (`src/pages/ShareTargetPage.tsx`):**
   - `extractSharedPayload(searchParams: URLSearchParams): { targetUrl: string; title: string }`:
     - Reads `rawUrl = searchParams.get("url")?.trim()`, `rawText = searchParams.get("text")?.trim()`, `rawTitle = searchParams.get("title")?.trim()`.
     - If `rawUrl` starts with `http://` or `https://`, use it as `targetUrl`.
     - Else if `rawText` contains an `https?://[^\s<>"]+` match, extract that match as `targetUrl` (stripping trailing punctuation like `.`, `,`, `)`), and if `rawTitle` is empty, use any remaining text in `rawText` as `title`.
     - Else set `targetUrl = rawUrl || rawText || ""`.
   - `ShareTargetPage.tsx` (`/app/share`):
     - Preserves URL query parameters across `AuthGate` if arriving unauthenticated.
     - Pre-populates `targetUrl` and `title` from `extractSharedPayload`.
     - Deduplication check: before creating, queries `listLinks({ search: targetUrl })` and checks for an exact target match. If found, shows existing link immediately with a notification.
     - Lets the user tap **"Shorten Now"** (6-char random Base62 slug) or customize slug/tags/expiry.
     - Once created: displays the short link prominently with an explicit **"Copy Short Link"** button (never auto-copies on load without user gesture), **"Share Short Link"** (`navigator.share` fallback), QR preview, and **"Go to Dashboard"** button.
   - **iOS Workflow Note:**
     - Web Share Target is supported on Android and ChromeOS, but unsupported by Safari on iOS. For iOS devices, users can install an Apple Shortcut calling `POST /api/v1/links` with a Bearer token from Settings.

**Verify Phase F6:**
- `pnpm --filter @redirect/web build` outputs `dist/app/manifest.webmanifest` and `dist/app/sw.js`.

---

### Phase F7 — Token Management & Security Settings View

Implement `src/pages/SettingsPage.tsx` for managing KV API tokens.

1. **Current Session Card (shadcn `<Card>`):**
   - Shows the authenticated principal from `AuthContext` (`principal.name`, `principal.kind`: `"Initial recovery token"`, `"Named API token"`, or `"Environment API_KEY secret"`).
   - Includes a **"Sign Out / Lock Device"** button.

2. **Tokens List (`GET /api/v1/tokens`):**
   - Table/list of tokens rendered with shadcn `<Card>` or table styles:
     - `name` + shadcn `Badge` (`Initial Token` if `isInitial: true`).
     - Masked `preview` in monospace (`rdir_ab12...cd34`).
     - `createdAt` and `expiresAt` (`"Never"` or formatted date / `"Expired"` badge).
     - Actions:
       - For `id === "initial"`: **"Rotate Initial Token"** button (`POST /api/v1/tokens/initial/rotate`, confirms via shadcn `AlertDialog`).
       - For regular tokens: **"Revoke"** button (`DELETE /api/v1/tokens/:id`, confirms via shadcn `AlertDialog`).
       - **Active Token Self-Revocation Warning:** If the token being revoked matches the currently active token in `localStorage`, the `AlertDialog` displays a clear warning: *"Warning: Revoking this token will immediately log out your current session."*

3. **Create Token Modal / Form (`POST /api/v1/tokens`):**
   - Modal dialog using shadcn `Dialog`:
     - Inputs: `name` (required, 1–64 chars, e.g., `"iPhone Shortcut"`, `"Laptop CLI"`) and optional `expiresAt` date picker.
   - On `201 Created`:
     - Display a prominent modal containing the full `token` string with a **"Copy Token & Continue"** button and notice: *"Copy this token now. For security, the API only returns the full token once at creation time (it remains viewable in your Cloudflare KV dashboard)."*

4. **Rotate Initial Token Flow:**
   - Confirmation dialog using shadcn `AlertDialog` explaining that rotating invalidates the previous `initial_token`.
   - On confirm (`POST /api/v1/tokens/initial/rotate`):
     - Display the new initial token in a modal with an explicit **"Copy Token & Continue"** button.
     - If `principal.kind === "initial"`, call `updateActiveToken(res.token)` in `AuthContext` so the current browser session transitions to the new token without interruption.
     - If the backend returns `409 mechanism_disabled` (because `API_KEY` secret is set), display the message clearly.

5. **Eventual Consistency Notice:**
   - Include a subtle info note on the page: *"Tokens are stored in Cloudflare Workers KV. Creation, rotation, and revocation may take up to 60 seconds to propagate across all global edge locations."*

**Verify Phase F7:**
- `pnpm --filter @redirect/web typecheck` passes.

---

### Phase F8 — Frontend Unit Tests & Full-Stack Verification

Write automated tests in `apps/web/test/` and run the full monorepo test suite.

1. **Test Environment & Setup (`apps/web/vitest.config.ts` & `apps/web/test/setup.ts`):**
   - Configure Vitest with `environment: "jsdom"` and `setupFiles: ["./test/setup.ts"]`.
   - In `apps/web/test/setup.ts`:
     - Mock `ResizeObserver` (required by Radix UI dialogs):
       ```ts
       global.ResizeObserver = class {
         observe() {}
         unobserve() {}
         disconnect() {}
       };
       ```
     - Mock `window.matchMedia` and `Element.prototype.scrollIntoView`.

2. **Test Suites (`apps/web/test/`):**
   - `share.test.ts`:
     - Extracts `url` when provided directly in query string;
     - Extracts embedded `https://...` URL from `text` when mobile apps share `"Check this: https://example.com/post?id=1"` with no `url` param;
     - Preserves `title` or falls back to remaining text;
     - Handles empty or malformed share params gracefully.
   - `stats.test.ts`:
     - `zeroFillDailySeries` fills missing days with `0` in ascending UTC order;
     - Handles month boundaries and single-day ranges;
     - `formatUtcDay` formats dates strictly in UTC (e.g. `2026-10-25` evaluates to Oct 25 regardless of local timezone offset);
     - `formatCountryName` maps `"XX"` to `"Unknown / Unspecified"` and ISO codes to readable names.
   - `client.test.ts`:
     - Attaches `Authorization: Bearer <token>` from `localStorage`;
     - Sets `redirect: "manual"` on fetch calls;
     - Throws `ApiClientError` on JSON `4xx`/`5xx` responses with parsed code/message;
     - Throws `AccessSessionExpiredError` (and preserves `localStorage` token) on opaque redirects, CORS `TypeError`, or HTML responses on status < 500.
   - `components.test.tsx`:
     - `LinkFormModal` validates slugs (`api`, `app` rejected; `Docs` vs `docs` preserved; invalid characters rejected) and self-referencing target URLs;
     - `LinkFormModal` in edit mode displays the mutable slug rename warning when `slug` is changed, and caching warnings for `301`/`308`;
     - `LinkFormModal` correctly converts local `<input type="datetime-local">` values to UTC ISO-8601 strings;
     - `LinkRow` displays primary buttons (Copy, Stats), renders mobile dropdown for secondary actions, and triggers the delete `AlertDialog`.

3. **Full Monorepo Verification:**
   - Run `pnpm build` (builds `@redirect/web` and `@redirect/api`).
   - Run `node apps/api/scripts/verify-dist.mjs` (verifies distribution layout).
   - Run `pnpm typecheck` across all workspace packages.
   - Run `pnpm test` (runs both `@redirect/api` workerd tests and `@redirect/web` Vitest suites).

---

## 5. Frontend Definition of Done

From `/home/azraftaohid/codes/redirect/`:

- [ ] `pnpm build` succeeds and `node apps/api/scripts/verify-dist.mjs` passes, verifying:
  - `apps/web/dist/app/index.html` exists and contains no inline `<script>`.
  - `apps/web/dist/app/assets/*` exists.
  - `apps/web/dist/app/manifest.webmanifest` exists and declares PNG and SVG icons.
  - `apps/web/dist/app/sw.js` exists.
  - `apps/web/dist/404.html` exists.
  - No `apps/web/dist/index.html` or `apps/web/dist/assets/` exists at the root of `dist`.
- [ ] `pnpm typecheck` passes across `packages/shared`, `apps/web`, and `apps/api` with zero errors.
- [ ] `pnpm test` passes all backend workerd suites (`apps/api/test/*.test.ts`) and all frontend suites (`apps/web/test/*.test.ts`).
- [ ] `index.html` links `/app/manifest.webmanifest` with `crossorigin="use-credentials"`.
- [ ] Service worker is registered at `/app/sw.js` with `{ scope: "/app/" }`, precaches `/app/index.html` on install, and passes through opaque redirects and non-200 responses to avoid trapping expired Access sessions.
- [ ] Worker serves `/app/assets/*` with `Cache-Control: public, max-age=31536000, immutable`.
- [ ] All assets, styles, and QR generation work under the Worker's strict `Content-Security-Policy` without console CSP violations.
- [ ] Opening `/app/` while unauthenticated triggers a background `/api/v1/auth/verify` ping so `initial_token` is lazily created in KV on first visit.
- [ ] Links can be created, searched, filtered by tag/status, sorted, toggled active/inactive, edited (including renaming `slug` and clearing `expiresAt`), shared via QR code, and deleted.
- [ ] Link statistics zero-fill missing days, format dates strictly in UTC, and render `country` / `referrer` breakdowns only when enabled by the backend.
