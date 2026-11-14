export const RESERVED_SLUGS = ["api", "app"] as const;

export const SLUG_REGEX = /^[A-Za-z0-9_-]{1,64}$/;

export const REDIRECT_STATUS_CODES = [301, 302, 307, 308] as const;
export type RedirectStatusCode = (typeof REDIRECT_STATUS_CODES)[number];
export const DEFAULT_STATUS_CODE: RedirectStatusCode = 307;

export const MAX_URL_LENGTH = 2048;
export const MAX_TAGS = 10;
export const MAX_TAG_LENGTH = 32;
export const MAX_TITLE_LENGTH = 200;
export const DEFAULT_SLUG_LENGTH = 6;

export const ANALYTICS_DIMENSIONS = ["country", "referrer"] as const;
export type AnalyticsDimension = (typeof ANALYTICS_DIMENSIONS)[number];

export const EXPORT_SCHEMA_VERSION = 1 as const;
export const EXPORT_DEFAULT_LIMIT = 500 as const;
export const EXPORT_MAX_LIMIT = 1000 as const;
export const IMPORT_MAX_BATCH_SIZE = 500 as const;
export const IMPORT_CLIENT_CHUNK_SIZE = 200 as const;

export const IMPORT_CONFLICT_MODES = ["skip", "overwrite"] as const;
export type ImportConflictMode = (typeof IMPORT_CONFLICT_MODES)[number];
