import { describe, expect, it } from "vitest";

import { normalizeBffRequestBody } from "@/lib/bff-body-policy";

const occurrenceId = "00000000-0000-4000-8000-000000000041";
const commitmentId = "00000000-0000-4000-8000-000000000042";
const decisionId = "00000000-0000-4000-8000-000000000043";
const guideId = "00000000-0000-4000-8000-000000000044";
const attemptId = "00000000-0000-4000-8000-000000000045";

describe("normalizeBffRequestBody", () => {
  it("accepts only exact M5 household mutation bodies", () => {
    const invitation = normalizeBffRequestBody(
      "POST",
      `/api/bff/v1/households/${commitmentId}/invitations`,
      JSON.stringify({ inviteeEmail: "member@autopayguard.local" }),
    );
    expect(invitation.accepted).toBe(true);

    const acceptance = normalizeBffRequestBody(
      "POST",
      "/api/bff/v1/household-invitations/accept",
      JSON.stringify({ invitationCode: "a".repeat(43) }),
    );
    expect(acceptance.accepted).toBe(true);

    const householdSharing = normalizeBffRequestBody(
      "PATCH",
      `/api/bff/v1/commitments/${commitmentId}/sharing`,
      JSON.stringify({
        visibility: "HOUSEHOLD",
        responsibleMemberId: decisionId,
      }),
    );
    expect(householdSharing.accepted).toBe(true);

    const privateSharing = normalizeBffRequestBody(
      "PATCH",
      `/api/bff/v1/commitments/${commitmentId}/sharing`,
      JSON.stringify({
        visibility: "PRIVATE",
        responsibleMemberId: null,
      }),
    );
    expect(privateSharing.accepted).toBe(true);
  });

  it("accepts exact M5 privacy, guide-admin, and support bodies", () => {
    const cases = [
      {
        method: "POST",
        path: "/api/bff/v1/privacy/notice-acknowledgements",
        body: { noticeVersion: "foundation-v1" },
      },
      {
        method: "POST",
        path: "/api/bff/v1/privacy/consents",
        body: {
          purpose: "HOUSEHOLD_SHARING",
          purposeVersion: "foundation-v1",
          action: "GRANTED",
        },
      },
      {
        method: "POST",
        path: "/api/bff/v1/privacy/requests",
        body: {
          requestType: "CORRECTION",
          correctionValue: "Asia/Calcutta",
        },
      },
      {
        method: "POST",
        path: "/api/bff/v1/privacy/requests",
        body: { requestType: "EXPORT" },
      },
      {
        method: "POST",
        path: "/api/bff/v1/privacy/requests",
        body: { requestType: "DELETION" },
      },
      {
        method: "PATCH",
        path: `/api/bff/v1/admin/cancellation-guide-drafts/${guideId}`,
        body: {
          riskNotice: "Use only the fictional local destination.",
          reviewIntervalDays: 45,
          steps: [
            {
              track: "SERVICE",
              sequenceNumber: 1,
              title: "Open settings",
              instruction: "Open the fictional local service settings.",
            },
            {
              track: "SERVICE",
              sequenceNumber: 2,
              title: "Confirm service",
              instruction: "Confirm the fictional service state.",
            },
            {
              track: "PAYMENT_MANDATE",
              sequenceNumber: 1,
              title: "Open mandate settings",
              instruction: "Open the fictional local mandate settings.",
            },
            {
              track: "PAYMENT_MANDATE",
              sequenceNumber: 2,
              title: "Confirm mandate",
              instruction: "Confirm the fictional mandate state.",
            },
          ],
        },
      },
      {
        method: "POST",
        path: `/api/bff/v1/admin/cancellation-guide-feedback/${guideId}/review`,
        body: { disposition: "RESOLVED" },
      },
      {
        method: "POST",
        path: `/api/bff/v1/households/${commitmentId}/support-codes`,
        body: { acknowledgeReadOnlyDiagnostics: true },
      },
      {
        method: "POST",
        path: "/api/bff/v1/support/diagnostics/resolve",
        body: { supportCode: "A".repeat(43) },
      },
    ];

    for (const testCase of cases) {
      expect(
        normalizeBffRequestBody(
          testCase.method,
          testCase.path,
          JSON.stringify(testCase.body),
        ).accepted,
      ).toBe(true);
    }
  });

  it("accepts UTC as a backend-compatible IANA timezone", () => {
    expect(
      normalizeBffRequestBody(
        "POST",
        "/api/bff/v1/privacy/requests",
        JSON.stringify({
          requestType: "CORRECTION",
          correctionValue: "UTC",
        }),
      ),
    ).toEqual({
      accepted: true,
      body: '{"requestType":"CORRECTION","correctionValue":"UTC"}',
    });
  });

  it("rejects duplicate top-level keys before JSON normalization", () => {
    expect(
      normalizeBffRequestBody(
        "POST",
        "/api/bff/v1/privacy/requests",
        '{"requestType":"EXPORT","request\\u0054ype":"DELETION"}',
      ),
    ).toEqual({ accepted: false });
  });

  it("rejects duplicate keys nested in a guide step", () => {
    const body = JSON.stringify({
      riskNotice: "Use only the fictional local destination.",
      reviewIntervalDays: 45,
      steps: [
        {
          track: "SERVICE",
          sequenceNumber: 1,
          title: "Open settings",
          instruction: "Open the fictional local service settings.",
        },
        {
          track: "SERVICE",
          sequenceNumber: 2,
          title: "Confirm service",
          instruction: "Confirm the fictional service state.",
        },
        {
          track: "PAYMENT_MANDATE",
          sequenceNumber: 1,
          title: "Open mandate settings",
          instruction: "Open the fictional local mandate settings.",
        },
        {
          track: "PAYMENT_MANDATE",
          sequenceNumber: 2,
          title: "Confirm mandate",
          instruction: "Confirm the fictional mandate state.",
        },
      ],
    }).replace(
      '"title":"Open settings"',
      '"title":"Open settings","title":"Changed settings"',
    );

    expect(
      normalizeBffRequestBody(
        "PATCH",
        `/api/bff/v1/admin/cancellation-guide-drafts/${guideId}`,
        body,
      ),
    ).toEqual({ accepted: false });
  });

  it.each([
    [
      "privacy server field",
      "POST",
      "/api/bff/v1/privacy/requests",
      { requestType: "EXPORT", status: "READY" },
    ],
    [
      "correction missing zone",
      "POST",
      "/api/bff/v1/privacy/requests",
      { requestType: "CORRECTION", correctionValue: null },
    ],
    [
      "non-correction zone",
      "POST",
      "/api/bff/v1/privacy/requests",
      { requestType: "DELETION", correctionValue: "Asia/Calcutta" },
    ],
    [
      "legacy null field on export",
      "POST",
      "/api/bff/v1/privacy/requests",
      { requestType: "EXPORT", correctionValue: null },
    ],
    [
      "guide immutable target",
      "PATCH",
      `/api/bff/v1/admin/cancellation-guide-drafts/${guideId}`,
      {
        riskNotice: "Safe.",
        reviewIntervalDays: 45,
        steps: [
          {
            track: "SERVICE",
            sequenceNumber: 1,
            title: "One",
            instruction: "One.",
            targetUri: "https://evil.test",
          },
        ],
      },
    ],
    [
      "support acknowledgement false",
      "POST",
      `/api/bff/v1/households/${commitmentId}/support-codes`,
      { acknowledgeReadOnlyDiagnostics: false },
    ],
    [
      "support account override",
      "POST",
      "/api/bff/v1/support/diagnostics/resolve",
      { supportCode: "A".repeat(43), userId: commitmentId },
    ],
  ])("rejects unsafe M5 bodies: %s", (_label, method, path, body) => {
    expect(normalizeBffRequestBody(method, path, JSON.stringify(body))).toEqual(
      {
        accepted: false,
      },
    );
  });

  it.each([
    [
      "real email",
      "POST",
      `/api/bff/v1/households/${commitmentId}/invitations`,
      { inviteeEmail: "person@gmail.com" },
    ],
    [
      "invitation mass assignment",
      "POST",
      `/api/bff/v1/households/${commitmentId}/invitations`,
      { inviteeEmail: "member@autopayguard.local", role: "OWNER" },
    ],
    [
      "short invitation code",
      "POST",
      "/api/bff/v1/household-invitations/accept",
      { invitationCode: "short" },
    ],
    [
      "acceptance server field",
      "POST",
      "/api/bff/v1/household-invitations/accept",
      { invitationCode: "a".repeat(43), householdId: commitmentId },
    ],
    [
      "private responsibility",
      "PATCH",
      `/api/bff/v1/commitments/${commitmentId}/sharing`,
      { visibility: "PRIVATE", responsibleMemberId: decisionId },
    ],
    [
      "sharing role override",
      "PATCH",
      `/api/bff/v1/commitments/${commitmentId}/sharing`,
      {
        visibility: "HOUSEHOLD",
        responsibleMemberId: null,
        role: "OWNER",
      },
    ],
  ])(
    "rejects an unsafe M5 household body: %s",
    (_label, method, path, body) => {
      expect(
        normalizeBffRequestBody(method, path, JSON.stringify(body)),
      ).toEqual({ accepted: false });
    },
  );

  it("accepts and normalizes every exact M4 mutation shape", () => {
    const cases = [
      {
        method: "POST",
        path: `/api/bff/v1/occurrences/${occurrenceId}/decisions`,
        body: { decision: "CANCEL_WITH_PROVIDER" },
      },
      {
        method: "POST",
        path: `/api/bff/v1/commitments/${commitmentId}/cancellation-attempts`,
        body: {
          occurrenceId,
          decisionId,
          guideId,
          guideVersion: 2,
          note: null,
        },
      },
      {
        method: "PATCH",
        path: `/api/bff/v1/cancellation-attempts/${attemptId}`,
        body: {
          serviceStatus: "CONFIRMED",
          paymentMandateStatus: "REQUESTED",
          abandoned: false,
        },
      },
      {
        method: "POST",
        path: `/api/bff/v1/cancellation-attempts/${attemptId}/verify`,
        body: { status: "SELF_REPORTED" },
      },
      {
        method: "POST",
        path: `/api/bff/v1/cancellation-guides/${guideId}/feedback`,
        body: {
          commitmentId,
          guideVersion: 2,
          outcome: "UNSAFE_LINK",
          note: "Unexpected demo destination.",
        },
      },
    ] as const;

    for (const testCase of cases) {
      const result = normalizeBffRequestBody(
        testCase.method,
        testCase.path,
        JSON.stringify(testCase.body, null, 2),
      );
      expect(result.accepted).toBe(true);
      if (result.accepted) {
        expect(JSON.parse(result.body ?? "")).toEqual(testCase.body);
      }
    }
  });

  it.each([
    [
      "decision mass assignment",
      "POST",
      `/api/bff/v1/occurrences/${occurrenceId}/decisions`,
      { decision: "CANCEL_WITH_PROVIDER", householdId: commitmentId },
    ],
    [
      "attempt server field",
      "POST",
      `/api/bff/v1/commitments/${commitmentId}/cancellation-attempts`,
      {
        occurrenceId,
        decisionId,
        guideId,
        guideVersion: 2,
        note: null,
        projectedSavingsMinor: 9_999_999,
      },
    ],
    [
      "track server field",
      "PATCH",
      `/api/bff/v1/cancellation-attempts/${attemptId}`,
      {
        serviceStatus: "CONFIRMED",
        paymentMandateStatus: "CONFIRMED",
        abandoned: false,
        version: 99,
      },
    ],
    [
      "verification provenance",
      "POST",
      `/api/bff/v1/cancellation-attempts/${attemptId}/verify`,
      { status: "VERIFIED", source: "BANK" },
    ],
    [
      "feedback target",
      "POST",
      `/api/bff/v1/cancellation-guides/${guideId}/feedback`,
      {
        commitmentId,
        guideVersion: 2,
        outcome: "WORKED",
        note: null,
        target: "https://evil.test/",
      },
    ],
  ])("rejects %s", (_label, method, path, body) => {
    expect(normalizeBffRequestBody(method, path, JSON.stringify(body))).toEqual(
      { accepted: false },
    );
  });

  it.each([
    ["missing body", undefined],
    ["malformed JSON", "{"],
    ["array body", "[]"],
    [
      "missing required note",
      JSON.stringify({ commitmentId, guideVersion: 2, outcome: "WORKED" }),
    ],
    ["pending verification", JSON.stringify({ status: "PENDING" })],
    [
      "invalid guide version",
      JSON.stringify({
        commitmentId,
        guideVersion: 0,
        outcome: "WORKED",
        note: null,
      }),
    ],
    [
      "untrimmed note",
      JSON.stringify({
        commitmentId,
        guideVersion: 2,
        outcome: "WORKED",
        note: " padded ",
      }),
    ],
  ])("rejects an invalid feedback/verification payload: %s", (label, body) => {
    const path = label.includes("verification")
      ? `/api/bff/v1/cancellation-attempts/${attemptId}/verify`
      : `/api/bff/v1/cancellation-guides/${guideId}/feedback`;
    expect(normalizeBffRequestBody("POST", path, body)).toEqual({
      accepted: false,
    });
  });

  it("leaves an earlier-milestone body unchanged", () => {
    const body = '{ "read": true }';
    expect(
      normalizeBffRequestBody(
        "PATCH",
        `/api/bff/v1/notifications/${attemptId}`,
        body,
      ),
    ).toEqual({ accepted: true, body });
  });

  it("accepts one through 100 semantically distinct import item IDs", () => {
    const importId = "10000000-0000-4000-8000-000000000001";
    const selectedItemIds = Array.from(
      { length: 100 },
      (_, index) =>
        `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    );
    expect(
      normalizeBffRequestBody(
        "POST",
        `/api/bff/v1/imports/${importId}/confirm`,
        JSON.stringify({ selectedItemIds }),
      ),
    ).toEqual({
      accepted: true,
      body: JSON.stringify({ selectedItemIds }),
    });
  });

  it.each([
    ["empty", []],
    [
      "mixed-case semantic duplicate",
      [
        "abcdef12-abcd-4abc-aabc-abcdef123456",
        "ABCDEF12-ABCD-4ABC-AABC-ABCDEF123456",
      ],
    ],
    ["not a UUID", ["not-a-uuid"]],
  ])("rejects %s import item IDs", (_label, selectedItemIds) => {
    expect(
      normalizeBffRequestBody(
        "POST",
        "/api/bff/v1/imports/10000000-0000-4000-8000-000000000001/confirm",
        JSON.stringify({ selectedItemIds }),
      ),
    ).toEqual({ accepted: false });
  });

  it("rejects import-confirm mass assignment", () => {
    expect(
      normalizeBffRequestBody(
        "POST",
        "/api/bff/v1/imports/10000000-0000-4000-8000-000000000001/confirm",
        JSON.stringify({
          selectedItemIds: ["20000000-0000-4000-8000-000000000001"],
          householdId: "30000000-0000-4000-8000-000000000001",
        }),
      ),
    ).toEqual({ accepted: false });
  });
});
