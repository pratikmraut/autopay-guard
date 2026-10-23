import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  environment: vi.fn(),
}));
vi.mock("@/auth", () => ({ handlers: { GET: mocks.get, POST: mocks.post } }));
vi.mock("@/lib/env", () => ({ getServerEnvironment: mocks.environment }));

import { GET, POST } from "./route";

describe("browser auth handlers protect server-only sessions", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    const fakeSensitiveResponse = () =>
      Response.json({
        apiAccessToken: "sensitive-test-access-token",
        providerRefreshToken: "sensitive-test-refresh-token",
      });
    mocks.get.mockImplementation(fakeSensitiveResponse);
    mocks.post.mockImplementation(fakeSensitiveResponse);
  });

  it.each([
    "/api/auth/session",
    "/api/auth/session/",
    "/api/auth/session///",
    "/api/auth//session",
    "/api/auth/%73ession",
    "/api/auth/%2Fsession",
    "/api/auth/session%2F",
    "/api/auth/%2573ession",
    "/api/auth/other/../session",
    "/api/auth/other/%2e%2e/session",
  ])(
    "never delegates session variants to token-bearing handlers: %s",
    async (pathname) => {
      for (const [method, handler] of [
        ["GET", GET],
        ["POST", POST],
      ] as const) {
        const response = await handler(
          new NextRequest(`http://localhost:3000${pathname}?action=session`, {
            method,
          }),
        );
        expect(response.status).toBe(404);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(await response.text()).toBe("");
      }
      expect(mocks.get).not.toHaveBeenCalled();
      expect(mocks.post).not.toHaveBeenCalled();
      expect(mocks.environment).toHaveBeenCalledTimes(2);
    },
  );

  it("keeps the configured OIDC callback delegated without touching internal auth", async () => {
    const request = new NextRequest(
      "http://localhost:3000/api/auth/callback/keycloak?code=fictional-test-code&state=fictional-test-state",
    );
    mocks.get.mockResolvedValue(new Response(null, { status: 302 }));
    expect((await GET(request)).status).toBe(302);
    expect(mocks.get).toHaveBeenCalledWith(request);
  });

  it("preserves sign-out POST for provider and local-session cleanup", async () => {
    const request = new NextRequest("http://localhost:3000/api/auth/signout", {
      method: "POST",
    });
    mocks.post.mockResolvedValue(new Response(null, { status: 302 }));
    expect((await POST(request)).status).toBe(302);
    expect(mocks.post).toHaveBeenCalledWith(request);
  });
});
