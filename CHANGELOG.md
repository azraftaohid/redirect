# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.1] - 2026-11-14

### Fixed

- Fixed QR code dialog footer buttons overflowing the modal on desktop by widening the dialog and aligning the three actions in a responsive grid.

## [0.2.0] - 2026-11-14

### Added

- **Links JSON Import & Export:**
  - `GET /api/v1/links/export` cursor-paginated endpoint supporting `limit` (default `200`, max `500`), `search`, `tag`, and `isActive` filters, exporting portable versioned JSON (`version: 1`) without click analytics or API tokens.
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
