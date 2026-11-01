import { z } from "zod";
import {
  MAX_TAG_LENGTH,
  MAX_TAGS,
  MAX_TITLE_LENGTH,
  MAX_URL_LENGTH,
  REDIRECT_STATUS_CODES,
  RedirectStatusCode,
  SLUG_REGEX,
} from "./constants.js";
import { validateSlug } from "./validation.js";

export const slugSchema = z
  .string()
  .trim()
  .regex(SLUG_REGEX, "Slug must be 1-64 characters and contain only [A-Za-z0-9_-]")
  .superRefine((val, ctx) => {
    const res = validateSlug(val);
    if (!res.ok) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
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
    try {
      const parsed = new URL(val);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Target URL protocol must be either 'http:' or 'https:'",
        });
      }
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Target URL must be a valid absolute URL",
      });
    }
  });

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

export const createLinkSchema = z.object({
  targetUrl: targetUrlSchema,
  slug: slugSchema.optional(),
  title: z
    .string()
    .trim()
    .max(MAX_TITLE_LENGTH, `Title must be at most ${MAX_TITLE_LENGTH} characters`)
    .nullable()
    .optional(),
  statusCode: z
    .union([z.literal(301), z.literal(302), z.literal(307), z.literal(308)])
    .optional(),
  tags: tagsSchema.optional(),
  isActive: z.boolean().optional(),
  forwardQuery: z.boolean().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});
export type CreateLinkInput = z.infer<typeof createLinkSchema>;

export const updateLinkSchema = z
  .object({
    targetUrl: targetUrlSchema.optional(),
    slug: slugSchema.optional(),
    title: z
      .string()
      .trim()
      .max(MAX_TITLE_LENGTH, `Title must be at most ${MAX_TITLE_LENGTH} characters`)
      .nullable()
      .optional(),
    statusCode: z
      .union([z.literal(301), z.literal(302), z.literal(307), z.literal(308)])
      .optional(),
    tags: tagsSchema.optional(),
    isActive: z.boolean().optional(),
    forwardQuery: z.boolean().optional(),
    expiresAt: z.string().datetime().nullable().optional(),
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
  expiresAt: z.string().datetime().nullable().optional(),
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
