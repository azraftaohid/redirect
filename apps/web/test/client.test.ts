import { describe, it, expect, beforeEach } from "vitest";
import {
  AUTH_TOKEN_STORAGE_KEY,
  AUTH_TOKEN_SET_AT_STORAGE_KEY,
  getStoredToken,
  getStoredTokenSetAt,
  setStoredToken,
  clearStoredToken,
  ApiClientError,
  AccessSessionExpiredError,
} from "../src/api/client";

describe("API client & storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("stores and retrieves token with timestamp", () => {
    expect(getStoredToken()).toBeNull();
    expect(getStoredTokenSetAt()).toBe(0);

    const before = Date.now();
    setStoredToken("test_secret_token_123");
    const after = Date.now();

    expect(getStoredToken()).toBe("test_secret_token_123");
    const setAt = getStoredTokenSetAt();
    expect(setAt).toBeGreaterThanOrEqual(before);
    expect(setAt).toBeLessThanOrEqual(after);
  });

  it("clears stored token and timestamp", () => {
    setStoredToken("sample_token");
    expect(getStoredToken()).toBe("sample_token");

    clearStoredToken();
    expect(getStoredToken()).toBeNull();
    expect(getStoredTokenSetAt()).toBe(0);
  });

  it("creates ApiClientError with status and code", () => {
    const err = new ApiClientError(404, "not_found", "Link was not found", { id: "123" });
    expect(err.name).toBe("ApiClientError");
    expect(err.status).toBe(404);
    expect(err.code).toBe("not_found");
    expect(err.message).toBe("Link was not found");
    expect(err.details).toEqual({ id: "123" });
  });

  it("creates AccessSessionExpiredError and dispatches redirect:access-expired event", () => {
    let eventReceived = false;
    const listener = () => {
      eventReceived = true;
    };
    window.addEventListener("redirect:access-expired", listener);

    const err = new AccessSessionExpiredError("Custom session message");
    expect(err.name).toBe("AccessSessionExpiredError");
    expect(err.message).toBe("Custom session message");
    expect(eventReceived).toBe(true);

    window.removeEventListener("redirect:access-expired", listener);
  });
});
