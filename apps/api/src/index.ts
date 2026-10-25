import { Hono } from "hono";
import type { AppContext } from "./types.js";
import { handleApiError, ApiError } from "./errors.js";
import { authMiddleware } from "./auth/middleware.js";
import { tokensRouter } from "./routes/tokens.js";
import { linksRouter } from "./routes/links.js";
import { statsRouter } from "./routes/stats.js";

const app = new Hono<AppContext>();

// Global error handling
app.onError((err, c) => {
  return handleApiError(err, c);
});

// Public health check
app.get("/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() }, 200, {
    "Cache-Control": "no-store",
  });
});

// API v1 Sub-app
const apiV1 = new Hono<AppContext>();
apiV1.use("*", authMiddleware);
apiV1.route("/", tokensRouter);
apiV1.route("/", linksRouter);
apiV1.route("/", statsRouter);

// Mount API v1 router
app.route("/api/v1", apiV1);

// Any other /api/* route -> 404 JSON
app.all("/api/*", (c) => {
  throw new ApiError(404, "not_found", "API endpoint not found.");
});

export default app;
