# Redirect — Implementation Plan

Specification for an LLM coding agent working on the **Redirect** platform in `/home/coder/project/redirect/`. The product concept is `/home/coder/notes/redirect-dev-notes/Concept.md`. If this plan and the concept disagree, the concept's intent wins — **except** where Phase R11 explicitly amends the concept. Report any other discrepancy instead of guessing.

The project is **pre-release**: data formats, KV layout, API shapes, and the D1 schema need no backward compatibility. Prefer the cleanest design over migration shims.

## How to Use This Plan

1. Work through the Part III phases **in order** (R0 → R11). Each phase lists files, exact behavior, and a verification gate. Do not start the next phase until the gate passes.
2. Keep each phase in its own commit (Conventional Commits, e.g. `fix(api): …`, `perf(api): …`, `refactor(web): …`).
3. Toolchain: Node 20+ and the pnpm version pinned in root `package.json` (`packageManager`) must be on `PATH`. Do not hardcode machine-specific paths in code, scripts, or docs.
4. Never weaken an Authoritative Decision (§1) to make a test pass. If a decision blocks a correct fix, stop and report.
5. Part IV (future features) is **not** to be implemented. It is a backlog for later assessment.

---

## Project Status Overview

| Part | Scope | Status |
| :--- | :--- | :--- |
| **Part I** | Monorepo, `@redirect/shared`, `@redirect/api` (Phases 1–9) | ✅ Completed — 49 workerd tests |
| **Part II** | `@redirect/web` SPA & PWA (Phases F1–F8) | ✅ Completed — 31 jsdom tests |
| **Part III** | Correctness, cost/latency, token storage redesign, cleanup (Phases R0–R12) | 📋 Ready for implementation |
| **Part IV** | Future feature backlog | 🧭 For assessment only — do not implement |

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

### Part III Decisions (`D13`–`D20`) — new

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

## 2. Architecture (current, with Part III deltas)

### Request dispatch (`apps/api/src/index.ts`), evaluated in order on `url.pathname`

1. `/api/v1` or `/api/v1/*` → API Hono app. Any other `/api` or `/api/*` → JSON 404.
2. `/app` → 308 to `/app/` (query preserved).
3. `/app/*` → `serveApp()`.
4. `/` → `handleRoot()` (valid `FALLBACK_URL` → 307, else 404 page).
5. Single segment (optional trailing `/`) matching `SLUG_REGEX` on the raw path:
   - **R3 delta:** if the segment is a reserved slug (case-insensitive, e.g. `/APP`, `/Api`) → unknown-link handling (fallback/404) **without** a D1 query.
   - Otherwise → `handleRedirect()` (non-GET/HEAD → 405 `Allow: GET, HEAD`).
6. Anything else → exact static asset, else 404 page.

### Bindings (unchanged)

`DB` (D1), `AUTH_TOKENS` (KV), `ASSETS` (Fetcher), `API_KEY` (secret, optional), `FALLBACK_URL`, `OWN_HOSTNAMES`, `ANALYTICS_ENABLED`, `ANALYTICS_DIMENSIONS` (vars).

### KV layout after R2 (D13)

| Key | Value | Metadata | TTL |
| :-- | :-- | :-- | :-- |
| `initial_token` | `rdir_initial_<32 base62>` | `{ createdAt }` | none |
| `token:<10 base62 id>` | `rdir_<id>_<32 base62>` | `{ name, createdAt, expiresAt, preview }` | KV `expiration` = `expiresAt` when set |

### Repository layout (unchanged except where noted)

```text
packages/shared/src/   constants.ts · schemas.ts · validation.ts · slug.ts (+ randomBase62, token helpers in R2) · index.ts
apps/api/src/          index.ts · types.ts · errors.ts
                       auth/{tokens,middleware}.ts
                       db/{links,stats}.ts
                       routes/{links,tokens,stats,redirect,app}.ts
                       utils/{query,analytics}.ts            (utils/slug.ts removed in R8)
apps/api/test/         apply-migrations · validation · auth · links · redirect · analytics · dispatch
apps/web/src/          main.tsx · App.tsx · api/client.ts · context/AuthContext.tsx
                       utils/{stats,dates,share,qr,url*}.ts   (*url.ts added in R5)
                       components/{Layout,AuthGate,AccessExpiredBanner,LinkRow,LinkFormModal,QrCodeModal,DailyChart}.tsx
                       components/ui/{button,input,label,dialog,alert-dialog,card,badge,switch,dropdown-menu}.tsx
                       pages/{Dashboard,LinkStats,ShareTarget,Settings,NotFound}Page.tsx
apps/web/test/         setup · share · stats · client · components · link-row · dashboard-debounce (+ qr in R10)
```

---

## 3. Reassessment of the Previous Part III (O1–O6)

The previous revision of this plan was reviewed for soundness, necessity, and safety:

| Prev. item | Verdict | Reason | Replacement |
| :-- | :-- | :-- | :-- |
| **O1.1** Dual index `token_id:<id>` → raw token | ❌ Rejected | Doubles KV writes on create (writes are the scarcest free-tier KV quota, 1k/day); two non-atomic keys can orphan; still needs a list-scan fallback. Revoke is rare for a single user, so the original list scan was not a real cost problem. | **D13**: embed the id in the token → one key, O(1) auth/revoke, no index. |
| **O1.2** Also write `token:<initialToken>` for 1-read auth; "self-heal" writes on auth | ❌ Rejected (**security regression**) | Creates two sources of truth. The documented recovery "delete `initial_token` in the dashboard" would no longer revoke the old token, because the shadow `token:` key keeps working. Self-heal puts KV writes on the hot auth path. | **D13**: `rdir_initial_…` is recognized by its id and looked up directly in `initial_token`: 1 read, one source of truth. |
| **O1.3** Skip `ensureInitialToken` when a token was supplied | ❌ Rejected | Breaks recovery: a browser holding a stale token after the owner deleted `initial_token` would never trigger regeneration (the SPA only pings when it has *no* token). The saving is one edge-cached KV read, on failures only. | Keep bootstrap on every 401 (R2). |
| **O2.1** Batch `COUNT` + page query | ✅ Kept | One round-trip instead of two; same rows read. | R3.1 |
| **O2.2** Direct INSERT, catch UNIQUE error | ✅ Kept, improved | Correct, but matching exception strings is brittle. | R3.2: `ON CONFLICT(slug) DO NOTHING RETURNING *` (null row ⇒ conflict). |
| **O2.3** `UPDATE … RETURNING *` | ✅ Kept, improved | The previous version still pre-read the link; that read is also unnecessary. | R3.3: PATCH is **one statement**. |
| **O2.4** Direct DELETE | ✅ Kept | Removes a read. | R3.4 |
| **O2.5** Batch stats queries | ✅ Kept, extended | The SPA also calls `GET /links/:id` alongside stats and refetches both on every period change. | R3.5: stats response embeds the link → 1 request, 1 round-trip. |
| **O3.1** Fetch `/app/index.html` directly for `/app/` | ✅ Kept (minor) | Saves one in-process asset lookup. The real bug in `serveApp` was missed (304 → empty 200). | R1.4 |
| **O3.2** Case-insensitive `/APP`, `/API` routing | ⚠️ Replaced | Reserved slugs can never exist, so the current 404 is already correct; routing `/API/v1/...` into Hono would still miss its case-sensitive routes. Only the wasted D1 read matters. | R3.6: reserved segment ⇒ skip D1. |
| **O4.1** `forwardQuery` default `true` in modal | ✅ Kept | Real contract bug (Concept §1.2). | R5.1 |
| **O4.2** Shared validators in modal | ✅ Kept | Real bug (reserved slugs / self-loops accepted client-side). | R5.2 |
| **O4.3** Clickable tag chips | ✅ Kept | Clicking a tag currently navigates to stats; there is no other way to set a tag filter. | R5.4 |
| **O4.4** "Recently updated" sort | ✅ Kept | Trivial gap. | R5.5 |
| **O4.5** Quick-shorten copy + QR | ✅ Kept, clarified | The spec was vague ("open QR if user clicks the toast"). | R5.6: Sonner action buttons. |
| **O4.6** Zero-fill with server bounds | ✅ Kept, simplified | Drop the `days` parameter entirely. | R5.8 |
| **O5** Tests | ✅ Kept, expanded | | R10 |
| **O6** Zero friction/cost | ✅ Kept | | D20 |
| Doc defects | ❌ Fixed | The previous plan claimed Vite 6 (actual 8), listed non-existent `ui/select.tsx` & `ui/sonner.tsx`, hardcoded a machine-specific `PATH`, and counted "8 bugs" without listing them. | This document. |

---

## 4. Verified Defect Inventory

Items marked 🔬 were reproduced against the Workers runtime (`@cloudflare/vitest-plugin`) on 2026-11-01. The rest were confirmed by reading the code.

| ID | Sev. | Area | Defect | Fix |
| :-- | :-- | :-- | :-- | :-- |
| B1 🔬 | **P0** | Auth | `API_KEY` containing `+ / =`, spaces, or shorter than 16 chars can never authenticate (`TOKEN_REGEX` runs first). Because `API_KEY` disables the initial token, this is a **total lockout** (e.g. with `openssl rand -base64 32`). | R1.1 |
| B2 🔬 | **P0** | Web/API | SPA shell revalidation (`If-None-Match`) on `/app/` or any deep route returns **200 with an empty body**, so the page renders blank on reload once the browser has the ETag cached. `serveApp` rewrites the asset's 304 into a 200. | R1.4 |
| B3 | **P0** | Web | QR "Download PNG" and "Copy image" call `fetch(dataUrl)`, which the production CSP (`connect-src` ← `'self'`) blocks. Works in dev (no CSP), broken in production. | R1.6 |
| B4 🔬 | P1 | API | Malformed JSON body → 500 `internal_error` (Hono `HTTPException` not mapped). | R1.2 |
| B5 🔬 | P1 | Tokens | `expiresAt` < 60 s in the future → 500 (KV rejects `expiration`); a past `expiresAt` is accepted and creates a dead token. | R1.3 |
| B6 🔬 | P1 | Links | PATCH with an unchanged past `expiresAt` → 400. The edit modal always resends `expiresAt`, so **no field of an expired link can be edited** without clearing its expiry. | R1.5 + R4.3 |
| B7 | P1 | Web | The edit modal sends `tags: undefined` when all tags are removed, so tags can never be cleared. | R4.3 |
| B8 | P1 | Web | The stats page "Period Clicks" card shows the all-time total (`stats.totalClicks`), labeled "Last N days". | R1.7 |
| B9 | P1 | Web | Toggling a link's active switch triggers **two to three full list refetches** (optimistic update, success, and rollback each call `fetchLinks`). Each refetch = 1 KV read + 1–2 D1 queries. | R4.1 |
| B10 | P2 | Web | The create/edit modal defaults `forwardQuery` to `false` (concept & DB default is on). | R5.1 |
| B11 | P2 | Web | The modal validates slugs with its own regex; reserved slugs (`api`, `app`), over-length slugs and self-referencing targets pass client validation. Random slug length is hardcoded to 8. | R5.2, R5.3 |
| B12 | P2 | Web | Settings shows "Revoke" on the initial token (API returns 409) and a "Rotate Initial" button even when `API_KEY` mode disables it. The reveal dialog claims the token can't be seen again (it can, in KV). | R4.5 |
| B13 | P2 | Web | If a token is revoked or expires mid-session, every call toasts an error and the user is never returned to the unlock screen. | R4.4 |
| B14 | P2 | Web | After rotating the initial token, Settings still displays the old stored token (read once at render, not from state). | R4.4 |
| B15 | P2 | Web | Referrer `"(direct)"` (what the API stores) is shown raw; the UI maps `""`/`"direct"` instead. Country `"XX"` renders as a broken flag / "Unknown Region". Dimension cards are hidden when the array is empty (spec: show "No data in this period"). | R5.7 |
| B16 | P2 | Web | The Share Target duplicate check uses substring search with `limit: 10` and exact-matches client-side, so it misses exact matches when there are >10 substring hits. It also marks "copied" even when the clipboard write failed. | R5.9 |
| B17 | P2 | Web | Clicking a tag chip navigates to the stats page (the event bubbles to the row click). | R5.4 |
| B18 | P3 | API | Reserved case variants (`/APP`, `/Api`) cost a D1 query to return 404. | R3.6 |
| B19 | P3 | Web | The SW caches *any* `/app/*` navigation response under `/app/index.html` (e.g. opening the manifest URL in a tab poisons the shell). Old hashed assets accumulate forever because the cache name never changes. | R7.3 |
| B20 | P3 | Web | `animate-in`, `fade-in`, `zoom-in-95` etc. are no-ops (no animation plugin installed). | R7.5 |
| B21 | P3 | Web | The search clear button has no accessible name (a test depends on `name: ""`). | R5.10 |
| B22 | P3 | Docs | README says pnpm v10/v11 (the repo pins pnpm 12) and describes a "32-character Base62" initial token (actual: `rdir_` + 48 hex). | R11 |

---

## 5. Part III — Implementation Phases

### Phase R0 — Repository Hygiene (no behavior change)

1. The working tree has uncommitted changes outside this plan: `package.json` (`packageManager` `pnpm@11.2.2` → `pnpm@12.16.1`) and `pnpm-lock.yaml` (a new `packageManagerDependencies` header). **Ask the owner** whether to commit or revert them; do not silently include them in a feature commit.
2. Ensure exactly one plan exists. If `/home/coder/notes/redirect-dev-notes/plan.md` exists, it is a stale copy produced by an earlier session; ask the owner before deleting it.
3. Run `pnpm install`, `pnpm typecheck`, `pnpm test` and record the baseline (expected: 49 api + 31 web passing).

**Gate:** baseline green; owner decisions on items 1–2 recorded.

---

### Phase R1 — P0/P1 Correctness Fixes

**R1.1 — `API_KEY` lockout (B1, D14)**: `apps/api/src/auth/tokens.ts`, `apps/api/src/auth/middleware.ts`
- In `authenticate(env, token)`: first, if `env.API_KEY?.trim()` is non-empty and `await safeEqual(token, env.API_KEY.trim())` → return `{ kind: "env", id: "env", name: "Environment API key" }`. Apply token-format checks only after that.
- In `authMiddleware`: remove the `TOKEN_REGEX.test(token)` pre-filter; pass any extracted non-empty token to `authenticate`. Reject header tokens longer than 512 chars before hashing.
- `extractToken`: keep `Bearer` and `X-API-Key`; trim.

**R1.2 — Map framework errors (B4, D16)**: `apps/api/src/errors.ts`
- In `handleApiError`: `if (err instanceof HTTPException)` (from `hono/http-exception`) → status `err.status`, code `err.status === 400 ? "bad_request" : "http_error"`, message `err.message`, header `Cache-Control: no-store`. Only unknown errors become 500 (and are logged).

**R1.3 — Token expiry validation (B5)**: `packages/shared/src/schemas.ts`, `apps/api/src/routes/tokens.ts`
- `createTokenSchema.expiresAt`: ISO datetime or null. The route rejects values earlier than `now + 120 s` with `400 invalid_expiry` ("Token expiry must be at least 2 minutes in the future"). The 2-minute floor keeps a safe margin over KV's 60 s minimum `expiration`.
- Always set KV `expiration = Math.floor(Date.parse(expiresAt) / 1000)` when `expiresAt` is set (now guaranteed valid).

**R1.4 — SPA shell conditional requests (B2)**: `apps/api/src/routes/app.ts`
- Rewrite `serveApp`:
  1. If `pathname === "/app/"` → fetch `/app/index.html` directly (single lookup), carrying the original request's headers so conditional requests still work.
  2. Otherwise fetch the exact asset; if it is 404, the method is GET/HEAD and the last segment has no `.`, fetch `/app/index.html` with the original headers.
  3. When serving the shell for a fallback path: if the shell response is **304**, return 304 (no body) with the shell's headers; if 200, return 200 with the body; any other status passes through unchanged. **Never** synthesize a 200 from a non-200.
  4. Apply security headers (D17) and Cache-Control rules (F11) to every response, including 304.

**R1.5 — PATCH expiry semantics (B6)**: `apps/api/src/routes/links.ts`
- `expiresAt` in PATCH: `null` clears; a provided value must be in the future. Because clients send only changed fields (R4.3), an untouched past expiry is never resent. Document this contract in a route comment.
- Create (`POST`) keeps the "must be in the future" rule.

**R1.6 — QR PNG under CSP (B3, F4)**: `apps/web/src/utils/qr.ts`, `apps/web/src/components/QrCodeModal.tsx`
- Replace `generateQrPngDataUrl` + `fetch(dataUrl)` with `generateQrPngBlob(text, width = 1024): Promise<Blob>` using `QRCode.toCanvas(canvas, text, opts)` and `canvas.toBlob(..., "image/png")`.
- Generate the PNG **lazily** (on "Download PNG" / "Copy image" click); open the modal with the SVG only.
- Keep `downloadBlob` (an object URL on an `<a download>` is allowed by the CSP).

**R1.7 — Period clicks KPI (B8)**: `apps/web/src/pages/LinkStatsPage.tsx`
- KPI cards: **Total clicks** (`link.clickCount`), **Clicks in period** (sum of `daily`), **Peak day** (max day + count, "—" if zero), **Last clicked**. Move status code / forward-query info into header badges.

**Gate:** `pnpm typecheck && pnpm test`; the R10 tests for B1, B2, B4, B5, B6 pass.

---

### Phase R2 — Token Storage Redesign (D13)

Files: `packages/shared/src/slug.ts`, `packages/shared/src/schemas.ts`, `apps/api/src/auth/tokens.ts`, `apps/api/src/auth/middleware.ts`, `apps/api/src/routes/tokens.ts`, `apps/web/src/components/AuthGate.tsx`.

**R2.1 — Random primitive.** In `packages/shared/src/slug.ts`, extract the unbiased rejection-sampling loop into `randomBase62(length: number): string`; `generateRandomSlug` delegates to it.

**R2.2 — Token format** (`apps/api/src/auth/tokens.ts`):
```ts
export const TOKEN_PREFIX = "rdir_";
export const TOKEN_ID_LENGTH = 10;        // custom token ids
export const TOKEN_SECRET_LENGTH = 32;    // ~190 bits
export const INITIAL_TOKEN_ID = "initial";
export const TOKEN_FORMAT = /^rdir_([A-Za-z0-9]{1,16})_([A-Za-z0-9]{32})$/;

generateToken(id: string): string  // `rdir_${id}_${randomBase62(32)}`
parseToken(raw: string): { id: string } | null
maskToken(raw: string): string     // `rdir_${id}_…${last4}`
```
Remove `generateTokenId` (hex) and `TOKEN_REGEX`.

**R2.3 — `authenticate(env, token)`** (after the API_KEY check from R1.1):
1. `parseToken(token)`; null → return null.
2. `id === "initial"`: if `API_KEY` is set → null. Else `stored = await KV.get("initial_token")`; `safeEqual(stored, token)` → `{ kind: "initial", id: "initial", name: "Initial token" }`.
3. Otherwise: `{ value, metadata } = await KV.getWithMetadata<TokenMeta>("token:" + id)`; require `value` and `safeEqual(value, token)`; if `metadata.expiresAt` is in the past → null. Return `{ kind: "token", id, name: metadata.name }`.

Result: exactly **one KV read** per authenticated request for every principal kind.

**R2.4 — `ensureInitialToken(env)`.** Skip when `API_KEY` is set. Read `initial_token`; if it is missing **or** doesn't match `TOKEN_FORMAT` with id `initial`, write a fresh `generateToken("initial")` with metadata `{ createdAt }`, and `console.warn` when replacing a malformed value. This also upgrades any pre-R2 value automatically, with no manual steps. Keep calling it from the middleware on **every** 401 (see §3, O1.3).

**R2.5 — Routes** (`apps/api/src/routes/tokens.ts`):
- `POST /tokens`: `id = randomBase62(10)`, `token = generateToken(id)`, `put("token:" + id, token, { metadata: { name, createdAt, expiresAt, preview: maskToken(token) }, expiration? })`. One write. Response `TokenInfo & { token }`.
- `GET /tokens`: the initial entry (when `API_KEY` is unset and `initial_token` exists, via `getWithMetadata`), then a single `list({ prefix: "token:" })` (follow `cursor` only while `list_complete` is false). Build `TokenInfo` purely from key name + metadata (no value reads). Sort by `createdAt` desc after the initial entry.
- `DELETE /tokens/:id`: `id === "initial"` → 409 `initial_token_protected` (unchanged). An `id` not matching `^[A-Za-z0-9]{10}$` → 404. Otherwise `delete("token:" + id)` and return `{ deleted: true, id }` (idempotent; no read, no list).
- `POST /tokens/initial/rotate`: 409 `mechanism_disabled` when `API_KEY` is set; else `put("initial_token", generateToken("initial"), { metadata: { createdAt } })`. One write; the old token stops working once KV propagates (≤ 60 s).
- `TokenInfo` in shared keeps its shape: `{ id, name, createdAt, expiresAt, preview, isInitial? }`.

**R2.6 — Dashboard copy.** AuthGate help: "Your token is the value of the `initial_token` key (or of any `token:<id>` key)." Remove references to `token:<rawToken>`.

**Gate:** the rewritten auth suite (R10.1) passes; `GET /tokens` performs exactly 1 `list` (+1 `getWithMetadata` for the initial entry); `DELETE` performs exactly 1 `delete`.

---

### Phase R3 — D1 Round-trip & Read Reduction (D15)

**R3.1 — `listLinks`** (`apps/api/src/db/links.ts`): build `countStmt` and `dataStmt`, then run `const [countRes, dataRes] = await db.batch([countStmt, dataStmt])`. Add an exact-match `targetUrl` filter (`target_url = ?`) to `listLinksQuerySchema` (used by R5.9). Cap `search` at 200 chars and `tag` at `MAX_TAG_LENGTH` in the schema.

**R3.2 — Create** (`db/links.ts`, `routes/links.ts`):
```sql
INSERT INTO links (id, slug, target_url, title, status_code, tags, is_active, forward_query,
                   expires_at, click_count, last_clicked_at, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)
ON CONFLICT(slug) DO NOTHING
RETURNING *
```
- `createLinkRecord` returns `LinkRecord | null` (null ⇒ slug conflict).
- Custom slug: null → 409 `slug_taken`.
- Auto slug: up to 5 attempts at `DEFAULT_SLUG_LENGTH`, then 2 attempts at +1, then 500 `slug_generation_failed`. No `SELECT` before inserting.
- Remove `getLinkBySlug` (no remaining callers).

**R3.3 — Update = one statement** (`db/links.ts`, `routes/links.ts`):
- `updateLinkRecord(db, id, input): Promise<LinkRecord | null>` builds the `SET` list from provided fields, always sets `updated_at`, and runs `UPDATE links SET … WHERE id = ? RETURNING *` with `.first()`.
- Route: validate target URL/expiry/slug from the body only; call `updateLinkRecord`; null → 404; an error containing `UNIQUE constraint failed: links.slug` → 409 `slug_taken`. No pre-read.

**R3.4 — Delete** (`routes/links.ts`): `const deleted = await deleteLinkRecord(db, id)`; `!deleted` → 404. No pre-read. (FK cascades remove rollups; those deletes count as rows written, as already documented.)

**R3.5 — Stats = one request, one round-trip** (`db/stats.ts`, `routes/stats.ts`, shared types):
- New `LinkStats` shape:
  ```ts
  interface LinkStats {
    link: LinkRecord;
    range: { days: number; from: string; to: string };
    daily: Array<{ day: string; clicks: number }>;
    dimensions: { country?: DimRow[]; referrer?: DimRow[] }; // keys present only if enabled
  }
  ```
  `linkId`, `totalClicks` and `lastClickedAt` are dropped because they duplicate `link`.
- `getLinkStats(db, id, days, enabledDims)` batches `SELECT * FROM links WHERE id = ?`, the daily query, and one query per enabled dimension; it returns null if the link row is missing (route → 404).
- Extract `parseEnabledDimensions(raw?: string): AnalyticsDimension[]` into `apps/api/src/utils/analytics.ts`; use it in both `recordClick` and the stats route.

**R3.6 — Reserved segment short-circuit** (`apps/api/src/index.ts`): before calling `handleRedirect`, if `RESERVED_SLUGS` contains `segment.toLowerCase()`: GET/HEAD → the unknown-link response; other methods → 405. Factor the FALLBACK_URL-or-404 logic into a shared helper `respondUnknownLink(request, env)` used by `handleRedirect`, `handleRoot` and this branch. No D1 query.

**Gate:** links/stats/dispatch suites green; R10.2 query-count assertions pass.

---

### Phase R4 — Frontend Data Flow & Auth State (D19)

**R4.1 — No refetch on mutation (B9)**: `DashboardPage.tsx`, `LinkRow.tsx`
- `handleLinkUpdated(saved)` → `setLinks(prev => prev.map(l => l.id === saved.id ? saved : l))`. No `fetchLinks()`.
- `LinkRow` optimistic toggle: patch local state, call the API, then patch with the server record on success or restore on failure. Zero list refetches. (A row toggled out of the current status filter stays visible until the next natural refetch; acceptable.)
- Create (quick shorten or modal): refetch the current page once (creation is rare, and ordering/pagination depend on the server).
- Delete: remove locally and decrement `totalCount`; if the page becomes empty and `page > 1`, go to `page - 1` (which fetches).

**R4.2 — Single stats call**: `LinkStatsPage.tsx`, `api/client.ts`
- Remove `getLink` from this page; `getLinkStats(id, days)` returns `link` too. A period change = one request. After editing via the modal, replace `stats.link` locally (no refetch).

**R4.3 — Diff-based PATCH (B6, B7)**: `LinkFormModal.tsx`
- On edit, build `UpdateLinkInput` containing only fields that differ from `initialLink`. Compare `expiresAt` via the local-input string (avoids false positives from seconds truncation); compare tags as sorted arrays. Send an empty `tags` array when all tags were removed. If nothing changed, close the modal with an info toast and make no request.
- Client-side expiry check: "must be in the future" only when the expiry field changed.

**R4.4 — Auth state owns the token (B13, B14)**: `context/AuthContext.tsx`, `api/client.ts`, `pages/SettingsPage.tsx`
- `AuthContext` keeps `token` in state (initialized from storage); `login`, `logout` and `updateActiveToken` update both state and storage. Settings reads the token from context.
- `request()` dispatches the `window` event `redirect:unauthorized` on any 401 for a request that used the **stored** token (not `verifyAuth(candidate)` during login). `AuthContext` handles it with the same grace logic as boot (F13): within 60 s → warning toast; otherwise clear the token → unlock screen with "Session expired or token revoked."

**R4.5 — Settings page (B12)**
- Initial-token row: a "Rotate" action (AlertDialog) instead of "Revoke". Custom rows: "Revoke".
- Hide all rotate controls when the token list has no initial entry (`API_KEY` mode).
- Reveal dialog copy: "Copy this token now. It is also visible as the value of `token:<id>` (or `initial_token`) in your Cloudflare KV dashboard."
- Expiry input: `min` = now + 2 min (matches R1.3).
- Current-session detection: `principal.kind === "token" && principal.id === t.id`, or `principal.kind === "initial" && t.isInitial`.

**Gate:** `pnpm --filter @redirect/web typecheck && pnpm --filter @redirect/web test`.

---

### Phase R5 — Frontend Contract & UX Fixes

- **R5.1 (B10)** `LinkFormModal`: `forwardQuery` defaults to `true` (initial state and create reset).
- **R5.2 (B11)** `LinkFormModal`: validate with `validateSlug` and `validateTargetUrl(url, [window.location.hostname])` from `@redirect/shared`, showing the returned error text. Remove the local regex and the `setTargetUrl` side effect inside `validate()`.
- **R5.3 (B11)** "Generate random" uses `generateValidRandomSlug(DEFAULT_SLUG_LENGTH)`. Slug input `maxLength={64}`. Slug-rename warning text: "Renaming frees `/<old>` immediately. The old link will return 404 (no alias is kept). Statistics are preserved."
- **R5.4 (B17)** `LinkRow`: tags become `<button type="button">` with `stopPropagation`, calling a new `onTagClick(tag)` prop; `DashboardPage` sets the tag filter and resets `page` to 1.
- **R5.5** Dashboard sort: add `updatedAt:desc` "Recently updated".
- **R5.6** Quick shorten: after creation, attempt `navigator.clipboard.writeText(shortUrl)`; toast "Created /slug — copied" (or "Created /slug" if the write failed) with Sonner actions **Copy** and **QR** (QR opens `QrCodeModal` for the new link).
- **R5.7 (B15)** Stats: label `"(direct)"` as "Direct / none"; `formatCountryName("XX")` → "Unknown" (no flag); render a dimension card whenever its key exists (empty → "No data in this period"); if no dimension keys exist, show the footer note about `ANALYTICS_DIMENSIONS`.
- **R5.8** `zeroFillDailySeries(records, from, to)`: iterate UTC days from `range.from` to `range.to` inclusive. Remove the `days`/"today" logic.
- **R5.9 (B16)** Share Target: run the duplicate check via `listLinks({ targetUrl, limit: 1 })` (R3.1); re-check on blur only if the URL changed since the last check; set "copied" only after a successful clipboard write.
- **R5.10 (B21)** Search clear button: `aria-label="Clear search"`; update `dashboard-debounce.test.tsx` to query by that name.
- **R5.11** Extract `normalizeUrlInput(raw): string` (trim; prepend `https://` if there is no `scheme://`) into `apps/web/src/utils/url.ts`; use it in quick shorten, the modal and the share page.

**Gate:** web typecheck + tests green.

---

### Phase R6 — Analytics Accuracy (reduces D1 writes)

`apps/api/src/utils/analytics.ts`
- Do not count requests with an empty `User-Agent`.
- Extend `BOT_UA_REGEX` with non-browser fetchers that inflate counts (each skipped request saves 2–4 D1 rows written):
  - fediverse preview fetchers: `mastodon`, `pleroma`, `akkoma`, `misskey`, `friendica`, `http\.rb`
  - HTTP clients: `curl`, `wget`, `python-requests`, `python-urllib`, `go-http-client`, `okhttp`, `axios`, `node-fetch`, `undici`, `libwww-perl`
  - headless/audit tools: `headlesschrome`, `lighthouse`
  - uptime monitors: `uptimerobot`, `pingdom`, `statuscake`
  - others: `meta-externalagent`, `google-inspectiontool`, `googleother`, `iframely`
- In-app browsers used by real people **must still count** (`FBAN`, `FBAV`, `Instagram`, `Line/`, `Twitter for iPhone`). Add tests for both lists.

**Gate:** analytics suite green, including the budget assertions (2/3/4 rows).

---

### Phase R7 — Hardening, Assets & Service Worker

- **R7.1 (D17)** `apps/api/src/routes/app.ts`: update the `APP_SECURITY_HEADERS` CSP and add `X-Robots-Tag: noindex, nofollow` to app responses. Add a Hono middleware on `apiApp` that sets `X-Robots-Tag: noindex, nofollow` and `X-Content-Type-Options: nosniff` on every API response.
- **R7.2** `apps/web/404.html`: remove the "Go to Dashboard" link. Public visitors of a dead short link gain nothing from it, and it advertises the admin path. Keep the page self-contained.
- **R7.3 (B19, D18)** `apps/web/public/sw.js` + `vite.config.ts`:
  - `sw.js` declares `const CACHE_NAME = "redirect-app-__BUILD_ID__";`.
  - A Vite `closeBundle` plugin replaces `__BUILD_ID__` in `dist/app/sw.js` with a short hash of the built `index.html`.
  - Cache navigation responses only when `content-type` includes `text/html`.
  - `verify-dist.mjs` fails if `__BUILD_ID__` is still present in `dist/app/sw.js`.
- **R7.4** `verify-dist.mjs`: also assert `icon-192.png`, `icon-512.png` and `apple-touch-icon.png` exist under `dist/app/`.
- **R7.5 (B20)** Add the dev dependency `tw-animate-css` and `@import "tw-animate-css";` in `globals.css` (CSS only, no runtime JS). If the owner prefers no new dependency, remove the animation utility classes instead.

**Gate:** `pnpm build && node apps/api/scripts/verify-dist.mjs`; dispatch tests assert the new headers.

---

### Phase R8 — Code Cleanup

- Delete `apps/api/src/utils/slug.ts`; import generators from `@redirect/shared`.
- Delete the unused `isLinkScheduled` (`apps/web/src/utils/dates.ts`) and any other dead code found by enabling `noUnusedLocals` and `noUnusedParameters` in `tsconfig.base.json`.
- Zod v4: replace deprecated `z.string().datetime()` with `z.iso.datetime()` and `z.ZodIssueCode.custom` with `"custom"`.
- Schemas: normalize an empty `title` (`""` after trim) to `null`; build one `statusCodeSchema` from `REDIRECT_STATUS_CODES`; derive `updateLinkSchema` from a shared base object (no duplicated field definitions).
- Remove the redundant `scrollTo` in `LinkStatsPage` (Layout already does it).
- Remove `@testing-library/user-event` if it is still unused after R10, or use it in the new tests.

**Gate:** `pnpm typecheck && pnpm test`.

---

### Phase R9 — Bundle Size (no behavior change)

- Use `React.lazy` + `Suspense` for `LinkStatsPage`, `SettingsPage`, `ShareTargetPage` and `QrCodeModal` (so `qrcode` loads only when the modal opens). The dashboard and auth gate stay in the entry chunk.
- Record the entry-chunk gzip size before/after in the commit message.

**Gate:** `pnpm build`, `verify-dist` and web tests green; manual smoke test of each lazy route under `wrangler dev`.

---

### Phase R10 — Tests

**R10.1 API — auth/tokens (`auth.test.ts`)**
- `API_KEY` values containing `+/=`, spaces, or only 8 chars authenticate as `env`; tokens still work alongside.
- The initial token matches `rdir_initial_[A-Za-z0-9]{32}`; a malformed `initial_token` value is regenerated on the next unauthenticated request.
- Create → key `token:<id>` exists with value = token and metadata `{ name, createdAt, expiresAt, preview }`; auth succeeds; revoke deletes exactly that key; a wrong secret with a valid id fails.
- Token expiry: < 2 min → 400 `invalid_expiry`; past → 400; valid → KV `expiration` set.
- Rotate invalidates the old initial token; deleting `initial_token` regenerates a different one.

**R10.2 API — links/stats (`links.test.ts`, `analytics.test.ts`)**
- Custom slug conflict → 409 without throwing; auto slug retries (simulate by pre-inserting the generator's output via a mocked `generateValidRandomSlug`).
- PATCH: a single statement (spy on `env.DB.prepare`: exactly one call); unknown id → 404; slug conflict → 409; editing an expired link's title without `expiresAt` → 200; clearing tags with `[]` → 200.
- DELETE of an unknown id → 404 with one `prepare` call.
- `listLinks` uses one `batch` call; the `targetUrl` exact filter works.
- Stats returns `link` and only the enabled dimension keys; unknown id → 404; one `batch` call.
- Malformed JSON → 400 `bad_request`.
- Bot/in-app-browser counting lists from R6.

**R10.3 API — dispatch (`dispatch.test.ts`)**
- `/app/` and `/app/links/x` with `If-None-Match: <etag>` → 304 with security headers; without it → 200 with a non-empty body.
- `/APP` → 404 with zero `prepare` calls.
- CSP and `X-Robots-Tag` values.

**R10.4 Web**
- `LinkFormModal`: rejects `api`/`App`, self-host targets and 65-char slugs; `forwardQuery` defaults on; edit sends only changed fields; removing all tags sends `[]`; an unchanged form sends nothing.
- `LinkRow`: a tag click calls `onTagClick` and does not navigate.
- `DashboardPage`: toggling a row triggers zero additional `listLinks` calls.
- `stats.test.ts`: `zeroFillDailySeries(records, from, to)` across month/year boundaries; `formatCountryName("XX")`.
- `client.test.ts`: a 401 with the stored token dispatches `redirect:unauthorized`; a 401 for a login candidate does not.
- `qr.test.ts`: the `generateQrPngBlob` path never calls `fetch` (mock the canvas).

**Gate:** `pnpm typecheck && pnpm test && pnpm build && node apps/api/scripts/verify-dist.mjs` all green.

---

### Phase R11 — Documentation & Concept Amendments

Apply these edits. They are justified changes, not drift.

**`Concept.md`**
- §4 Authentication: tokens use the format `rdir_<id>_<secret>`; custom tokens are stored under `token:<id>` with the full token as the value; the initial token stays under `initial_token`. Each auth/revoke/rotate is one KV operation.
- §4: `API_KEY` may be any non-empty string; it is checked before token-format rules so it can never lock the owner out.
- §1.5 / Structure: the static 404 page contains no link to the dashboard.
- §2: the bot heuristic also excludes fediverse preview fetchers, HTTP client libraries and uptime monitors; requests without a User-Agent are not counted.
- §3: the stats endpoint returns the link record together with the series (one request per stats view).
- §6: the SW cache is versioned per build; the CSP includes `object-src 'none'; base-uri 'none'; form-action 'self'`; admin and API responses carry `X-Robots-Tag: noindex`.

**`README.md`**
- Toolchain: Node 20+, pnpm version from `packageManager`.
- Token format and KV layout (D13); "find your token" = the value of `initial_token` or `token:<id>`.
- `API_KEY` can be any string; recommend `openssl rand -base64 32`.
- Remove the "32-character Base62" claim.

**`plan.md`**: mark Part III phases complete with commit hashes.

**Gate:** docs reviewed against code; no stale names (`token:<rawToken>`, `generateTokenId`, `TOKEN_REGEX`) remain anywhere (`grep`).

---

### Phase R12 — Optional Tooling (only if the owner agrees)

- `.github/workflows/ci.yml`: on push/PR run `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `verify-dist`. Free for this workload; does not touch deployment.
- Linting/formatting: a single tool (Biome) with a minimal config and `pnpm lint` / `pnpm format` scripts.

---

## 6. Considered and Deferred / Rejected Alternatives

| Alternative | Decision | Reasoning |
| :-- | :-- | :-- |
| D1 read replication (`withSession`) for redirects | Deferred | Free and faster, but conflicts with D5 / Concept principle 4 ("simple over fast"), needs a dashboard toggle (friction, D20), and replica lag would serve old targets right after an edit (the concept values D1's immediate consistency). Revisit only with measured latency complaints. |
| KV or Cache API mirror of slug → target | Rejected | Violates D5; adds a second source of truth and KV writes on every edit. |
| Smart Placement | Rejected | Redirects run one query; no measurable benefit, adds a variable. |
| In-isolate memo of authenticated principals | Rejected | KV `get` is already edge-cached (~60 s); a memo adds revocation ambiguity for negligible gain. |
| Drop the `links` counter-row update (derive totals from `SUM(link_daily_clicks)`) | Deferred — owner decision | Halves D1 writes per click (2 → 1; the main cost driver). Costs: `lastClickedAt` becomes day-granular, and sorting the list by clicks needs an aggregate over all rollups (reads ≈ links × days; cheap on paid, could matter on the 5M/day free read quota with thousands of links). Decide before release; adopting it changes the Concept §2 cost table. |
| Keyset pagination / dropping `COUNT(*)` | Deferred | Only saves rows read on very large tables; the UI uses page counts. Not needed at single-user scale. |
| `COUNT(*) OVER()` in one statement | Rejected | Loses the total on an out-of-range page; `batch` is equally cheap and simpler. |
| Auto-run remote migrations in `pnpm deploy` | Deferred | Convenient, but `wrangler d1 migrations apply --remote` prompts interactively, which would make deploy behavior surprising. Document instead. |
| `observability.head_sampling_rate` | Not needed | Workers Logs volume stays within included limits at single-user scale. |
| Routing `/API/...` / `/APP` case-insensitively into the app | Rejected | See §3 O3.2; R3.6 removes the only real cost. |

---

## 7. Definition of Done (Part III)

- [ ] B1–B22 fixed, each covered by a test or an explicit verification note.
- [ ] Auth = 1 KV read for every principal kind; token create/rotate = 1 write; revoke = 1 delete; list = 1 list (+1 read for the initial entry).
- [ ] `POST /links` = 1 D1 statement in the common case; `PATCH` = 1; `DELETE` = 1; `GET /links` = 1 batch; `GET /links/:id/stats` = 1 batch; reserved-segment requests = 0.
- [ ] Dashboard toggle/edit cause zero list refetches; the stats view = 1 request per period change.
- [ ] Any non-empty `API_KEY` authenticates; no format rule can lock the owner out.
- [ ] SPA reloads never render blank (304 handling); QR PNG works under the production CSP.
- [ ] No new bindings, services, paid features or manual dashboard steps; D1 rows written per click unchanged or lower.
- [ ] `pnpm typecheck`, `pnpm test`, `pnpm build`, `verify-dist` green; Concept.md and README updated per R11.

---

## 8. Part IV — Future Feature Backlog (assess after Part III; do not implement)

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
