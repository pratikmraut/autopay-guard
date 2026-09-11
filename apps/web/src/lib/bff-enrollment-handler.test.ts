// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ environment: vi.fn(), fetch: vi.fn() }));
vi.mock("@/auth", () => ({ auth: (handler: unknown) => handler }));
vi.mock("@/lib/env", () => ({ getServerEnvironment: mocks.environment }));
vi.mock("@/lib/outbound-fetch", () => ({ fetchWithoutRedirects: mocks.fetch }));

import { POST } from "@/app/api/bff/[...path]/route";

const handle = POST as unknown as (request: NextRequest) => Promise<Response>;
const consent = {
  ageConfirmed: true,
  privacyNoticeAccepted: true,
  privacyNoticeVersion: "foundation-v1",
};

describe("enrollment BFF handler", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.environment.mockReturnValue({
      AUTH_SELF_REGISTRATION_ENABLED: "true",
      AUTH_URL: "http://localhost:3000",
      API_BASE_URL: "http://api:8080",
    });
    mocks.fetch.mockResolvedValue(
      new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  });

  it("forwards only the verified session token and exact consent body", async () => {
    const response = await handle(enrollmentRequest());
    expect(response.status).toBe(200);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = mocks.fetch.mock.calls[0] as [URL, RequestInit];
    expect(url.href).toBe("http://api:8080/v1/account/enrollment");
    expect(init.body).toBe(JSON.stringify(consent));
    expect(new Headers(init.headers).get("authorization")).toBe(
      "Bearer fake-server-token",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects enrollment when disabled even if API is enabled", async () => {
    mocks.environment.mockReturnValue({
      AUTH_SELF_REGISTRATION_ENABLED: "false",
      AUTH_URL: "http://localhost:3000",
    });
    expect((await handle(enrollmentRequest())).status).toBe(404);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated requests before upstream forwarding", async () => {
    const request = enrollmentRequest();
    Object.assign(request, { auth: null });
    expect((await handle(request)).status).toBe(401);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it.each([
    { roles: [] },
    { roles: ["SUPPORT"] },
    { roles: ["USER", "SUPPORT"] },
    { roles: ["USER", "USER"] },
  ])("rejects role set $roles", async ({ roles }) => {
    expect((await handle(enrollmentRequest({ roles }))).status).toBe(403);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("rejects cross-site mutation", async () => {
    expect(
      (await handle(enrollmentRequest({ origin: "https://evil.example" })))
        .status,
    ).toBe(403);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("rejects client-selected role and credentials in the body", async () => {
    expect(
      (
        await handle(
          enrollmentRequest({
            body: { ...consent, role: "SUPPORT", password: "not-accepted" },
          }),
        )
      ).status,
    ).toBe(400);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});

function enrollmentRequest({
  roles = ["USER"],
  origin = "http://localhost:3000",
  body = consent,
}: { roles?: string[]; origin?: string; body?: Record<string, unknown> } = {}) {
  const request = new NextRequest(
    "http://localhost:3000/api/bff/v1/account/enrollment",
    {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify(body),
    },
  );
  return Object.assign(request, {
    auth: {
      user: { id: "fake-subject", email: "fake@autopayguard.local" },
      apiAccessToken: "fake-server-token",
      appRoles: roles,
    },
  });
}
