import { describe, it, expect, beforeEach } from "vitest";
import { env, SELF } from "cloudflare:test";
import { TOKEN_REGEX } from "../src/auth/tokens.js";

describe("Authentication & Token Management", () => {
  beforeEach(async () => {
    // Clear KV keys
    const list = await env.AUTH_TOKENS.list();
    for (const key of list.keys) {
      await env.AUTH_TOKENS.delete(key.name);
    }
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
    expect(initialToken).toMatch(/^rdir_[a-f0-9]{48}$/);
    expect(TOKEN_REGEX.test(initialToken!)).toBe(true);
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

  it("creates, lists (masked), and revokes regular custom tokens", async () => {
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
    expect(createdToken.token).toMatch(/^rdir_[a-f0-9]{48}$/);
    expect(createdToken.name).toBe("CI Deployment Token");
    expect(createdToken.preview).toContain("...");

    // Authenticate with the new custom token
    const verifyRes = await SELF.fetch("https://redirect.example.com/api/v1/auth/verify", {
      headers: { Authorization: `Bearer ${createdToken.token}` },
    });
    expect(verifyRes.status).toBe(200);
    const verifyBody = (await verifyRes.json()) as any;
    expect(verifyBody.principal.kind).toBe("token");
    expect(verifyBody.principal.id).toBe(createdToken.id);
    expect(verifyBody.principal.name).toBe("CI Deployment Token");

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

    // Delete custom token
    const deleteRes = await SELF.fetch(
      `https://redirect.example.com/api/v1/tokens/${createdToken.id}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${initialToken}` },
      }
    );
    expect(deleteRes.status).toBe(200);

    // After revocation, custom token returns 401
    const verifyRevoked = await SELF.fetch("https://redirect.example.com/api/v1/auth/verify", {
      headers: { Authorization: `Bearer ${createdToken.token}` },
    });
    expect(verifyRevoked.status).toBe(401);
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

    // Authenticate with new token
    const verifyRes = await SELF.fetch("https://redirect.example.com/api/v1/auth/verify", {
      headers: { Authorization: `Bearer ${token2}` },
    });
    expect(verifyRes.status).toBe(200);
  });

  it("rejects expired tokens and malformed token formats without touching KV", async () => {
    // Malformed token format
    const malformedRes = await SELF.fetch("https://redirect.example.com/api/v1/auth/verify", {
      headers: { Authorization: "Bearer short" },
    });
    expect(malformedRes.status).toBe(401);

    // Expired token
    const expiredToken = "rdir_1111222233334444555566667777888899990000aaaabbbb";
    await env.AUTH_TOKENS.put(
      `token:${expiredToken}`,
      JSON.stringify({
        id: "exp1",
        name: "Expired",
        createdAt: "2020-01-01T00:00:00.000Z",
        expiresAt: "2020-01-02T00:00:00.000Z",
      })
    );

    const expiredRes = await SELF.fetch("https://redirect.example.com/api/v1/auth/verify", {
      headers: { Authorization: `Bearer ${expiredToken}` },
    });
    expect(expiredRes.status).toBe(401);
  });

  it("authenticates manually created token:<token> records in KV (e.g. from CF dashboard)", async () => {
    const customSecret = "rdir_customsecret1234567890abcdef1234567890abcdef";
    await env.AUTH_TOKENS.put(
      `token:${customSecret}`,
      JSON.stringify({
        id: "manual-id",
        name: "Dashboard Token",
        createdAt: new Date().toISOString(),
        expiresAt: null,
      })
    );

    const res = await SELF.fetch("https://redirect.example.com/api/v1/auth/verify", {
      headers: { Authorization: `Bearer ${customSecret}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.principal.id).toBe("manual-id");
    expect(body.principal.name).toBe("Dashboard Token");
  });
});
