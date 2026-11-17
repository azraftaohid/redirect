# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.1] - 2026-11-17

### Added

- **Configurable External Branding Links (`BRANDING_EXTERNAL_LINKS`):** Added the `BRANDING_EXTERNAL_LINKS` Worker runtime environment variable (enabled by default; set to `false`, `0`, `off`, `no`, or `disabled` to remove external repository links from 404 pages via `HTMLRewriter` on `404.html` and `brandingExternalLinks` in `GET /api/v1/auth/verify` while retaining the non-clickable Redirect logo/wordmark footer on `404.html`).

### Changed

- **Consistent 404 Pages (`404.html`, `NotFoundPage`, `LinkStatsPage`):** Redesigned the public static `404.html` page with the light-first Zinc palette, dark mode support, Redirect `/>` favicon, rounded card layout, `Unlink` icon badge, `404 Not Found` status pill, and Redirect GitHub repository footer link; aligned `NotFoundPage` and `LinkStatsPage`'s missing-link state via a shared `NotFoundCard` component and updated `ensure-assets.mjs` to copy `apps/web/404.html`.

## [0.3.0] - 2026-11-15

### Added

- **Dynamic JSON / CSV Link Importer (`@redirect/shared`, `ImportLinksModal`):** Added browser-side parsing, field mapping, constant overrides, string/epoch timestamp UTC conversion, pre-flight validation with original row error preservation, and chunked submission via `importLinksChunked` for Redirect v1 exports (fast path + optional customization), custom JSON arrays/objects (with nested array path selection), and RFC 4180 CSV files (`,` / `;` / `\t` delimiters and optional header row).

### Security & Changed

- **Rate Limiting & Analytics Controls:** Tuned `API_LIMITER` (`120 req / 60s` per normalized IP or IPv6 `/64` prefix) and `CLICK_LIMITER` (`10 req / 60s` per normalized IP or IPv6 `/64` prefix), moved click rate-limiting inside `ctx.waitUntil` gated by countable clicks and enabled analytics, and made `ANALYTICS_ENABLED` accept case-insensitive `"false"`, `"0"`, `"off"`, and `"no"`.
- **Token Management Hardening:** Replaced wildcard middleware on `/api/v1/tokens*` with explicit per-route `requireTokenAdmin` middleware + `auth.forbidden` audit logging, blocked `POST /api/v1/tokens` with `409 mechanism_disabled` during strict `API_KEY` lockdown, removed unreachable handler checks, and bounded `DELETE /api/v1/tokens` (`limit: 100`, max 5 pages / 500 keys per call, 25-key parallel delete batches) returning `{ deleted: true, count, truncated }` with a Settings UI warning when truncated.
- **URL Validation & Security Headers:** Shared `UNSAFE_URL_CHARS_REGEX` (`/[\u0000-\u0020\u007F-\u009F\u2028\u2029]/`) across `@redirect/shared` (`validation.ts` and `schemas.ts`), applied `validateTargetUrl` in `DashboardPage` and `ShareTargetPage`, trimmed `FALLBACK_URL` before validation, added `Content-Security-Policy` to 404 responses (`renderNotFound`), added `X-Frame-Options: DENY` on static asset fallbacks, added `Referrer-Policy: no-referrer` to 405 responses, and unified post-dispatch `/api/v1/*` principal enforcement in `apiApp`.
- **Audit Logs, Dev Hosts & Overrides:** Hardened `logAuditEvent` against envelope field overwrites and enriched `link.import`, `link.update`, `link.delete`, and `token.revoke_all` metadata; removed hardcoded internal hostnames from `apps/web/vite.config.ts` in favor of `ALLOWED_HOSTS` / `VITE_ALLOWED_HOSTS` via `loadEnv`; scoped `zod` override in `pnpm-workspace.yaml` to `zod@<4.6.7`.

## [0.2.3] - 2026-11-14

### Changed

- Updated the Redirect brand mark to a squircle `/>` logo across the navigation header (`Layout`), token unlock screen (`AuthGate`), theme-aware SVG favicons (`icon-192.svg`, `icon-512.svg`), and PWA/Apple PNG icons (`icon-192.png`, `icon-512.png`, `icon-512-maskable.png`, `apple-touch-icon.png`).

## [0.2.2] - 2026-11-14

### Changed

- Removed link import/export buttons from the Links dashboard tab, keeping them solely in **Settings → Data Portability**.

### Fixed

- Grouped each link item's active toggle and clicks pill on the left on mobile viewports while aligning the actions menu on the right.

## [0.2.1] - 2026-11-14

### Fixed

- Fixed QR code dialog footer buttons overflowing the modal on desktop by widening the dialog and aligning the three actions in a responsive grid.

## [0.2.0] - 2026-11-14

### Added

- **Links JSON Import & Export:**
  - `GET /api/v1/links/export` cursor-paginated endpoint supporting `limit` (default `500`, max `1000`), `search`, `tag`, and `isActive` filters, exporting portable versioned JSON (`version: 1`) without click analytics or API tokens.
  - `POST /api/v1/links/import` batch endpoint (up to `500` items per request) with configurable conflict modes (`"skip"` default or `"overwrite"`), per-item result tracking (`created`, `updated`, `skipped`, `failed`), explicit `skippedSlugs`/`createdSlugs`/`updatedSlugs`, auto-generated 6-character slugs when omitted, timezone offset normalization (`+HH:MM`/`Z`), merge-only overwrite semantics for omitted optional fields, and per-chunk database error recovery (`db_error`).
  - Frontend chunked transfer helpers (`exportAllLinks` with `maxPages` overflow guard, `importLinksChunked` with `200`-item chunks and `ImportChunkError` partial progress preservation), Dashboard filtered/full Export and Import triggers, **Settings → Data Portability** controls, and `ImportLinksModal` with per-reason skip annotations (`slug_exists` vs `duplicate_in_batch`) and partial-failure reporting.
- **Management Web Console (`/app/`):**
  - React 19 + Tailwind CSS v4 + Wouter SPA served under `/app/` with route-level code splitting.
  - Dashboard (`/app/`): quick shorten bar, advanced link modal, live debounced search, tag and status filters, pagination, active/inactive toggles, inline edit/delete, and client-side QR code modal.
  - Analytics (`/app/links/:id`): per-link daily click chart and optional country/referrer dimension breakdowns.
  - PWA & Web Share Target (`/app/share`): installable web app manifest (`manifest.webmanifest`), service worker (`sw.js`), and shared-URL shortening workflow.
  - Settings (`/app/settings`): API token creation (with expiry), one-time reveal modal, revocation, initial-token rotation, and Data Portability actions.
  - Cloudflare Zero Trust session-expiration detection and reload banner (`AccessExpiredBanner`).

### Changed

- Redesigned Workers KV token storage into self-indexing plaintext keys (`rdir_<id>_<secret>` and `rdir_initial_<secret>`) with KV metadata headers for direct single-op lookups, deletions, and prefix listing.
- Normalized target URL loop detection to handle FQDN trailing dots against request hostname and `OWN_HOSTNAMES`.
- Upgraded workspace package manager configuration to `pnpm@12.16.1`.

### Fixed

- Hardened D1 analytics writes with bounded referrer cardinality, dimension deduplication, and KV unauthenticated write-storm protection.
- Fixed dashboard URL query parameter sanitization, debounced search race conditions, expired-link toggle handling, modal state synchronization, and token listing page bounds.

## [0.1.0] - 2026-10-25

### Added

- Initial Cloudflare Workers + D1 + Workers KV release (`@redirect/shared`, `@redirect/api`, `@redirect/web`).
- Single-segment case-sensitive slug redirection engine with `/` `FALLBACK_URL` handling and query parameter forwarding.
- Token-authenticated Hono REST API (`/api/v1/*`) with zero-lockout lazy `initial_token` bootstrapping and optional `API_KEY` override.
- Daily D1 rollup analytics tables (`link_daily_clicks`, `link_daily_dims`) and automated Vitest test suites.
