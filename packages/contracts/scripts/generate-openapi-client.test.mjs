import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { renderClient, validateDocument } from "./generate-openapi-client.mjs";

const fixture = {
  openapi: "3.0.3",
  paths: {
    "/v1/things/{id}": {
      get: {
        operationId: "getThing",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
          {
            name: "from",
            in: "query",
            required: false,
            schema: { type: "string", format: "date" },
          },
          {
            name: "If-Match",
            in: "header",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          200: {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Thing" },
              },
            },
          },
        },
      },
      put: {
        operationId: "updateThing",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
          {
            name: "If-Match",
            in: "header",
            required: true,
            schema: { type: "string" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/UpdateThingRequest" },
            },
          },
        },
        responses: {
          200: {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Thing" },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Thing: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string" } },
      },
      UpdateThingRequest: {
        type: "object",
        required: ["name"],
        properties: { name: { type: "string" } },
      },
      ChoiceRequest: {
        oneOf: [
          { $ref: "#/components/schemas/FirstChoiceRequest" },
          { $ref: "#/components/schemas/SecondChoiceRequest" },
        ],
        discriminator: {
          propertyName: "kind",
          mapping: {
            FIRST: "#/components/schemas/FirstChoiceRequest",
            SECOND: "#/components/schemas/SecondChoiceRequest",
          },
        },
      },
      FirstChoiceRequest: {
        type: "object",
        additionalProperties: false,
        required: ["kind"],
        properties: { kind: { type: "string", enum: ["FIRST"] } },
      },
      SecondChoiceRequest: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "value"],
        properties: {
          kind: { type: "string", enum: ["SECOND"] },
          value: { type: "string" },
        },
      },
      ApiProblem: {
        type: "object",
        properties: {
          title: { type: "string" },
          status: { type: "integer" },
        },
      },
    },
  },
};

const generated = renderClient(fixture);
assert.match(generated, /encodeURIComponent\(String\(parameters\.id\)\)/);
assert.match(generated, /query\.set\("from"/);
assert.match(generated, /requestHeaders\.set\("If-Match"/);
assert.match(generated, /export interface GetThingParameters/);
assert.match(generated, /async updateThing/);
assert.match(generated, /"PUT"/);
assert.match(generated, /body: UpdateThingRequest/);
assert.match(
  generated,
  /export type ChoiceRequest = FirstChoiceRequest \| SecondChoiceRequest;/,
);

const objectSchema = (propertyNames, properties = {}) => ({
  type: "object",
  additionalProperties: false,
  required: propertyNames,
  properties: Object.fromEntries(
    propertyNames.map((name) => [name, properties[name] ?? { type: "string" }]),
  ),
});
const operation = (
  operationId,
  { ifMatch = false, requestSchema, responseSchema, etag = false } = {},
) => ({
  operationId,
  ...(ifMatch
    ? {
        parameters: [
          {
            name: "If-Match",
            in: "header",
            required: true,
            schema: { type: "string" },
          },
        ],
      }
    : {}),
  ...(requestSchema
    ? {
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: `#/components/schemas/${requestSchema}`,
              },
            },
          },
        },
      }
    : {}),
  responses: {
    200: {
      description: "ok",
      ...(etag ? { headers: { ETag: { schema: { type: "string" } } } } : {}),
      content: {
        "application/json": {
          schema: {
            $ref: `#/components/schemas/${responseSchema}`,
          },
        },
      },
    },
  },
});
const milestone3Fixture = {
  openapi: "3.0.3",
  paths: {
    "/v1/notification-preferences": {
      get: operation("getNotificationPreferences", {
        responseSchema: "NotificationPreferences",
        etag: true,
      }),
      put: operation("updateNotificationPreferences", {
        ifMatch: true,
        requestSchema: "UpdateNotificationPreferencesRequest",
        responseSchema: "NotificationPreferences",
        etag: true,
      }),
    },
    "/v1/households/{householdId}/reminder-rules": {
      get: operation("getHouseholdReminderRules", {
        responseSchema: "ReminderRuleSet",
        etag: true,
      }),
      put: operation("updateHouseholdReminderRules", {
        ifMatch: true,
        requestSchema: "UpdateReminderRuleSetRequest",
        responseSchema: "ReminderRuleSet",
        etag: true,
      }),
    },
    "/v1/commitments/{commitmentId}/reminder-rules": {
      get: operation("getCommitmentReminderRules", {
        responseSchema: "ReminderRuleSet",
        etag: true,
      }),
      put: operation("updateCommitmentReminderRules", {
        ifMatch: true,
        requestSchema: "UpdateReminderRuleSetRequest",
        responseSchema: "ReminderRuleSet",
        etag: true,
      }),
    },
    "/v1/notifications": {
      get: operation("listNotifications", {
        responseSchema: "NotificationPage",
      }),
    },
    "/v1/notifications/{notificationId}": {
      get: operation("getNotification", {
        responseSchema: "Notification",
        etag: true,
      }),
      patch: operation("updateNotificationReadState", {
        ifMatch: true,
        requestSchema: "UpdateNotificationReadRequest",
        responseSchema: "Notification",
        etag: true,
      }),
    },
    "/v1/notification-diagnostics": {
      get: operation("getNotificationDiagnostics", {
        responseSchema: "NotificationDiagnostics",
      }),
    },
  },
  components: {
    schemas: {
      NotificationPreferences: objectSchema([
        "id",
        "enabled",
        "inAppEnabled",
        "emailEnabled",
        "timezone",
        "quietHoursEnabled",
        "quietStart",
        "quietEnd",
        "version",
        "updatedAt",
      ]),
      UpdateNotificationPreferencesRequest: objectSchema(
        [
          "enabled",
          "inAppEnabled",
          "emailEnabled",
          "timezone",
          "quietHoursEnabled",
          "quietStart",
          "quietEnd",
        ],
        { timezone: { type: "string", minLength: 1 } },
      ),
      ReminderRuleInput: objectSchema([
        "channel",
        "offsetDays",
        "localSendTime",
        "enabled",
      ]),
      ReminderRule: objectSchema([
        "channel",
        "offsetDays",
        "localSendTime",
        "enabled",
      ]),
      UpdateReminderRuleSetRequest: objectSchema(["mode", "rules"]),
      ReminderRuleSet: objectSchema([
        "id",
        "householdId",
        "commitmentId",
        "mode",
        "rules",
        "suggestedRules",
        "version",
        "updatedAt",
      ]),
      UpdateNotificationReadRequest: objectSchema(["read"]),
      Notification: objectSchema([
        "id",
        "householdId",
        "commitmentId",
        "scheduledDate",
        "channel",
        "offsetDays",
        "plannedFor",
        "status",
        "read",
        "version",
        "failureCategory",
        "nextAttemptAt",
        "deliveredAt",
        "createdAt",
      ]),
      NotificationPage: objectSchema([
        "householdId",
        "filter",
        "items",
        "nextCursor",
      ]),
      NotificationFailureCount: objectSchema(["category", "count"]),
      NotificationDiagnostics: objectSchema([
        "householdId",
        "pendingCount",
        "processingCount",
        "retryScheduledCount",
        "deliveredCount",
        "deadCount",
        "suppressedCount",
        "oldestPendingAgeSeconds",
        "nextRetryAt",
        "failures",
      ]),
    },
  },
};
assert.doesNotThrow(() => validateDocument(milestone3Fixture));

const optionalCursorFixture = structuredClone(milestone3Fixture);
optionalCursorFixture.components.schemas.NotificationPage.required =
  optionalCursorFixture.components.schemas.NotificationPage.required.filter(
    (name) => name !== "nextCursor",
  );
assert.throws(
  () => validateDocument(optionalCursorFixture),
  /NotificationPage has optional fields: nextCursor/,
);

const optionalIfMatchFixture = structuredClone(milestone3Fixture);
optionalIfMatchFixture.paths[
  "/v1/notification-preferences"
].put.parameters[0].required = false;
assert.throws(
  () => validateDocument(optionalIfMatchFixture),
  /mandatory If-Match header/,
);

const openRequestFixture = structuredClone(milestone3Fixture);
delete openRequestFixture.components.schemas.ReminderRuleInput
  .additionalProperties;
assert.throws(
  () => validateDocument(openRequestFixture),
  /ReminderRuleInput must set additionalProperties to false/,
);

const missingTimezoneMinimumFixture = structuredClone(milestone3Fixture);
delete missingTimezoneMinimumFixture.components.schemas
  .UpdateNotificationPreferencesRequest.properties.timezone.minLength;
assert.throws(
  () => validateDocument(missingTimezoneMinimumFixture),
  /UpdateNotificationPreferencesRequest\.timezone must set minLength to 1/,
);

const problemResponse = (description = "problem") => ({
  description,
  content: {
    "application/problem+json": {
      schema: { $ref: "#/components/schemas/ApiProblem" },
    },
  },
});
const uuidParameter = (name, location, required = true) => ({
  name,
  in: location,
  required,
  schema: { type: "string", format: "uuid" },
});
const optionalParameter = (name, type, format) => ({
  name,
  in: "query",
  required: false,
  schema: { type, ...(format ? { format } : {}) },
});
const idempotencyParameter = () => ({
  name: "Idempotency-Key",
  in: "header",
  required: true,
  schema: {
    type: "string",
    minLength: 16,
    maxLength: 100,
    pattern: "^[\\x21-\\x7E]{16,100}$",
  },
});
const ifMatchParameter = () => ({
  name: "If-Match",
  in: "header",
  required: true,
  schema: {
    type: "string",
    pattern: '^"(0|[1-9][0-9]*)"$',
  },
});
const milestone4Operation = ({
  operationId,
  parameters = [],
  requestSchema,
  responseSchema,
  success = 200,
  etag = false,
  errors = [],
}) => ({
  operationId,
  parameters,
  ...(requestSchema
    ? {
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: `#/components/schemas/${requestSchema}` },
            },
          },
        },
      }
    : {}),
  responses: {
    [success]: {
      description: "ok",
      ...(etag ? { headers: { ETag: { schema: { type: "string" } } } } : {}),
      ...(responseSchema
        ? {
            content: {
              "application/json": {
                schema: { $ref: `#/components/schemas/${responseSchema}` },
              },
            },
          }
        : {}),
    },
    ...Object.fromEntries(errors.map((status) => [status, problemResponse()])),
  },
});
const responseSchemaProperties = {
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
const uuidProperty = { type: "string", format: "uuid" };
const boundedNoteProperty = {
  type: "string",
  nullable: true,
  minLength: 1,
  maxLength: 500,
};
const milestone4Fixture = {
  openapi: "3.0.3",
  security: [{ bearerAuth: [] }],
  paths: {
    "/v1/decisions/inbox": {
      get: milestone4Operation({
        operationId: "listDecisionInbox",
        parameters: [
          uuidParameter("householdId", "query"),
          optionalParameter("from", "string", "date"),
          optionalParameter("to", "string", "date"),
          optionalParameter("cursor", "string"),
          optionalParameter("limit", "integer"),
        ],
        responseSchema: "DecisionInboxPage",
        errors: [400, 404],
      }),
    },
    "/v1/occurrences/{occurrenceId}/decisions": {
      post: milestone4Operation({
        operationId: "createOccurrenceDecision",
        parameters: [
          uuidParameter("occurrenceId", "path"),
          idempotencyParameter(),
        ],
        requestSchema: "CreateOccurrenceDecisionRequest",
        responseSchema: "OccurrenceDecision",
        success: 201,
        errors: [400, 404, 409],
      }),
    },
    "/v1/commitments/{commitmentId}/cancellation-guide": {
      get: milestone4Operation({
        operationId: "getCancellationGuide",
        parameters: [uuidParameter("commitmentId", "path")],
        responseSchema: "CancellationGuide",
        errors: [404],
      }),
    },
    "/v1/commitments/{commitmentId}/cancellation-attempts": {
      post: milestone4Operation({
        operationId: "createCancellationAttempt",
        parameters: [
          uuidParameter("commitmentId", "path"),
          idempotencyParameter(),
        ],
        requestSchema: "CreateCancellationAttemptRequest",
        responseSchema: "CancellationAttempt",
        success: 201,
        etag: true,
        errors: [400, 404, 409],
      }),
      get: milestone4Operation({
        operationId: "listCancellationAttempts",
        parameters: [
          uuidParameter("commitmentId", "path"),
          uuidParameter("householdId", "query"),
          optionalParameter("cursor", "string"),
          optionalParameter("limit", "integer"),
        ],
        responseSchema: "CancellationAttemptPage",
        errors: [400, 404],
      }),
    },
    "/v1/cancellation-attempts/{attemptId}": {
      get: milestone4Operation({
        operationId: "getCancellationAttempt",
        parameters: [uuidParameter("attemptId", "path")],
        responseSchema: "CancellationAttempt",
        etag: true,
        errors: [404],
      }),
      patch: milestone4Operation({
        operationId: "updateCancellationAttempt",
        parameters: [uuidParameter("attemptId", "path"), ifMatchParameter()],
        requestSchema: "UpdateCancellationAttemptRequest",
        responseSchema: "CancellationAttempt",
        etag: true,
        errors: [400, 404, 409, 412, 428],
      }),
    },
    "/v1/cancellation-attempts/{attemptId}/verify": {
      post: milestone4Operation({
        operationId: "verifyCancellationAttempt",
        parameters: [
          uuidParameter("attemptId", "path"),
          ifMatchParameter(),
          idempotencyParameter(),
        ],
        requestSchema: "VerifyCancellationAttemptRequest",
        responseSchema: "CancellationAttempt",
        etag: true,
        errors: [400, 404, 409, 412, 428],
      }),
    },
    "/v1/cancellation-guides/{guideId}/feedback": {
      post: milestone4Operation({
        operationId: "createCancellationGuideFeedback",
        parameters: [uuidParameter("guideId", "path"), idempotencyParameter()],
        requestSchema: "CreateCancellationGuideFeedbackRequest",
        success: 204,
        errors: [400, 404, 409],
      }),
    },
    "/v1/savings": {
      get: milestone4Operation({
        operationId: "getSavings",
        parameters: [
          uuidParameter("householdId", "query"),
          {
            ...optionalParameter("state", "string"),
            schema: {
              type: "string",
              enum: ["POTENTIAL", "SELF_REPORTED", "VERIFIED", "REVERSED"],
            },
          },
          optionalParameter("cursor", "string"),
          optionalParameter("limit", "integer"),
        ],
        responseSchema: "SavingsPage",
        errors: [400, 404, 409],
      }),
    },
  },
  components: {
    schemas: {
      ...Object.fromEntries(
        Object.entries(responseSchemaProperties).map(([name, properties]) => [
          name,
          objectSchema(properties),
        ]),
      ),
      CreateOccurrenceDecisionRequest: objectSchema(["decision"], {
        decision: {
          type: "string",
          enum: [
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
          ],
        },
      }),
      CreateCancellationAttemptRequest: objectSchema(
        ["occurrenceId", "decisionId", "guideId", "guideVersion", "note"],
        {
          occurrenceId: uuidProperty,
          decisionId: uuidProperty,
          guideId: uuidProperty,
          guideVersion: { type: "integer", minimum: 1 },
          note: boundedNoteProperty,
        },
      ),
      UpdateCancellationAttemptRequest: objectSchema(
        ["serviceStatus", "paymentMandateStatus", "abandoned"],
        {
          serviceStatus: {
            type: "string",
            enum: [
              "NOT_REQUIRED",
              "NOT_STARTED",
              "REQUESTED",
              "CONFIRMED",
              "FAILED",
            ],
          },
          paymentMandateStatus: {
            type: "string",
            enum: [
              "NOT_REQUIRED",
              "NOT_STARTED",
              "REQUESTED",
              "CONFIRMED",
              "FAILED",
            ],
          },
          abandoned: { type: "boolean" },
        },
      ),
      VerifyCancellationAttemptRequest: objectSchema(["status"], {
        status: {
          type: "string",
          enum: ["SELF_REPORTED", "VERIFIED", "DISPUTED"],
        },
      }),
      CreateCancellationGuideFeedbackRequest: objectSchema(
        ["commitmentId", "guideVersion", "outcome", "note"],
        {
          commitmentId: uuidProperty,
          guideVersion: { type: "integer", minimum: 1 },
          outcome: {
            type: "string",
            enum: [
              "WORKED",
              "OUTDATED",
              "MERCHANT_CHANGED_FLOW",
              "UNSAFE_LINK",
            ],
          },
          note: boundedNoteProperty,
        },
      ),
      ApiProblem: objectSchema(["title", "status"]),
    },
  },
};
const milestone4Schemas = milestone4Fixture.components.schemas;
Object.assign(milestone4Schemas.SavingsStateTotal.properties, {
  exactAmountMinor: {
    type: "integer",
    format: "int64",
    minimum: 0,
    maximum: 9_007_199_254_740_991,
  },
  estimatedAmountMinor: {
    type: "integer",
    format: "int64",
    minimum: 0,
    maximum: 9_007_199_254_740_991,
  },
  exactAttemptCount: {
    type: "integer",
    format: "int32",
    minimum: 0,
    maximum: 2_147_483_647,
  },
  estimatedAttemptCount: {
    type: "integer",
    format: "int32",
    minimum: 0,
    maximum: 2_147_483_647,
  },
});
for (const [schemaName, propertyName] of [
  ["CancellationAttempt", "projectedSavingsMinor"],
  ["SavingsItem", "amountMinor"],
]) {
  milestone4Schemas[schemaName].properties[propertyName] = {
    type: "integer",
    format: "int64",
    nullable: true,
    minimum: 1,
    maximum: 9_007_199_254_740_991,
  };
}
milestone4Schemas.CancellationAttempt.properties.verificationDueReached = {
  type: "boolean",
};
for (const [schemaName, propertyNames] of Object.entries({
  DecisionInboxItem: ["expectedAmountMinor", "currentDecision"],
  DecisionInboxPage: ["nextCursor"],
  GuideStep: ["target"],
  CancellationAttempt: ["projectedSavingsMinor", "completedAt"],
  CancellationAttemptPage: ["nextCursor"],
  SavingsItem: ["amountMinor", "reversalReason"],
  SavingsPage: ["nextCursor"],
})) {
  for (const propertyName of propertyNames) {
    milestone4Schemas[schemaName].properties[propertyName].nullable = true;
  }
}
const referenceProperty = (name, nullable = false) => ({
  ...(nullable
    ? {
        nullable: true,
        allOf: [{ $ref: `#/components/schemas/${name}` }],
      }
    : { $ref: `#/components/schemas/${name}` }),
});
const referenceArrayProperty = (name) => ({
  type: "array",
  items: referenceProperty(name),
});
milestone4Schemas.DecisionInboxItem.properties.currentDecision =
  referenceProperty("OccurrenceDecision", true);
milestone4Schemas.DecisionInboxPage.properties.items =
  referenceArrayProperty("DecisionInboxItem");
milestone4Schemas.GuideStep.properties.target = referenceProperty(
  "GuideTarget",
  true,
);
milestone4Schemas.GuideTrack.properties.steps =
  referenceArrayProperty("GuideStep");
milestone4Schemas.CancellationGuide.properties.tracks =
  referenceArrayProperty("GuideTrack");
milestone4Schemas.CancellationAttempt.properties.guide =
  referenceProperty("CancellationGuide");
milestone4Schemas.CancellationAttemptPage.properties.items =
  referenceArrayProperty("CancellationAttempt");
milestone4Schemas.SavingsCurrencySummary.properties.totals =
  referenceArrayProperty("SavingsStateTotal");
milestone4Schemas.SavingsPage.properties.currencies = referenceArrayProperty(
  "SavingsCurrencySummary",
);
milestone4Schemas.SavingsPage.properties.items =
  referenceArrayProperty("SavingsItem");
const enumProperty = (values, nullable = false) => ({
  type: "string",
  enum: values,
  ...(nullable ? { nullable: true } : {}),
});
const fixtureDecisionActions =
  milestone4Schemas.CreateOccurrenceDecisionRequest.properties.decision.enum;
const fixtureAmountKinds = ["FIXED", "ESTIMATED", "UNKNOWN_VARIABLE"];
const fixtureTrackStatuses =
  milestone4Schemas.UpdateCancellationAttemptRequest.properties.serviceStatus
    .enum;
const fixtureSavingsStates =
  milestone4Fixture.paths["/v1/savings"].get.parameters[1].schema.enum;
milestone4Schemas.AttemptTrackStatus = {
  type: "string",
  enum: fixtureTrackStatuses,
};
milestone4Schemas.VerificationStatus = {
  type: "string",
  enum: ["PENDING", "SELF_REPORTED", "VERIFIED", "DISPUTED"],
};
milestone4Schemas.FeedbackOutcome = {
  type: "string",
  enum: ["WORKED", "OUTDATED", "MERCHANT_CHANGED_FLOW", "UNSAFE_LINK"],
};
milestone4Schemas.UpdateCancellationAttemptRequest.properties.serviceStatus = {
  $ref: "#/components/schemas/AttemptTrackStatus",
};
milestone4Schemas.UpdateCancellationAttemptRequest.properties.paymentMandateStatus =
  {
    $ref: "#/components/schemas/AttemptTrackStatus",
  };
milestone4Schemas.CreateCancellationGuideFeedbackRequest.properties.outcome = {
  $ref: "#/components/schemas/FeedbackOutcome",
};
milestone4Schemas.OccurrenceDecision.properties.decision = enumProperty(
  fixtureDecisionActions,
);
milestone4Schemas.DecisionInboxItem.properties.category = enumProperty([
  "SUBSCRIPTION",
  "UTILITY",
  "MEMBERSHIP",
  "SOFTWARE",
  "EMI_LOAN",
  "INSURANCE",
  "INVESTMENT_COMMITMENT",
  "EDUCATION",
  "OTHER",
]);
milestone4Schemas.DecisionInboxItem.properties.paymentRail = enumProperty([
  "UPI_AUTOPAY",
  "CARD_RECURRING",
  "NACH_ENACH",
  "APP_STORE",
  "MERCHANT_DIRECT",
  "CASH_OR_MANUAL",
  "UNKNOWN",
]);
milestone4Schemas.DecisionInboxItem.properties.amountKind =
  enumProperty(fixtureAmountKinds);
milestone4Schemas.DecisionInboxItem.properties.reviewActions = {
  type: "array",
  items: enumProperty(fixtureDecisionActions),
};
milestone4Schemas.GuideStep.properties.kind = enumProperty([
  "INFORMATION",
  "SAFE_LINK",
  "APP_DEEP_LINK",
]);
milestone4Schemas.GuideTrack.properties.track = enumProperty([
  "SERVICE",
  "PAYMENT_MANDATE",
]);
milestone4Schemas.CancellationGuide.properties.status = enumProperty([
  "PUBLISHED",
]);
milestone4Schemas.CancellationGuide.properties.freshness = enumProperty([
  "CURRENT",
  "REVIEW_DUE",
]);
milestone4Schemas.CancellationGuide.properties.targetSuppressionReason =
  enumProperty(["NONE", "REVIEW_DUE", "USER_REPORTED_UNSAFE"]);
milestone4Schemas.CancellationAttempt.properties.amountKind =
  enumProperty(fixtureAmountKinds);
milestone4Schemas.CancellationAttempt.properties.serviceStatus = {
  $ref: "#/components/schemas/AttemptTrackStatus",
};
milestone4Schemas.CancellationAttempt.properties.paymentMandateStatus = {
  $ref: "#/components/schemas/AttemptTrackStatus",
};
milestone4Schemas.CancellationAttempt.properties.verificationStatus = {
  $ref: "#/components/schemas/VerificationStatus",
};
milestone4Schemas.SavingsStateTotal.properties.state =
  enumProperty(fixtureSavingsStates);
milestone4Schemas.SavingsItem.properties.state =
  enumProperty(fixtureSavingsStates);
milestone4Schemas.SavingsItem.properties.reversalReason = enumProperty(
  ["ABANDONED", "DEBIT_OCCURRED"],
  true,
);
assert.doesNotThrow(() => validateDocument(milestone4Fixture));

const milestone4Generated = renderClient(milestone4Fixture);
assert.match(milestone4Generated, /async createOccurrenceDecision/);
assert.match(milestone4Generated, /requestHeaders\.set\("Idempotency-Key"/);
assert.match(milestone4Generated, /async verifyCancellationAttempt/);
assert.match(milestone4Generated, /requestHeaders\.set\("If-Match"/);
assert.match(
  milestone4Generated,
  /export type AttemptTrackStatus =[\s\S]*"CONFIRMED"/,
);
assert.match(
  milestone4Generated,
  /currentDecision: OccurrenceDecision \| null;/,
);
assert.match(milestone4Generated, /target: GuideTarget \| null;/);

const optionalIdempotencyFixture = structuredClone(milestone4Fixture);
optionalIdempotencyFixture.paths[
  "/v1/occurrences/{occurrenceId}/decisions"
].post.parameters[1].required = false;
assert.throws(
  () => validateDocument(optionalIdempotencyFixture),
  /mandatory header parameter Idempotency-Key/,
);

const forbiddenHeaderFixture = structuredClone(milestone4Fixture);
forbiddenHeaderFixture.paths[
  "/v1/commitments/{commitmentId}/cancellation-attempts"
].post.parameters.push(ifMatchParameter());
assert.throws(
  () => validateDocument(forbiddenHeaderFixture),
  /must contain exactly these parameters/,
);

const weakIdempotencyFixture = structuredClone(milestone4Fixture);
weakIdempotencyFixture.paths[
  "/v1/occurrences/{occurrenceId}/decisions"
].post.parameters[1].schema.pattern = "^.{16,100}$";
assert.throws(
  () => validateDocument(weakIdempotencyFixture),
  /Idempotency-Key must allow exactly 16 through 100 visible ASCII/,
);

const weakIfMatchFixture = structuredClone(milestone4Fixture);
weakIfMatchFixture.paths[
  "/v1/cancellation-attempts/{attemptId}"
].patch.parameters[1].schema.pattern = "^.*$";
assert.throws(
  () => validateDocument(weakIfMatchFixture),
  /If-Match must be one quoted non-negative numeric version/,
);

const openMilestone4RequestFixture = structuredClone(milestone4Fixture);
delete openMilestone4RequestFixture.components.schemas
  .CreateCancellationAttemptRequest.additionalProperties;
assert.throws(
  () => validateDocument(openMilestone4RequestFixture),
  /CreateCancellationAttemptRequest must set additionalProperties to false/,
);

const massAssignmentFixture = structuredClone(milestone4Fixture);
massAssignmentFixture.components.schemas.CreateCancellationAttemptRequest.properties.householdId =
  uuidProperty;
massAssignmentFixture.components.schemas.CreateCancellationAttemptRequest.required.push(
  "householdId",
);
assert.throws(
  () => validateDocument(massAssignmentFixture),
  /must not mass-assign householdId/,
);

const incompleteAttemptFixture = structuredClone(milestone4Fixture);
incompleteAttemptFixture.components.schemas.CancellationAttempt.required =
  incompleteAttemptFixture.components.schemas.CancellationAttempt.required.filter(
    (name) => name !== "verificationDueDate",
  );
assert.throws(
  () => validateDocument(incompleteAttemptFixture),
  /CancellationAttempt has optional fields: verificationDueDate/,
);

const nonUuidOwnershipFixture = structuredClone(milestone4Fixture);
delete nonUuidOwnershipFixture.paths["/v1/cancellation-attempts/{attemptId}"]
  .get.parameters[0].schema.format;
assert.throws(
  () => validateDocument(nonUuidOwnershipFixture),
  /parameter attemptId has the wrong schema/,
);

const missingEtagFixture = structuredClone(milestone4Fixture);
delete missingEtagFixture.paths["/v1/cancellation-attempts/{attemptId}"].patch
  .responses[200].headers;
assert.throws(
  () => validateDocument(missingEtagFixture),
  /requires an ETag response header/,
);

const missingIdempotencyConflictFixture = structuredClone(milestone4Fixture);
delete missingIdempotencyConflictFixture.paths[
  "/v1/cancellation-attempts/{attemptId}/verify"
].post.responses[409];
assert.throws(
  () => validateDocument(missingIdempotencyConflictFixture),
  /must document 409 with ApiProblem/,
);

const missingPreconditionFixture = structuredClone(milestone4Fixture);
delete missingPreconditionFixture.paths["/v1/cancellation-attempts/{attemptId}"]
  .patch.responses[428];
assert.throws(
  () => validateDocument(missingPreconditionFixture),
  /must document 428 with ApiProblem/,
);

const milestone5Fixture = JSON.parse(
  await readFile(
    new URL("../../../services/api/openapi/openapi.json", import.meta.url),
    "utf8",
  ),
);
// Keep the generator self-test independent from the checked-in snapshot drift
// check while the v2 privacy export is introduced. The subsequent --check run
// still requires the authoritative snapshot and generated client to agree.
milestone5Fixture.components.schemas.PrivacyExportMetadata.properties.schemaVersion.enum =
  ["autopay-guard-export-v1", "autopay-guard-export-v2"];
milestone5Fixture.paths[
  "/v1/privacy/requests/{requestId}/export"
].get.responses[200].headers["Content-Disposition"].schema.pattern =
  '^attachment; filename="autopay-guard-export-v(?:1|2)\\.json"$';
assert.doesNotThrow(() => validateDocument(milestone5Fixture));

const milestone5Generated = renderClient(milestone5Fixture);
assert.match(
  milestone5Generated,
  /export type CreatePrivacyRequest =[\s\S]*CreateExportPrivacyRequest[\s\S]*CreateCorrectionPrivacyRequest[\s\S]*CreateDeletionPrivacyRequest;/,
);
assert.match(
  milestone5Generated,
  /export interface ListHouseholdMembersParameters[\s\S]*cursor\?: string;[\s\S]*limit\?: number;/,
);

for (const schemaName of [
  "HouseholdMemberCollection",
  "HouseholdInvitationCollection",
  "PrivacyNoticeAcknowledgementCollection",
  "ConsentCollection",
  "AdminCancellationGuideVersionCollection",
]) {
  const missingCursorFixture = structuredClone(milestone5Fixture);
  missingCursorFixture.components.schemas[schemaName].required =
    missingCursorFixture.components.schemas[schemaName].required.filter(
      (property) => property !== "nextCursor",
    );
  assert.throws(
    () => validateDocument(missingCursorFixture),
    new RegExp(`${schemaName} has optional fields: nextCursor`),
  );

  const nonNullableCursorFixture = structuredClone(milestone5Fixture);
  delete nonNullableCursorFixture.components.schemas[schemaName].properties
    .nextCursor.nullable;
  assert.throws(
    () => validateDocument(nonNullableCursorFixture),
    new RegExp(`${schemaName}\\.nextCursor must be explicitly nullable`),
  );
}

for (const [path, method] of [
  ["/v1/households/{householdId}/members", "get"],
  ["/v1/households/{householdId}/invitations", "get"],
  ["/v1/household-invitations", "get"],
  ["/v1/privacy/notice-acknowledgements", "get"],
  ["/v1/privacy/consents", "get"],
  ["/v1/admin/cancellation-guides/{guideId}/versions", "get"],
]) {
  const invalidCursorFixture = structuredClone(milestone5Fixture);
  const operation = invalidCursorFixture.paths[path][method];
  const cursor = operation.parameters.find(
    (parameter) => parameter.name === "cursor",
  );
  delete cursor.schema.format;
  assert.throws(
    () => validateDocument(invalidCursorFixture),
    /parameter cursor has the wrong schema/,
  );

  const missingCursorNotFoundFixture = structuredClone(milestone5Fixture);
  delete missingCursorNotFoundFixture.paths[path][method].responses[404];
  assert.throws(
    () => validateDocument(missingCursorNotFoundFixture),
    /must document exactly these responses/,
  );
}

const optionalM5IdempotencyFixture = structuredClone(milestone5Fixture);
optionalM5IdempotencyFixture.paths["/v1/privacy/requests"].post.parameters.find(
  (parameter) => parameter.name === "Idempotency-Key",
).required = false;
assert.throws(
  () => validateDocument(optionalM5IdempotencyFixture),
  /mandatory header parameter Idempotency-Key/,
);

const forbiddenOneTimeCodeHeaderFixture = structuredClone(milestone5Fixture);
forbiddenOneTimeCodeHeaderFixture.paths[
  "/v1/households/{householdId}/invitations"
].post.parameters.push(idempotencyParameter());
assert.throws(
  () => validateDocument(forbiddenOneTimeCodeHeaderFixture),
  /must contain exactly these parameters/,
);

const openM5RequestFixture = structuredClone(milestone5Fixture);
delete openM5RequestFixture.components.schemas.CreateSupportCodeRequest
  .additionalProperties;
assert.throws(
  () => validateDocument(openM5RequestFixture),
  /CreateSupportCodeRequest must set additionalProperties to false/,
);

const brokenPrivacyDiscriminatorFixture = structuredClone(milestone5Fixture);
delete brokenPrivacyDiscriminatorFixture.components.schemas.CreatePrivacyRequest
  .discriminator.mapping.CORRECTION;
assert.throws(
  () => validateDocument(brokenPrivacyDiscriminatorFixture),
  /exact requestType discriminator mapping/,
);

const milestone6Fixture = structuredClone(milestone5Fixture);
const importStatuses = ["PREVIEW_READY", "CONFIRMED", "DISCARDED", "EXPIRED"];
const importStatusProperty = () => ({
  type: "string",
  enum: importStatuses,
});
const boundedInteger = (format, minimum, maximum) => ({
  type: "integer",
  format,
  minimum,
  ...(maximum === undefined ? {} : { maximum }),
});
const importTimestamp = (nullable = false) => ({
  type: "string",
  format: "date-time",
  ...(nullable ? { nullable: true } : {}),
});
Object.assign(milestone6Fixture.components.schemas, {
  CommitmentImportUploadRequest: objectSchema(["householdId", "file"], {
    householdId: { type: "string", format: "uuid" },
    file: {
      type: "string",
      format: "binary",
      minLength: 1,
      maxLength: 262_144,
    },
  }),
  UploadResponse: objectSchema(
    [
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
    {
      id: { type: "string", format: "uuid" },
      householdId: { type: "string", format: "uuid" },
      status: importStatusProperty(),
      rawByteCount: boundedInteger("int32", 1, 262_144),
      expiresAt: importTimestamp(),
      totalItemCount: boundedInteger("int32", 1, 100),
      validItemCount: boundedInteger("int32", 0, 100),
      invalidItemCount: boundedInteger("int32", 0, 100),
      duplicateItemCount: boundedInteger("int32", 0, 100),
      version: boundedInteger("int64", 0),
      createdAt: importTimestamp(),
      updatedAt: importTimestamp(),
    },
  ),
  JobResponse: objectSchema(
    [
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
    {
      id: { type: "string", format: "uuid" },
      householdId: { type: "string", format: "uuid" },
      status: importStatusProperty(),
      rawByteCount: boundedInteger("int32", 1, 262_144),
      expiresAt: importTimestamp(),
      rawProcessedAt: importTimestamp(),
      totalItemCount: boundedInteger("int32", 1, 100),
      validItemCount: boundedInteger("int32", 0, 100),
      invalidItemCount: boundedInteger("int32", 0, 100),
      duplicateItemCount: boundedInteger("int32", 0, 100),
      selectedItemCount: boundedInteger("int32", 0, 100),
      createdCommitmentCount: boundedInteger("int32", 0, 100),
      items: {
        type: "array",
        minItems: 1,
        maxItems: 100,
        items: { $ref: "#/components/schemas/ItemResponse" },
      },
      version: boundedInteger("int64", 0),
      createdAt: importTimestamp(),
      updatedAt: importTimestamp(),
    },
  ),
  ItemResponse: objectSchema(
    [
      "id",
      "rowNumber",
      "valid",
      "duplicateKind",
      "selected",
      "createdCommitmentId",
      "errors",
      "preview",
    ],
    {
      id: { type: "string", format: "uuid" },
      rowNumber: boundedInteger("int32", 2, 101),
      valid: { type: "boolean" },
      duplicateKind: {
        type: "string",
        enum: ["NONE", "IN_FILE", "EXISTING"],
        nullable: true,
      },
      selected: { type: "boolean", nullable: true },
      createdCommitmentId: {
        type: "string",
        format: "uuid",
        nullable: true,
      },
      errors: {
        type: "array",
        minItems: 0,
        maxItems: 10,
        items: { $ref: "#/components/schemas/ErrorResponse" },
      },
      preview: {
        allOf: [{ $ref: "#/components/schemas/Preview" }],
        nullable: true,
      },
    },
  ),
  Preview: objectSchema(
    [
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
    {
      name: { type: "string", minLength: 1, maxLength: 160 },
      category: {
        type: "string",
        enum: [
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
      },
      amountMinor: boundedInteger("int64", 1, 999_999_999_999),
      currency: {
        type: "string",
        minLength: 3,
        maxLength: 3,
        pattern: "^[A-Z]{3}$",
      },
      frequency: {
        type: "string",
        enum: ["WEEKLY", "MONTHLY", "QUARTERLY", "HALF_YEARLY", "YEARLY"],
      },
      nextDueDate: { type: "string", format: "date" },
      monthDayPolicy: {
        type: "string",
        enum: ["ANCHOR_DAY", "LAST_DAY"],
      },
      paymentRail: {
        type: "string",
        enum: [
          "UPI_AUTOPAY",
          "CARD_RECURRING",
          "NACH_ENACH",
          "APP_STORE",
          "MERCHANT_DIRECT",
          "CASH_OR_MANUAL",
          "UNKNOWN",
        ],
      },
      maskedPaymentLabel: {
        type: "string",
        minLength: 0,
        maxLength: 64,
        nullable: true,
      },
      merchantId: { type: "string", format: "uuid", nullable: true },
    },
  ),
  ErrorResponse: objectSchema(["code", "message"], {
    code: {
      type: "string",
      enum: [
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
    },
    message: { type: "string", minLength: 1, maxLength: 200 },
  }),
  ConfirmRequest: objectSchema(["selectedItemIds"], {
    selectedItemIds: {
      type: "array",
      minItems: 1,
      maxItems: 100,
      uniqueItems: true,
      items: { type: "string", format: "uuid" },
    },
  }),
  ConfirmationResponse: objectSchema(
    [
      "importId",
      "status",
      "selectedItemCount",
      "createdCommitmentCount",
      "commitmentIds",
      "rawProcessedAt",
      "version",
    ],
    {
      importId: { type: "string", format: "uuid" },
      status: importStatusProperty(),
      selectedItemCount: boundedInteger("int32", 1, 100),
      createdCommitmentCount: boundedInteger("int32", 1, 100),
      commitmentIds: {
        type: "array",
        minItems: 1,
        maxItems: 100,
        uniqueItems: true,
        items: { type: "string", format: "uuid" },
      },
      rawProcessedAt: importTimestamp(),
      version: boundedInteger("int64", 0),
    },
  ),
});
for (const action of [
  "IMPORT_PREVIEW_CREATED",
  "IMPORT_CONFIRMED",
  "IMPORT_DISCARDED",
  "IMPORT_PREVIEW_EXPIRED",
]) {
  const actions =
    milestone6Fixture.components.schemas.AdminAuditEvent.properties.action.enum;
  if (!actions.includes(action)) {
    actions.push(action);
  }
}
const auditResourceTypes =
  milestone6Fixture.components.schemas.AdminAuditEvent.properties.resourceType
    .enum;
if (!auditResourceTypes.includes("IMPORT_JOB")) {
  auditResourceTypes.push("IMPORT_JOB");
}

const importEtagHeader = {
  schema: { type: "string", pattern: '^"(0|[1-9][0-9]*)"$' },
};
const importNoStoreHeader = {
  schema: { type: "string", pattern: "^no-store$" },
};
const importLocationHeader = {
  schema: {
    type: "string",
    pattern:
      "^/v1/imports/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
  },
};
const importOperation = ({
  operationId,
  parameters = [],
  requestSchema,
  requestMediaType = "application/json",
  responseSchema,
  success = 200,
  responseHeaders,
  errors,
}) => ({
  operationId,
  security: [{ bearerAuth: [] }],
  parameters,
  ...(requestSchema
    ? {
        requestBody: {
          required: true,
          content: {
            [requestMediaType]: {
              schema: { $ref: `#/components/schemas/${requestSchema}` },
            },
          },
        },
      }
    : {}),
  responses: {
    [success]: {
      description: "ok",
      ...(responseHeaders ? { headers: responseHeaders } : {}),
      ...(responseSchema
        ? {
            content: {
              "application/json": {
                schema: { $ref: `#/components/schemas/${responseSchema}` },
              },
            },
          }
        : {}),
    },
    ...Object.fromEntries(errors.map((status) => [status, problemResponse()])),
  },
});
milestone6Fixture.paths["/v1/imports"] = {
  post: importOperation({
    operationId: "uploadCommitmentImport",
    parameters: [idempotencyParameter()],
    requestSchema: "CommitmentImportUploadRequest",
    requestMediaType: "multipart/form-data",
    responseSchema: "UploadResponse",
    success: 201,
    responseHeaders: {
      Location: importLocationHeader,
      ETag: importEtagHeader,
      "Cache-Control": importNoStoreHeader,
    },
    errors: [400, 401, 403, 404, 409, 429],
  }),
};
milestone6Fixture.paths["/v1/imports/{importId}"] = {
  get: importOperation({
    operationId: "getCommitmentImport",
    parameters: [uuidParameter("importId", "path")],
    responseSchema: "JobResponse",
    responseHeaders: {
      ETag: importEtagHeader,
      "Cache-Control": importNoStoreHeader,
    },
    errors: [401, 403, 404],
  }),
  delete: importOperation({
    operationId: "discardCommitmentImport",
    parameters: [uuidParameter("importId", "path"), ifMatchParameter()],
    success: 204,
    responseHeaders: { "Cache-Control": importNoStoreHeader },
    errors: [400, 401, 403, 404, 409, 412, 428],
  }),
};
milestone6Fixture.paths["/v1/imports/{importId}/confirm"] = {
  post: importOperation({
    operationId: "confirmCommitmentImport",
    parameters: [
      uuidParameter("importId", "path"),
      ifMatchParameter(),
      idempotencyParameter(),
    ],
    requestSchema: "ConfirmRequest",
    responseSchema: "ConfirmationResponse",
    responseHeaders: {
      ETag: importEtagHeader,
      "Cache-Control": importNoStoreHeader,
    },
    errors: [400, 401, 403, 404, 409, 412, 428, 429],
  }),
};

assert.doesNotThrow(() => validateDocument(milestone6Fixture));
const milestone6Generated = renderClient(milestone6Fixture);
assert.doesNotMatch(milestone6Generated, /async uploadCommitmentImport/);
assert.doesNotMatch(
  milestone6Generated,
  /export interface UploadCommitmentImportParameters/,
);
assert.match(milestone6Generated, /async getCommitmentImport/);
assert.match(
  milestone6Generated,
  /async confirmCommitmentImport\([\s\S]*body: ConfirmRequest/,
);
assert.match(milestone6Generated, /async discardCommitmentImport/);

const bodylessMultipartFixture = structuredClone(milestone6Fixture);
const multipartBody =
  bodylessMultipartFixture.paths["/v1/imports"].post.requestBody;
multipartBody.content["application/octet-stream"] =
  multipartBody.content["multipart/form-data"];
delete multipartBody.content["multipart/form-data"];
assert.throws(
  () => renderClient(bodylessMultipartFixture),
  /uses unsupported request media types: application\/octet-stream/,
);

const jsonUploadFixture = structuredClone(milestone6Fixture);
const jsonUploadBody = jsonUploadFixture.paths["/v1/imports"].post.requestBody;
jsonUploadBody.content["application/json"] =
  jsonUploadBody.content["multipart/form-data"];
delete jsonUploadBody.content["multipart/form-data"];
assert.throws(
  () => validateDocument(jsonUploadFixture),
  /multipart\/form-data request schema CommitmentImportUploadRequest/,
);

const weakUploadBoundFixture = structuredClone(milestone6Fixture);
delete weakUploadBoundFixture.components.schemas.CommitmentImportUploadRequest
  .properties.file.maxLength;
assert.throws(
  () => validateDocument(weakUploadBoundFixture),
  /binary string bounded to 1 through 256 KiB/,
);

const nonUniqueSelectionFixture = structuredClone(milestone6Fixture);
delete nonUniqueSelectionFixture.components.schemas.ConfirmRequest.properties
  .selectedItemIds.uniqueItems;
assert.throws(
  () => validateDocument(nonUniqueSelectionFixture),
  /ConfirmRequest\.selectedItemIds must contain 1 through 100 unique items/,
);

const nullableRawProcessedFixture = structuredClone(milestone6Fixture);
nullableRawProcessedFixture.components.schemas.JobResponse.properties.rawProcessedAt.nullable = true;
assert.throws(
  () => validateDocument(nullableRawProcessedFixture),
  /JobResponse\.rawProcessedAt must be required and non-null/,
);

const missingImportEtagFixture = structuredClone(milestone6Fixture);
delete missingImportEtagFixture.paths["/v1/imports/{importId}"].get
  .responses[200].headers.ETag;
assert.throws(
  () => validateDocument(missingImportEtagFixture),
  /must contain exactly these success headers: ETag, Cache-Control/,
);

const missingImportPreconditionFixture = structuredClone(milestone6Fixture);
delete missingImportPreconditionFixture.paths["/v1/imports/{importId}/confirm"]
  .post.responses[412];
assert.throws(
  () => validateDocument(missingImportPreconditionFixture),
  /must document exactly these responses/,
);

const incompleteImportAuditFixture = structuredClone(milestone6Fixture);
incompleteImportAuditFixture.components.schemas.AdminAuditEvent.properties.action.enum.pop();
assert.throws(
  () => validateDocument(incompleteImportAuditFixture),
  /AdminAuditEvent\.action must be exactly/,
);

const extraImportMethodFixture = structuredClone(milestone6Fixture);
extraImportMethodFixture.paths["/v1/imports"].get =
  extraImportMethodFixture.paths["/v1/imports/{importId}"].get;
assert.throws(
  () => validateDocument(extraImportMethodFixture),
  /\/v1\/imports must expose exactly: post/,
);

console.log("OpenAPI client generator path/query/header self-test passed.");
