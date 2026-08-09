import { describe, expect, it } from "vitest";

import {
  applyRuntimeTransportSecurity,
  securityHeaders,
} from "@/lib/security-headers";

describe("security headers", () => {
  it("adds HSTS only for the explicit production runtime", () => {
    const productionHeaders = new Headers();
    applyRuntimeTransportSecurity(productionHeaders, "PRODUCTION");
    expect(productionHeaders.get("strict-transport-security")).toBe(
      "max-age=31536000; includeSubDomains",
    );

    const localHeaders = new Headers();
    applyRuntimeTransportSecurity(localHeaders, "LOCAL");
    expect(localHeaders.has("strict-transport-security")).toBe(false);
  });

  it("keeps HSTS out of the build-time header manifest", () => {
    expect(
      securityHeaders("production").some(
        ({ key }) => key === "Strict-Transport-Security",
      ),
    ).toBe(false);
  });
});
