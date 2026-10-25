function decodeKey(rawKey: string): string {
  try {
    return decodeURIComponent(rawKey.replace(/\+/g, " "));
  } catch {
    return rawKey;
  }
}

/**
 * Merges incoming query parameters into the target URL.
 *
 * Rules:
 * - If forwardQuery is false or the incoming query is empty, return targetUrl unchanged.
 * - Target query parameters and their exact encoding (%20, +, etc.) are preserved byte-for-byte.
 * - Target-defined keys win: any incoming parameter with a matching key is discarded.
 * - Incoming parameter order and duplicates for un-shadowed keys are preserved.
 * - Fragments (#...) on the target URL are preserved at the very end.
 */
export function mergeQuery(
  targetUrl: string,
  incomingSearch: string,
  forwardQuery: boolean
): string {
  if (!forwardQuery) {
    return targetUrl;
  }

  const rawIncoming = incomingSearch.startsWith("?")
    ? incomingSearch.slice(1)
    : incomingSearch;

  if (!rawIncoming || rawIncoming.trim() === "") {
    return targetUrl;
  }

  // Split target on its first '#' to preserve the fragment
  const hashIdx = targetUrl.indexOf("#");
  const targetWithoutHash = hashIdx >= 0 ? targetUrl.slice(0, hashIdx) : targetUrl;
  const fragment = hashIdx >= 0 ? targetUrl.slice(hashIdx) : "";

  // Split target without hash on its first '?' to separate base URL and existing query
  const questionIdx = targetWithoutHash.indexOf("?");
  const base = questionIdx >= 0 ? targetWithoutHash.slice(0, questionIdx) : targetWithoutHash;
  const existingTargetQuery = questionIdx >= 0 ? targetWithoutHash.slice(questionIdx + 1) : "";

  // Compute the target's key set by decoding keys with URLSearchParams (read-only, no re-serialization)
  const targetKeys = new Set<string>();
  if (existingTargetQuery) {
    const searchParams = new URLSearchParams(existingTargetQuery);
    for (const key of searchParams.keys()) {
      targetKeys.add(key);
    }
  }

  // Split the incoming raw query on '&'; keep each raw pair whose decoded key is NOT in targetKeys
  const rawPairs = rawIncoming.split("&");
  const keptPairs: string[] = [];

  for (const pair of rawPairs) {
    if (!pair || pair.trim() === "") {
      continue;
    }
    const eqIdx = pair.indexOf("=");
    const rawKey = eqIdx >= 0 ? pair.slice(0, eqIdx) : pair;
    const decodedKey = decodeKey(rawKey);

    if (!targetKeys.has(decodedKey)) {
      keptPairs.push(pair);
    }
  }

  if (keptPairs.length === 0) {
    return targetUrl;
  }

  const appended = keptPairs.join("&");
  const queryPart = existingTargetQuery
    ? `?${existingTargetQuery}&${appended}`
    : `?${appended}`;

  return `${base}${queryPart}${fragment}`;
}
