import { z } from "zod";
import {
  EXPORT_DEFAULT_LIMIT,
  EXPORT_MAX_LIMIT,
  EXPORT_SCHEMA_VERSION,
  IMPORT_CONFLICT_MODES,
  IMPORT_MAX_BATCH_SIZE,
  MAX_TAG_LENGTH,
  MAX_TAGS,
  MAX_TITLE_LENGTH,
  MAX_URL_LENGTH,
  REDIRECT_STATUS_CODES,
  RedirectStatusCode,
  SLUG_REGEX,
  type ImportConflictMode,
} from "./constants.js";
import { UNSAFE_URL_CHARS_REGEX, validateSlug } from "./validation.js";

export const slugSchema = z
  .string()
  .trim()
  .regex(SLUG_REGEX, "Slug must be 1-64 characters and contain only [A-Za-z0-9_-]")
  .superRefine((val, ctx) => {
    const res = validateSlug(val);
    if (!res.ok) {
      ctx.addIssue({
        code: "custom",
        message: res.error,
      });
    }
  });

export const targetUrlSchema = z
  .string()
  .trim()
  .min(1, "Target URL is required")
  .max(MAX_URL_LENGTH, `Target URL must be at most ${MAX_URL_LENGTH} characters`)
  .superRefine((val, ctx) => {
    if (UNSAFE_URL_CHARS_REGEX.test(val)) {
      ctx.addIssue({
        code: "custom",
        message: "Target URL must not contain control characters or unencoded spaces",
      });
      return;
    }
    try {
      const parsed = new URL(val);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        ctx.addIssue({
          code: "custom",
          message: "Target URL protocol must be either 'http:' or 'https:'",
        });
      }
    } catch {
      ctx.addIssue({
        code: "custom",
        message: "Target URL must be a valid absolute URL",
      });
    }
  });

export const titleSchema = z
  .string()
  .trim()
  .max(MAX_TITLE_LENGTH, `Title must be at most ${MAX_TITLE_LENGTH} characters`)
  .transform((val) => (val === "" ? null : val))
  .nullable()
  .optional();

export const statusCodeSchema = z.union(
  REDIRECT_STATUS_CODES.map((code) => z.literal(code))
);

export const tagsSchema = z
  .array(
    z
      .string()
      .trim()
      .toLowerCase()
      .min(1, "Tag cannot be empty")
      .max(MAX_TAG_LENGTH, `Tag must be at most ${MAX_TAG_LENGTH} characters`)
  )
  .max(MAX_TAGS, `Cannot exceed ${MAX_TAGS} tags`)
  .transform((tags) => Array.from(new Set(tags)));

const linkBaseFields = {
  targetUrl: targetUrlSchema,
  slug: slugSchema,
  title: titleSchema,
  statusCode: statusCodeSchema,
  tags: tagsSchema,
  isActive: z.boolean(),
  forwardQuery: z.boolean(),
  expiresAt: z.iso.datetime().nullable(),
};

export const createLinkSchema = z.object({
  targetUrl: linkBaseFields.targetUrl,
  slug: linkBaseFields.slug.optional(),
  title: linkBaseFields.title,
  statusCode: linkBaseFields.statusCode.optional(),
  tags: linkBaseFields.tags.optional(),
  isActive: linkBaseFields.isActive.optional(),
  forwardQuery: linkBaseFields.forwardQuery.optional(),
  expiresAt: linkBaseFields.expiresAt.optional(),
});
export type CreateLinkInput = z.infer<typeof createLinkSchema>;

export const updateLinkSchema = z
  .object({
    targetUrl: linkBaseFields.targetUrl.optional(),
    slug: linkBaseFields.slug.optional(),
    title: linkBaseFields.title,
    statusCode: linkBaseFields.statusCode.optional(),
    tags: linkBaseFields.tags.optional(),
    isActive: linkBaseFields.isActive.optional(),
    forwardQuery: linkBaseFields.forwardQuery.optional(),
    expiresAt: linkBaseFields.expiresAt.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided for update",
  });
export type UpdateLinkInput = z.infer<typeof updateLinkSchema>;

export const listLinksQuerySchema = z.object({
  search: z.string().max(200).optional(),
  tag: z.string().max(MAX_TAG_LENGTH).optional(),
  slug: z.string().optional(),
  targetUrl: z.string().optional(),
  isActive: z.enum(["true", "false"]).optional(),
  sortBy: z.enum(["createdAt", "updatedAt", "clickCount", "slug"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListLinksQuery = z.infer<typeof listLinksQuerySchema>;

export const statsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});
export type StatsQuery = z.infer<typeof statsQuerySchema>;

export const createTokenSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(64, "Name must be at most 64 characters"),
  expiresAt: z.iso.datetime().nullable().optional(),
});
export type CreateTokenInput = z.infer<typeof createTokenSchema>;

export interface LinkRecord {
  id: string;
  slug: string;
  targetUrl: string;
  title: string | null;
  statusCode: RedirectStatusCode;
  tags: string[];
  isActive: boolean;
  forwardQuery: boolean;
  expiresAt: string | null;
  clickCount: number;
  lastClickedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TokenInfo {
  id: string;
  name: string;
  createdAt: string;
  expiresAt: string | null;
  preview: string;
  isInitial?: boolean;
}

export interface DimRow {
  value: string;
  clicks: number;
}

export interface LinkStats {
  link: LinkRecord;
  range: {
    days: number;
    from: string;
    to: string;
  };
  daily: Array<{ day: string; clicks: number }>;
  dimensions: {
    country?: DimRow[];
    referrer?: DimRow[];
  };
}

export interface Paginated<T> {
  data: T[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export const exportLinksQuerySchema = z.object({
  search: z.string().max(200).optional(),
  tag: z.string().max(MAX_TAG_LENGTH).optional(),
  isActive: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(EXPORT_MAX_LIMIT).default(EXPORT_DEFAULT_LIMIT),
  cursor: z.string().min(1).max(512).optional(),
});
export type ExportLinksQuery = z.infer<typeof exportLinksQuerySchema>;

export const importLinkItemSchema = z.object({
  slug: linkBaseFields.slug.optional(),
  targetUrl: linkBaseFields.targetUrl,
  title: linkBaseFields.title,
  statusCode: linkBaseFields.statusCode.optional(),
  tags: linkBaseFields.tags.optional(),
  isActive: linkBaseFields.isActive.optional(),
  forwardQuery: linkBaseFields.forwardQuery.optional(),
  // Past expiresAt values are intentionally permitted for round-trip backup imports;
  // redirect lookup enforces expiration at request time.
  expiresAt: z.iso.datetime({ offset: true }).nullable().optional(),
  createdAt: z.iso.datetime({ offset: true }).optional(),
  updatedAt: z.iso.datetime({ offset: true }).optional(),
});
export type ImportLinkInput = z.infer<typeof importLinkItemSchema>;

export const importLinksEnvelopeSchema = z.object({
  version: z.literal(EXPORT_SCHEMA_VERSION),
  onConflict: z.enum(IMPORT_CONFLICT_MODES).default("skip"),
  links: z
    .array(z.unknown())
    .min(1, "At least one link is required")
    .max(
      IMPORT_MAX_BATCH_SIZE,
      `Cannot import more than ${IMPORT_MAX_BATCH_SIZE} links per request`
    ),
});
export type ImportLinksEnvelope = z.infer<typeof importLinksEnvelopeSchema>;

export interface ExportedLink {
  slug: string;
  targetUrl: string;
  title: string | null;
  statusCode: RedirectStatusCode;
  tags: string[];
  isActive: boolean;
  forwardQuery: boolean;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LinksExportEnvelope {
  version: typeof EXPORT_SCHEMA_VERSION;
  exportedAt: string;
  count: number;
  links: ExportedLink[];
  pagination?: {
    limit: number;
    nextCursor: string | null;
    hasMore: boolean;
  };
}

export interface ImportLinksRequest {
  version: typeof EXPORT_SCHEMA_VERSION;
  onConflict?: ImportConflictMode;
  links: ImportLinkInput[];
}

export interface ImportItemError {
  index: number;
  slug: string | null;
  code: string;
  message: string;
}

export interface ImportItemResult {
  index: number;
  slug: string;
  status: "created" | "updated" | "skipped" | "failed";
  id?: string;
  reason?: string;
}

export interface ImportLinksResponse {
  version: typeof EXPORT_SCHEMA_VERSION;
  onConflict: ImportConflictMode;
  summary: {
    total: number;
    created: number;
    updated: number;
    skipped: number;
    failed: number;
  };
  skippedSlugs: string[];
  createdSlugs: string[];
  updatedSlugs: string[];
  errors: ImportItemError[];
  results: ImportItemResult[];
}
