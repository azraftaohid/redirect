/**
 * Utilities for parsing incoming Web Share Target payloads (e.g. from iOS/Android share sheets).
 */

export interface SharedPayload {
  targetUrl: string | null;
  title: string | null;
  text: string | null;
}

const URL_REGEX = /https?:\/\/[^\s"'<>]+/i;

/**
 * Extracts candidate URL and title from Web Share Target URLSearchParams.
 * Mobile apps frequently combine URLs and captions into the `text` field.
 */
export function extractSharedPayload(params: URLSearchParams): SharedPayload {
  const rawUrl = params.get("url")?.trim() || "";
  const rawText = params.get("text")?.trim() || "";
  const rawTitle = params.get("title")?.trim() || "";

  let detectedUrl: string | null = null;

  // 1. Check if rawUrl itself is valid
  if (rawUrl && /^https?:\/\//i.test(rawUrl)) {
    detectedUrl = rawUrl;
  }

  // 2. If not found, look for URL in text
  if (!detectedUrl && rawText) {
    const match = rawText.match(URL_REGEX);
    if (match && match[0]) {
      detectedUrl = match[0];
    }
  }

  // 3. If still not found, look for URL in title
  if (!detectedUrl && rawTitle) {
    const match = rawTitle.match(URL_REGEX);
    if (match && match[0]) {
      detectedUrl = match[0];
    }
  }

  // Clean trailing punctuation from detected URL (e.g. trailing period, parenthesis)
  if (detectedUrl) {
    detectedUrl = detectedUrl.replace(/[.,;:!?)>]+$/, "");
  }

  // Use remaining non-URL text or title as link title/label
  let derivedTitle: string | null = rawTitle || null;
  if (!derivedTitle && rawText && detectedUrl && rawText !== detectedUrl) {
    const textWithoutUrl = rawText.replace(detectedUrl, "").trim();
    if (textWithoutUrl) {
      derivedTitle = textWithoutUrl;
    }
  }

  return {
    targetUrl: detectedUrl,
    title: derivedTitle,
    text: rawText || null,
  };
}
