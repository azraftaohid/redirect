# Redirect — Implementation Plan

Specification for an LLM coding agent working on the **Redirect** platform in `/home/coder/project/redirect/`. The product concept is `/home/coder/notes/redirect-dev-notes/Concept.md`. If this plan and the concept disagree, the concept's intent wins — **except** where Phase R11 explicitly amends the concept. Report any other discrepancy instead of guessing.

The project is **pre-release**: data formats, KV layout, API shapes, and the D1 schema need no backward compatibility. Prefer the cleanest design over migration shims.

## How to Use This Plan

1. **Parts I, II, and III** are fully completed and verified (93 passing tests).
2. Toolchain: Node 20+ and the pnpm version pinned in root `package.json` (`packageManager`) must be on `PATH`. Do not hardcode machine-specific paths in code, scripts, or docs.
3. Never weaken an Authoritative Decision (§1) to make a test pass. If a decision blocks a correct fix, stop and report.
4. **Part IV (future feature backlog)** is for assessment and future implementation.

---

## Project Status Overview

| Part | Scope | Status |
| :--- | :--- | :--- |
| **Part I** | Monorepo, `@redirect/shared`, `@redirect/api` (Phases 1–9) | ✅ Completed — 49 workerd tests |
| **Part II** | `@redirect/web` SPA & PWA (Phases F1–F8) | ✅ Completed — 31 jsdom tests |
| **Part III** | Correctness, cost/latency, token storage redesign, cleanup (Phases R0–R12) | ✅ Completed — 93 tests (commits `22f0083`, `e3d2493`) |
| **Part IV** | Future feature backlog (Tiers A, B, C) | 🧭 Backlog for future assessment |

---

## 1. Authoritative Decisions (Do Not Deviate or "Improve")

### Backend & Platform (`D1`–`D12`)

| # | Decision |
| :-- | :-- |
| D1 | One Cloudflare Worker + Static Assets. `run_worker_first: true`; the Worker dispatches every request explicitly. |
| D2 | Assets config: `not_found_handling: "none"`, `html_handling: "none"`. Never use `single-page-application` mode. |
| D3 | Token auth is the only application-level auth. The Worker never reads or trusts Cloudflare Access headers/JWTs. |
| D4 | Tokens live in **KV** (`AUTH_TOKENS`) **in plain text** so the owner can read them in the Cloudflare dashboard. The owner must never be lockable out. (Key layout is redefined by **D13**.) |
| D5 | No caching layer in front of D1. No "edge-fast" optimizations (no read replicas, no KV/Cache API mirror of links). Hundreds of ms per redirect is acceptable. |
| D6 | Analytics = counters and daily rollups only. **No per-click event table. No IP, User-Agent, city or device storage.** |
| D7 | Slugs are **case-sensitive** and **mutable**. Links are identified by stable `id`; API routes use `/links/:id`. |
| D8 | Only `api` and `app` are reserved slugs (case-insensitive check). |
| D9 | No private-IP/SSRF blocking (the Worker never fetches targets). Validate protocol, length and self-reference only. |
| D10 | No CORS (same-origin). No CORS middleware, no `CORS_ORIGIN` variable. |
| D11 | Analytics failures never affect a redirect. A D1 lookup failure returns `503`, never `404`. |
| D12 | `PATCH` for partial updates. No `PUT`. |

### Frontend (`F1`–`F13`)

| # | Decision |
| :-- | :-- |
| F1 | Subpath isolation: Vite `base: "/app/"`, `build.outDir: "dist/app"`; standalone `dist/404.html`; no root `dist/index.html` or `dist/assets/`. |
| F2 | Service worker served from `/app/sw.js`, registered with `{ scope: "/app/" }`. Never root-scoped. |
| F3 | Manifest linked with `crossorigin="use-credentials"`; PNG icons 192/512 + `apple-touch-icon.png`. |
| F4 | Strict CSP on `/app/*` (exact value in **D17**). No external scripts/fonts/CDNs, no inline `<script>`. **Never `fetch()` a `data:` or `blob:` URL**: `connect-src` falls back to `'self'` and blocks it. |
| F5 | `@redirect/shared` is the single source of truth for constants, schemas, validators, slug/random generators and API types. Never duplicate validation regexes in the UI. |
| F6 | Token in `localStorage` (`redirect_auth_token`). With no stored token, `/app/` fires one background unauthenticated `GET /api/v1/auth/verify` to lazily bootstrap `initial_token`. |
| F7 | All API calls use `redirect: "manual"`. Opaque redirect / CORS `TypeError` while online / `text/html` on status < 500 → `AccessSessionExpiredError`. Never wipe the stored token for that error. |
| F8 | Zero-fill the daily series on the client **using the server-supplied `range.from`/`range.to`**. Render a dimension card iff its key exists in `dimensions`. |
| F9 | QR codes generated locally (SVG + canvas PNG). No third-party QR services. |
| F10 | React + TS + Vite + Tailwind + shadcn-style primitives (Radix Dialog/AlertDialog/DropdownMenu/Switch/Label, Sonner). `wouter` with `base="/app"`. Native `<select>`. Single-tree responsive rows. Self-contained SVG chart (no chart libraries). |
| F11 | SW: versioned cache name (see **D18**), precache `/app/index.html`, bypass `/app/sw.js`, external origins and non-GET. Navigations network-first; pass through opaque/redirected/non-200; fall back to cached shell only on network failure. `/app/assets/*` → `public, max-age=31536000, immutable`; `/app/sw.js`, `/app/index.html`, manifest, extensionless SPA routes → `no-cache`. |
| F12 | Datetime inputs use explicit local ↔ UTC ISO helpers. |
| F13 | 60 s KV propagation grace: persist `redirect_auth_token_set_at`; don't wipe a token on a 401 within 60 s of setting it. |

### Core Architecture & Operational Decisions (`D13`–`D20`)

| # | Decision |
| :-- | :-- |
| D13 | **Id-embedded tokens, one KV key per token.** Token format `rdir_<id>_<secret>`. Custom tokens: key `token:<id>`, value = full plaintext token, metadata `{ name, createdAt, expiresAt, preview }`. Initial token: key `initial_token` (unchanged name, dashboard-friendly), value = `rdir_initial_<secret>`. Auth, revoke and rotate are each a single KV operation. No secondary indexes, no duplicate keys. |
| D14 | **`API_KEY` accepts any non-empty string.** It is compared (constant-time, after trimming) **before** any token-format check. A format rule must never be able to lock the owner out. |
| D15 | **Minimum D1 round-trips, no redundant reads.** Use `db.batch()` for independent statements, `INSERT … ON CONFLICT(slug) DO NOTHING RETURNING *` for creates, `UPDATE … RETURNING *` for updates, and `DELETE` + `meta.changes` for deletes. No pre-flight `SELECT`s whose only purpose is existence/uniqueness checking. |
| D16 | **Every error path returns the JSON error envelope with the correct status.** Framework exceptions (e.g. Hono `HTTPException` for malformed JSON) are mapped, never surfaced as 500. |
| D17 | `/app/*` CSP: `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`. `/app/*` and `/api/*` responses also carry `X-Robots-Tag: noindex, nofollow`. |
| D18 | Service worker cache name embeds a **build id** injected at build time (`redirect-app-<buildId>`), so every deploy changes `sw.js` bytes, triggers an SW update, and purges stale hashed assets. |
| D19 | **Client reads are minimal.** Mutations patch local state from the server's response instead of refetching lists; a page needs at most one API call per user action (plus the auth verify on boot). |
| D20 | **Zero deployment friction, zero added cost.** No new bindings, services, paid features, or manual dashboard toggles. Every change must keep or reduce D1 rows read/written and KV operations. |

---

## 2. Architecture & Layout

### Request dispatch (`apps/api/src/index.ts`), evaluated in order on `url.pathname`

1. `/api/v1` or `/api/v1/*` → API Hono app. Any other `/api` or `/api/*` → JSON 404.
2. `/app` → 308 to `/app/` (query preserved).
3. `/app/*` → `serveApp()`.
4. `/` → `handleRoot()` (valid `FALLBACK_URL` → 307, else 404 page).
5. Single segment (optional trailing `/`) matching `SLUG_REGEX` on the raw path:
   - If the segment is a reserved slug (case-insensitive, e.g. `/APP`, `/Api`) → unknown-link handling (fallback/404) **without** a D1 query.
   - Otherwise → `handleRedirect()` (non-GET/HEAD → 405 `Allow: GET, HEAD`).
6. Anything else → exact static asset, else 404 page.

### Bindings

`DB` (D1), `AUTH_TOKENS` (KV), `ASSETS` (Fetcher), `API_KEY` (secret, optional), `FALLBACK_URL`, `OWN_HOSTNAMES`, `ANALYTICS_ENABLED`, `ANALYTICS_DIMENSIONS` (vars).

### KV layout (D13)

| Key | Value | Metadata | TTL |
| :-- | :-- | :-- | :-- |
| `initial_token` | `rdir_initial_<32 base62>` | `{ createdAt }` | none |
| `token:<10 base62 id>` | `rdir_<id>_<32 base62>` | `{ name, createdAt, expiresAt, preview }` | KV `expiration` = `expiresAt` when set |

### Repository layout

```text
packages/shared/src/   constants.ts · schemas.ts · validation.ts · slug.ts · index.ts
apps/api/src/          index.ts · types.ts · errors.ts
                       auth/{tokens,middleware}.ts
                       db/{links,stats}.ts
                       routes/{links,tokens,stats,redirect,app}.ts
                       utils/{query,analytics}.ts
apps/api/test/         apply-migrations · validation · auth · links · redirect · analytics · dispatch
apps/web/src/          main.tsx · App.tsx · api/client.ts · context/AuthContext.tsx
                       utils/{stats,dates,share,qr,url}.ts
                       components/{Layout,AuthGate,AccessExpiredBanner,LinkRow,LinkFormModal,QrCodeModal,DailyChart}.tsx
                       components/ui/{button,input,label,dialog,alert-dialog,card,badge,switch,dropdown-menu}.tsx
                       pages/{Dashboard,LinkStats,ShareTarget,Settings,NotFound}Page.tsx
apps/web/test/         setup · share · stats · client · components · link-row · dashboard-debounce · qr
```

---

## 3. Completed Implementation Phases (Parts I, II & III)

### Part I — Monorepo & Backend Foundation (Phases 1–9) — ✅ Completed
- **Phase 1 — Workspace:** Monorepo configuration (`pnpm-workspace.yaml`, root `package.json`, `tsconfig.base.json`).
- **Phase 2 — Shared Package (`@redirect/shared`):** Constants, types, Zod schemas, validation, and slug utilities.
- **Phase 3 — D1 Schema (`apps/api/migrations/0001_initial.sql`):** SQLite schema for links, daily click rollups, and dimension rollups.
- **Phase 4 — Authentication (KV):** Token format, hashing, verification, and `authMiddleware`.
- **Phase 5 — Links API (`/api/v1/links`):** Authenticated CRUD, filtering, search, pagination, and collision-retry slug creation.
- **Phase 6 — Statistics (`GET /api/v1/links/:id/stats`):** Daily click time-series aggregation and country/referrer breakdowns.
- **Phase 7 — Redirect Engine & Asset Dispatch:** Root/fallback handling, single-segment 301/302/307/308 redirects, and bot filtering.
- **Phase 8 — Tests:** Real workerd runtime integration test suite (`@cloudflare/vitest-plugin`).
- **Phase 9 — Runbook & Docs:** Operations runbook, deployment instructions, and local development CLI guide (`README.md`).

---

### Part II — Web SPA & PWA (Phases F1–F8) — ✅ Completed
- **Phase F1 — Frontend Workspace & Build Pipeline:** Vite, React 19, Tailwind CSS, subpath isolation under `/app/`, and static `404.html`.
- **Phase F2 — API Client, Auth Context & Session Handling:** Typed API client, localStorage token persistence, `AuthGate`, and Cloudflare Access session resilience.
- **Phase F3 — App Shell, Router & Design System:** History router (`wouter`), responsive `Layout`, and shadcn-style UI primitives.
- **Phase F4 — Links Dashboard:** Link listing, search, filtering, inline active toggle, create/edit modals, and client-side QR generation.
- **Phase F5 — Link Analytics & Visualization:** `LinkStatsPage`, self-contained SVG `DailyChart`, and dimension breakdown cards.
- **Phase F6 — PWA, Service Worker & Web Share Target:** Scoped `/app/sw.js`, manifest, offline shell fallback, and share target parsing.
- **Phase F7 — Token Management & Settings:** `SettingsPage` with token list, masked preview, token creation, rotation, and revocation.
- **Phase F8 — Frontend Tests & Verification:** Vitest + jsdom test suite covering UI components, share target, stats, and auth client.

---

### Part III — Correctness, Cost & Storage Redesign (Phases R0–R12) — ✅ Completed
- **Phase R0 — Repository Hygiene:** Toolchain validation (Node 20+, pnpm 12) and baseline test verification.
- **Phase R1 — P0/P1 Correctness Fixes:** API_KEY lockout fix, Hono framework error mapping, 2-minute token expiry floor, SPA 304 shell revalidation, and QR PNG generation under CSP.
- **Phase R2 — Token Storage Redesign (D13):** Id-embedded tokens (`rdir_<id>_<secret>`), single-operation KV reads/writes, O(1) revoke/rotate, and automatic initial token upgrade.
- **Phase R3 — D1 Round-trip & Read Reduction (D15):** Batched `listLinks` queries, direct `INSERT/UPDATE ... RETURNING *`, single-batch stats response with embedded link row, and reserved slug short-circuiting.
- **Phase R4 — Frontend Data Flow & Auth State (D19):** Optimistic link toggles without list refetching, diff-based PATCH updates, token state ownership in `AuthContext`, and settings rotation actions.
- **Phase R5 — Frontend Contract & UX Fixes:** Default `forwardQuery: true`, shared validation in modal, tag filter chips, recently-updated sorting, copy-to-clipboard on quick shorten, and share target exact duplicate query.
- **Phase R6 — Analytics Accuracy:** Bot/crawler UA filter expansion (fediverse, HTTP clients, uptime monitors) saving 2–4 D1 writes per skipped request while preserving in-app browsers.
- **Phase R7 — Hardening, Assets & Service Worker:** Strict CSP with `object-src 'none'`, `X-Robots-Tag: noindex, nofollow`, build-id hashed SW cache name (`redirect-app-<buildId>`), and public 404 decoupling.
- **Phase R8 — Code Cleanup:** Dead code removal (`isLinkScheduled`, redundant `scrollTo`), Zod v4 `z.iso.datetime()` modernization, and strict unused local/parameter enforcement.
- **Phase R9 — Bundle Code-Splitting:** Lazy loading for `LinkStatsPage`, `SettingsPage`, `ShareTargetPage`, and `QrCodeModal`, achieving ~23% gzip entry-chunk reduction.
- **Phase R10 — Test Suite Expansion:** Full workerd and jsdom coverage for B1–B22 defects, bringing total test count to 93 passing tests.
- **Phase R11 — Documentation Updates:** Synchronization of `Concept.md`, `README.md`, and `plan.md` with id-embedded tokens, bot rules, and build cache names.
- **Phase R12 — Optional Tooling:** Biome linting and GitHub Actions CI workflow (deferred).

---

## 4. Part IV — Future Feature Backlog (Backlog for subsequent phases)

Scoring: **Cost** = effect on D1 rows written per click / KV writes; **Friction** = deploy or ops burden; **Concept** = conflicts to resolve first.

### Tier A — high value, ~zero cost, no concept conflict

| Feature | Value | Cost | Friction | Notes |
| :-- | :-- | :-- | :-- | :-- |
| Bookmarklet / "Shorten this page" | One-click shortening on desktop | 0 | 0 | A `javascript:` link opening `/app/share?url=…`; reuses the Share Target page. Document in Settings. |
| iOS Shortcut template + docs | Native share sheet on iOS | 0 | 0 | Downloadable instructions using `POST /api/v1/links` with a dedicated token. |
| Scheduled activation (`starts_at`) | Pre-publish links | 0 per click (same row read) | Migration | Mirror of `expires_at`; before the start time the link behaves like a disabled one. |
| Per-link fallback URL for expired/disabled | Better UX than a global fallback | 0 | Migration | Column `fallback_url`, validated like targets. |
| Tag suggestions endpoint | Faster tagging | Reads only | 0 | `SELECT DISTINCT value FROM links, json_each(tags)`. |
| UTM builder in the link form | Common marketing need | 0 | 0 | Pure client-side; writes into `targetUrl`. |
| Duplicate-link action | Convenience | 1 write per use | 0 | The client calls create with copied fields. |
| Client-side CSV/JSON export | Portability without an endpoint | Reads only | 0 | Pages through `GET /links`. The concept currently says "use `wrangler d1 export`"; amend if adopted. |

### Tier B — valuable, small cost or open design questions

| Feature | Value | Cost | Friction | Concept |
| :-- | :-- | :-- | :-- | :-- |
| Read-only / scoped tokens | Safer integrations (e.g. stats dashboards) | 0 (metadata field) | 0 | Extends D13 metadata with `scopes`. |
| Max-clicks expiry | One-time/limited links | 0 extra (the counter is already read) | Migration | Interacts with bot filtering and permanent-redirect caching; must use temporary codes. |
| Device/OS targeting (App Store vs Play Store) | App marketing | 0 (UA read, never stored) | Migration | Tension with "simple"; D6 still holds since the UA isn't stored. |
| Geo targeting via `cf.country` | Regional targets | 0 | Migration | Same as above. |
| Slug history / aliases after rename | No broken old links | +1 read on misses only | Migration | A concept non-goal today; worth reconsidering since renames are a headline feature. |
| Archive (soft delete) | Keep stats, hide the link | 0 | Migration | Alternative to destructive delete (cascading deletes cost writes). |
| Link notes field | Context for the owner | 0 | Migration | Trivial. |
| Custom Open Graph preview (serve OG HTML to known preview bots) | Branded social previews | 0 | Migration | Bots are already detected, but serving HTML instead of a redirect changes semantics; needs concept wording. |
| OpenAPI document for `/api/v1` | CLI/integration friendliness | 0 | 0 | Generate from the shared Zod schemas. |

### Tier C — defer or reject unless requirements change

| Feature | Why not now |
| :-- | :-- |
| Target health checks (cron fetch of targets) | Server-side fetching activates the SSRF concerns D9 explicitly defers; uses subrequests/cron. |
| Hourly analytics, unique visitors, per-click logs | Multiply D1 writes or require per-visitor state; violate D6 / the cost principle. |
| Email/webhook notifications | Needs an external service (friction, possibly cost). |
| Password-protected links | Requires an interstitial page, secret storage and brute-force handling; complexity disproportionate for a personal shortener. |
| Multi-domain / multi-user | Concept non-goals; would reshape schema and auth. |
| A/B target rotation | Little value without per-variant analytics (more writes). |
