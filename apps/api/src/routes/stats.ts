import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { statsQuerySchema } from "@redirect/shared";
import type { AppContext } from "../types.js";
import { ApiError } from "../errors.js";
import { getLinkStats } from "../db/stats.js";
import { parseEnabledDimensions } from "../utils/analytics.js";

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

    const enabledDims = parseEnabledDimensions(c.env.ANALYTICS_DIMENSIONS);
    const stats = await getLinkStats(c.env.DB, id, query.days, enabledDims);

    if (!stats) {
      throw new ApiError(404, "not_found", `Link with id '${id}' not found.`);
    }

    return c.json(stats, 200, { "Cache-Control": "no-store" });
  }
);
