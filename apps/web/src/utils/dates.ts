/**
 * Date formatting and conversion utilities for local timezone and UTC handling.
 */

/**
 * Converts a UTC ISO string (e.g. from API) into the "YYYY-MM-DDTHH:mm" format
 * expected by <input type="datetime-local"> in the user's local timezone.
 */
export function toLocalDatetimeInputValue(utcIsoString?: string | null): string {
  if (!utcIsoString) return "";
  const date = new Date(utcIsoString);
  if (isNaN(date.getTime())) return "";

  const pad = (n: number) => String(n).padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());

  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

/**
 * Converts a local datetime-local input string ("YYYY-MM-DDTHH:mm")
 * into a UTC ISO string (e.g. "2026-10-25T12:00:00.000Z") for the API.
 */
export function fromLocalDatetimeInputValue(localDatetimeValue?: string | null): string | null {
  if (!localDatetimeValue || !localDatetimeValue.trim()) return null;
  const date = new Date(localDatetimeValue);
  if (isNaN(date.getTime())) return null;
  return date.toISOString();
}

/**
 * Formats a date string into a user-friendly relative or localized date.
 */
export function formatDisplayDate(dateInput: string | Date | null | undefined): string {
  if (!dateInput) return "—";
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  if (isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

/**
 * Determines if an expiration date has passed.
 */
export function isLinkExpired(expiresAt?: string | null): boolean {
  if (!expiresAt) return false;
  const exp = new Date(expiresAt).getTime();
  return !isNaN(exp) && exp <= Date.now();
}
