import { describe, expect, it } from "vitest";

import {
  isCanonicalRawBffRequest,
  isRawBffRequest,
  rawRequestPathname,
} from "@/lib/bff-raw-url.mjs";

describe("raw BFF request-target policy", () => {
  it.each([
    ["http://localhost:3000/api/bff/v1/me", "/api/bff/v1/me"],
    [
      "https://autopayguard.local/api/bff/v1/merchants/search?q=Cloud%20Nest",
      "/api/bff/v1/merchants/search",
    ],
    [
      "/api/bff/v1/privacy/requests?cursor=abc#ignored",
      "/api/bff/v1/privacy/requests",
    ],
  ])("extracts the undecoded pathname from %s", (url, expected) => {
    expect(rawRequestPathname(url)).toBe(expected);
  });

  it.each([
    "http://localhost:3000/api/bff/v1/me",
    "http://localhost:3000/api/bff/v1/privacy/requests?limit=25",
    "/api/bff/v1/households/00000000-0000-4000-8000-000000000123/members",
  ])("accepts a canonical literal BFF target: %s", (url) => {
    expect(isCanonicalRawBffRequest(url)).toBe(true);
  });

  it.each([
    "/api/bff/v1/privacy/%2e%2e/me",
    "/api/bff/v1/privacy/%2E%2E/me",
    "/api/bff/v1/privacy/%2e./me",
    "/api/bff/v1/privacy/../me",
    "/api/bff/v1/privacy/./requests",
    "/api/bff/v1/privacy/%252e%252e/me",
    "/api/bff/v1/privacy/%2f..%2fme",
    String.raw`/api/bff/v1/privacy\..\me`,
    "/api/bff%2Fv1%2Fme",
    "/api%2Fbff/v1/me",
    "/api/%62ff/v1/me",
    String.raw`/api/bff\v1\me`,
    "/api/bff%5Cv1%5Cme",
    "/api/bff/v1/privacy//requests",
    "/api/bff/v1/privacy/requests/",
    "/api/bff/v1/privacy/requests.json",
  ])("rejects a non-canonical raw BFF target: %s", (url) => {
    expect(isRawBffRequest(url)).toBe(true);
    expect(isCanonicalRawBffRequest(url)).toBe(false);
  });

  it.each([
    "http://localhost:3000/signin",
    "/api/auth/session",
    "/api/bffoo/v1/me",
    "not-an-absolute-or-origin-form-target",
  ])("does not classify a non-BFF target as BFF: %s", (url) => {
    expect(isRawBffRequest(url)).toBe(false);
  });
});
