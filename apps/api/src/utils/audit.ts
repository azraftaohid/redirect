import type { Principal } from "../types.js";

/**
 * Emit a structured JSON audit log entry for security-sensitive mutations.
 * Never pass raw secret/token values in `details`.
 */
export function logAuditEvent(
  event: string,
  principal: Principal | undefined,
  details?: Record<string, unknown>
): void {
  console.info(
    JSON.stringify({
      ...details,
      type: "audit",
      event,
      timestamp: new Date().toISOString(),
      principalId: principal?.id ?? "unknown",
      principalKind: principal?.kind ?? "unknown",
    })
  );
}
