import { describe, expect, it, vi } from "vitest";

import { fetchWithoutRedirects } from "@/lib/outbound-fetch";

describe("server outbound fetch policy", () => {
  it("forces redirect rejection while preserving the bounded request", async () => {
    const redirectFailure = new TypeError("fetch failed");
    const fetchImplementation = vi.fn().mockRejectedValue(redirectFailure);

    await expect(
      fetchWithoutRedirects(
        "https://api.private-beta.autopayguard.in/v1/me",
        {
          method: "GET",
          headers: { authorization: "Bearer fake-token" },
        },
        fetchImplementation,
      ),
    ).rejects.toBe(redirectFailure);

    expect(fetchImplementation).toHaveBeenCalledWith(
      "https://api.private-beta.autopayguard.in/v1/me",
      expect.objectContaining({
        method: "GET",
        redirect: "error",
        headers: { authorization: "Bearer fake-token" },
      }),
    );
  });

  it("overrides a caller attempt to follow redirects", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(new Response());

    await fetchWithoutRedirects(
      "https://identity.private-beta.autopayguard.in/token",
      { redirect: "follow" },
      fetchImplementation,
    );

    expect(fetchImplementation.mock.calls[0]?.[1]?.redirect).toBe("error");
  });
});
