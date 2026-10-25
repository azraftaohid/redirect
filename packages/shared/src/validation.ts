import { MAX_URL_LENGTH, RESERVED_SLUGS, SLUG_REGEX } from "./constants.js";

export function validateSlug(slug: string): { ok: true } | { ok: false; error: string } {
  if (!SLUG_REGEX.test(slug)) {
    return {
      ok: false,
      error: "Slug must be 1-64 characters and contain only letters, numbers, underscores, and dashes.",
    };
  }

  const lower = slug.toLowerCase();
  if ((RESERVED_SLUGS as readonly string[]).includes(lower)) {
    return {
      ok: false,
      error: `Slug '${slug}' is reserved and cannot be used.`,
    };
  }

  return { ok: true };
}

export function parseOwnHostnames(
  requestHostname: string,
  ownHostnamesVar?: string | null
): string[] {
  const result = new Set<string>();

  const trimmedRequestHost = requestHostname.trim().toLowerCase();
  if (trimmedRequestHost) {
    result.add(trimmedRequestHost);
  }

  if (ownHostnamesVar) {
    const parts = ownHostnamesVar.split(",");
    for (const part of parts) {
      const trimmed = part.trim().toLowerCase();
      if (trimmed) {
        result.add(trimmed);
      }
    }
  }

  return Array.from(result);
}

export function validateTargetUrl(
  url: string,
  ownHostnames: string[] = []
): { ok: true } | { ok: false; error: string } {
  if (typeof url !== "string") {
    return { ok: false, error: "Target URL must be a string." };
  }

  if (url.length === 0) {
    return { ok: false, error: "Target URL cannot be empty." };
  }

  if (url.length > MAX_URL_LENGTH) {
    return {
      ok: false,
      error: `Target URL exceeds maximum length of ${MAX_URL_LENGTH} characters.`,
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: "Target URL is not a valid absolute URL." };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      ok: false,
      error: "Target URL protocol must be either 'http:' or 'https:'.",
    };
  }

  const lowerTargetHost = parsed.hostname.toLowerCase();
  const lowerOwnHosts = ownHostnames.map((h) => h.toLowerCase());

  if (lowerOwnHosts.includes(lowerTargetHost)) {
    return {
      ok: false,
      error: "Target URL cannot point to the redirector's own domain (loop prevention).",
    };
  }

  return { ok: true };
}
