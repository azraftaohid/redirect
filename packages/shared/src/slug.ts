import { DEFAULT_SLUG_LENGTH } from "./constants.js";
import { validateSlug } from "./validation.js";

export const BASE62_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export function randomBase62(length: number): string {
  let result = "";
  while (result.length < length) {
    const randomBytes = new Uint8Array(length * 2);
    crypto.getRandomValues(randomBytes);
    for (const b of randomBytes) {
      if (b < 248) {
        result += BASE62_ALPHABET[b % 62];
        if (result.length === length) {
          break;
        }
      }
    }
  }
  return result;
}

export function generateRandomSlug(length = DEFAULT_SLUG_LENGTH): string {
  return randomBase62(length);
}

export function generateValidRandomSlug(length = DEFAULT_SLUG_LENGTH): string {
  for (let attempt = 0; attempt < 100; attempt++) {
    const slug = generateRandomSlug(length);
    if (validateSlug(slug).ok) {
      return slug;
    }
  }
  throw new Error("Failed to generate a valid random slug.");
}
