import { describe, expect, it } from "vitest";

import {
  isSubjectExportPath,
  isValidSubjectExportResponse,
  MAX_SUBJECT_EXPORT_BYTES,
  validatedSubjectExportFilename,
} from "@/lib/bff-export-response";

describe("subject export BFF response policy", () => {
  it("matches only the exact subject-export route", () => {
    const id = "10000000-0000-4000-8000-000000000001";
    const uppercaseId = "ABCDEF12-ABCD-4ABC-AABC-ABCDEF123456";
    expect(isSubjectExportPath(`/v1/privacy/requests/${id}/export`)).toBe(true);
    expect(
      isSubjectExportPath(`/v1/privacy/requests/${uppercaseId}/export`),
    ).toBe(true);
    expect(
      isSubjectExportPath(`/v1/Privacy/requests/${uppercaseId}/export`),
    ).toBe(false);
    expect(isSubjectExportPath(`/v1/admin/privacy/requests/${id}/export`)).toBe(
      false,
    );
    expect(isSubjectExportPath(`/v1/privacy/requests/${id}/export/extra`)).toBe(
      false,
    );
  });

  it("accepts the exact media, filename, digest, and maximum size", async () => {
    const emptyBody = exportBody();
    const body = exportBody(
      "x".repeat(MAX_SUBJECT_EXPORT_BYTES - emptyBody.length),
    );
    expect(body.byteLength).toBe(MAX_SUBJECT_EXPORT_BYTES);
    const response = await responseFor(body);
    await expect(isValidSubjectExportResponse(response, body)).resolves.toBe(
      true,
    );
  });

  it("accepts a canonical v2 export and returns only its allowlisted filename", async () => {
    const body = new TextEncoder().encode(JSON.stringify(exportManifestV2()));
    const response = await responseFor(body, {
      "content-disposition":
        'attachment; filename="autopay-guard-export-v2.json"',
    });

    await expect(validatedSubjectExportFilename(response, body)).resolves.toBe(
      "autopay-guard-export-v2.json",
    );
    await expect(isValidSubjectExportResponse(response, body)).resolves.toBe(
      true,
    );
  });

  it("rejects a schema/filename mismatch in both directions", async () => {
    const v1 = exportBody();
    const v2 = new TextEncoder().encode(JSON.stringify(exportManifestV2()));
    await expect(
      isValidSubjectExportResponse(
        await responseFor(v1, {
          "content-disposition":
            'attachment; filename="autopay-guard-export-v2.json"',
        }),
        v1,
      ),
    ).resolves.toBe(false);
    await expect(
      isValidSubjectExportResponse(await responseFor(v2), v2),
    ).resolves.toBe(false);
  });

  it.each([
    ["alternate media", { "content-type": "text/csv" }],
    [
      "alternate filename",
      { "content-disposition": 'attachment; filename="foreign.json"' },
    ],
    ["invalid digest", { "x-content-sha256": "secret" }],
    ["mismatched length", { "content-length": "3" }],
  ])("rejects %s", async (_label, override) => {
    const body = exportBody();
    await expect(
      isValidSubjectExportResponse(await responseFor(body, override), body),
    ).resolves.toBe(false);
  });

  it("rejects an oversized body", async () => {
    const emptyBody = exportBody();
    const body = exportBody(
      "x".repeat(MAX_SUBJECT_EXPORT_BYTES + 1 - emptyBody.length),
    );
    await expect(
      isValidSubjectExportResponse(await responseFor(body), body),
    ).resolves.toBe(false);
  });

  it.each([
    ["arbitrary bytes", new Uint8Array([0, 1, 2])],
    ["invalid UTF-8", new Uint8Array([0xc3, 0x28])],
    ["an array", new TextEncoder().encode("[]")],
    [
      "the wrong top-level keys",
      new TextEncoder().encode(
        '{"schemaVersion":"autopay-guard-export-v1","subject":{}}',
      ),
    ],
    [
      "the wrong schema",
      new TextEncoder().encode(
        JSON.stringify({
          ...exportManifest(),
          schemaVersion: "autopay-guard-export-v2",
        }),
      ),
    ],
  ])("rejects %s even when its digest matches", async (_label, body) => {
    await expect(
      isValidSubjectExportResponse(await responseFor(body), body),
    ).resolves.toBe(false);
  });

  it("rejects non-canonical whitespace and recursively unsorted keys", async () => {
    const pretty = new TextEncoder().encode(
      JSON.stringify(exportManifest(), null, 2),
    );
    const nestedKeysOutOfOrder = new TextEncoder().encode(
      JSON.stringify(exportManifest({ z: true, a: true })),
    );

    await expect(
      isValidSubjectExportResponse(await responseFor(pretty), pretty),
    ).resolves.toBe(false);
    await expect(
      isValidSubjectExportResponse(
        await responseFor(nestedKeysOutOfOrder),
        nestedKeysOutOfOrder,
      ),
    ).resolves.toBe(false);
  });

  it("rejects a syntactically valid digest that does not match the bytes", async () => {
    const body = exportBody();
    await expect(
      isValidSubjectExportResponse(
        await responseFor(body, { "x-content-sha256": "a".repeat(64) }),
        body,
      ),
    ).resolves.toBe(false);
  });
});

async function responseFor(
  body: Uint8Array,
  override: Record<string, string> = {},
) {
  return new Response(null, {
    status: 200,
    headers: {
      "content-type": "application/json",
      "content-disposition":
        'attachment; filename="autopay-guard-export-v1.json"',
      "x-content-sha256": await digest(body),
      "content-length": String(body.byteLength),
      ...override,
    },
  });
}

async function digest(body: Uint8Array) {
  const hash = await crypto.subtle.digest("SHA-256", Uint8Array.from(body));
  return Array.from(new Uint8Array(hash), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

function exportBody(padding = "") {
  return new TextEncoder().encode(JSON.stringify(exportManifest({ padding })));
}

function exportManifest(subject: Record<string, unknown> = {}) {
  return {
    auditEvents: [],
    cancellationData: {},
    consentEvents: [],
    generatedAt: "2026-07-28T00:00:00Z",
    households: [],
    memberships: [],
    noticeAcknowledgements: [],
    notificationData: {},
    privacyRequests: [],
    schemaVersion: "autopay-guard-export-v1",
    subject,
    supportGrants: [],
  };
}

function exportManifestV2() {
  return {
    auditEvents: [],
    cancellationData: {},
    consentEvents: [],
    generatedAt: "2026-07-28T00:00:00Z",
    households: [],
    importJobs: [],
    memberships: [],
    noticeAcknowledgements: [],
    notificationData: {},
    privacyRequests: [],
    schemaVersion: "autopay-guard-export-v2",
    subject: {},
    supportGrants: [],
  };
}
