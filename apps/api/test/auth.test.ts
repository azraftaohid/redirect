import { describe, it, expect, beforeEach } from "vitest";
import { env, SELF } from "cloudflare:test";
import { TOKEN_FORMAT } from "../src/auth/tokens.js";

describe("Authentication & Token Management", () => {
  beforeEach(async () => {
    // Clear KV keys
    const list = await env.AUTH_TOKENS.list();
    for (const key of list.keys) {
      await env.AUTH_TOKENS.delete(key.name);
    }
  });

  it("does not trigger ensureInitialToken on arbitrary unauthenticated endpoints (H2.2/B26)", async () => {
    // Before request, initial_token does not exist
    const beforeToken = await env.AUTH_TOKENS.get("initial_token");
    expect(beforeToken).toBeNull();

    // Hitting /api/v1/links without token returns 401 but does NOT write initial_token
    const resLinks = await SELF.fetch("https://redirect.example.com/api/v1/links");
    expect(resLinks.status).toBe(401);
    const tokenAfterLinks = await env.AUTH_TOKENS.get("initial_token");
    expect(tokenAfterLinks).toBeNull();

    // Hitting /api/v1/auth/verify without token returns 401 AND bootstraps initial_token
    const resVerify = await SELF.fetch("https://redirect.example.com/api/v1/auth/verify");
    expect(resVerify.status).toBe(401);
    const tokenAfterVerify = await env.AUTH_TOKENS.get("initial_token");
    expect(tokenAfterVerify).not.toBeNull();
    expect(tokenAfterVerify).toMatch(/^rdir_initial_[A-Za-z0-9]{32}$/);
  });

  it("returns 401 and lazily bootstraps initial_token on unauthenticated request", async () => {
    // Before request, initial_token does not exist
    const beforeToken = await env.AUTH_TOKENS.get("initial_token");
    expect(beforeToken).toBeNull();

    const res = await SELF.fetch("https://redirect.example.com/api/v1/auth/verify");
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toBe("Bearer");
    expect(res.headers.get("Cache-Control")).toBe("no-store");

    const body = (await res.json()) as any;
    expect(body.error.code).toBe("unauthorized");

    // After unauthenticated request, initial_token was bootstrapped in KV
    const initialToken = await env.AUTH_TOKENS.get("initial_token");
    expect(initialToken).not.toBeNull();
    expect(initialToken).toMatch(/^rdir_initial_[A-Za-z0-9]{32}$/);
    expect(TOKEN_FORMAT.test(initialToken!)).toBe(true);
  });

  it("authenticates via Authorization: Bearer <initial_token> and X-API-Key", async () => {
    // Trigger lazy bootstrap
    await SELF.fetch("https://redirect.example.com/api/v1/auth/verify");
    const initialToken = (await env.AUTH_TOKENS.get("initial_token"))!;

    // Bearer
    const resBearer = await SELF.fetch("https://redirect.example.com/api/v1/auth/verify", {
      headers: { Authorization: `Bearer ${initialToken}` },
    });
    expect(resBearer.status).toBe(200);
    const bodyBearer = (await resBearer.json()) as any;
    expect(bodyBearer.principal).toEqual({
      kind: "initial",
      id: "initial",
      name: "Initial token",
    });

    // X-API-Key
    const resApiKey = await SELF.fetch("https://redirect.example.com/api/v1/auth/verify", {
      headers: { "X-API-Key": initialToken },
    });
    expect(resApiKey.status).toBe(200);
    const bodyApiKey = (await resApiKey.json()) as any;
    expect(bodyApiKey.principal.kind).toBe("initial");
  });

  it("authenticates env.API_KEY regardless of format (B1/D14)", async () => {
    // Set an API_KEY containing spaces, Base64 +, /, =
    (env as any).API_KEY = "  secret+with/special=chars and spaces  ";

    try {
      const res = await SELF.fetch("https://redirect.example.com/api/v1/auth/verify", {
        headers: { Authorization: "Bearer secret+with/special=chars and spaces" },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.principal).toEqual({
        kind: "env",
        id: "env",
        name: "Environment API key",
      });
    } finally {
      delete (env as any).API_KEY;
    }
  });

  it("creates, lists (masked), and revokes regular custom tokens with single KV operations (D13)", async () => {
    // Setup initial token
    await SELF.fetch("https://redirect.example.com/api/v1/auth/verify");
    const initialToken = (await env.AUTH_TOKENS.get("initial_token"))!;

    // Create a new token
    const createRes = await SELF.fetch("https://redirect.example.com/api/v1/tokens", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${initialToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "CI Deployment Token" }),
    });
    expect(createRes.status).toBe(201);
    const createdToken = (await createRes.json()) as any;
    expect(createdToken.token).toMatch(/^rdir_[A-Za-z0-9]{10}_[A-Za-z0-9]{32}$/);
    expect(createdToken.name).toBe("CI Deployment Token");
    expect(createdToken.preview).toMatch(/^rdir_[A-Za-z0-9]{10}_\.\.\./);

    // Verify stored format in KV: key "token:<id>", value = full token plaintext
    const { value: storedVal, metadata: storedMeta } =
      await env.AUTH_TOKENS.getWithMetadata<any>(`token:${createdToken.id}`);
    expect(storedVal).toBe(createdToken.token);
    expect(storedMeta.name).toBe("CI Deployment Token");
    expect(storedMeta.preview).toBe(createdToken.preview);

    // Authenticate with the new custom token
    const verifyRes = await SELF.fetch("https://redirect.example.com/api/v1/auth/verify", {
      headers: { Authorization: `Bearer ${createdToken.token}` },
    });
    expect(verifyRes.status).toBe(200);
    const verifyBody = (await verifyRes.json()) as any;
    expect(verifyBody.principal.kind).toBe("token");
    expect(verifyBody.principal.id).toBe(createdToken.id);
    expect(verifyBody.principal.name).toBe("CI Deployment Token");

    // Authenticate with right ID but wrong secret fails
    const tamperedToken = `rdir_${createdToken.id}_00000000000000000000000000000000`;
    const wrongSecretRes = await SELF.fetch("https://redirect.example.com/api/v1/auth/verify", {
      headers: { Authorization: `Bearer ${tamperedToken}` },
    });
    expect(wrongSecretRes.status).toBe(401);

    // List tokens
    const listRes = await SELF.fetch("https://redirect.example.com/api/v1/tokens", {
      headers: { Authorization: `Bearer ${initialToken}` },
    });
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as any;
    expect(listBody.data).toHaveLength(2); // initial + new token
    expect(listBody.data[0].id).toBe("initial");
    expect(listBody.data[1].id).toBe(createdToken.id);
    // Never expose full token in list
    expect(listBody.data[1].token).toBeUndefined();
    expect(listBody.data[1].preview).toBe(createdToken.preview);

    // Delete custom token by ID
    const deleteRes = await SELF.fetch(
      `https://redirect.example.com/api/v1/tokens/${createdToken.id}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${initialToken}` },
      }
    );
    expect(deleteRes.status).toBe(200);

    // Key in KV is gone
    const afterDelete = await env.AUTH_TOKENS.get(`token:${createdToken.id}`);
    expect(afterDelete).toBeNull();

    // After revocation, custom token returns 401
    const verifyRevoked = await SELF.fetch("https://redirect.example.com/api/v1/auth/verify", {
      headers: { Authorization: `Bearer ${createdToken.token}` },
    });
    expect(verifyRevoked.status).toBe(401);
  });

  it("validates token expiry on creation (B5)", async () => {
    await SELF.fetch("https://redirect.example.com/api/v1/auth/verify");
    const initialToken = (await env.AUTH_TOKENS.get("initial_token"))!;

    // Expiry < 2 minutes in future is rejected
    const tooSoon = new Date(Date.now() + 60_000).toISOString();
    const soonRes = await SELF.fetch("https://redirect.example.com/api/v1/tokens", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${initialToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "Too Soon", expiresAt: tooSoon }),
    });
    expect(soonRes.status).toBe(400);
    const soonBody = (await soonRes.json()) as any;
    expect(soonBody.error.code).toBe("invalid_expiry");

    // Past expiry is rejected
    const past = new Date(Date.now() - 60_000).toISOString();
    const pastRes = await SELF.fetch("https://redirect.example.com/api/v1/tokens", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${initialToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "Past", expiresAt: past }),
    });
    expect(pastRes.status).toBe(400);

    // Valid expiry (> 2 min) succeeds
    const validExpiry = new Date(Date.now() + 600_000).toISOString();
    const validRes = await SELF.fetch("https://redirect.example.com/api/v1/tokens", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${initialToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "Valid Expiry", expiresAt: validExpiry }),
    });
    expect(validRes.status).toBe(201);
  });

  it("prevents deleting initial token via DELETE /tokens/initial and supports POST /tokens/initial/rotate", async () => {
    await SELF.fetch("https://redirect.example.com/api/v1/auth/verify");
    const initialToken = (await env.AUTH_TOKENS.get("initial_token"))!;

    // DELETE /tokens/initial returns 409
    const deleteRes = await SELF.fetch("https://redirect.example.com/api/v1/tokens/initial", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${initialToken}` },
    });
    expect(deleteRes.status).toBe(409);
    const deleteBody = (await deleteRes.json()) as any;
    expect(deleteBody.error.code).toBe("initial_token_protected");

    // Rotate initial token
    const rotateRes = await SELF.fetch("https://redirect.example.com/api/v1/tokens/initial/rotate", {
      method: "POST",
      headers: { Authorization: `Bearer ${initialToken}` },
    });
    expect(rotateRes.status).toBe(200);
    const rotateBody = (await rotateRes.json()) as any;
    expect(rotateBody.token).not.toBe(initialToken);
    expect(rotateBody.token).toMatch(/^rdir_initial_[A-Za-z0-9]{32}$/);

    // Old initial token stops working
    const oldRes = await SELF.fetch("https://redirect.example.com/api/v1/auth/verify", {
      headers: { Authorization: `Bearer ${initialToken}` },
    });
    expect(oldRes.status).toBe(401);

    // New initial token works
    const newRes = await SELF.fetch("https://redirect.example.com/api/v1/auth/verify", {
      headers: { Authorization: `Bearer ${rotateBody.token}` },
    });
    expect(newRes.status).toBe(200);
  });

  it("allows recovering access by deleting initial_token from KV and hitting API again", async () => {
    await SELF.fetch("https://redirect.example.com/api/v1/auth/verify");
    const token1 = (await env.AUTH_TOKENS.get("initial_token"))!;

    // Manually delete initial_token in KV (simulating user doing it via Cloudflare dashboard)
    await env.AUTH_TOKENS.delete("initial_token");

    // Hit unauthenticated API
    const res = await SELF.fetch("https://redirect.example.com/api/v1/auth/verify");
    expect(res.status).toBe(401);

    // A fresh initial token was regenerated
    const token2 = (await env.AUTH_TOKENS.get("initial_token"))!;
    expect(token2).not.toBeNull();
    expect(token2).not.toBe(token1);
    expect(token2).toMatch(/^rdir_initial_[A-Za-z0-9]{32}$/);

    // Authenticate with new token
    const verifyRes = await SELF.fetch("https://redirect.example.com/api/v1/auth/verify", {
      headers: { Authorization: `Bearer ${token2}` },
    });
    expect(verifyRes.status).toBe(200);
  });

  it("regenerates a malformed initial_token in KV automatically on next unauthenticated request", async () => {
    // Put legacy or corrupted initial_token into KV
    await env.AUTH_TOKENS.put("initial_token", "legacy_hex_token_12345");

    const res = await SELF.fetch("https://redirect.example.com/api/v1/auth/verify");
    expect(res.status).toBe(401);

    const refreshed = await env.AUTH_TOKENS.get("initial_token");
    expect(refreshed).toMatch(/^rdir_initial_[A-Za-z0-9]{32}$/);
  });

  it("rejects expired tokens and malformed token formats without touching KV", async () => {
    // Malformed token format
    const malformedRes = await SELF.fetch("https://redirect.example.com/api/v1/auth/verify", {
      headers: { Authorization: "Bearer short" },
    });
    expect(malformedRes.status).toBe(401);

    // Expired token in KV
    const expiredToken = "rdir_abcdef1234_11112222333344445555666677778888";
    await env.AUTH_TOKENS.put(
      "token:abcdef1234",
      expiredToken,
      {
        metadata: {
          name: "Expired",
          createdAt: "2020-01-01T00:00:00.000Z",
          expiresAt: "2020-01-02T00:00:00.000Z",
          preview: "rdir_abcdef1234_...8888",
        },
      }
    );

    const expiredRes = await SELF.fetch("https://redirect.example.com/api/v1/auth/verify", {
      headers: { Authorization: `Bearer ${expiredToken}` },
    });
    expect(expiredRes.status).toBe(401);
  });

  it("authenticates manually created token:<id> records in KV (e.g. from CF dashboard)", async () => {
    const id = "manualid01";
    const secret = "1234567890abcdef1234567890abcdef";
    const customToken = `rdir_${id}_${secret}`;
    await env.AUTH_TOKENS.put(
      `token:${id}`,
      customToken,
      {
        metadata: {
          name: "Dashboard Token",
          createdAt: new Date().toISOString(),
          expiresAt: null,
          preview: `rdir_${id}_...cdef`,
        },
      }
    );

    const res = await SELF.fetch("https://redirect.example.com/api/v1/auth/verify", {
      headers: { Authorization: `Bearer ${customToken}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.principal.id).toBe(id);
    expect(body.principal.name).toBe("Dashboard Token");
  });
});
