import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { statsQuerySchema } from "@redirect/shared";
import type { AppContext } from "../types.js";
import { ApiError } from "../errors.js";
import { getLinkById } from "../db/links.js";
import { getLinkStats } from "../db/stats.js";

export const statsRouter = new Hono<AppContext>();

// GET /api/v1/links/:id/stats
statsRouter.get(
  "/links/:id/stats",
  zValidator("query", statsQuerySchema, (result) => {
    if (!result.success) {
      throw new ApiError(400, "validation_error", "Invalid query parameters", result.error.issues);
    }
  }),
  async (c) => {
    const id = c.req.param("id");
    const query = c.req.valid("query");

    const link = await getLinkById(c.env.DB, id);
    if (!link) {
      throw new ApiError(404, "not_found", `Link with id '${id}' not found.`);
    }

    const enabledDims = (c.env.ANALYTICS_DIMENSIONS || "")
      .split(",")
      .map((d) => d.trim().toLowerCase())
      .filter((d) => d === "country" || d === "referrer");

    const stats = await getLinkStats(
      c.env.DB,
      link.id,
      link.clickCount,
      link.lastClickedAt,
      query.days,
      enabledDims
    );

    return c.json(stats, 200, { "Cache-Control": "no-store" });
  }
);
