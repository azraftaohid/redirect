import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ApiErrorBody } from "@redirect/shared";

export class ApiError extends Error {
  public readonly status: ContentfulStatusCode;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(status: ContentfulStatusCode, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function formatErrorResponse(
  status: ContentfulStatusCode,
  code: string,
  message: string,
  details?: unknown
): { body: ApiErrorBody; status: ContentfulStatusCode } {
  return {
    status,
    body: {
      error: {
        code,
        message,
        ...(details !== undefined ? { details } : {}),
      },
    },
  };
}

export function handleApiError(err: unknown, c: Context): Response {
  if (err instanceof ApiError) {
    const { status, body } = formatErrorResponse(
      err.status,
      err.code,
      err.message,
      err.details
    );
    return c.json(body, status, { "Cache-Control": "no-store" });
  }

  console.error("Unhandled error:", err);
  const { status, body } = formatErrorResponse(
    500,
    "internal_error",
    "An unexpected error occurred."
  );
  return c.json(body, status, { "Cache-Control": "no-store" });
}
