import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  createLinkSchema,
  exportLinksQuerySchema,
  EXPORT_SCHEMA_VERSION,
  importLinksEnvelopeSchema,
  listLinksQuerySchema,
  updateLinkSchema,
  validateSlug,
  validateTargetUrl,
  parseOwnHostnames,
  DEFAULT_SLUG_LENGTH,
  generateValidRandomSlug,
  type LinkRecord,
  type LinksExportEnvelope,
} from "@redirect/shared";
import type { AppContext } from "../types.js";
import { ApiError } from "../errors.js";
import { logAuditEvent } from "../utils/audit.js";
import {
  createLinkRecord,
  decodeExportCursor,
  deleteLinkRecord,
  exportLinks,
  getLinkById,
  importLinksBatch,
  listLinks,
  updateLinkRecord,
} from "../db/links.js";

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

    const id = crypto.randomUUID();

    if (body.slug) {
      const slugValidation = validateSlug(body.slug);
      if (!slugValidation.ok) {
        throw new ApiError(400, "invalid_slug", slugValidation.error);
      }

      const record = await createLinkRecord(c.env.DB, id, body.slug, body);
      if (!record) {
        throw new ApiError(409, "slug_taken", `Slug '${body.slug}' is already taken.`);
      }
      logAuditEvent("link.create", c.get("principal"), {
        linkId: record.id,
        slug: record.slug,
      });
      return c.json(record, 201, { "Cache-Control": "no-store" });
    }

    // Auto-generate slug with collision retry logic (no pre-read SELECTs)
    let record: LinkRecord | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = generateValidRandomSlug(DEFAULT_SLUG_LENGTH);
      record = await createLinkRecord(c.env.DB, id, candidate, body);
      if (record) break;
    }

    if (!record) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const candidate = generateValidRandomSlug(DEFAULT_SLUG_LENGTH + 1);
        record = await createLinkRecord(c.env.DB, id, candidate, body);
        if (record) break;
      }
    }

    if (!record) {
      throw new ApiError(500, "slug_generation_failed", "Failed to generate unique slug.");
    }

    logAuditEvent("link.create", c.get("principal"), {
      linkId: record.id,
      slug: record.slug,
    });
    return c.json(record, 201, { "Cache-Control": "no-store" });
  }
);

// GET /api/v1/links/export (must be registered before /links/:id)
linksRouter.get(
  "/links/export",
  zValidator("query", exportLinksQuerySchema, (result) => {
    if (!result.success) {
      throw new ApiError(400, "validation_error", "Invalid query parameters", result.error.issues);
    }
  }),
  async (c) => {
    const query = c.req.valid("query");
    const decodedCursor = query.cursor ? decodeExportCursor(query.cursor) : null;
    if (query.cursor && !decodedCursor) {
      throw new ApiError(400, "invalid_cursor", "Invalid pagination cursor.");
    }

    const result = await exportLinks(c.env.DB, query, decodedCursor);
    const exportedAt = new Date().toISOString();
    const datePart = exportedAt.slice(0, 10);

    const body: LinksExportEnvelope = {
      version: EXPORT_SCHEMA_VERSION,
      exportedAt,
      count: result.links.length,
      links: result.links,
      pagination: result.pagination,
    };

    return c.json(body, 200, {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="redirect-links-${datePart}.json"`,
    });
  }
);

// POST /api/v1/links/import (must be registered before /links/:id)
linksRouter.post(
  "/links/import",
  zValidator("json", importLinksEnvelopeSchema, (result) => {
    if (!result.success) {
      throw new ApiError(400, "validation_error", "Validation failed", result.error.issues);
    }
  }),
  async (c) => {
    const body = c.req.valid("json");
    const ownHostnames = parseOwnHostnames(new URL(c.req.url).hostname, c.env.OWN_HOSTNAMES);
    const result = await importLinksBatch(c.env.DB, body.links, body.onConflict, ownHostnames);
    logAuditEvent("link.import", c.get("principal"), {
      onConflict: body.onConflict,
      summary: result.summary,
    });
    return c.json(result, 200, { "Cache-Control": "no-store" });
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

    const ownHostnames = parseOwnHostnames(new URL(c.req.url).hostname, c.env.OWN_HOSTNAMES);

    if (body.targetUrl !== undefined) {
      const targetValidation = validateTargetUrl(body.targetUrl, ownHostnames);
      if (!targetValidation.ok) {
        throw new ApiError(400, "invalid_target_url", targetValidation.error);
      }
    }

    // Contract (R1.5): null clears expiry; a provided value must be in the future.
    // Because clients send only changed fields (R4.3), an untouched past expiry is never resent.
    if (body.expiresAt) {
      const expTime = new Date(body.expiresAt).getTime();
      if (!Number.isFinite(expTime) || expTime <= Date.now()) {
        throw new ApiError(400, "invalid_expiry", "expiresAt must be a valid future timestamp.");
      }
    }

    if (body.slug !== undefined) {
      const slugValidation = validateSlug(body.slug);
      if (!slugValidation.ok) {
        throw new ApiError(400, "invalid_slug", slugValidation.error);
      }
    }

    try {
      const updated = await updateLinkRecord(c.env.DB, id, body);
      if (!updated) {
        throw new ApiError(404, "not_found", `Link with id '${id}' not found.`);
      }
      logAuditEvent("link.update", c.get("principal"), {
        linkId: updated.id,
        slug: updated.slug,
        fields: Object.keys(body),
      });
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
  const deleted = await deleteLinkRecord(c.env.DB, id);
  if (!deleted) {
    throw new ApiError(404, "not_found", `Link with id '${id}' not found.`);
  }
  logAuditEvent("link.delete", c.get("principal"), { linkId: id, slug: deleted.slug });
  return c.json({ deleted: true, id }, 200, { "Cache-Control": "no-store" });
});
