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

### Frontend Decisions (`F1`–`F10`)

| # | Decision |
| :-- | :-- |
| F1 | **Subpath isolation under `/app/`.** Vite builds with `base: "/app/"` and `build.outDir: "dist/app"`, producing `apps/web/dist/app/index.html` and `apps/web/dist/app/assets/*`. A standalone `404.html` is emitted to `apps/web/dist/404.html`. No root `/index.html` or root `/assets/*` directory may exist. |
| F2 | **Strict `/app/` Service Worker scope.** The service worker MUST be served from `/app/sw.js` and registered with `{ scope: "/app/" }`. Never register a root-scoped service worker, as it would intercept short links (`/:slug`). |
| F3 | **Zero Trust-compatible Web App Manifest.** Link the manifest with `<link rel="manifest" href="/app/manifest.webmanifest" crossorigin="use-credentials">` so PWA installation works when `/app/*` is gated by Cloudflare Access. |
| F4 | **Strict CSP compliance.** All `/app/*` responses carry `Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'`. Do not load external scripts, external icon/font CDNs, or use inline `<script>` tags. |
| F5 | **Single source of truth via `@redirect/shared`.** Import constants, Zod schemas, `validateSlug`, `validateTargetUrl`, and TypeScript interfaces (`LinkRecord`, `LinkStats`, `TokenInfo`, `Paginated<T>`, `ApiErrorBody`) directly from `@redirect/shared`. Do not duplicate validation regexes or types. |
| F6 | **Token persistence & lazy bootstrap.** Store the bearer token in `localStorage` (`redirect_auth_token`). When `/app/` loads without a stored token, fire one background `GET /api/v1/auth/verify` (ignoring the expected `401`) so the Worker lazily generates `initial_token` in KV on first visit. |
| F7 | **Zero Trust expired-session detection.** If any `/api/v1/*` request returns `res.redirected === true` or a non-JSON `Content-Type` (e.g. `text/html` from a Cloudflare Access login redirect), do **not** wipe the stored token; surface a session-expired prompt that reloads the page to re-authenticate with Access. |
| F8 | **Client-side analytics zero-filling & dynamic dimensions.** Zero-fill missing UTC days in `LinkStats.daily` on the client. Render `country` and `referrer` breakdown sections **only** when those keys exist on `LinkStats.dimensions`. |
| F9 | **Client-side QR generation.** Generate QR codes locally in the browser as `<svg>` / `data:image/png` (no third-party QR API requests). |
| F10 | **UI component architecture & minimal charting footprint.** Build with React + TypeScript + Vite + Tailwind CSS + shadcn/ui components (Radix UI primitives, Lucide icons, Sonner toast). For link analytics, render the daily clicks time-series chart with a lightweight, self-contained SVG component rather than pulling in heavy charting libraries (e.g. Recharts). |

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
├── packages/shared/                   # ✅ completed
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts
│       ├── constants.ts
│       ├── schemas.ts                 # zod schemas + inferred types
│       └── validation.ts              # slug / target URL validators
└── apps/
    ├── api/                           # ✅ completed
    │   ├── package.json
    │   ├── tsconfig.json
    │   ├── vitest.config.ts
    │   ├── wrangler.jsonc
    │   ├── worker-configuration.d.ts
    │   ├── .dev.vars.example
    │   ├── migrations/0001_initial.sql
    │   ├── scripts/ensure-assets.mjs
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
    │   │       ├── slug.ts            # Base62 generation
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
        │   ├── icon-192.svg           # PWA & header icon
        │   └── icon-512.svg
        ├── src/
        │   ├── main.tsx               # React root + SW registration
        │   ├── App.tsx                # AuthGate wrapper + route switch + layout shell
        │   ├── router.tsx             # Lightweight history router scoped to /app
        │   ├── lib/
        │   │   └── utils.ts           # cn helper (clsx + tailwind-merge)
        │   ├── styles/
        │   │   └── globals.css        # Tailwind CSS + shadcn theme variables (dark/light)
        │   ├── api/
        │   │   └── client.ts          # Typed API client + Access redirect detection
        │   ├── context/
        │   │   └── AuthContext.tsx    # Token state, verify, login, logout, bootstrap ping
        │   ├── utils/
        │   │   ├── stats.ts           # zeroFillDailySeries, date/region formatters
        │   │   ├── share.ts           # extractSharedPayload for Web Share Target
        │   │   └── qr.ts              # Client-side SVG/Canvas QR generator
        │   ├── components/
        │   │   ├── ui/                # shadcn/ui components (Radix primitives)
        │   │   │   ├── button.tsx
        │   │   │   ├── input.tsx
        │   │   │   ├── label.tsx
        │   │   │   ├── dialog.tsx
        │   │   │   ├── alert-dialog.tsx
        │   │   │   ├── card.tsx
        │   │   │   ├── badge.tsx
        │   │   │   ├── switch.tsx
        │   │   │   ├── dropdown-menu.tsx
        │   │   │   ├── select.tsx
        │   │   │   └── sonner.tsx
        │   │   ├── Layout.tsx         # Navigation bar, principal indicator, mobile nav
        │   │   ├── AuthGate.tsx       # Unlock screen + first-run KV recovery guide
        │   │   ├── AccessExpiredBanner.tsx
        │   │   ├── LinkFormModal.tsx  # Create & Edit (with mutable slug & status warnings)
        │   │   ├── QrCodeModal.tsx    # SVG preview + PNG/SVG download + copy
        │   │   └── DailyChart.tsx     # Lean SVG time-series chart (no Recharts)
        │   └── pages/
        │       ├── DashboardPage.tsx  # Quick shorten, search/tag/sort toolbar, links list
        │       ├── LinkStatsPage.tsx  # Daily SVG chart + conditional dimension breakdowns
        │       ├── ShareTargetPage.tsx# /app/share one-tap mobile shortening flow
        │       └── SettingsPage.tsx   # Token management, initial token rotation, revoke
        └── test/
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

1. **`apps/web/package.json`:**
   - Dependencies: `react`, `react-dom`, `@redirect/shared` (`workspace:*`), `lucide-react`, `clsx`, `tailwind-merge`, `class-variance-authority`, `@radix-ui/react-dialog`, `@radix-ui/react-alert-dialog`, `@radix-ui/react-dropdown-menu`, `@radix-ui/react-select`, `@radix-ui/react-switch`, `@radix-ui/react-label`, `sonner`, `qrcode`.
   - DevDependencies: `typescript`, `vite`, `@vitejs/plugin-react`, `tailwindcss`, `@tailwindcss/vite` (or Tailwind PostCSS), `@types/react`, `@types/react-dom`, `@types/qrcode`, `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`.
   - Scripts:
     - `"dev": "vite"`
     - `"build": "tsc --noEmit && vite build"`
     - `"typecheck": "tsc --noEmit"`
     - `"test": "vitest run"`

2. **`apps/web/tsconfig.json` & Path Aliases:**
   - Extend `../../tsconfig.base.json`.
   - Set `"jsx": "react-jsx"`, `"lib": ["ES2022", "DOM", "DOM.Iterable"]`.
   - Configure `"baseUrl": "."` and `"paths": { "@/*": ["./src/*"] }` for shadcn UI import compatibility.

3. **`apps/web/vite.config.ts`:**
   - Set `base: "/app/"`.
   - Set `build.outDir: "dist/app"` and `build.emptyOutDir: true`.
   - Configure path alias: `resolve: { alias: { "@": path.resolve(__dirname, "./src") } }`.
   - Configure `server`:
     - `port: 5173`
     - `proxy: { "/api": { target: "http://127.0.0.1:8787", changeOrigin: false } }`
   - Add a small Vite `closeBundle` plugin hook in `vite.config.ts` that copies `apps/web/404.html` to `apps/web/dist/404.html` on every build so the root 404 asset is always present alongside `dist/app/`.

4. **Standalone `apps/web/404.html`:**
   - Self-contained HTML + inline CSS (no external JS/CSS dependencies so it works for any invalid root `/:slug` path without extra asset requests).
   - Clean dark/light adaptive layout displaying `"404 Not Found — The requested short link does not exist, has expired, or has been disabled."`

5. **`apps/web/index.html`:**
   - Title: `Redirect — Link Manager`.
   - Viewport meta, theme-color meta, icon link (`/app/icon-192.svg`).
   - Manifest link with credentials:
     `<link rel="manifest" href="/app/manifest.webmanifest" crossorigin="use-credentials" />` (Decision F3).
   - `<div id="root"></div>` and `<script type="module" src="/src/main.tsx"></script>`.

6. **Root `package.json` & `apps/api/package.json` script updates:**
   - In root `package.json`:
     - `"build": "pnpm --filter @redirect/shared build && pnpm --filter @redirect/web build && pnpm --filter @redirect/api build"`
     - `"test": "pnpm --filter @redirect/api test && pnpm --filter @redirect/web test"`
     - `"deploy": "pnpm --filter @redirect/web build && pnpm --filter @redirect/api deploy"`

**Verify Phase F1:**
- `pnpm install` succeeds.
- `pnpm --filter @redirect/web build` succeeds and produces `apps/web/dist/app/index.html`, `apps/web/dist/app/assets/*`, and `apps/web/dist/404.html`.
- `pnpm --filter @redirect/api test` still passes (specifically `dispatch.test.ts` checking `<title>Redirect` and security headers).
  - *Note:* Keep `<title>Redirect App</title>` in `apps/web/index.html` (or update `dispatch.test.ts` if changed) so `dispatch.test.ts` assertions remain in sync!

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
     - Thrown when a `fetch("/api/v1/...")` call detects an expired Cloudflare Zero Trust Access session:
       - `response.redirected === true` (and `new URL(response.url).pathname !== expectedPathname`), OR
       - `response.type === "opaqueredirect"`, OR
       - `!(response.headers.get("content-type") ?? "").includes("application/json")` on a `/api/v1/*` endpoint.
     - **Important (Decision F7):** Never call `clearStoredToken()` when `AccessSessionExpiredError` occurs.

3. **Typed API Methods (`src/api/client.ts`):**
   - All requests set `Accept: "application/json"`, `credentials: "same-origin"`, and `Authorization: Bearer ${token}` (when a token is available or passed explicitly).
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
   - On mount:
     - If `getStoredToken()` exists: call `verifyAuth()`.
       - On `200`: set `status = "authenticated"` and `principal`.
       - On `401`: call `clearStoredToken()`, set `status = "unauthenticated"`.
       - On `AccessSessionExpiredError`: keep token, set `accessExpired = true`.
     - If no stored token exists: set `status = "unauthenticated"` and fire `bootstrapInitialTokenPing()` once in the background (Decision F6).
   - `login(rawToken: string)`: trims input, calls `verifyAuth(rawToken)`, and on success stores the token in `localStorage` and transitions to `"authenticated"`.
   - `updateActiveToken(newToken: string)`: updates `localStorage` in-place (used when rotating `initial_token` while logged in as `initial`).
   - `logout()`: clears `localStorage` and resets state to `"unauthenticated"`.
   - **`AuthGate.tsx` UI:**
     - Clean password/token input with show/hide toggle and "Unlock" submit button.
     - Collapsible **"Where do I find my token?"** section explaining:
       1. Production: Cloudflare Dashboard → **Storage & Databases** → **KV** → `AUTH_TOKENS` → key `initial_token`.
       2. Local dev: `pnpm --filter @redirect/api exec wrangler kv key get initial_token --binding AUTH_TOKENS --local`.
       3. Recovery: deleting `initial_token` in KV regenerates it automatically on the next visit.

**Verify Phase F2:**
- `pnpm --filter @redirect/web typecheck` passes.

---

### Phase F3 — App Shell, History Router & Design System

Build a responsive, accessible UI shell scoped under `/app/` using Tailwind CSS and shadcn/ui.

1. **History Router (`src/router.tsx`):**
   - Implement a clean, dependency-free History API router (or React Router) operating relative to base `/app`:
     - `/app/` (or `/app`) → `DashboardPage`
     - `/app/links/:id` → `LinkStatsPage`
     - `/app/share` → `ShareTargetPage`
     - `/app/settings` → `SettingsPage`
   - Intercept internal navigation links, push state with `window.history.pushState`, and listen to `popstate`.
   - Preserve query parameters (`window.location.search`) so `/app/share?url=...` and dashboard filter URLs work seamlessly.

2. **Design System & Styling (`src/lib/utils.ts` & `src/styles/globals.css`):**
   - Implement `cn(...inputs)` utility in `src/lib/utils.ts` combining `clsx` and `tailwind-merge`.
   - Configure Tailwind CSS and shadcn CSS variables in `src/styles/globals.css` (`--background`, `--foreground`, `--card`, `--primary`, `--muted`, `--border`, `--radius`) supporting automatic dark/light mode via `@media (prefers-color-scheme: dark)` and `color-scheme: light dark`.
   - System font stack (`system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`) and monospace font stack (`ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`) for slugs, URLs, and tokens — zero external font requests (Decision F4).
   - Responsive layout:
     - Desktop: sticky top navigation bar (`Links`, `Tokens & Settings`, active principal badge, `Lock / Sign out`), max-width container (`1100px`).
     - Mobile: compact header + touch-friendly controls (minimum `44px` tap targets) for effortless mobile use.

3. **Core shadcn/ui Primitives (`src/components/ui/`):**
   - Add core shadcn primitives: `button.tsx`, `input.tsx`, `label.tsx`, `dialog.tsx`, `alert-dialog.tsx`, `card.tsx`, `badge.tsx`, `switch.tsx`, `dropdown-menu.tsx`, `select.tsx`, `sonner.tsx`.
   - Setup `<Toaster />` from `sonner` at the root layout for non-blocking feedback (`"Short link copied to clipboard"`, `"Link updated"`).
   - `AccessExpiredBanner.tsx`: banner shown when `accessExpired` is true, offering a one-click `"Reload & Re-authenticate"` button (`window.location.reload()`).

**Verify Phase F3:**
- `pnpm --filter @redirect/web typecheck` passes.

---

### Phase F4 — Links Dashboard: Create, Edit, Rename, Filter & QR Code

Implement the primary link management workflow in `src/pages/DashboardPage.tsx`, `src/components/LinkFormModal.tsx`, and `src/components/QrCodeModal.tsx`.

1. **Quick Shorten Bar (Top of Dashboard):**
   - Single-line form on desktop (stacked on mobile): `Target URL` input + optional `Custom slug` input + `"Shorten"` button + `"More options…"` button (which opens `LinkFormModal` pre-filled with the current inputs).
   - Validates `targetUrl` with `validateTargetUrl(url, [window.location.hostname])` and `slug` (if non-empty) with `validateSlug(slug)` from `@redirect/shared`.
   - On creation (`POST /api/v1/links`):
     - Automatically copies the new short URL (`${window.location.origin}/${created.slug}`) to the clipboard (with toast notification), prepends/refreshes the link list, and shows a quick action to view its QR code.

2. **Full Create / Edit Modal (`src/components/LinkFormModal.tsx`):**
   - Supports both **Create** (`POST /api/v1/links`) and **Edit** (`PATCH /api/v1/links/:id`).
   - Fields:
     - `targetUrl` (required, validated against `validateTargetUrl(val, [window.location.hostname])`).
     - `slug` (optional on create — blank auto-generates 6-char Base62; required on edit).
       - Includes a `"Generate random"` helper button on create/edit.
       - **Case-sensitive hint:** `"Case-sensitive (e.g. Docs and docs are distinct)."`.
       - **Mutable slug warning on Edit:** When `slug !== originalLink.slug`, display an inline warning alert: `"Renaming the slug frees '/<oldSlug>' immediately. The old link will return 404 (no redirect alias is kept). Click statistics will be preserved."`
     - `title` (optional, max `MAX_TITLE_LENGTH` = 200 chars).
     - `tags` (comma/Enter-separated chip input; normalized trimmed lowercase, max `MAX_TAGS` = 10 tags, each ≤ `MAX_TAG_LENGTH` = 32 chars).
     - `statusCode` select:
       - `307 — Temporary Redirect (Default, preserves method)`
       - `302 — Found (Temporary)`
       - `308 — Permanent Redirect (Preserves method)`
       - `301 — Moved Permanently`
       - **Caching warning:** When `301` or `308` is selected, display an inline note: `"Browsers cache permanent redirects (max-age=3600). Repeat clicks from the same browser will not be counted in analytics, and target changes propagate slowly."`
     - `forwardQuery` checkbox (default `true`: `"Forward incoming query parameters to target URL"`).
     - `isActive` checkbox (default `true`: `"Link is active and resolves redirects"`).
     - `expiresAt` (`<input type="datetime-local">` + `"Clear expiry"` button). Converts local input to UTC ISO-8601 string (`new Date(localVal).toISOString()`), or sends `null` on edit when cleared.
   - Error handling:
     - `409 slug_taken`: highlight the `slug` input with `"This slug is already in use."`
     - `400 invalid_target_url` / `invalid_slug` / `invalid_expiry` / `validation_error`: display the server message inline.

3. **Search, Filter & Sort Toolbar (`src/pages/DashboardPage.tsx`):**
   - Search input (`300ms` debounce) → `search` query param.
   - Active Tag filter badge (with `"× Clear"` button) + dropdown/suggestions from visible tags → `tag` query param.
   - Status filter segmented control: `All` (`undefined`), `Active` (`"true"`), `Disabled` (`"false"`).
   - Sort selector:
     - Newest first (`sortBy=createdAt`, `sortOrder=desc`)
     - Oldest first (`sortBy=createdAt`, `sortOrder=asc`)
     - Most clicked (`sortBy=clickCount`, `sortOrder=desc`)
     - Recently updated (`sortBy=updatedAt`, `sortOrder=desc`)
     - Slug A–Z (`sortBy=slug`, `sortOrder=asc`)

4. **Links List & Row Actions:**
   - Each link card/row displays:
     - Short URL (`/${link.slug}`) in bold monospace + **Copy** button + external test link (`href="/${link.slug}" target="_blank" rel="noopener noreferrer"`).
     - Title (if set) and `targetUrl`.
     - Status badges:
       - `Disabled` if `!link.isActive`
       - `Expired` if `link.expiresAt && new Date(link.expiresAt) <= new Date()`
       - `Expires <date>` if `link.expiresAt` is in the future
       - Status code pill (`307`, `301`, `302`, `308`)
       - Tag chips (clicking a tag filters the list by that tag)
     - Metrics summary: **`<N> clicks`** (links to `/app/links/${link.id}`) and `Last clicked <relative time>`.
     - Action buttons:
       - **Copy** short URL
       - **QR** (opens `QrCodeModal` with shadcn `Dialog`)
       - **Stats** (navigates to `/app/links/${link.id}`)
       - **Edit** (opens `LinkFormModal` in edit mode)
       - **Enable / Disable** quick toggle (shadcn `Switch` calling `PATCH /api/v1/links/:id` with `{ isActive: !link.isActive }`)
       - **Delete** (opens shadcn `AlertDialog` → `DELETE /api/v1/links/:id`)
   - Layout: On desktop, render a clear table with status badges and action buttons; on mobile screens, render responsive shadcn `<Card>` components.
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

1. **Zero-Fill Utility (`src/utils/stats.ts`):**
   - `zeroFillDailySeries(daily: Array<{ day: string; clicks: number }>, from: string, to: string): Array<{ day: string; clicks: number }>`
   - Iterates day-by-day in UTC from `from` (`YYYY-MM-DD`) to `to` (`YYYY-MM-DD`) inclusive using `Date.UTC`, looking up the click count from a `Map` of `daily` rows and defaulting missing days to `0`.
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
     - Responsive inline `<svg>` bar/column chart plotting the zero-filled daily series (custom lightweight SVG component avoiding bulky charting libraries like Recharts to preserve bundle size under 100 KB gzipped).
     - Horizontal gridlines, Y-axis scale labels, X-axis date ticks, and accessible `<title>` / hover tooltip showing `YYYY-MM-DD: N clicks`.
   - **Conditional Dimension Breakdowns (Decision F8):**
     - Check `stats.dimensions?.country` and `stats.dimensions?.referrer`.
     - If `stats.dimensions?.country` is defined: render **Top Countries** card (list of top 10 values with horizontal proportion bars and click counts, or `"No country data in this period"` if empty array).
     - If `stats.dimensions?.referrer` is defined: render **Top Referrers** card (list of top 10 hostnames / `(direct)` with proportion bars and click counts).
     - If neither is defined in `stats.dimensions`, do not render the breakdown section (optionally show a subtle footer note that `country` and `referrer` dimensions can be enabled via `ANALYTICS_DIMENSIONS` in `wrangler.jsonc`).

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
         "src": "/app/icon-192.svg",
         "sizes": "192x192",
         "type": "image/svg+xml",
         "purpose": "any maskable"
       },
       {
         "src": "/app/icon-512.svg",
         "sizes": "512x512",
         "type": "image/svg+xml",
         "purpose": "any maskable"
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
   - **Worker rules (`public/sw.js`, Decision F2):**
     - Only handle `GET` requests whose `new URL(event.request.url).pathname` starts with `"/app/"`. Ignore everything else (especially `/api/*` and root `/:slug`).
     - For `/app/assets/*` (hashed immutable bundles): cache-first with network fallback.
     - For navigation requests under `/app/*`: network-first, falling back to cached `/app/index.html` only when offline (and never caching redirects to Cloudflare Access login pages: check `!response.redirected && response.status === 200`).

3. **Share Payload Extractor (`src/utils/share.ts`) & Page (`src/pages/ShareTargetPage.tsx`):**
   - `extractSharedPayload(searchParams: URLSearchParams): { targetUrl: string; title: string }`:
     - Reads `rawUrl = searchParams.get("url")?.trim()`, `rawText = searchParams.get("text")?.trim()`, `rawTitle = searchParams.get("title")?.trim()`.
     - If `rawUrl` starts with `http://` or `https://`, use it as `targetUrl`.
     - Else if `rawText` contains an `https?://[^\s<>"]+` match, extract that match as `targetUrl` (stripping trailing punctuation like `.`, `,`, `)`), and if `rawTitle` is empty, use any remaining text in `rawText` as `title`.
     - Else set `targetUrl = rawUrl || rawText || ""`.
   - `ShareTargetPage.tsx` (`/app/share`):
     - Pre-populates `targetUrl` and `title` from `extractSharedPayload(new URLSearchParams(window.location.search))`.
     - Lets the user either tap **"Shorten Now"** (one tap with default 6-char random slug) or customize the slug/tags/expiry before saving.
     - Once created, displays the short URL in large text, auto-copies it to the clipboard, renders its QR code immediately, and provides `"Share Short Link"` (`navigator.share` if available) and `"Go to Dashboard"` buttons.

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

3. **Create Token Modal / Form (`POST /api/v1/tokens`):**
   - Modal dialog using shadcn `Dialog`:
     - Inputs: `name` (required, 1–64 chars, e.g., `"iPhone Shortcut"`, `"Laptop CLI"`) and optional `expiresAt` date picker.
   - On `201 Created`:
     - Display a prominent success banner containing the full `token` string with a **"Copy Token"** button and a notice: *"Copy this token now. For security, the API only returns the full token at creation time (it remains viewable in your Cloudflare KV dashboard)."*

4. **Rotate Initial Token Flow:**
   - Confirmation dialog using shadcn `AlertDialog` explaining that rotating invalidates the previous `initial_token`.
   - On confirm (`POST /api/v1/tokens/initial/rotate`):
     - Display the new initial token in the one-time reveal banner.
     - If `principal.kind === "initial"`, automatically call `updateActiveToken(res.token)` in `AuthContext` so the current browser session stays authenticated with the new initial token!
     - If the backend returns `409 mechanism_disabled` (because `API_KEY` secret is set), display the message clearly.

5. **Eventual Consistency Notice:**
   - Include a subtle info note on the page: *"Tokens are stored in Cloudflare Workers KV. Creation, rotation, and revocation may take up to 60 seconds to propagate across all global edge locations."*

**Verify Phase F7:**
- `pnpm --filter @redirect/web typecheck` passes.

---

### Phase F8 — Frontend Unit Tests & Full-Stack Verification

Write automated tests in `apps/web/test/` and run the full monorepo test suite.

1. **`apps/web/vitest.config.ts`:**
   - Configure Vitest with `environment: "jsdom"`.

2. **Test Suites (`apps/web/test/`):**
   - `share.test.ts`:
     - extracts `url` when provided directly;
     - extracts embedded `https://...` URL from `text` when mobile apps share `"Read this article: https://example.com/post?id=1!"` with no `url` param;
     - preserves `title` or falls back to remaining text;
     - handles empty or malformed share params gracefully.
   - `stats.test.ts`:
     - `zeroFillDailySeries` fills missing days with `0` in ascending UTC order;
     - handles month boundaries (e.g. Jan 28 → Feb 3) and single-day ranges (`days = 1`);
     - preserves existing click counts on matching days;
     - `formatCountryName` maps `"XX"` to `"Unknown / Unspecified"` and valid ISO codes (`"US"`, `"BD"`) to readable names.
   - `client.test.ts`:
     - attaches `Authorization: Bearer <token>` from `localStorage`;
     - throws `ApiClientError` with parsed `code`, `message`, and `details` on JSON `4xx`/`5xx` responses;
     - throws `AccessSessionExpiredError` (and does **not** clear `localStorage`) when a `/api/v1/*` call is redirected (`redirected: true`) or returns `text/html` (simulating Cloudflare Access login redirect).
   - `components.test.tsx`:
     - `LinkFormModal` validates slugs (`api`, `app` rejected; `Docs` vs `docs` preserved; invalid chars rejected) and self-referencing target URLs (`https://redirect.example.com/x` rejected when hostname is `redirect.example.com`);
     - `LinkFormModal` in edit mode shows the slug-rename warning when the slug is modified and shows the permanent-redirect caching notice when `301` or `308` is selected;
     - `LinkStatsPage` (or breakdown component) renders `country` / `referrer` sections only when present in `stats.dimensions`.

3. **Full Monorepo Verification:**
   - Run `pnpm build` (builds `@redirect/shared`, `@redirect/web`, and `@redirect/api`).
   - Run `pnpm typecheck` across all workspace packages.
   - Run `pnpm test` (runs both `@redirect/api` workerd tests against the newly built `apps/web/dist` assets and `@redirect/web` Vitest suites).

---

## 5. Frontend Definition of Done

From `/home/azraftaohid/codes/redirect/`:

- [ ] `pnpm build` succeeds and generates:
  - `apps/web/dist/app/index.html`
  - `apps/web/dist/app/assets/*`
  - `apps/web/dist/app/manifest.webmanifest`
  - `apps/web/dist/app/sw.js`
  - `apps/web/dist/404.html`
  - No `apps/web/dist/index.html` or `apps/web/dist/assets/` at the root of `dist`.
- [ ] `pnpm typecheck` passes across `packages/shared`, `apps/web`, and `apps/api` with zero errors.
- [ ] `pnpm test` passes all backend workerd suites (`apps/api/test/*.test.ts`) and all frontend suites (`apps/web/test/*.test.ts`).
- [ ] `index.html` links `/app/manifest.webmanifest` with `crossorigin="use-credentials"`.
- [ ] Service worker is registered at `/app/sw.js` with `{ scope: "/app/" }` and never intercepts paths outside `/app/`.
- [ ] All assets, styles, and QR generation work under the Worker's strict `Content-Security-Policy` without console CSP violations.
- [ ] Opening `/app/` while unauthenticated triggers a background `/api/v1/auth/verify` ping so `initial_token` is lazily created in KV on first visit.
- [ ] Links can be created, searched, filtered by tag/status, sorted, toggled active/inactive, edited (including renaming `slug` and clearing `expiresAt`), shared via QR code, and deleted.
- [ ] Link statistics zero-fill missing days and render `country` / `referrer` breakdowns only when enabled by the backend.
