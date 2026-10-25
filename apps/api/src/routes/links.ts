import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  createLinkSchema,
  listLinksQuerySchema,
  updateLinkSchema,
  validateSlug,
  validateTargetUrl,
  parseOwnHostnames,
  DEFAULT_SLUG_LENGTH,
} from "@redirect/shared";
import type { AppContext } from "../types.js";
import { ApiError } from "../errors.js";
import {
  createLinkRecord,
  deleteLinkRecord,
  getLinkById,
  getLinkBySlug,
  listLinks,
  updateLinkRecord,
} from "../db/links.js";
import { generateValidRandomSlug } from "../utils/slug.js";

export const linksRouter = new Hono<AppContext>();

// GET /api/v1/links
linksRouter.get(
  "/links",
  zValidator("query", listLinksQuerySchema, (result) => {
    if (!result.success) {
      throw new ApiError(400, "validation_error", "Invalid query parameters", result.error.issues);
    }
  }),
  async (c) => {
    const query = c.req.valid("query");
    const result = await listLinks(c.env.DB, query);
    return c.json(result, 200, { "Cache-Control": "no-store" });
  }
);

// POST /api/v1/links
linksRouter.post(
  "/links",
  zValidator("json", createLinkSchema, (result) => {
    if (!result.success) {
      throw new ApiError(400, "validation_error", "Validation failed", result.error.issues);
    }
  }),
  async (c) => {
    const body = c.req.valid("json");
    const ownHostnames = parseOwnHostnames(new URL(c.req.url).hostname, c.env.OWN_HOSTNAMES);

    // Validate target URL against own hostnames (loop prevention)
    const targetValidation = validateTargetUrl(body.targetUrl, ownHostnames);
    if (!targetValidation.ok) {
      throw new ApiError(400, "invalid_target_url", targetValidation.error);
    }

    // Check future expiry
    if (body.expiresAt) {
      const expTime = new Date(body.expiresAt).getTime();
      if (!Number.isFinite(expTime) || expTime <= Date.now()) {
        throw new ApiError(400, "invalid_expiry", "expiresAt must be a valid future timestamp.");
      }
    }

    let slug: string;
    if (body.slug) {
      const slugValidation = validateSlug(body.slug);
      if (!slugValidation.ok) {
        throw new ApiError(400, "invalid_slug", slugValidation.error);
      }

      const existing = await getLinkBySlug(c.env.DB, body.slug);
      if (existing) {
        throw new ApiError(409, "slug_taken", `Slug '${body.slug}' is already taken.`);
      }
      slug = body.slug;
    } else {
      // Auto-generate slug with collision retry logic
      let generated: string | null = null;
      let len = DEFAULT_SLUG_LENGTH;

      for (let attempt = 0; attempt < 5; attempt++) {
        const candidate = generateValidRandomSlug(len);
        const existing = await getLinkBySlug(c.env.DB, candidate);
        if (!existing) {
          generated = candidate;
          break;
        }
      }

      if (!generated) {
        // Increase length by 1 and retry once
        const candidate = generateValidRandomSlug(len + 1);
        const existing = await getLinkBySlug(c.env.DB, candidate);
        if (!existing) {
          generated = candidate;
        }
      }

      if (!generated) {
        throw new ApiError(500, "slug_generation_failed", "Failed to generate unique slug.");
      }
      slug = generated;
    }

    const id = crypto.randomUUID();
    try {
      const record = await createLinkRecord(c.env.DB, id, slug, body);
      return c.json(record, 201, { "Cache-Control": "no-store" });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("UNIQUE constraint failed: links.slug")) {
        throw new ApiError(409, "slug_taken", `Slug '${slug}' is already taken.`);
      }
      throw err;
    }
  }
);

// GET /api/v1/links/:id
linksRouter.get("/links/:id", async (c) => {
  const id = c.req.param("id");
  const link = await getLinkById(c.env.DB, id);
  if (!link) {
    throw new ApiError(404, "not_found", `Link with id '${id}' not found.`);
  }
  return c.json(link, 200, { "Cache-Control": "no-store" });
});

// PATCH /api/v1/links/:id
linksRouter.patch(
  "/links/:id",
  zValidator("json", updateLinkSchema, (result) => {
    if (!result.success) {
      throw new ApiError(400, "validation_error", "Validation failed", result.error.issues);
    }
  }),
  async (c) => {
    const id = c.req.param("id");
    const body = c.req.valid("json");

    const existing = await getLinkById(c.env.DB, id);
    if (!existing) {
      throw new ApiError(404, "not_found", `Link with id '${id}' not found.`);
    }

    const ownHostnames = parseOwnHostnames(new URL(c.req.url).hostname, c.env.OWN_HOSTNAMES);

    if (body.targetUrl !== undefined) {
      const targetValidation = validateTargetUrl(body.targetUrl, ownHostnames);
      if (!targetValidation.ok) {
        throw new ApiError(400, "invalid_target_url", targetValidation.error);
      }
    }

    if (body.expiresAt) {
      const expTime = new Date(body.expiresAt).getTime();
      if (!Number.isFinite(expTime) || expTime <= Date.now()) {
        throw new ApiError(400, "invalid_expiry", "expiresAt must be a valid future timestamp.");
      }
    }

    if (body.slug !== undefined && body.slug !== existing.slug) {
      const slugValidation = validateSlug(body.slug);
      if (!slugValidation.ok) {
        throw new ApiError(400, "invalid_slug", slugValidation.error);
      }

      const slugInUse = await getLinkBySlug(c.env.DB, body.slug);
      if (slugInUse && slugInUse.id !== existing.id) {
        throw new ApiError(409, "slug_taken", `Slug '${body.slug}' is already taken.`);
      }
    }

    try {
      const updated = await updateLinkRecord(c.env.DB, existing, body);
      return c.json(updated, 200, { "Cache-Control": "no-store" });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("UNIQUE constraint failed: links.slug")) {
        throw new ApiError(409, "slug_taken", `Slug '${body.slug}' is already taken.`);
      }
      throw err;
    }
  }
);

// DELETE /api/v1/links/:id
linksRouter.delete("/links/:id", async (c) => {
  const id = c.req.param("id");
  const existing = await getLinkById(c.env.DB, id);
  if (!existing) {
    throw new ApiError(404, "not_found", `Link with id '${id}' not found.`);
  }

  await deleteLinkRecord(c.env.DB, id);
  return c.json({ deleted: true, id }, 200, { "Cache-Control": "no-store" });
});
