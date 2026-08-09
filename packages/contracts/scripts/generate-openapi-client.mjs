import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { format } from "prettier";

const sourcePath = fileURLToPath(
  new URL("../../../services/api/openapi/openapi.json", import.meta.url),
);
const outputPath = fileURLToPath(
  new URL("../src/generated/index.ts", import.meta.url),
);

const MILESTONE_5_ADMIN_AUDIT_ACTIONS = [
  "PRIVACY_NOTICE_ACKNOWLEDGED",
  "HOUSEHOLD_INVITATION_CREATED",
  "HOUSEHOLD_INVITATION_ACCEPTED",
  "HOUSEHOLD_INVITATION_REVOKED",
  "HOUSEHOLD_INVITATION_EXPIRED",
  "HOUSEHOLD_MEMBER_REMOVED",
  "COMMITMENT_SHARING_CHANGED",
  "CONSENT_RECORDED",
  "PRIVACY_REQUEST_CREATED",
  "PRIVACY_REQUEST_CANCELLED",
  "PRIVACY_REQUESTS_VIEWED",
  "PRIVACY_EXPORT_GENERATED",
  "PRIVACY_EXPORT_DOWNLOADED",
  "PRIVACY_EXPORT_EXPIRED",
  "PRIVACY_CORRECTION_EXECUTED",
  "PRIVACY_DELETION_BLOCKED",
  "PRIVACY_DELETION_EXECUTED",
  "GUIDE_DRAFT_CREATED",
  "GUIDE_DRAFT_SAVED",
  "GUIDE_PUBLISHED",
  "GUIDE_RETIRED",
  "GUIDE_FEEDBACK_REVIEWED",
  "SUPPORT_GRANT_CREATED",
  "SUPPORT_GRANT_REVOKED",
  "SUPPORT_GRANT_EXPIRED",
  "SUPPORT_DIAGNOSTICS_VIEWED",
  "AUDIT_EVENTS_VIEWED",
];
const MILESTONE_6_ADMIN_AUDIT_ACTIONS = [
  ...MILESTONE_5_ADMIN_AUDIT_ACTIONS,
  "IMPORT_PREVIEW_CREATED",
  "IMPORT_CONFIRMED",
  "IMPORT_DISCARDED",
  "IMPORT_PREVIEW_EXPIRED",
];
const MILESTONE_5_ADMIN_AUDIT_RESOURCE_TYPES = [
  "NOTICE_ACKNOWLEDGEMENT",
  "HOUSEHOLD_INVITATION",
  "HOUSEHOLD_MEMBER",
  "RECURRING_COMMITMENT",
  "CONSENT_EVENT",
  "PRIVACY_REQUEST",
  "CANCELLATION_GUIDE",
  "GUIDE_FEEDBACK",
  "SUPPORT_GRANT",
  "AUDIT_QUERY",
];
const MILESTONE_6_ADMIN_AUDIT_RESOURCE_TYPES = [
  ...MILESTONE_5_ADMIN_AUDIT_RESOURCE_TYPES,
  "IMPORT_JOB",
];

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await generate({ checkOnly: process.argv.includes("--check") });
}

async function generate({ checkOnly }) {
  const document = JSON.parse(await readFile(sourcePath, "utf8"));
  validateDocument(document);
  const generated = await format(renderClient(document), {
    parser: "typescript",
  });

  if (!checkOnly) {
    await writeFile(outputPath, generated, "utf8");
    return;
  }

  const existing = await readFile(outputPath, "utf8").catch(() => "");
  if (existing !== generated) {
    console.error(
      "Generated contracts are stale. Run: pnpm --filter @autopay-guard/contracts generate",
    );
    process.exitCode = 1;
  }
}

export function validateDocument(specification) {
  if (!/^3\.0\.\d+$/.test(String(specification.openapi))) {
    throw new Error("Expected an OpenAPI 3.0.x document.");
  }
  if (!specification.components?.schemas || !specification.paths) {
    throw new Error("OpenAPI schemas and paths are required.");
  }
  if (specification.components.schemas.Commitment) {
    validateMilestone2Schemas(specification.components.schemas);
  }
  if (
    specification.components.schemas.NotificationPreferences ||
    specification.paths["/v1/notification-preferences"]
  ) {
    validateMilestone3Contract(specification);
  }
  if (
    [
      "/v1/decisions/inbox",
      "/v1/occurrences/{occurrenceId}/decisions",
      "/v1/commitments/{commitmentId}/cancellation-guide",
      "/v1/commitments/{commitmentId}/cancellation-attempts",
      "/v1/cancellation-attempts/{attemptId}",
      "/v1/cancellation-attempts/{attemptId}/verify",
      "/v1/cancellation-guides/{guideId}/feedback",
      "/v1/savings",
    ].some((path) => specification.paths[path]) ||
    [
      "OccurrenceDecision",
      "CancellationGuide",
      "CancellationAttempt",
      "SavingsPage",
    ].some((name) => specification.components.schemas[name])
  ) {
    validateMilestone4Contract(specification);
  }
  if (
    [
      "/v1/privacy/notices/current",
      "/v1/households/{householdId}/members",
      "/v1/privacy/requests",
      "/v1/admin/cancellation-guides",
      "/v1/admin/audit-events",
      "/v1/support/diagnostics/resolve",
    ].some((path) => specification.paths[path]) ||
    [
      "HouseholdMember",
      "PrivacyNotice",
      "PrivacyRequest",
      "AdminCancellationGuideDraft",
      "AdminAuditEvent",
      "SupportDiagnostics",
    ].some((name) => specification.components.schemas[name])
  ) {
    validateMilestone5Contract(specification);
  }
  if (hasMilestone6Contract(specification)) {
    validateMilestone6Contract(specification);
  }
}

function hasMilestone6Contract(specification) {
  return (
    [
      "/v1/imports",
      "/v1/imports/{importId}",
      "/v1/imports/{importId}/confirm",
    ].some((path) => specification.paths[path]) ||
    [
      "CommitmentImportUploadRequest",
      "UploadResponse",
      "JobResponse",
      "ItemResponse",
      "ConfirmRequest",
      "ConfirmationResponse",
    ].some((name) => specification.components.schemas[name])
  );
}

function validateMilestone2Schemas(schemas) {
  const completeResponseSchemas = [
    "Commitment",
    "CommitmentPage",
    "MerchantSearchItem",
    "MerchantSearchResults",
    "DashboardSummary",
    "ProjectionPeriod",
    "CurrencyProjection",
    "CalendarDay",
    "DashboardCalendar",
    "Occurrence",
    "OccurrenceList",
    "UpcomingItem",
    "UpcomingList",
  ];
  for (const name of completeResponseSchemas) {
    const schema = schemas[name];
    if (!schema?.properties) {
      throw new Error(`Milestone 2 response schema ${name} is required.`);
    }
    const required = new Set(schema.required ?? []);
    const missing = Object.keys(schema.properties).filter(
      (property) => !required.has(property),
    );
    if (missing.length > 0) {
      throw new Error(
        `Milestone 2 response schema ${name} has optional fields: ${missing.join(", ")}.`,
      );
    }
  }

  for (const name of ["CreateCommitmentRequest", "UpdateCommitmentRequest"]) {
    const schema = schemas[name];
    const required = new Set(schema?.required ?? []);
    const missing = Object.keys(schema?.properties ?? {}).filter(
      (property) => !required.has(property),
    );
    if (!schema?.properties || missing.length > 0) {
      throw new Error(
        `Milestone 2 full-payload schema ${name} is incomplete: ${missing.join(", ")}.`,
      );
    }
  }

  const nullableInputs = [
    "merchantId",
    "amountMinor",
    "estimatedAmountMinor",
    "customIntervalUnit",
    "maskedPaymentLabel",
  ];
  for (const name of ["CreateCommitmentRequest", "UpdateCommitmentRequest"]) {
    const properties = schemas[name].properties;
    const missingNullable = nullableInputs.filter(
      (property) => properties[property]?.nullable !== true,
    );
    if (missingNullable.length > 0) {
      throw new Error(
        `Milestone 2 schema ${name} must allow explicit null for: ${missingNullable.join(", ")}.`,
      );
    }
  }

  const updateStatuses =
    schemas.UpdateCommitmentRequest.properties.status?.enum ?? [];
  if (
    updateStatuses.length !== 2 ||
    updateStatuses[0] !== "ACTIVE" ||
    updateStatuses[1] !== "PAUSED"
  ) {
    throw new Error(
      "UpdateCommitmentRequest.status must be exactly ACTIVE or PAUSED.",
    );
  }
}

function validateMilestone3Contract(specification) {
  const schemas = specification.components.schemas;
  const completeSchemas = [
    "NotificationPreferences",
    "ReminderRule",
    "ReminderRuleSet",
    "Notification",
    "NotificationPage",
    "NotificationFailureCount",
    "NotificationDiagnostics",
  ];
  for (const name of completeSchemas) {
    validateCompleteObjectSchema(schemas, name, "Milestone 3 response");
  }

  const requestProperties = {
    UpdateNotificationPreferencesRequest: [
      "enabled",
      "inAppEnabled",
      "emailEnabled",
      "timezone",
      "quietHoursEnabled",
      "quietStart",
      "quietEnd",
    ],
    ReminderRuleInput: ["channel", "offsetDays", "localSendTime", "enabled"],
    UpdateReminderRuleSetRequest: ["mode", "rules"],
    UpdateNotificationReadRequest: ["read"],
  };
  for (const [name, expectedProperties] of Object.entries(requestProperties)) {
    validateCompleteObjectSchema(schemas, name, "Milestone 3 request");
    if (schemas[name].additionalProperties !== false) {
      throw new Error(
        `Milestone 3 request schema ${name} must set additionalProperties to false.`,
      );
    }
    const actualProperties = Object.keys(schemas[name].properties);
    if (
      actualProperties.length !== expectedProperties.length ||
      expectedProperties.some(
        (property) => !actualProperties.includes(property),
      )
    ) {
      throw new Error(
        `Milestone 3 request schema ${name} must contain exactly: ${expectedProperties.join(", ")}.`,
      );
    }
  }
  if (
    schemas.UpdateNotificationPreferencesRequest.properties.timezone
      ?.minLength !== 1
  ) {
    throw new Error(
      "Milestone 3 request schema UpdateNotificationPreferencesRequest.timezone must set minLength to 1.",
    );
  }

  const operations = [
    {
      method: "get",
      path: "/v1/notification-preferences",
      operationId: "getNotificationPreferences",
      responseSchema: "NotificationPreferences",
      versioned: true,
    },
    {
      method: "put",
      path: "/v1/notification-preferences",
      operationId: "updateNotificationPreferences",
      requestSchema: "UpdateNotificationPreferencesRequest",
      responseSchema: "NotificationPreferences",
      versioned: true,
    },
    {
      method: "get",
      path: "/v1/households/{householdId}/reminder-rules",
      operationId: "getHouseholdReminderRules",
      responseSchema: "ReminderRuleSet",
      versioned: true,
    },
    {
      method: "put",
      path: "/v1/households/{householdId}/reminder-rules",
      operationId: "updateHouseholdReminderRules",
      requestSchema: "UpdateReminderRuleSetRequest",
      responseSchema: "ReminderRuleSet",
      versioned: true,
    },
    {
      method: "get",
      path: "/v1/commitments/{commitmentId}/reminder-rules",
      operationId: "getCommitmentReminderRules",
      responseSchema: "ReminderRuleSet",
      versioned: true,
    },
    {
      method: "put",
      path: "/v1/commitments/{commitmentId}/reminder-rules",
      operationId: "updateCommitmentReminderRules",
      requestSchema: "UpdateReminderRuleSetRequest",
      responseSchema: "ReminderRuleSet",
      versioned: true,
    },
    {
      method: "get",
      path: "/v1/notifications",
      operationId: "listNotifications",
      responseSchema: "NotificationPage",
    },
    {
      method: "get",
      path: "/v1/notifications/{notificationId}",
      operationId: "getNotification",
      responseSchema: "Notification",
      versioned: true,
    },
    {
      method: "patch",
      path: "/v1/notifications/{notificationId}",
      operationId: "updateNotificationReadState",
      requestSchema: "UpdateNotificationReadRequest",
      responseSchema: "Notification",
      versioned: true,
    },
    {
      method: "get",
      path: "/v1/notification-diagnostics",
      operationId: "getNotificationDiagnostics",
      responseSchema: "NotificationDiagnostics",
    },
  ];
  for (const {
    method,
    path,
    operationId,
    requestSchema,
    responseSchema,
    versioned,
  } of operations) {
    const operation = specification.paths[path]?.[method];
    if (operation?.operationId !== operationId) {
      throw new Error(
        `Milestone 3 requires ${method.toUpperCase()} ${path} operationId ${operationId}.`,
      );
    }
    if (
      requestSchema &&
      operation.requestBody?.content?.["application/json"]?.schema?.$ref !==
        `#/components/schemas/${requestSchema}`
    ) {
      throw new Error(
        `Milestone 3 requires ${method.toUpperCase()} ${path} request schema ${requestSchema}.`,
      );
    }
    if (
      successfulResponseSchema(operation.responses)?.$ref !==
      `#/components/schemas/${responseSchema}`
    ) {
      throw new Error(
        `Milestone 3 requires ${method.toUpperCase()} ${path} response schema ${responseSchema}.`,
      );
    }
    if (
      versioned &&
      !successfulResponseHasHeader(operation.responses, "etag")
    ) {
      throw new Error(
        `Milestone 3 requires an ETag response header on ${method.toUpperCase()} ${path}.`,
      );
    }
  }

  for (const [method, path] of [
    ["put", "/v1/notification-preferences"],
    ["put", "/v1/households/{householdId}/reminder-rules"],
    ["put", "/v1/commitments/{commitmentId}/reminder-rules"],
    ["patch", "/v1/notifications/{notificationId}"],
  ]) {
    const parameters = specification.paths[path]?.[method]?.parameters ?? [];
    const ifMatch = parameters.find(
      (parameter) =>
        parameter.in === "header" &&
        parameter.name.toLowerCase() === "if-match",
    );
    if (!ifMatch?.required) {
      throw new Error(
        `Milestone 3 requires a mandatory If-Match header on ${method.toUpperCase()} ${path}.`,
      );
    }
  }

  const serializedSchemas = JSON.stringify(
    Object.fromEntries(
      [...completeSchemas, ...Object.keys(requestProperties)].map((name) => [
        name,
        schemas[name],
      ]),
    ),
  ).toLowerCase();
  for (const forbidden of [
    "recipient",
    "providerid",
    "providerresponse",
    "rawerror",
    "attemptcount",
    "idempotencykey",
    "semantickey",
    "outboxstate",
  ]) {
    if (serializedSchemas.includes(`"${forbidden}"`)) {
      throw new Error(
        `Milestone 3 product schemas must not expose ${forbidden}.`,
      );
    }
  }
}

function validateMilestone4Contract(specification) {
  const schemas = specification.components.schemas;
  const decisionActions = [
    "KEEP",
    "REVIEW",
    "PAUSE_TRACKING",
    "CANCEL_WITH_PROVIDER",
    "DOWNGRADE_WITH_PROVIDER",
    "SWITCH_PROVIDER",
    "CONFIRM_BILL",
    "COMPARE_PROVIDERS",
    "DUE_DATE_READINESS",
    "PAYMENT_CONFIRMATION",
    "RENEWAL_READINESS",
    "TRACK",
  ];
  const amountKinds = ["FIXED", "ESTIMATED", "UNKNOWN_VARIABLE"];
  const trackStatuses = [
    "NOT_REQUIRED",
    "NOT_STARTED",
    "REQUESTED",
    "CONFIRMED",
    "FAILED",
  ];
  const savingsStates = ["POTENTIAL", "SELF_REPORTED", "VERIFIED", "REVERSED"];
  const responseProperties = {
    OccurrenceDecision: [
      "id",
      "occurrenceId",
      "commitmentId",
      "householdId",
      "decision",
      "createdAt",
    ],
    DecisionInboxItem: [
      "occurrenceId",
      "commitmentId",
      "householdId",
      "displayName",
      "category",
      "paymentRail",
      "scheduledDate",
      "expectedAmountMinor",
      "currency",
      "amountKind",
      "reviewActions",
      "currentDecision",
    ],
    DecisionInboxPage: ["householdId", "from", "to", "items", "nextCursor"],
    GuideTarget: ["label", "uri"],
    GuideStep: ["sequence", "kind", "title", "instruction", "target"],
    GuideTrack: ["track", "title", "steps"],
    CancellationGuide: [
      "id",
      "version",
      "householdId",
      "commitmentId",
      "merchantName",
      "status",
      "freshness",
      "structuralReviewedAt",
      "reviewDueAt",
      "publishedAt",
      "riskNotice",
      "targetsSuppressed",
      "targetSuppressionReason",
      "tracks",
    ],
    CancellationAttempt: [
      "id",
      "householdId",
      "commitmentId",
      "occurrenceId",
      "decisionId",
      "guideId",
      "guideVersion",
      "guide",
      "scheduledDate",
      "amountKind",
      "currency",
      "projectedSavingsMinor",
      "savingsPeriodStart",
      "savingsPeriodEnd",
      "estimated",
      "serviceStatus",
      "paymentMandateStatus",
      "verificationStatus",
      "verificationDueDate",
      "verificationDueReached",
      "completedAt",
      "abandoned",
      "version",
      "createdAt",
      "updatedAt",
    ],
    CancellationAttemptPage: [
      "householdId",
      "commitmentId",
      "items",
      "nextCursor",
    ],
    SavingsStateTotal: [
      "state",
      "exactAmountMinor",
      "estimatedAmountMinor",
      "exactAttemptCount",
      "estimatedAttemptCount",
    ],
    SavingsCurrencySummary: ["currency", "totals"],
    SavingsItem: [
      "attemptId",
      "commitmentId",
      "displayName",
      "state",
      "amountMinor",
      "currency",
      "estimated",
      "periodStart",
      "periodEnd",
      "reversalReason",
      "updatedAt",
    ],
    SavingsPage: [
      "householdId",
      "asOf",
      "currencies",
      "unquantifiedCount",
      "items",
      "nextCursor",
    ],
  };
  for (const [name, expectedProperties] of Object.entries(responseProperties)) {
    validateExactObjectSchema(
      schemas,
      name,
      expectedProperties,
      "Milestone 4 response",
      false,
    );
  }
  if (
    schemas.CancellationAttempt.properties?.verificationDueReached?.type !==
    "boolean"
  ) {
    throw new Error(
      "Milestone 4 response CancellationAttempt.verificationDueReached must be boolean.",
    );
  }
  for (const [propertyName, expectedFormat, expectedMaximum] of [
    ["exactAmountMinor", "int64", 9_007_199_254_740_991],
    ["estimatedAmountMinor", "int64", 9_007_199_254_740_991],
    ["exactAttemptCount", "int32", 2_147_483_647],
    ["estimatedAttemptCount", "int32", 2_147_483_647],
  ]) {
    const property = schemas.SavingsStateTotal.properties?.[propertyName];
    if (
      property?.type !== "integer" ||
      property.format !== expectedFormat ||
      Number(property.minimum) !== 0 ||
      Number(property.maximum) !== expectedMaximum
    ) {
      throw new Error(
        `Milestone 4 response SavingsStateTotal.${propertyName} must be a bounded non-negative ${expectedFormat} integer.`,
      );
    }
  }
  for (const [schemaName, propertyName] of [
    ["CancellationAttempt", "projectedSavingsMinor"],
    ["SavingsItem", "amountMinor"],
  ]) {
    const property = schemas[schemaName].properties?.[propertyName];
    if (
      property?.type !== "integer" ||
      property.format !== "int64" ||
      property.nullable !== true ||
      Number(property.minimum) !== 1 ||
      Number(property.maximum) !== 9_007_199_254_740_991
    ) {
      throw new Error(
        `Milestone 4 response ${schemaName}.${propertyName} must be a nullable bounded positive int64 integer.`,
      );
    }
  }
  const nullableResponseProperties = {
    DecisionInboxItem: ["expectedAmountMinor", "currentDecision"],
    DecisionInboxPage: ["nextCursor"],
    GuideStep: ["target"],
    CancellationAttempt: ["projectedSavingsMinor", "completedAt"],
    CancellationAttemptPage: ["nextCursor"],
    SavingsItem: ["amountMinor", "reversalReason"],
    SavingsPage: ["nextCursor"],
  };
  for (const [schemaName, properties] of Object.entries(
    nullableResponseProperties,
  )) {
    for (const property of properties) {
      if (schemas[schemaName].properties[property]?.nullable !== true) {
        throw new Error(
          `Milestone 4 response ${schemaName}.${property} must be explicitly nullable.`,
        );
      }
    }
  }
  for (const [schemaName, property, reference, array] of [
    ["DecisionInboxItem", "currentDecision", "OccurrenceDecision", false],
    ["DecisionInboxPage", "items", "DecisionInboxItem", true],
    ["GuideStep", "target", "GuideTarget", false],
    ["GuideTrack", "steps", "GuideStep", true],
    ["CancellationGuide", "tracks", "GuideTrack", true],
    ["CancellationAttempt", "guide", "CancellationGuide", false],
    ["CancellationAttemptPage", "items", "CancellationAttempt", true],
    ["SavingsCurrencySummary", "totals", "SavingsStateTotal", true],
    ["SavingsPage", "currencies", "SavingsCurrencySummary", true],
    ["SavingsPage", "items", "SavingsItem", true],
  ]) {
    if (reference) {
      validateResponseReference(
        schemas,
        schemaName,
        property,
        reference,
        array,
      );
    }
  }
  for (const [schemaName, property, expectedValues] of [
    ["OccurrenceDecision", "decision", decisionActions],
    [
      "DecisionInboxItem",
      "category",
      [
        "SUBSCRIPTION",
        "UTILITY",
        "MEMBERSHIP",
        "SOFTWARE",
        "EMI_LOAN",
        "INSURANCE",
        "INVESTMENT_COMMITMENT",
        "EDUCATION",
        "OTHER",
      ],
    ],
    [
      "DecisionInboxItem",
      "paymentRail",
      [
        "UPI_AUTOPAY",
        "CARD_RECURRING",
        "NACH_ENACH",
        "APP_STORE",
        "MERCHANT_DIRECT",
        "CASH_OR_MANUAL",
        "UNKNOWN",
      ],
    ],
    ["DecisionInboxItem", "amountKind", amountKinds],
    ["GuideStep", "kind", ["INFORMATION", "SAFE_LINK", "APP_DEEP_LINK"]],
    ["GuideTrack", "track", ["SERVICE", "PAYMENT_MANDATE"]],
    ["CancellationGuide", "status", ["PUBLISHED"]],
    ["CancellationGuide", "freshness", ["CURRENT", "REVIEW_DUE"]],
    [
      "CancellationGuide",
      "targetSuppressionReason",
      ["NONE", "REVIEW_DUE", "USER_REPORTED_UNSAFE"],
    ],
    ["CancellationAttempt", "amountKind", amountKinds],
    ["CancellationAttempt", "serviceStatus", trackStatuses],
    ["CancellationAttempt", "paymentMandateStatus", trackStatuses],
    [
      "CancellationAttempt",
      "verificationStatus",
      ["PENDING", "SELF_REPORTED", "VERIFIED", "DISPUTED"],
    ],
    ["SavingsStateTotal", "state", savingsStates],
    ["SavingsItem", "state", savingsStates],
    ["SavingsItem", "reversalReason", ["ABANDONED", "DEBIT_OCCURRED"]],
  ]) {
    validateExactEnum(
      schemas[schemaName].properties[property],
      expectedValues,
      `${schemaName}.${property}`,
      schemas,
    );
  }
  validateExactEnum(
    schemas.DecisionInboxItem.properties.reviewActions?.items,
    decisionActions,
    "DecisionInboxItem.reviewActions items",
    schemas,
  );

  const requestProperties = {
    CreateOccurrenceDecisionRequest: ["decision"],
    CreateCancellationAttemptRequest: [
      "occurrenceId",
      "decisionId",
      "guideId",
      "guideVersion",
      "note",
    ],
    UpdateCancellationAttemptRequest: [
      "serviceStatus",
      "paymentMandateStatus",
      "abandoned",
    ],
    VerifyCancellationAttemptRequest: ["status"],
    CreateCancellationGuideFeedbackRequest: [
      "commitmentId",
      "guideVersion",
      "outcome",
      "note",
    ],
  };
  validateMilestone4MassAssignment(schemas, Object.keys(requestProperties));
  for (const [name, expectedProperties] of Object.entries(requestProperties)) {
    validateExactObjectSchema(
      schemas,
      name,
      expectedProperties,
      "Milestone 4 request",
      true,
    );
  }

  validateExactEnum(
    schemas.CreateOccurrenceDecisionRequest.properties.decision,
    decisionActions,
    "CreateOccurrenceDecisionRequest.decision",
    schemas,
  );
  for (const property of ["serviceStatus", "paymentMandateStatus"]) {
    validateExactEnum(
      schemas.UpdateCancellationAttemptRequest.properties[property],
      trackStatuses,
      `UpdateCancellationAttemptRequest.${property}`,
      schemas,
    );
  }
  validateExactEnum(
    schemas.VerifyCancellationAttemptRequest.properties.status,
    ["SELF_REPORTED", "VERIFIED", "DISPUTED"],
    "VerifyCancellationAttemptRequest.status",
    schemas,
  );
  validateExactEnum(
    schemas.CreateCancellationGuideFeedbackRequest.properties.outcome,
    ["WORKED", "OUTDATED", "MERCHANT_CHANGED_FLOW", "UNSAFE_LINK"],
    "CreateCancellationGuideFeedbackRequest.outcome",
    schemas,
  );

  for (const [schemaName, properties] of [
    [
      "CreateCancellationAttemptRequest",
      ["occurrenceId", "decisionId", "guideId"],
    ],
    ["CreateCancellationGuideFeedbackRequest", ["commitmentId"]],
  ]) {
    for (const property of properties) {
      const schema = schemas[schemaName].properties[property];
      if (schema?.type !== "string" || schema.format !== "uuid") {
        throw new Error(
          `Milestone 4 request ${schemaName}.${property} must be a UUID.`,
        );
      }
    }
  }
  for (const schemaName of [
    "CreateCancellationAttemptRequest",
    "CreateCancellationGuideFeedbackRequest",
  ]) {
    const guideVersion = schemas[schemaName].properties.guideVersion;
    if (
      guideVersion?.type !== "integer" ||
      Number(guideVersion.minimum) !== 1
    ) {
      throw new Error(
        `Milestone 4 request ${schemaName}.guideVersion must be an integer with minimum 1.`,
      );
    }
  }
  for (const schemaName of [
    "CreateCancellationAttemptRequest",
    "CreateCancellationGuideFeedbackRequest",
  ]) {
    const note = schemas[schemaName].properties.note;
    if (
      note?.type !== "string" ||
      note.nullable !== true ||
      note.minLength !== 1 ||
      note.maxLength !== 500
    ) {
      throw new Error(
        `Milestone 4 request ${schemaName}.note must be nullable text of 1 through 500 characters.`,
      );
    }
  }

  const operations = [
    {
      method: "get",
      path: "/v1/decisions/inbox",
      operationId: "listDecisionInbox",
      responseSchema: "DecisionInboxPage",
      parameters: [
        requiredUuidQuery("householdId"),
        optionalDateQuery("from"),
        optionalDateQuery("to"),
        optionalStringQuery("cursor"),
        optionalIntegerQuery("limit"),
      ],
      errors: [400, 404],
    },
    {
      method: "post",
      path: "/v1/occurrences/{occurrenceId}/decisions",
      operationId: "createOccurrenceDecision",
      requestSchema: "CreateOccurrenceDecisionRequest",
      responseSchema: "OccurrenceDecision",
      success: 201,
      parameters: [
        requiredUuidPath("occurrenceId"),
        requiredIdempotencyHeader(),
      ],
      errors: [400, 404, 409],
    },
    {
      method: "get",
      path: "/v1/commitments/{commitmentId}/cancellation-guide",
      operationId: "getCancellationGuide",
      responseSchema: "CancellationGuide",
      parameters: [requiredUuidPath("commitmentId")],
      errors: [404],
    },
    {
      method: "post",
      path: "/v1/commitments/{commitmentId}/cancellation-attempts",
      operationId: "createCancellationAttempt",
      requestSchema: "CreateCancellationAttemptRequest",
      responseSchema: "CancellationAttempt",
      success: 201,
      parameters: [
        requiredUuidPath("commitmentId"),
        requiredIdempotencyHeader(),
      ],
      errors: [400, 404, 409],
      etag: true,
    },
    {
      method: "get",
      path: "/v1/commitments/{commitmentId}/cancellation-attempts",
      operationId: "listCancellationAttempts",
      responseSchema: "CancellationAttemptPage",
      parameters: [
        requiredUuidPath("commitmentId"),
        requiredUuidQuery("householdId"),
        optionalStringQuery("cursor"),
        optionalIntegerQuery("limit"),
      ],
      errors: [400, 404],
    },
    {
      method: "get",
      path: "/v1/cancellation-attempts/{attemptId}",
      operationId: "getCancellationAttempt",
      responseSchema: "CancellationAttempt",
      parameters: [requiredUuidPath("attemptId")],
      errors: [404],
      etag: true,
    },
    {
      method: "patch",
      path: "/v1/cancellation-attempts/{attemptId}",
      operationId: "updateCancellationAttempt",
      requestSchema: "UpdateCancellationAttemptRequest",
      responseSchema: "CancellationAttempt",
      parameters: [requiredUuidPath("attemptId"), requiredIfMatchHeader()],
      errors: [400, 404, 409, 412, 428],
      etag: true,
    },
    {
      method: "post",
      path: "/v1/cancellation-attempts/{attemptId}/verify",
      operationId: "verifyCancellationAttempt",
      requestSchema: "VerifyCancellationAttemptRequest",
      responseSchema: "CancellationAttempt",
      parameters: [
        requiredUuidPath("attemptId"),
        requiredIfMatchHeader(),
        requiredIdempotencyHeader(),
      ],
      errors: [400, 404, 409, 412, 428],
      etag: true,
    },
    {
      method: "post",
      path: "/v1/cancellation-guides/{guideId}/feedback",
      operationId: "createCancellationGuideFeedback",
      requestSchema: "CreateCancellationGuideFeedbackRequest",
      parameters: [requiredUuidPath("guideId"), requiredIdempotencyHeader()],
      errors: [400, 404, 409],
      noContent: true,
      success: 204,
    },
    {
      method: "get",
      path: "/v1/savings",
      operationId: "getSavings",
      responseSchema: "SavingsPage",
      parameters: [
        requiredUuidQuery("householdId"),
        optionalStringQuery("state"),
        optionalStringQuery("cursor"),
        optionalIntegerQuery("limit"),
      ],
      errors: [400, 404, 409],
    },
  ];

  for (const expected of operations) {
    validateMilestone4Operation(specification, expected);
  }

  validateExactEnum(
    findOperationParameter(
      specification.paths["/v1/savings"].get,
      "query",
      "state",
    ).schema,
    savingsStates,
    "GET /v1/savings state",
    schemas,
  );
}

function validateMilestone5Contract(specification) {
  const schemas = specification.components.schemas;
  const responseProperties = {
    HouseholdMemberCollection: ["items", "nextCursor"],
    HouseholdMember: [
      "id",
      "userId",
      "displayName",
      "role",
      "status",
      "version",
      "joinedAt",
      "removedAt",
    ],
    HouseholdInvitationCollection: ["items", "nextCursor"],
    HouseholdInvitation: [
      "id",
      "householdId",
      "householdName",
      "inviteeEmail",
      "status",
      "version",
      "expiresAt",
      "createdAt",
    ],
    CreatedHouseholdInvitation: ["invitation", "invitationCode", "emailSent"],
    PrivacyNotice: ["noticeVersion", "contentSha256", "acknowledgementType"],
    PrivacyNoticeAcknowledgementCollection: ["items", "nextCursor"],
    PrivacyNoticeAcknowledgement: [
      "id",
      "noticeVersion",
      "contentSha256",
      "eventType",
      "acknowledgedAt",
    ],
    ConsentCollection: [
      "purpose",
      "currentPurposeVersion",
      "currentAction",
      "events",
      "nextCursor",
    ],
    ConsentEvent: ["id", "purpose", "purposeVersion", "action", "occurredAt"],
    PrivacyRequestCollection: ["items", "nextCursor"],
    PrivacyRequest: [
      "id",
      "requestType",
      "status",
      "correctionField",
      "correctionValue",
      "version",
      "createdAt",
      "updatedAt",
      "completedAt",
      "export",
    ],
    PrivacyExportMetadata: [
      "schemaVersion",
      "sha256",
      "byteCount",
      "generatedAt",
      "expiresAt",
    ],
    AdminCancellationGuideCollection: ["items"],
    AdminCancellationGuideSummary: [
      "guideId",
      "merchantId",
      "merchantName",
      "merchantCategory",
      "state",
      "currentPublishedVersion",
      "version",
      "updatedAt",
    ],
    AdminCancellationGuideVersionCollection: ["items", "nextCursor"],
    AdminCancellationGuideVersion: [
      "guideId",
      "guideVersion",
      "status",
      "riskNotice",
      "structuralReviewedAt",
      "reviewIntervalDays",
      "publishedAt",
      "createdAt",
      "draftId",
      "draftVersion",
    ],
    AdminCancellationGuideDraft: [
      "draftId",
      "guideId",
      "guideVersion",
      "status",
      "riskNotice",
      "structuralReviewedAt",
      "reviewIntervalDays",
      "steps",
      "version",
      "createdAt",
      "updatedAt",
    ],
    AdminCancellationGuideDraftStep: [
      "track",
      "sequenceNumber",
      "actionType",
      "title",
      "instruction",
      "targetKey",
      "targetUri",
    ],
    AdminCancellationGuidePublication: [
      "guideId",
      "publishedVersion",
      "catalogState",
      "catalogVersion",
      "publishedAt",
    ],
    AdminCancellationGuideFeedbackCollection: ["items", "nextCursor"],
    AdminCancellationGuideFeedback: [
      "id",
      "guideId",
      "guideVersion",
      "outcome",
      "createdAt",
      "disposition",
      "version",
    ],
    AdminAuditEventCollection: ["items", "nextCursor"],
    AdminAuditEvent: [
      "id",
      "occurredAt",
      "actorRole",
      "action",
      "resourceType",
      "resourceId",
      "outcome",
      "correlationId",
    ],
    CreatedSupportCode: ["grant", "supportCode"],
    SupportCode: ["id", "status", "version", "expiresAt", "createdAt"],
    SupportDiagnostics: [
      "schemaVersion",
      "status",
      "activeCommitmentCount",
      "failedNotificationCount",
      "pendingPrivacyRequestCount",
      "latestCommitmentVersion",
      "generatedAt",
      "grantExpiresAt",
    ],
  };
  for (const [name, expectedProperties] of Object.entries(responseProperties)) {
    validateExactObjectSchema(
      schemas,
      name,
      expectedProperties,
      "Milestone 5 response",
      false,
    );
  }

  const requestProperties = {
    AcceptHouseholdInvitationRequest: ["invitationCode"],
    CreateHouseholdInvitationRequest: ["inviteeEmail"],
    UpdateCommitmentSharingRequest: ["visibility", "responsibleMemberId"],
    AcknowledgePrivacyNoticeRequest: ["noticeVersion"],
    RecordConsentRequest: ["purpose", "purposeVersion", "action"],
    CreateExportPrivacyRequest: ["requestType"],
    CreateCorrectionPrivacyRequest: ["requestType", "correctionValue"],
    CreateDeletionPrivacyRequest: ["requestType"],
    UpdateAdminCancellationGuideDraftRequest: [
      "riskNotice",
      "reviewIntervalDays",
      "steps",
    ],
    UpdateAdminCancellationGuideDraftStepRequest: [
      "track",
      "sequenceNumber",
      "title",
      "instruction",
    ],
    ReviewAdminCancellationGuideFeedbackRequest: ["disposition"],
    CreateSupportCodeRequest: ["acknowledgeReadOnlyDiagnostics"],
    ResolveSupportDiagnosticsRequest: ["supportCode"],
  };
  validateMilestone5MassAssignment(schemas, requestProperties);
  for (const [name, expectedProperties] of Object.entries(requestProperties)) {
    validateExactObjectSchema(
      schemas,
      name,
      expectedProperties,
      "Milestone 5 request",
      true,
    );
  }

  for (const [schemaName, properties] of Object.entries({
    HouseholdMemberCollection: ["nextCursor"],
    HouseholdMember: ["removedAt"],
    HouseholdInvitationCollection: ["nextCursor"],
    PrivacyNoticeAcknowledgementCollection: ["nextCursor"],
    ConsentCollection: ["nextCursor"],
    PrivacyRequest: [
      "correctionField",
      "correctionValue",
      "completedAt",
      "export",
    ],
    PrivacyRequestCollection: ["nextCursor"],
    AdminCancellationGuideSummary: ["currentPublishedVersion"],
    AdminCancellationGuideVersionCollection: ["nextCursor"],
    AdminCancellationGuideVersion: ["publishedAt", "draftId", "draftVersion"],
    AdminCancellationGuideDraftStep: ["targetKey", "targetUri"],
    AdminCancellationGuideFeedbackCollection: ["nextCursor"],
    AdminAuditEventCollection: ["nextCursor"],
    UpdateCommitmentSharingRequest: ["responsibleMemberId"],
    Commitment: ["responsibleMemberId"],
  })) {
    for (const property of properties) {
      if (schemas[schemaName].properties[property]?.nullable !== true) {
        throw new Error(
          `Milestone 5 ${schemaName}.${property} must be explicitly nullable.`,
        );
      }
    }
  }

  for (const [schemaName, property, reference, array] of [
    ["HouseholdMemberCollection", "items", "HouseholdMember", true],
    ["HouseholdInvitationCollection", "items", "HouseholdInvitation", true],
    ["CreatedHouseholdInvitation", "invitation", "HouseholdInvitation", false],
    [
      "PrivacyNoticeAcknowledgementCollection",
      "items",
      "PrivacyNoticeAcknowledgement",
      true,
    ],
    ["ConsentCollection", "events", "ConsentEvent", true],
    ["PrivacyRequestCollection", "items", "PrivacyRequest", true],
    ["PrivacyRequest", "export", "PrivacyExportMetadata", false],
    [
      "AdminCancellationGuideCollection",
      "items",
      "AdminCancellationGuideSummary",
      true,
    ],
    [
      "AdminCancellationGuideVersionCollection",
      "items",
      "AdminCancellationGuideVersion",
      true,
    ],
    [
      "AdminCancellationGuideDraft",
      "steps",
      "AdminCancellationGuideDraftStep",
      true,
    ],
    [
      "AdminCancellationGuideFeedbackCollection",
      "items",
      "AdminCancellationGuideFeedback",
      true,
    ],
    ["AdminAuditEventCollection", "items", "AdminAuditEvent", true],
    ["CreatedSupportCode", "grant", "SupportCode", false],
  ]) {
    validateResponseReference(
      schemas,
      schemaName,
      property,
      reference,
      array,
      "Milestone 5",
    );
  }
  validateResponseReference(
    schemas,
    "UpdateAdminCancellationGuideDraftRequest",
    "steps",
    "UpdateAdminCancellationGuideDraftStepRequest",
    true,
    "Milestone 5",
  );

  const exactEnum = (schema, values, description) =>
    validateExactEnum(schema, values, description, schemas, "Milestone 5");
  for (const [schemaName, property, values] of [
    ["HouseholdMember", "role", ["OWNER", "MEMBER"]],
    ["HouseholdMember", "status", ["ACTIVE", "REMOVED"]],
    [
      "HouseholdInvitation",
      "status",
      ["PENDING", "ACCEPTED", "REVOKED", "EXPIRED"],
    ],
    ["PrivacyNotice", "acknowledgementType", ["ACKNOWLEDGED"]],
    ["PrivacyNoticeAcknowledgement", "eventType", ["ACKNOWLEDGED"]],
    ["ConsentCollection", "purpose", ["HOUSEHOLD_SHARING"]],
    ["ConsentCollection", "currentAction", ["GRANTED", "WITHDRAWN"]],
    ["ConsentEvent", "purpose", ["HOUSEHOLD_SHARING"]],
    ["ConsentEvent", "action", ["GRANTED", "WITHDRAWN"]],
    ["PrivacyRequest", "requestType", ["EXPORT", "CORRECTION", "DELETION"]],
    [
      "PrivacyRequest",
      "status",
      [
        "REQUESTED",
        "PROCESSING",
        "READY",
        "EXECUTED",
        "BLOCKED",
        "EXPIRED",
        "FAILED",
        "CANCELLED",
      ],
    ],
    ["PrivacyRequest", "correctionField", ["TIMEZONE"]],
    ["AdminCancellationGuideSummary", "state", ["ACTIVE", "RETIRED"]],
    [
      "AdminCancellationGuideVersion",
      "status",
      ["DRAFT", "PUBLISHED", "RETIRED"],
    ],
    [
      "AdminCancellationGuideDraft",
      "status",
      ["DRAFT", "PUBLISHED", "RETIRED"],
    ],
    [
      "AdminCancellationGuideDraftStep",
      "track",
      ["SERVICE", "PAYMENT_MANDATE"],
    ],
    [
      "AdminCancellationGuideDraftStep",
      "actionType",
      ["INFORMATION", "SAFE_LINK", "APP_DEEP_LINK"],
    ],
    ["AdminCancellationGuidePublication", "catalogState", ["ACTIVE"]],
    [
      "AdminCancellationGuideFeedback",
      "outcome",
      ["WORKED", "OUTDATED", "MERCHANT_CHANGED_FLOW", "UNSAFE_LINK"],
    ],
    [
      "AdminCancellationGuideFeedback",
      "disposition",
      ["PENDING", "RESOLVED", "DISMISSED"],
    ],
    [
      "AdminAuditEvent",
      "actorRole",
      ["USER", "GUIDE_ADMIN", "PRIVACY_ADMIN", "AUDIT_READ", "SUPPORT_READ"],
    ],
    [
      "AdminAuditEvent",
      "action",
      hasMilestone6Contract(specification)
        ? MILESTONE_6_ADMIN_AUDIT_ACTIONS
        : MILESTONE_5_ADMIN_AUDIT_ACTIONS,
    ],
    [
      "AdminAuditEvent",
      "resourceType",
      hasMilestone6Contract(specification)
        ? MILESTONE_6_ADMIN_AUDIT_RESOURCE_TYPES
        : MILESTONE_5_ADMIN_AUDIT_RESOURCE_TYPES,
    ],
    ["AdminAuditEvent", "outcome", ["SUCCEEDED"]],
    ["SupportCode", "status", ["ACTIVE", "REVOKED", "EXPIRED"]],
    ["SupportDiagnostics", "status", ["HEALTHY", "ATTENTION"]],
    [
      "PrivacyExportMetadata",
      "schemaVersion",
      ["autopay-guard-export-v1", "autopay-guard-export-v2"],
    ],
    ["SupportDiagnostics", "schemaVersion", ["support-diagnostics-v1"]],
    ["UpdateCommitmentSharingRequest", "visibility", ["PRIVATE", "HOUSEHOLD"]],
    ["Commitment", "visibility", ["PRIVATE", "HOUSEHOLD"]],
    ["RecordConsentRequest", "purpose", ["HOUSEHOLD_SHARING"]],
    ["RecordConsentRequest", "action", ["GRANTED", "WITHDRAWN"]],
    ["CreateExportPrivacyRequest", "requestType", ["EXPORT"]],
    ["CreateCorrectionPrivacyRequest", "requestType", ["CORRECTION"]],
    ["CreateDeletionPrivacyRequest", "requestType", ["DELETION"]],
    [
      "UpdateAdminCancellationGuideDraftStepRequest",
      "track",
      ["SERVICE", "PAYMENT_MANDATE"],
    ],
    [
      "ReviewAdminCancellationGuideFeedbackRequest",
      "disposition",
      ["RESOLVED", "DISMISSED"],
    ],
  ]) {
    exactEnum(
      schemas[schemaName].properties[property],
      values,
      `${schemaName}.${property}`,
    );
  }

  for (const [schemaName, property] of [
    ["HouseholdMemberCollection", "nextCursor"],
    ["HouseholdMember", "id"],
    ["HouseholdMember", "userId"],
    ["HouseholdInvitation", "id"],
    ["HouseholdInvitation", "householdId"],
    ["HouseholdInvitationCollection", "nextCursor"],
    ["PrivacyNoticeAcknowledgement", "id"],
    ["PrivacyNoticeAcknowledgementCollection", "nextCursor"],
    ["ConsentEvent", "id"],
    ["ConsentCollection", "nextCursor"],
    ["PrivacyRequest", "id"],
    ["AdminCancellationGuideSummary", "guideId"],
    ["AdminCancellationGuideSummary", "merchantId"],
    ["AdminCancellationGuideVersion", "guideId"],
    ["AdminCancellationGuideVersion", "draftId"],
    ["AdminCancellationGuideVersionCollection", "nextCursor"],
    ["AdminCancellationGuideDraft", "draftId"],
    ["AdminCancellationGuideDraft", "guideId"],
    ["AdminCancellationGuidePublication", "guideId"],
    ["AdminCancellationGuideFeedbackCollection", "nextCursor"],
    ["AdminCancellationGuideFeedback", "id"],
    ["AdminCancellationGuideFeedback", "guideId"],
    ["AdminAuditEventCollection", "nextCursor"],
    ["AdminAuditEvent", "id"],
    ["AdminAuditEvent", "resourceId"],
    ["SupportCode", "id"],
    ["UpdateCommitmentSharingRequest", "responsibleMemberId"],
    ["Commitment", "responsibleMemberId"],
  ]) {
    const propertySchema = schemas[schemaName].properties[property];
    if (propertySchema?.type !== "string" || propertySchema.format !== "uuid") {
      throw new Error(`Milestone 5 ${schemaName}.${property} must be a UUID.`);
    }
  }

  for (const [schemaName, property] of [
    ["CreatedHouseholdInvitation", "invitationCode"],
    ["AcceptHouseholdInvitationRequest", "invitationCode"],
    ["CreatedSupportCode", "supportCode"],
    ["ResolveSupportDiagnosticsRequest", "supportCode"],
  ]) {
    validateOpaqueOneTimeCode(
      schemas[schemaName].properties[property],
      `${schemaName}.${property}`,
    );
  }
  for (const [schemaName, property] of [
    ["PrivacyNotice", "contentSha256"],
    ["PrivacyNoticeAcknowledgement", "contentSha256"],
    ["PrivacyExportMetadata", "sha256"],
  ]) {
    validateSha256(
      schemas[schemaName].properties[property],
      `${schemaName}.${property}`,
    );
  }
  const exportBytes = schemas.PrivacyExportMetadata.properties.byteCount;
  if (
    exportBytes?.type !== "integer" ||
    exportBytes.format !== "int64" ||
    Number(exportBytes.minimum) !== 0 ||
    Number(exportBytes.maximum) !== 5_242_880
  ) {
    throw new Error(
      "Milestone 5 PrivacyExportMetadata.byteCount must be a bounded 0 through 5 MiB int64.",
    );
  }
  for (const [schemaName, property] of [
    ["HouseholdMember", "version"],
    ["HouseholdInvitation", "version"],
    ["PrivacyRequest", "version"],
    ["AdminCancellationGuideSummary", "version"],
    ["AdminCancellationGuideDraft", "version"],
    ["AdminCancellationGuidePublication", "catalogVersion"],
    ["AdminCancellationGuideFeedback", "version"],
    ["SupportCode", "version"],
  ]) {
    const version = schemas[schemaName].properties[property];
    if (
      version?.type !== "integer" ||
      version.format !== "int64" ||
      Number(version.minimum) !== 0
    ) {
      throw new Error(
        `Milestone 5 ${schemaName}.${property} must be a non-negative int64 version.`,
      );
    }
  }
  const invitationEmail =
    schemas.CreateHouseholdInvitationRequest.properties.inviteeEmail;
  if (
    invitationEmail?.type !== "string" ||
    invitationEmail.format !== "email" ||
    Number(invitationEmail.minLength) !== 3 ||
    Number(invitationEmail.maxLength) !== 320
  ) {
    throw new Error(
      "Milestone 5 CreateHouseholdInvitationRequest.inviteeEmail must be bounded to 320 characters.",
    );
  }
  const noticeVersion =
    schemas.AcknowledgePrivacyNoticeRequest.properties.noticeVersion;
  if (
    noticeVersion?.type !== "string" ||
    Number(noticeVersion.minLength) !== 1 ||
    Number(noticeVersion.maxLength) !== 64
  ) {
    throw new Error(
      "Milestone 5 AcknowledgePrivacyNoticeRequest.noticeVersion must be bounded to 64 characters.",
    );
  }
  const purposeVersion = schemas.RecordConsentRequest.properties.purposeVersion;
  if (
    purposeVersion?.type !== "string" ||
    Number(purposeVersion.maxLength) !== 64 ||
    !patternAcceptsExactly(
      purposeVersion.pattern,
      ["household-sharing.v1", "a", "a_b-c.d"],
      ["A", ".bad", "bad space", "a".repeat(65)],
    )
  ) {
    throw new Error(
      "Milestone 5 RecordConsentRequest.purposeVersion must be a bounded lowercase version token.",
    );
  }
  validatePrivacyRequestDiscriminator(schemas);
  const correctionValue =
    schemas.CreateCorrectionPrivacyRequest.properties.correctionValue;
  if (
    correctionValue?.type !== "string" ||
    correctionValue.nullable === true ||
    Number(correctionValue.minLength) !== 1 ||
    Number(correctionValue.maxLength) !== 64
  ) {
    throw new Error(
      "Milestone 5 CreateCorrectionPrivacyRequest.correctionValue must be required non-null text bounded to 1 through 64 characters.",
    );
  }
  const draftRequest = schemas.UpdateAdminCancellationGuideDraftRequest;
  if (
    Number(draftRequest.properties.riskNotice?.minLength) !== 1 ||
    Number(draftRequest.properties.riskNotice?.maxLength) !== 1000 ||
    Number(draftRequest.properties.reviewIntervalDays?.minimum) !== 30 ||
    Number(draftRequest.properties.reviewIntervalDays?.maximum) !== 90 ||
    draftRequest.properties.steps?.type !== "array" ||
    Number(draftRequest.properties.steps?.minItems) !== 4 ||
    Number(draftRequest.properties.steps?.maxItems) !== 4
  ) {
    throw new Error(
      "Milestone 5 guide draft updates must contain bounded notice text, a 30-90 day interval, and exactly four steps.",
    );
  }
  const draftStepRequest = schemas.UpdateAdminCancellationGuideDraftStepRequest;
  if (
    Number(draftStepRequest.properties.sequenceNumber?.minimum) !== 1 ||
    Number(draftStepRequest.properties.sequenceNumber?.maximum) !== 2 ||
    Number(draftStepRequest.properties.title?.minLength) !== 1 ||
    Number(draftStepRequest.properties.title?.maxLength) !== 160 ||
    Number(draftStepRequest.properties.instruction?.minLength) !== 1 ||
    Number(draftStepRequest.properties.instruction?.maxLength) !== 1000
  ) {
    throw new Error(
      "Milestone 5 guide draft step text and sequence bounds are required.",
    );
  }
  for (const schemaName of [
    "AdminCancellationGuideVersion",
    "AdminCancellationGuideDraft",
  ]) {
    const riskNotice = schemas[schemaName].properties.riskNotice;
    if (
      Number(riskNotice?.minLength) !== 1 ||
      Number(riskNotice?.maxLength) !== 1000
    ) {
      throw new Error(
        `Milestone 5 ${schemaName}.riskNotice must be bounded to 1 through 1000 characters.`,
      );
    }
  }
  const draftStep = schemas.AdminCancellationGuideDraftStep.properties;
  for (const [property, maximum] of [
    ["title", 160],
    ["instruction", 1000],
    ["targetKey", 100],
    ["targetUri", 1000],
  ]) {
    if (
      Number(draftStep[property]?.minLength) !== 1 ||
      Number(draftStep[property]?.maxLength) !== maximum
    ) {
      throw new Error(
        `Milestone 5 AdminCancellationGuideDraftStep.${property} has the wrong text bounds.`,
      );
    }
  }
  const supportAcknowledgement =
    schemas.CreateSupportCodeRequest.properties.acknowledgeReadOnlyDiagnostics;
  if (
    supportAcknowledgement?.type !== "boolean" ||
    supportAcknowledgement.enum?.length !== 1 ||
    supportAcknowledgement.enum[0] !== true
  ) {
    throw new Error(
      "Milestone 5 support-code acknowledgement must be the boolean value true.",
    );
  }
  for (const property of [
    "activeCommitmentCount",
    "failedNotificationCount",
    "pendingPrivacyRequestCount",
    "latestCommitmentVersion",
  ]) {
    const count = schemas.SupportDiagnostics.properties[property];
    if (
      count?.type !== "integer" ||
      count.format !== "int64" ||
      Number(count.minimum) !== 0
    ) {
      throw new Error(
        `Milestone 5 SupportDiagnostics.${property} must be a non-negative int64.`,
      );
    }
  }

  const etagHeader = {
    name: "ETag",
    type: "string",
    etag: true,
  };
  const operations = [
    {
      method: "get",
      path: "/v1/privacy/notices/current",
      operationId: "getCurrentPrivacyNotice",
      responseSchema: "PrivacyNotice",
      parameters: [],
      errors: [],
    },
    {
      method: "get",
      path: "/v1/privacy/notice-acknowledgements",
      operationId: "listPrivacyNoticeAcknowledgements",
      responseSchema: "PrivacyNoticeAcknowledgementCollection",
      parameters: [
        optionalUuidQuery("cursor"),
        optionalBoundedIntegerQuery("limit", 1, 100),
      ],
      errors: [400, 404],
    },
    {
      method: "post",
      path: "/v1/privacy/notice-acknowledgements",
      operationId: "acknowledgePrivacyNotice",
      requestSchema: "AcknowledgePrivacyNoticeRequest",
      responseSchema: "PrivacyNoticeAcknowledgement",
      success: 201,
      parameters: [requiredIdempotencyHeader()],
      errors: [400, 409],
    },
    {
      method: "get",
      path: "/v1/privacy/consents",
      operationId: "listConsentEvents",
      responseSchema: "ConsentCollection",
      parameters: [
        optionalUuidQuery("cursor"),
        optionalBoundedIntegerQuery("limit", 1, 100),
      ],
      errors: [400, 404],
    },
    {
      method: "post",
      path: "/v1/privacy/consents",
      operationId: "recordConsentEvent",
      requestSchema: "RecordConsentRequest",
      responseSchema: "ConsentEvent",
      success: 201,
      parameters: [requiredIdempotencyHeader()],
      errors: [400, 409],
    },
    {
      method: "get",
      path: "/v1/households/{householdId}/members",
      operationId: "listHouseholdMembers",
      responseSchema: "HouseholdMemberCollection",
      parameters: [
        requiredUuidPath("householdId"),
        optionalUuidQuery("cursor"),
        optionalBoundedIntegerQuery("limit", 1, 100),
      ],
      errors: [400, 404],
    },
    {
      method: "delete",
      path: "/v1/households/{householdId}/members/{memberId}",
      operationId: "removeHouseholdMember",
      success: 204,
      noContent: true,
      parameters: [
        requiredUuidPath("householdId"),
        requiredUuidPath("memberId"),
        requiredIfMatchHeader(),
      ],
      errors: [400, 404, 409, 412, 428],
    },
    {
      method: "get",
      path: "/v1/households/{householdId}/invitations",
      operationId: "listHouseholdInvitations",
      responseSchema: "HouseholdInvitationCollection",
      parameters: [
        requiredUuidPath("householdId"),
        optionalUuidQuery("cursor"),
        optionalBoundedIntegerQuery("limit", 1, 100),
      ],
      errors: [400, 404],
    },
    {
      method: "post",
      path: "/v1/households/{householdId}/invitations",
      operationId: "createHouseholdInvitation",
      requestSchema: "CreateHouseholdInvitationRequest",
      responseSchema: "CreatedHouseholdInvitation",
      success: 201,
      parameters: [requiredUuidPath("householdId")],
      errors: [400, 404, 409, 429],
    },
    {
      method: "delete",
      path: "/v1/households/{householdId}/invitations/{invitationId}",
      operationId: "revokeHouseholdInvitation",
      success: 204,
      noContent: true,
      parameters: [
        requiredUuidPath("householdId"),
        requiredUuidPath("invitationId"),
        requiredIfMatchHeader(),
      ],
      errors: [400, 404, 409, 412, 428],
    },
    {
      method: "get",
      path: "/v1/household-invitations",
      operationId: "listIncomingHouseholdInvitations",
      responseSchema: "HouseholdInvitationCollection",
      parameters: [
        optionalUuidQuery("cursor"),
        optionalBoundedIntegerQuery("limit", 1, 100),
      ],
      errors: [400, 404],
    },
    {
      method: "post",
      path: "/v1/household-invitations/accept",
      operationId: "acceptHouseholdInvitation",
      requestSchema: "AcceptHouseholdInvitationRequest",
      responseSchema: "HouseholdMember",
      parameters: [requiredIdempotencyHeader()],
      responseHeaders: [etagHeader],
      errors: [400, 404, 409, 429],
    },
    {
      method: "patch",
      path: "/v1/commitments/{commitmentId}/sharing",
      operationId: "updateCommitmentSharing",
      requestSchema: "UpdateCommitmentSharingRequest",
      responseSchema: "Commitment",
      parameters: [requiredUuidPath("commitmentId"), requiredIfMatchHeader()],
      responseHeaders: [etagHeader],
      errors: [400, 404, 409, 412, 428],
    },
    {
      method: "get",
      path: "/v1/privacy/requests",
      operationId: "listPrivacyRequests",
      responseSchema: "PrivacyRequestCollection",
      parameters: [
        optionalUuidQuery("cursor"),
        optionalBoundedIntegerQuery("limit", 1, 100),
      ],
      errors: [400],
    },
    {
      method: "post",
      path: "/v1/privacy/requests",
      operationId: "createPrivacyRequest",
      requestSchema: "CreatePrivacyRequest",
      responseSchema: "PrivacyRequest",
      success: 201,
      parameters: [requiredIdempotencyHeader()],
      responseHeaders: [etagHeader],
      errors: [400, 409, 429],
    },
    {
      method: "get",
      path: "/v1/privacy/requests/{requestId}",
      operationId: "getPrivacyRequest",
      responseSchema: "PrivacyRequest",
      parameters: [requiredUuidPath("requestId")],
      responseHeaders: [etagHeader],
      errors: [404],
    },
    {
      method: "post",
      path: "/v1/privacy/requests/{requestId}/cancel",
      operationId: "cancelPrivacyRequest",
      responseSchema: "PrivacyRequest",
      parameters: [
        requiredUuidPath("requestId"),
        requiredIfMatchHeader(),
        requiredIdempotencyHeader(),
      ],
      responseHeaders: [etagHeader],
      errors: [400, 404, 409, 412, 428],
    },
    {
      method: "get",
      path: "/v1/privacy/requests/{requestId}/export",
      operationId: "downloadPrivacyExport",
      objectResponse: true,
      parameters: [requiredUuidPath("requestId")],
      responseHeaders: [
        {
          name: "Content-Disposition",
          type: "string",
          accepted: [
            'attachment; filename="autopay-guard-export-v1.json"',
            'attachment; filename="autopay-guard-export-v2.json"',
          ],
          rejected: [
            "inline",
            'attachment; filename="other.json"',
            "attachment",
          ],
        },
        {
          name: "X-Content-SHA256",
          type: "string",
          minLength: 64,
          maxLength: 64,
          accepted: ["a".repeat(64)],
          rejected: ["A".repeat(64), "a".repeat(63), "g".repeat(64)],
        },
        {
          name: "Content-Length",
          type: "integer",
          format: "int64",
          minimum: 0,
          maximum: 5_242_880,
        },
      ],
      errors: [404, 409, 410],
    },
    {
      method: "get",
      path: "/v1/admin/privacy/requests",
      operationId: "listAdminPrivacyRequests",
      responseSchema: "PrivacyRequestCollection",
      parameters: [
        optionalUuidQuery("cursor"),
        optionalBoundedIntegerQuery("limit", 1, 100),
      ],
      errors: [400],
    },
    {
      method: "post",
      path: "/v1/admin/privacy/requests/{requestId}/execute",
      operationId: "executePrivacyRequest",
      responseSchema: "PrivacyRequest",
      parameters: [
        requiredUuidPath("requestId"),
        requiredIfMatchHeader(),
        requiredIdempotencyHeader(),
      ],
      responseHeaders: [etagHeader],
      errors: [400, 404, 409, 412, 428],
    },
    {
      method: "get",
      path: "/v1/admin/cancellation-guides",
      operationId: "listAdminCancellationGuides",
      responseSchema: "AdminCancellationGuideCollection",
      parameters: [],
      errors: [],
    },
    {
      method: "get",
      path: "/v1/admin/cancellation-guides/{guideId}",
      operationId: "getAdminCancellationGuide",
      responseSchema: "AdminCancellationGuideSummary",
      parameters: [requiredUuidPath("guideId")],
      responseHeaders: [etagHeader],
      errors: [404],
    },
    {
      method: "get",
      path: "/v1/admin/cancellation-guides/{guideId}/versions",
      operationId: "listAdminCancellationGuideVersions",
      responseSchema: "AdminCancellationGuideVersionCollection",
      parameters: [
        requiredUuidPath("guideId"),
        optionalUuidQuery("cursor"),
        optionalBoundedIntegerQuery("limit", 1, 100),
      ],
      errors: [400, 404],
    },
    {
      method: "post",
      path: "/v1/admin/cancellation-guides/{guideId}/drafts",
      operationId: "createAdminCancellationGuideDraft",
      responseSchema: "AdminCancellationGuideDraft",
      success: 201,
      parameters: [requiredUuidPath("guideId"), requiredIdempotencyHeader()],
      responseHeaders: [etagHeader, { name: "Location", type: "string" }],
      errors: [400, 404, 409],
    },
    {
      method: "post",
      path: "/v1/admin/cancellation-guides/{guideId}/retire",
      operationId: "retireAdminCancellationGuide",
      responseSchema: "AdminCancellationGuideSummary",
      parameters: [
        requiredUuidPath("guideId"),
        requiredIfMatchHeader(),
        requiredIdempotencyHeader(),
      ],
      responseHeaders: [etagHeader],
      errors: [400, 404, 409, 412, 428],
    },
    {
      method: "get",
      path: "/v1/admin/cancellation-guide-drafts/{draftId}",
      operationId: "getAdminCancellationGuideDraft",
      responseSchema: "AdminCancellationGuideDraft",
      parameters: [requiredUuidPath("draftId")],
      responseHeaders: [etagHeader],
      errors: [404],
    },
    {
      method: "patch",
      path: "/v1/admin/cancellation-guide-drafts/{draftId}",
      operationId: "updateAdminCancellationGuideDraft",
      requestSchema: "UpdateAdminCancellationGuideDraftRequest",
      responseSchema: "AdminCancellationGuideDraft",
      parameters: [requiredUuidPath("draftId"), requiredIfMatchHeader()],
      responseHeaders: [etagHeader],
      errors: [400, 404, 412, 428],
    },
    {
      method: "post",
      path: "/v1/admin/cancellation-guide-drafts/{draftId}/publish",
      operationId: "publishAdminCancellationGuideDraft",
      responseSchema: "AdminCancellationGuidePublication",
      parameters: [
        requiredUuidPath("draftId"),
        requiredIfMatchHeader(),
        requiredIdempotencyHeader(),
      ],
      responseHeaders: [etagHeader],
      errors: [400, 404, 409, 412, 428, 429],
    },
    {
      method: "get",
      path: "/v1/admin/cancellation-guide-feedback",
      operationId: "listAdminCancellationGuideFeedback",
      responseSchema: "AdminCancellationGuideFeedbackCollection",
      parameters: [
        optionalUuidQuery("cursor"),
        optionalBoundedIntegerQuery("limit", 1, 100),
      ],
      errors: [400],
    },
    {
      method: "post",
      path: "/v1/admin/cancellation-guide-feedback/{feedbackId}/review",
      operationId: "reviewAdminCancellationGuideFeedback",
      requestSchema: "ReviewAdminCancellationGuideFeedbackRequest",
      responseSchema: "AdminCancellationGuideFeedback",
      parameters: [
        requiredUuidPath("feedbackId"),
        requiredIfMatchHeader(),
        requiredIdempotencyHeader(),
      ],
      responseHeaders: [etagHeader],
      errors: [400, 404, 409, 412, 428],
    },
    {
      method: "get",
      path: "/v1/admin/audit-events",
      operationId: "listAdminAuditEvents",
      responseSchema: "AdminAuditEventCollection",
      parameters: [
        optionalUuidQuery("cursor"),
        optionalBoundedIntegerQuery("limit", 1, 100),
      ],
      errors: [400],
    },
    {
      method: "post",
      path: "/v1/households/{householdId}/support-codes",
      operationId: "createSupportCode",
      requestSchema: "CreateSupportCodeRequest",
      responseSchema: "CreatedSupportCode",
      success: 201,
      parameters: [requiredUuidPath("householdId")],
      errors: [400, 404, 409, 429],
    },
    {
      method: "delete",
      path: "/v1/households/{householdId}/support-codes/{supportCodeId}",
      operationId: "revokeSupportCode",
      success: 204,
      noContent: true,
      parameters: [
        requiredUuidPath("householdId"),
        requiredUuidPath("supportCodeId"),
        requiredIfMatchHeader(),
      ],
      errors: [400, 404, 412, 428],
    },
    {
      method: "post",
      path: "/v1/support/diagnostics/resolve",
      operationId: "resolveSupportDiagnostics",
      requestSchema: "ResolveSupportDiagnosticsRequest",
      responseSchema: "SupportDiagnostics",
      parameters: [],
      errors: [400, 404, 429],
    },
  ];

  for (const expected of operations) {
    validateExactOperation(
      specification,
      {
        ...expected,
        exactContract: true,
        responseHeaders: expected.responseHeaders ?? [],
      },
      "Milestone 5",
    );
  }
}

function validateMilestone6Contract(specification) {
  const schemas = specification.components.schemas;
  const responseProperties = {
    UploadResponse: [
      "id",
      "householdId",
      "status",
      "rawByteCount",
      "expiresAt",
      "totalItemCount",
      "validItemCount",
      "invalidItemCount",
      "duplicateItemCount",
      "version",
      "createdAt",
      "updatedAt",
    ],
    JobResponse: [
      "id",
      "householdId",
      "status",
      "rawByteCount",
      "expiresAt",
      "rawProcessedAt",
      "totalItemCount",
      "validItemCount",
      "invalidItemCount",
      "duplicateItemCount",
      "selectedItemCount",
      "createdCommitmentCount",
      "items",
      "version",
      "createdAt",
      "updatedAt",
    ],
    ItemResponse: [
      "id",
      "rowNumber",
      "valid",
      "duplicateKind",
      "selected",
      "createdCommitmentId",
      "errors",
      "preview",
    ],
    Preview: [
      "name",
      "category",
      "amountMinor",
      "currency",
      "frequency",
      "nextDueDate",
      "monthDayPolicy",
      "paymentRail",
      "maskedPaymentLabel",
      "merchantId",
    ],
    ErrorResponse: ["code", "message"],
    ConfirmationResponse: [
      "importId",
      "status",
      "selectedItemCount",
      "createdCommitmentCount",
      "commitmentIds",
      "rawProcessedAt",
      "version",
    ],
  };
  for (const [name, expectedProperties] of Object.entries(responseProperties)) {
    validateExactObjectSchema(
      schemas,
      name,
      expectedProperties,
      "Milestone 6 response",
      false,
    );
  }

  const requestProperties = {
    CommitmentImportUploadRequest: ["householdId", "file"],
    ConfirmRequest: ["selectedItemIds"],
  };
  for (const [name, expectedProperties] of Object.entries(requestProperties)) {
    validateExactObjectSchema(
      schemas,
      name,
      expectedProperties,
      "Milestone 6 request",
      true,
    );
  }

  for (const [schemaName, property, reference, array] of [
    ["JobResponse", "items", "ItemResponse", true],
    ["ItemResponse", "errors", "ErrorResponse", true],
    ["ItemResponse", "preview", "Preview", false],
  ]) {
    validateResponseReference(
      schemas,
      schemaName,
      property,
      reference,
      array,
      "Milestone 6",
    );
  }

  for (const [schemaName, property] of [
    ["ItemResponse", "duplicateKind"],
    ["ItemResponse", "selected"],
    ["ItemResponse", "createdCommitmentId"],
    ["ItemResponse", "preview"],
    ["Preview", "maskedPaymentLabel"],
    ["Preview", "merchantId"],
  ]) {
    if (schemas[schemaName].properties[property]?.nullable !== true) {
      throw new Error(
        `Milestone 6 ${schemaName}.${property} must be explicitly nullable.`,
      );
    }
  }
  for (const schemaName of ["JobResponse", "ConfirmationResponse"]) {
    if (schemas[schemaName].properties.rawProcessedAt?.nullable === true) {
      throw new Error(
        `Milestone 6 ${schemaName}.rawProcessedAt must be required and non-null.`,
      );
    }
  }

  const exactEnum = (schema, values, description) =>
    validateExactEnum(schema, values, description, schemas, "Milestone 6");
  for (const [schemaName, property] of [
    ["UploadResponse", "status"],
    ["JobResponse", "status"],
    ["ConfirmationResponse", "status"],
  ]) {
    exactEnum(
      schemas[schemaName].properties[property],
      ["PREVIEW_READY", "CONFIRMED", "DISCARDED", "EXPIRED"],
      `${schemaName}.${property}`,
    );
  }
  exactEnum(
    schemas.ItemResponse.properties.duplicateKind,
    ["NONE", "IN_FILE", "EXISTING"],
    "ItemResponse.duplicateKind",
  );
  exactEnum(
    schemas.ErrorResponse.properties.code,
    [
      "NAME_INVALID",
      "NAME_SENSITIVE",
      "CATEGORY_INVALID",
      "AMOUNT_INVALID",
      "CURRENCY_INVALID",
      "FREQUENCY_INVALID",
      "NEXT_DUE_DATE_INVALID",
      "PAYMENT_RAIL_INVALID",
      "MASKED_LABEL_INVALID",
      "MASKED_LABEL_SENSITIVE",
    ],
    "ErrorResponse.code",
  );
  exactEnum(
    schemas.Preview.properties.category,
    [
      "SUBSCRIPTION",
      "UTILITY",
      "MEMBERSHIP",
      "SOFTWARE",
      "EMI_LOAN",
      "INSURANCE",
      "INVESTMENT_COMMITMENT",
      "EDUCATION",
      "OTHER",
    ],
    "Preview.category",
  );
  exactEnum(
    schemas.Preview.properties.frequency,
    ["WEEKLY", "MONTHLY", "QUARTERLY", "HALF_YEARLY", "YEARLY"],
    "Preview.frequency",
  );
  exactEnum(
    schemas.Preview.properties.monthDayPolicy,
    ["ANCHOR_DAY", "LAST_DAY"],
    "Preview.monthDayPolicy",
  );
  exactEnum(
    schemas.Preview.properties.paymentRail,
    [
      "UPI_AUTOPAY",
      "CARD_RECURRING",
      "NACH_ENACH",
      "APP_STORE",
      "MERCHANT_DIRECT",
      "CASH_OR_MANUAL",
      "UNKNOWN",
    ],
    "Preview.paymentRail",
  );
  exactEnum(
    schemas.AdminAuditEvent.properties.action,
    MILESTONE_6_ADMIN_AUDIT_ACTIONS,
    "AdminAuditEvent.action",
  );
  exactEnum(
    schemas.AdminAuditEvent.properties.resourceType,
    MILESTONE_6_ADMIN_AUDIT_RESOURCE_TYPES,
    "AdminAuditEvent.resourceType",
  );

  for (const [schemaName, property] of [
    ["UploadResponse", "id"],
    ["UploadResponse", "householdId"],
    ["JobResponse", "id"],
    ["JobResponse", "householdId"],
    ["ItemResponse", "id"],
    ["ItemResponse", "createdCommitmentId"],
    ["Preview", "merchantId"],
    ["CommitmentImportUploadRequest", "householdId"],
    ["ConfirmationResponse", "importId"],
  ]) {
    const propertySchema = schemas[schemaName].properties[property];
    if (propertySchema?.type !== "string" || propertySchema.format !== "uuid") {
      throw new Error(`Milestone 6 ${schemaName}.${property} must be a UUID.`);
    }
  }

  for (const [schemaName, property, format] of [
    ["UploadResponse", "expiresAt", "date-time"],
    ["UploadResponse", "createdAt", "date-time"],
    ["UploadResponse", "updatedAt", "date-time"],
    ["JobResponse", "expiresAt", "date-time"],
    ["JobResponse", "rawProcessedAt", "date-time"],
    ["JobResponse", "createdAt", "date-time"],
    ["JobResponse", "updatedAt", "date-time"],
    ["Preview", "nextDueDate", "date"],
    ["ConfirmationResponse", "rawProcessedAt", "date-time"],
  ]) {
    const propertySchema = schemas[schemaName].properties[property];
    if (propertySchema?.type !== "string" || propertySchema.format !== format) {
      throw new Error(
        `Milestone 6 ${schemaName}.${property} must use string format ${format}.`,
      );
    }
  }

  const requireInteger = (schemaName, property, format, minimum, maximum) => {
    const schema = schemas[schemaName].properties[property];
    if (
      schema?.type !== "integer" ||
      schema.format !== format ||
      Number(schema.minimum) !== minimum ||
      (maximum !== undefined && Number(schema.maximum) !== maximum)
    ) {
      throw new Error(
        `Milestone 6 ${schemaName}.${property} must be a ${format} bounded from ${minimum}${maximum === undefined ? "" : ` through ${maximum}`}.`,
      );
    }
  };
  for (const schemaName of ["UploadResponse", "JobResponse"]) {
    requireInteger(schemaName, "rawByteCount", "int32", 1, 262_144);
    requireInteger(schemaName, "totalItemCount", "int32", 1, 100);
    for (const property of [
      "validItemCount",
      "invalidItemCount",
      "duplicateItemCount",
    ]) {
      requireInteger(schemaName, property, "int32", 0, 100);
    }
    requireInteger(schemaName, "version", "int64", 0);
  }
  for (const property of ["selectedItemCount", "createdCommitmentCount"]) {
    requireInteger("JobResponse", property, "int32", 0, 100);
    requireInteger("ConfirmationResponse", property, "int32", 1, 100);
  }
  requireInteger("ItemResponse", "rowNumber", "int32", 2, 101);
  requireInteger("Preview", "amountMinor", "int64", 1, 999_999_999_999);
  requireInteger("ConfirmationResponse", "version", "int64", 0);

  const requireArray = (schemaName, property, minimum, maximum, unique) => {
    const schema = schemas[schemaName].properties[property];
    if (
      schema?.type !== "array" ||
      Number(schema.minItems) !== minimum ||
      Number(schema.maxItems) !== maximum ||
      (unique && schema.uniqueItems !== true)
    ) {
      throw new Error(
        `Milestone 6 ${schemaName}.${property} must contain ${minimum} through ${maximum}${unique ? " unique" : ""} items.`,
      );
    }
  };
  requireArray("JobResponse", "items", 1, 100, false);
  requireArray("ItemResponse", "errors", 0, 10, false);
  requireArray("ConfirmRequest", "selectedItemIds", 1, 100, true);
  requireArray("ConfirmationResponse", "commitmentIds", 1, 100, true);

  for (const [schemaName, property] of [
    ["ConfirmRequest", "selectedItemIds"],
    ["ConfirmationResponse", "commitmentIds"],
  ]) {
    const item = schemas[schemaName].properties[property]?.items;
    if (item?.type !== "string" || item.format !== "uuid") {
      throw new Error(
        `Milestone 6 ${schemaName}.${property} must contain UUIDs.`,
      );
    }
  }

  const uploadFile = schemas.CommitmentImportUploadRequest.properties.file;
  if (
    uploadFile?.type !== "string" ||
    uploadFile.format !== "binary" ||
    Number(uploadFile.minLength) !== 1 ||
    Number(uploadFile.maxLength) !== 262_144
  ) {
    throw new Error(
      "Milestone 6 CommitmentImportUploadRequest.file must be a binary string bounded to 1 through 256 KiB.",
    );
  }
  const previewName = schemas.Preview.properties.name;
  if (
    previewName?.type !== "string" ||
    Number(previewName.minLength) !== 1 ||
    Number(previewName.maxLength) !== 160
  ) {
    throw new Error(
      "Milestone 6 Preview.name must be bounded to 1 through 160 characters.",
    );
  }
  const currency = schemas.Preview.properties.currency;
  if (
    currency?.type !== "string" ||
    Number(currency.minLength) !== 3 ||
    Number(currency.maxLength) !== 3 ||
    !patternAcceptsExactly(
      currency.pattern,
      ["INR", "USD"],
      ["inr", "IN", "INRR", "1NR"],
    )
  ) {
    throw new Error(
      "Milestone 6 Preview.currency must be one uppercase ISO-style three-letter code.",
    );
  }
  const maskedLabel = schemas.Preview.properties.maskedPaymentLabel;
  if (
    maskedLabel?.type !== "string" ||
    Number(maskedLabel.minLength ?? 0) !== 0 ||
    Number(maskedLabel.maxLength) !== 64
  ) {
    throw new Error(
      "Milestone 6 Preview.maskedPaymentLabel must be bounded to 64 characters.",
    );
  }
  const errorMessage = schemas.ErrorResponse.properties.message;
  if (
    errorMessage?.type !== "string" ||
    Number(errorMessage.minLength) !== 1 ||
    Number(errorMessage.maxLength) !== 200
  ) {
    throw new Error(
      "Milestone 6 ErrorResponse.message must be bounded to 1 through 200 characters.",
    );
  }

  const safeLocationHeader = {
    name: "Location",
    type: "string",
    accepted: ["/v1/imports/01234567-89ab-cdef-0123-456789abcdef"],
    rejected: [
      "https://example.com/v1/imports/01234567-89ab-cdef-0123-456789abcdef",
      "/v1/imports/../privacy",
      "/v1/imports/not-a-uuid",
    ],
  };
  const etagHeader = { name: "ETag", type: "string", etag: true };
  const noStoreHeader = {
    name: "Cache-Control",
    type: "string",
    accepted: ["no-store"],
    rejected: ["public", "no-cache", "no-store, private"],
  };
  const operations = [
    {
      method: "post",
      path: "/v1/imports",
      operationId: "uploadCommitmentImport",
      requestSchema: "CommitmentImportUploadRequest",
      requestMediaType: "multipart/form-data",
      responseSchema: "UploadResponse",
      success: 201,
      parameters: [requiredIdempotencyHeader()],
      responseHeaders: [safeLocationHeader, etagHeader, noStoreHeader],
      errors: [400, 401, 403, 404, 409, 429],
    },
    {
      method: "get",
      path: "/v1/imports/{importId}",
      operationId: "getCommitmentImport",
      responseSchema: "JobResponse",
      parameters: [requiredUuidPath("importId")],
      responseHeaders: [etagHeader, noStoreHeader],
      errors: [401, 403, 404],
    },
    {
      method: "post",
      path: "/v1/imports/{importId}/confirm",
      operationId: "confirmCommitmentImport",
      requestSchema: "ConfirmRequest",
      responseSchema: "ConfirmationResponse",
      parameters: [
        requiredUuidPath("importId"),
        requiredIfMatchHeader(),
        requiredIdempotencyHeader(),
      ],
      responseHeaders: [etagHeader, noStoreHeader],
      errors: [400, 401, 403, 404, 409, 412, 428, 429],
    },
    {
      method: "delete",
      path: "/v1/imports/{importId}",
      operationId: "discardCommitmentImport",
      success: 204,
      noContent: true,
      parameters: [requiredUuidPath("importId"), requiredIfMatchHeader()],
      responseHeaders: [noStoreHeader],
      errors: [400, 401, 403, 404, 409, 412, 428],
    },
  ];
  for (const expected of operations) {
    validateExactOperation(
      specification,
      { ...expected, exactContract: true },
      "Milestone 6",
    );
  }

  const expectedMethods = new Map([
    ["/v1/imports", ["post"]],
    ["/v1/imports/{importId}", ["get", "delete"]],
    ["/v1/imports/{importId}/confirm", ["post"]],
  ]);
  const actualPaths = Object.keys(specification.paths).filter(
    (path) => path === "/v1/imports" || path.startsWith("/v1/imports/"),
  );
  if (
    actualPaths.length !== expectedMethods.size ||
    [...expectedMethods.keys()].some((path) => !actualPaths.includes(path))
  ) {
    throw new Error(
      "Milestone 6 must expose exactly the three controlled import paths.",
    );
  }
  for (const [path, expected] of expectedMethods) {
    const actual = ["get", "post", "put", "patch", "delete"].filter(
      (method) => specification.paths[path]?.[method],
    );
    if (
      actual.length !== expected.length ||
      expected.some((method) => !actual.includes(method))
    ) {
      throw new Error(
        `Milestone 6 ${path} must expose exactly: ${expected.join(", ")}.`,
      );
    }
  }
}

function validatePrivacyRequestDiscriminator(schemas) {
  const schema = schemas.CreatePrivacyRequest;
  const expectedMapping = {
    EXPORT: "#/components/schemas/CreateExportPrivacyRequest",
    CORRECTION: "#/components/schemas/CreateCorrectionPrivacyRequest",
    DELETION: "#/components/schemas/CreateDeletionPrivacyRequest",
  };
  const references = (schema?.oneOf ?? []).map(schemaReference);
  const expectedReferences = Object.values(expectedMapping);
  if (
    references.length !== expectedReferences.length ||
    expectedReferences.some((reference) => !references.includes(reference))
  ) {
    throw new Error(
      "Milestone 5 CreatePrivacyRequest must be exactly the EXPORT, CORRECTION, or DELETION request union.",
    );
  }
  const discriminator = schema.discriminator;
  const mapping = discriminator?.mapping ?? {};
  if (
    discriminator?.propertyName !== "requestType" ||
    Object.keys(mapping).length !== Object.keys(expectedMapping).length ||
    Object.entries(expectedMapping).some(
      ([value, reference]) => mapping[value] !== reference,
    )
  ) {
    throw new Error(
      "Milestone 5 CreatePrivacyRequest must use the exact requestType discriminator mapping.",
    );
  }
}

function validateMilestone5MassAssignment(schemas, requestProperties) {
  const forbidden = new Set([
    "id",
    "userid",
    "ownerid",
    "householdid",
    "memberid",
    "commitmentid",
    "guideid",
    "draftid",
    "feedbackid",
    "supportcodeid",
    "role",
    "status",
    "version",
    "createdat",
    "updatedat",
    "completedat",
    "publishedat",
    "expiresat",
    "contentsha256",
    "sha256",
    "bytecount",
    "target",
    "targetkey",
    "targeturi",
    "actiontype",
    "artifact",
    "artifactbytes",
    "audit",
    "actorrole",
    "resourceid",
    "outcome",
  ]);
  for (const [schemaName, allowed] of Object.entries(requestProperties)) {
    for (const property of Object.keys(schemas[schemaName]?.properties ?? {})) {
      if (
        !allowed.includes(property) ||
        forbidden.has(property.toLowerCase())
      ) {
        throw new Error(
          `Milestone 5 request schemas must not mass-assign ${property}.`,
        );
      }
    }
  }
}

function validateOpaqueOneTimeCode(schema, description) {
  if (
    schema?.type !== "string" ||
    Number(schema.minLength) !== 43 ||
    Number(schema.maxLength) !== 43 ||
    !patternAcceptsExactly(
      schema.pattern,
      ["A".repeat(43), "a_b-" + "0".repeat(39)],
      [
        "A".repeat(42),
        "A".repeat(44),
        "a".repeat(42) + "=",
        "a".repeat(42) + " ",
      ],
    )
  ) {
    throw new Error(
      `Milestone 5 ${description} must be an exact 43-character URL-safe opaque code.`,
    );
  }
}

function validateSha256(schema, description) {
  if (
    schema?.type !== "string" ||
    Number(schema.minLength) !== 64 ||
    Number(schema.maxLength) !== 64 ||
    !patternAcceptsExactly(
      schema.pattern,
      ["a".repeat(64), "0123456789abcdef".repeat(4)],
      ["A".repeat(64), "g".repeat(64), "a".repeat(63), "a".repeat(65)],
    )
  ) {
    throw new Error(
      `Milestone 5 ${description} must be an exact lowercase hexadecimal SHA-256.`,
    );
  }
}

function validateMilestone4MassAssignment(schemas, requestSchemaNames) {
  const forbidden = new Set([
    "owner",
    "ownerid",
    "owneruserid",
    "userid",
    "household",
    "householdid",
    "amount",
    "amountminor",
    "expectedamountminor",
    "estimatedamountminor",
    "currency",
    "link",
    "links",
    "target",
    "targets",
    "targeturi",
    "uri",
    "projectedsavingsminor",
    "state",
    "states",
    "savingsstate",
    "verificationstatus",
    "verificationsource",
    "timestamp",
    "timestamps",
    "createdat",
    "updatedat",
    "completedat",
    "abandonedat",
    "publishedat",
    "structuralreviewedat",
  ]);
  for (const schemaName of requestSchemaNames) {
    for (const property of Object.keys(schemas[schemaName]?.properties ?? {})) {
      if (forbidden.has(property.toLowerCase())) {
        throw new Error(
          `Milestone 4 request schemas must not mass-assign ${property}.`,
        );
      }
    }
  }
}

function validateMilestone4Operation(specification, expected) {
  validateExactOperation(specification, expected, "Milestone 4");
}

function validateExactOperation(specification, expected, milestone) {
  const operation = specification.paths[expected.path]?.[expected.method];
  const label = `${expected.method.toUpperCase()} ${expected.path}`;
  if (operation?.operationId !== expected.operationId) {
    throw new Error(
      `${milestone} requires ${label} operationId ${expected.operationId}.`,
    );
  }
  if (!hasBearerSecurity(specification, operation)) {
    throw new Error(`${milestone} requires bearer authentication on ${label}.`);
  }

  const requestMediaType = expected.requestMediaType ?? "application/json";
  const requestReference =
    operation.requestBody?.content?.[requestMediaType]?.schema?.$ref;
  if (expected.requestSchema) {
    if (
      operation.requestBody?.required !== true ||
      (expected.exactContract &&
        Object.keys(operation.requestBody?.content ?? {}).join(",") !==
          requestMediaType) ||
      requestReference !== `#/components/schemas/${expected.requestSchema}`
    ) {
      throw new Error(
        `${milestone} requires ${label} ${requestMediaType} request schema ${expected.requestSchema}.`,
      );
    }
  } else if (operation.requestBody) {
    throw new Error(`${milestone} forbids a request body on ${label}.`);
  }

  const successStatus = String(expected.success ?? 200);
  const successResponse = operation.responses?.[successStatus];
  const responseMediaType = expected.successMediaType ?? "application/json";
  const responseSchema =
    successResponse?.content?.[responseMediaType]?.schema ?? null;
  if (expected.exactContract) {
    const actualStatuses = Object.keys(operation.responses ?? {}).sort();
    const expectedStatuses = [
      successStatus,
      ...expected.errors.map(String),
    ].sort();
    if (
      actualStatuses.length !== expectedStatuses.length ||
      expectedStatuses.some((status, index) => actualStatuses[index] !== status)
    ) {
      throw new Error(
        `${milestone} ${label} must document exactly these responses: ${expectedStatuses.join(", ")}.`,
      );
    }
    const actualSuccessMediaTypes = Object.keys(successResponse?.content ?? {});
    const expectedSuccessMediaTypes = expected.noContent
      ? []
      : [responseMediaType];
    if (
      actualSuccessMediaTypes.length !== expectedSuccessMediaTypes.length ||
      expectedSuccessMediaTypes.some(
        (mediaType) => !actualSuccessMediaTypes.includes(mediaType),
      )
    ) {
      throw new Error(
        `${milestone} ${label} must return exactly ${expectedSuccessMediaTypes.join(", ") || "an empty body"} for ${successStatus}.`,
      );
    }
  }
  if (expected.noContent) {
    if (
      !successResponse ||
      responseSchema !== null ||
      Object.keys(successResponse.content ?? {}).length > 0
    ) {
      throw new Error(
        `${milestone} requires ${label} to return an empty ${successStatus} response.`,
      );
    }
  } else if (expected.objectResponse) {
    if (
      responseSchema?.type !== "object" ||
      responseSchema.additionalProperties !== true
    ) {
      throw new Error(
        `${milestone} requires ${label} to return an arbitrary JSON object.`,
      );
    }
  } else if (
    responseSchema?.$ref !== `#/components/schemas/${expected.responseSchema}`
  ) {
    throw new Error(
      `${milestone} requires ${label} response schema ${expected.responseSchema}.`,
    );
  }

  const pathItem = specification.paths[expected.path];
  const parameters = [
    ...(pathItem.parameters ?? []),
    ...(operation.parameters ?? []),
  ];
  validateExactOperationParameters(
    parameters,
    expected.parameters,
    label,
    milestone,
  );
  if (expected.responseHeaders) {
    validateExactResponseHeaders(
      successResponse,
      expected.responseHeaders,
      label,
      milestone,
    );
  } else if (expected.etag && !responseHasHeader(successResponse, "etag")) {
    throw new Error(
      `${milestone} requires an ETag response header on ${label}.`,
    );
  }
  for (const status of expected.errors) {
    validateProblemResponse(
      operation.responses,
      String(status),
      label,
      milestone,
    );
  }
}

function responseHasHeader(response, expectedHeader) {
  return Object.keys(response?.headers ?? {}).some(
    (name) => name.toLowerCase() === expectedHeader,
  );
}

function validateExactResponseHeaders(response, expected, label, milestone) {
  const headers = response?.headers ?? {};
  const actualNames = Object.keys(headers);
  if (
    actualNames.length !== expected.length ||
    expected.some(
      ({ name }) =>
        !actualNames.some(
          (actualName) => actualName.toLowerCase() === name.toLowerCase(),
        ),
    )
  ) {
    throw new Error(
      `${milestone} ${label} must contain exactly these success headers: ${expected
        .map(({ name }) => name)
        .join(", ")}.`,
    );
  }

  for (const expectedHeader of expected) {
    const actualName = actualNames.find(
      (name) => name.toLowerCase() === expectedHeader.name.toLowerCase(),
    );
    const schema = headers[actualName]?.schema;
    if (
      schema?.type !== expectedHeader.type ||
      (expectedHeader.format && schema.format !== expectedHeader.format)
    ) {
      throw new Error(
        `${milestone} ${label} response header ${expectedHeader.name} has the wrong schema.`,
      );
    }
    for (const constraint of ["minimum", "maximum", "minLength", "maxLength"]) {
      if (
        expectedHeader[constraint] !== undefined &&
        Number(schema?.[constraint]) !== Number(expectedHeader[constraint])
      ) {
        throw new Error(
          `${milestone} ${label} response header ${expectedHeader.name} has the wrong ${constraint}.`,
        );
      }
    }
    if (expectedHeader.etag) {
      validateIfMatchHeader(schema, `${label} response ETag`, milestone);
    }
    if (
      expectedHeader.accepted &&
      !patternAcceptsExactly(
        schema?.pattern,
        expectedHeader.accepted,
        expectedHeader.rejected ?? [],
      )
    ) {
      throw new Error(
        `${milestone} ${label} response header ${expectedHeader.name} has the wrong pattern.`,
      );
    }
  }
}

function validateExactOperationParameters(
  parameters,
  expected,
  label,
  milestone = "Milestone 4",
) {
  if (parameters.length !== expected.length) {
    throw new Error(
      `${milestone} ${label} must contain exactly these parameters: ${expected
        .map(({ location, name }) => `${location}:${name}`)
        .join(", ")}.`,
    );
  }
  for (const expectedParameter of expected) {
    const parameter = parameters.find(
      (candidate) =>
        candidate.in === expectedParameter.location &&
        (candidate.in === "header"
          ? candidate.name.toLowerCase() ===
            expectedParameter.name.toLowerCase()
          : candidate.name === expectedParameter.name),
    );
    if (!parameter || parameter.required !== expectedParameter.required) {
      throw new Error(
        `${milestone} ${label} requires ${expectedParameter.required ? "mandatory" : "optional"} ${expectedParameter.location} parameter ${expectedParameter.name}.`,
      );
    }
    if (
      parameter.schema?.type !== expectedParameter.type ||
      (expectedParameter.format &&
        parameter.schema?.format !== expectedParameter.format)
    ) {
      throw new Error(
        `${milestone} ${label} parameter ${expectedParameter.name} has the wrong schema.`,
      );
    }
    for (const constraint of ["minimum", "maximum", "minLength", "maxLength"]) {
      if (
        expectedParameter[constraint] !== undefined &&
        Number(parameter.schema?.[constraint]) !==
          Number(expectedParameter[constraint])
      ) {
        throw new Error(
          `${milestone} ${label} parameter ${expectedParameter.name} has the wrong ${constraint}.`,
        );
      }
    }
    if (expectedParameter.name.toLowerCase() === "idempotency-key") {
      validateIdempotencyHeader(parameter.schema, label, milestone);
    }
    if (expectedParameter.name.toLowerCase() === "if-match") {
      validateIfMatchHeader(parameter.schema, label, milestone);
    }
  }
}

function validateIdempotencyHeader(schema, label, milestone = "Milestone 4") {
  if (
    schema.minLength !== 16 ||
    schema.maxLength !== 100 ||
    !patternAcceptsExactly(
      schema.pattern,
      ["0123456789abcdef", "A".repeat(100)],
      [
        "A".repeat(15),
        "A".repeat(101),
        "A".repeat(15) + "é",
        "with space key!!",
      ],
    )
  ) {
    throw new Error(
      `${milestone} ${label} Idempotency-Key must allow exactly 16 through 100 visible ASCII characters.`,
    );
  }
}

function validateIfMatchHeader(schema, label, milestone = "Milestone 4") {
  if (
    !patternAcceptsExactly(
      schema.pattern,
      ['"0"', '"123456"'],
      ["0", 'W/"1"', '"-1"', '"abc"', '"01"'],
    )
  ) {
    throw new Error(
      `${milestone} ${label} If-Match must be one quoted non-negative numeric version.`,
    );
  }
}

function patternAcceptsExactly(pattern, accepted, rejected) {
  if (typeof pattern !== "string") {
    return false;
  }
  let expression;
  try {
    expression = new RegExp(pattern);
  } catch {
    return false;
  }
  return (
    accepted.every((value) => expression.test(value)) &&
    rejected.every((value) => !expression.test(value))
  );
}

function validateProblemResponse(
  responses,
  status,
  label,
  milestone = "Milestone 4",
) {
  const response = responses?.[status];
  const schemas = Object.values(response?.content ?? {}).map(
    (mediaType) => mediaType.schema,
  );
  if (
    !response ||
    !schemas.some(
      (schema) => schema?.$ref === "#/components/schemas/ApiProblem",
    )
  ) {
    throw new Error(
      `${milestone} ${label} must document ${status} with ApiProblem.`,
    );
  }
}

function validateExactObjectSchema(
  schemas,
  name,
  expectedProperties,
  description,
  closed,
) {
  validateCompleteObjectSchema(schemas, name, description);
  const schema = schemas[name];
  const actualProperties = Object.keys(schema.properties);
  if (
    actualProperties.length !== expectedProperties.length ||
    expectedProperties.some((property) => !actualProperties.includes(property))
  ) {
    throw new Error(
      `${description} schema ${name} must contain exactly: ${expectedProperties.join(", ")}.`,
    );
  }
  if (closed && schema.additionalProperties !== false) {
    throw new Error(
      `${description} schema ${name} must set additionalProperties to false.`,
    );
  }
}

function validateResponseReference(
  schemas,
  schemaName,
  property,
  reference,
  array,
  milestone = "Milestone 4",
) {
  const propertySchema = schemas[schemaName].properties[property];
  const actualReference = schemaReference(
    array ? propertySchema?.items : propertySchema,
  );
  if (
    (array && propertySchema?.type !== "array") ||
    actualReference !== `#/components/schemas/${reference}`
  ) {
    throw new Error(
      `${milestone} response ${schemaName}.${property} must ${array ? "contain" : "reference"} ${reference}.`,
    );
  }
}

function validateExactEnum(
  schema,
  expectedValues,
  description,
  schemas,
  milestone = "Milestone 4",
) {
  const reference = schemaReference(schema);
  const resolvedSchema =
    Array.isArray(schema?.enum) || !reference || !schemas
      ? schema
      : schemas[reference.split("/").at(-1)];
  const actualValues = resolvedSchema?.enum ?? [];
  if (
    actualValues.length !== expectedValues.length ||
    expectedValues.some((value) => !actualValues.includes(value))
  ) {
    throw new Error(
      `${milestone} ${description} must be exactly: ${expectedValues.join(", ")}.`,
    );
  }
}

function schemaReference(schema) {
  if (schema?.$ref) {
    return schema.$ref;
  }
  if (
    Array.isArray(schema?.allOf) &&
    schema.allOf.length === 1 &&
    schema.allOf[0]?.$ref
  ) {
    return schema.allOf[0].$ref;
  }
  return null;
}

function hasBearerSecurity(specification, operation) {
  const security = operation?.security ?? specification.security ?? [];
  return security.some((requirement) =>
    Object.prototype.hasOwnProperty.call(requirement, "bearerAuth"),
  );
}

function findOperationParameter(operation, location, name) {
  return (operation.parameters ?? []).find(
    (parameter) => parameter.in === location && parameter.name === name,
  );
}

function requiredUuidPath(name) {
  return {
    location: "path",
    name,
    required: true,
    type: "string",
    format: "uuid",
  };
}

function requiredUuidQuery(name) {
  return {
    location: "query",
    name,
    required: true,
    type: "string",
    format: "uuid",
  };
}

function optionalDateQuery(name) {
  return {
    location: "query",
    name,
    required: false,
    type: "string",
    format: "date",
  };
}

function optionalStringQuery(name) {
  return { location: "query", name, required: false, type: "string" };
}

function optionalUuidQuery(name) {
  return {
    location: "query",
    name,
    required: false,
    type: "string",
    format: "uuid",
  };
}

function optionalIntegerQuery(name) {
  return { location: "query", name, required: false, type: "integer" };
}

function optionalBoundedIntegerQuery(name, minimum, maximum) {
  return {
    location: "query",
    name,
    required: false,
    type: "integer",
    minimum,
    maximum,
  };
}

function requiredIdempotencyHeader() {
  return {
    location: "header",
    name: "Idempotency-Key",
    required: true,
    type: "string",
  };
}

function requiredIfMatchHeader() {
  return {
    location: "header",
    name: "If-Match",
    required: true,
    type: "string",
  };
}

function successfulResponseHasHeader(responses, expectedHeader) {
  for (const [status, response] of Object.entries(responses ?? {})) {
    if (
      /^2\d\d$/.test(status) &&
      Object.keys(response.headers ?? {}).some(
        (name) => name.toLowerCase() === expectedHeader,
      )
    ) {
      return true;
    }
  }
  return false;
}

function validateCompleteObjectSchema(schemas, name, description) {
  const schema = schemas[name];
  if (!schema?.properties) {
    throw new Error(`${description} schema ${name} is required.`);
  }
  const required = new Set(schema.required ?? []);
  const missing = Object.keys(schema.properties).filter(
    (property) => !required.has(property),
  );
  if (missing.length > 0) {
    throw new Error(
      `${description} schema ${name} has optional fields: ${missing.join(", ")}.`,
    );
  }
}

export function renderClient(specification) {
  const schemas = Object.entries(specification.components.schemas)
    .map(([name, schema]) => renderSchema(name, schema))
    .join("\n\n");
  const operations = renderOperations(specification.paths);

  return `/* eslint-disable */
/**
 * Generated from services/api/openapi/openapi.json.
 * Do not edit this file directly; run the contracts generate script.
 */

${schemas}

${operations.parameterInterfaces}

export interface ApiClientConfiguration {
  baseUrl: string;
  fetchApi?: typeof globalThis.fetch;
  defaultHeaders?: HeadersInit;
}

export interface RequestContext {
  signal?: AbortSignal;
  headers?: HeadersInit;
}

export class ApiClientError extends Error {
  readonly status: number;
  readonly problem: ApiProblem | null;
  readonly correlationId: string | null;

  constructor(
    message: string,
    status: number,
    problem: ApiProblem | null,
    correlationId: string | null,
  ) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.problem = problem;
    this.correlationId = correlationId;
  }
}

export class FoundationApi {
  private readonly baseUrl: string;
  private readonly fetchApi: typeof globalThis.fetch;
  private readonly defaultHeaders: HeadersInit;

  constructor(configuration: ApiClientConfiguration) {
    this.baseUrl = configuration.baseUrl.replace(/\\/$/, "");
    this.fetchApi = configuration.fetchApi ?? globalThis.fetch.bind(globalThis);
    this.defaultHeaders = configuration.defaultHeaders ?? {};
  }

${indent(operations.methods, 2)}

  private async request<T>(
    path: string,
    method: string,
    context: RequestContext,
    requestBody?: unknown,
  ): Promise<T> {
    const headers = new Headers(this.defaultHeaders);
    headers.set("accept", "application/json, application/problem+json");
    new Headers(context.headers).forEach((value, name) => headers.set(name, value));

    const init: RequestInit = {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers,
    };
    if (context.signal) {
      init.signal = context.signal;
    }
    if (requestBody !== undefined) {
      headers.set("content-type", "application/json");
      init.body = JSON.stringify(requestBody);
    }

    const response = await this.fetchApi(\`\${this.baseUrl}\${path}\`, init);
    if (response.ok) {
      if (response.status === 204) {
        return undefined as T;
      }
      return (await response.json()) as T;
    }

    const problem = await readProblem(response);
    const correlationId =
      response.headers.get("x-correlation-id") ?? problem?.correlationId ?? null;
    throw new ApiClientError(
      problem?.detail ??
        problem?.title ??
        \`Request failed with status \${response.status}.\`,
      response.status,
      problem,
      correlationId,
    );
  }
}

async function readProblem(response: Response): Promise<ApiProblem | null> {
  if (!(response.headers.get("content-type") ?? "").includes("json")) {
    return null;
  }
  try {
    return (await response.json()) as ApiProblem;
  } catch {
    return null;
  }
}
`;
}

function renderSchema(name, schema) {
  if (schema.type !== "object" || Array.isArray(schema.oneOf)) {
    return `export type ${name} = ${renderType(schema)};`;
  }

  const required = new Set(schema.required ?? []);
  const properties = Object.entries(schema.properties ?? {}).map(
    ([propertyName, property]) => {
      const optional = required.has(propertyName) ? "" : "?";
      return `  ${safePropertyName(propertyName)}${optional}: ${renderType(property)};`;
    },
  );

  return `export interface ${name} {\n${properties.join("\n")}\n}`;
}

function renderType(schema) {
  let type;
  if (schema.$ref) {
    type = schema.$ref.split("/").at(-1);
  } else if (Array.isArray(schema.oneOf)) {
    type = schema.oneOf.map((candidate) => renderType(candidate)).join(" | ");
  } else if (Array.isArray(schema.enum)) {
    type = schema.enum.map((value) => JSON.stringify(value)).join(" | ");
  } else if (Array.isArray(schema.allOf)) {
    if (schema.allOf.length !== 1) {
      throw new Error("Only a single-schema allOf is supported.");
    }
    type = renderType(schema.allOf[0]);
  } else if (schema.type === "array") {
    type = `Array<${renderType(schema.items)}>`;
  } else if (schema.type === "object" && schema.additionalProperties) {
    type = `Record<string, ${renderType(schema.additionalProperties)}>`;
  } else {
    type =
      {
        boolean: "boolean",
        integer: "number",
        number: "number",
        string: "string",
      }[schema.type] ?? "unknown";
  }

  return schema.nullable ? `${type} | null` : type;
}

function renderOperations(paths) {
  const supportedMethods = ["get", "post", "put", "patch", "delete"];
  const parameterInterfaces = [];
  const methods = [];

  for (const [path, pathItem] of Object.entries(paths)) {
    for (const method of supportedMethods) {
      const operation = pathItem[method];
      if (!operation) {
        continue;
      }

      const operationId = operation.operationId;
      if (!operationId) {
        throw new Error(
          `${method.toUpperCase()} ${path} needs an operationId.`,
        );
      }

      const requestMediaTypes = Object.keys(
        operation.requestBody?.content ?? {},
      );
      if (
        requestMediaTypes.length === 1 &&
        requestMediaTypes[0] === "multipart/form-data"
      ) {
        // File uploads are intentionally kept out of this JSON-only client.
        // Callers must construct a bounded FormData request in their transport
        // boundary instead of receiving a misleading bodyless generated method.
        continue;
      }
      if (
        requestMediaTypes.length > 0 &&
        (requestMediaTypes.length !== 1 ||
          requestMediaTypes[0] !== "application/json")
      ) {
        throw new Error(
          `${method.toUpperCase()} ${path} uses unsupported request media types: ${requestMediaTypes.join(", ")}.`,
        );
      }

      const operationParameters = [
        ...(pathItem.parameters ?? []),
        ...(operation.parameters ?? []),
      ];
      const parameterTypeName =
        operationParameters.length > 0
          ? `${upperFirst(operationId)}Parameters`
          : null;
      if (parameterTypeName) {
        parameterInterfaces.push(
          renderParameterInterface(parameterTypeName, operationParameters),
        );
      }

      const requestSchema =
        operation.requestBody?.content?.["application/json"]?.schema;
      const responseSchema = successfulResponseSchema(operation.responses);
      const requestType = requestSchema ? renderType(requestSchema) : null;
      const responseType = responseSchema ? renderType(responseSchema) : "void";
      const signature = [
        parameterTypeName ? `parameters: ${parameterTypeName}` : null,
        requestType ? `body: ${requestType}` : null,
        "context: RequestContext = {}",
      ]
        .filter(Boolean)
        .join(", ");
      const preparation = renderParameterPreparation(path, operationParameters);

      methods.push(`async ${operationId}(
  ${signature},
): Promise<${responseType}> {
${indent(preparation, 2)}
  return this.request<${responseType}>(
    requestPath,
    ${JSON.stringify(method.toUpperCase())},
    context${requestType ? ", body" : ""},
  );
}`);
    }
  }

  return {
    parameterInterfaces: parameterInterfaces.join("\n\n"),
    methods: methods.join("\n\n"),
  };
}

function renderParameterInterface(name, parameters) {
  const properties = parameters.map((parameter) => {
    if (parameter.$ref) {
      throw new Error(
        `Parameter references are not supported: ${parameter.$ref}`,
      );
    }
    const propertyName = parameterPropertyName(parameter.name);
    return `  ${propertyName}${parameter.required ? "" : "?"}: ${renderType(
      parameter.schema ?? {},
    )};`;
  });
  return `export interface ${name} {\n${properties.join("\n")}\n}`;
}

function renderParameterPreparation(path, parameters) {
  const lines = [`let requestPath = ${JSON.stringify(path)};`];
  const queryParameters = [];
  const headerParameters = [];

  for (const parameter of parameters) {
    const propertyName = parameterPropertyName(parameter.name);
    if (parameter.in === "path") {
      const marker = `{${parameter.name}}`;
      if (!path.includes(marker) || !parameter.required) {
        throw new Error(`Path parameter ${parameter.name} must be required.`);
      }
      lines.push(
        `requestPath = requestPath.replace(${JSON.stringify(marker)}, encodeURIComponent(String(parameters.${propertyName})));`,
      );
    } else if (parameter.in === "query") {
      queryParameters.push({ ...parameter, propertyName });
    } else if (parameter.in === "header") {
      headerParameters.push({ ...parameter, propertyName });
    } else {
      throw new Error(
        `Unsupported parameter location ${parameter.in} for ${parameter.name}.`,
      );
    }
  }

  if (queryParameters.length > 0) {
    lines.push("const query = new URLSearchParams();");
    for (const parameter of queryParameters) {
      lines.push(
        ...renderConditionalParameter(
          parameter,
          `query.set(${JSON.stringify(parameter.name)}, String(parameters.${parameter.propertyName}));`,
        ),
      );
    }
    lines.push(
      "if (query.size > 0) requestPath = `${requestPath}?${query.toString()}`;",
    );
  }

  if (headerParameters.length > 0) {
    lines.push("const requestHeaders = new Headers(context.headers);");
    for (const parameter of headerParameters) {
      lines.push(
        ...renderConditionalParameter(
          parameter,
          `requestHeaders.set(${JSON.stringify(parameter.name)}, String(parameters.${parameter.propertyName}));`,
        ),
      );
    }
    lines.push("context = { ...context, headers: requestHeaders };");
  }

  return lines.join("\n");
}

function renderConditionalParameter(parameter, statement) {
  if (parameter.required) {
    return [statement];
  }
  return [
    `if (parameters.${parameter.propertyName} !== undefined) {`,
    `  ${statement}`,
    "}",
  ];
}

function parameterPropertyName(name) {
  const words = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const [first = "parameter", ...rest] = words;
  return (
    first.charAt(0).toLowerCase() +
    first.slice(1) +
    rest.map((word) => upperFirst(word.toLowerCase())).join("")
  );
}

function upperFirst(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function successfulResponseSchema(responses) {
  for (const [status, response] of Object.entries(responses ?? {})) {
    if (/^2\d\d$/.test(status)) {
      return response.content?.["application/json"]?.schema ?? null;
    }
  }
  return null;
}

function safePropertyName(name) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
}

function indent(value, spaces) {
  const prefix = " ".repeat(spaces);
  return value
    .split("\n")
    .map((line) => (line ? `${prefix}${line}` : line))
    .join("\n");
}
