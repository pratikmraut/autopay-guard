const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_PATH =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

type FieldValidator = (value: unknown) => boolean;

interface BodyRule {
  method: string;
  path: RegExp;
  fields?: Readonly<Record<string, FieldValidator>>;
  variants?: readonly Readonly<Record<string, FieldValidator>>[];
  validate?: (body: Readonly<Record<string, unknown>>) => boolean;
}

export type NormalizedBffBody =
  | { accepted: true; body: string | undefined }
  | { accepted: false };

const isDecision = oneOf([
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
]);
const isTrackStatus = oneOf([
  "NOT_REQUIRED",
  "NOT_STARTED",
  "REQUESTED",
  "CONFIRMED",
  "FAILED",
]);
const isVerificationStatus = oneOf(["SELF_REPORTED", "VERIFIED", "DISPUTED"]);
const isFeedbackOutcome = oneOf([
  "WORKED",
  "OUTDATED",
  "MERCHANT_CHANGED_FLOW",
  "UNSAFE_LINK",
]);
const isUuid: FieldValidator = (value) =>
  typeof value === "string" && UUID.test(value);
const isPositiveInt32: FieldValidator = (value) =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 1 &&
  value <= 2_147_483_647;
const isOptionalNote: FieldValidator = (value) =>
  value === null ||
  (typeof value === "string" &&
    value === value.trim() &&
    value.length >= 1 &&
    value.length <= 500);
const isFakeLocalEmail: FieldValidator = (value) =>
  typeof value === "string" &&
  value === value.trim() &&
  value.length >= 3 &&
  value.length <= 320 &&
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:autopayguard\.local|[a-z0-9-]+\.example\.test)$/i.test(
    value,
  );
const isInvitationCode: FieldValidator = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
const isCommitmentVisibility = oneOf(["PRIVATE", "HOUSEHOLD"]);
const isOptionalUuid: FieldValidator = (value) =>
  value === null || isUuid(value);
const isNoticeVersion: FieldValidator = (value) =>
  typeof value === "string" && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(value);
const isConsentAction = oneOf(["GRANTED", "WITHDRAWN"]);
const isGuideReviewInterval: FieldValidator = (value) =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 30 &&
  value <= 90;
const isGuideText = boundedTrimmedText(1_000);
const isGuideTitle = boundedTrimmedText(160);
const isGuideSteps: FieldValidator = (value) => {
  if (!Array.isArray(value) || value.length !== 4) {
    return false;
  }
  const identities = new Set<string>();
  for (const step of value) {
    if (
      !isExactObject(step, [
        "instruction",
        "sequenceNumber",
        "title",
        "track",
      ]) ||
      !oneOf(["SERVICE", "PAYMENT_MANDATE"])(step.track) ||
      (step.sequenceNumber !== 1 && step.sequenceNumber !== 2) ||
      !isGuideTitle(step.title) ||
      !isGuideText(step.instruction)
    ) {
      return false;
    }
    identities.add(`${String(step.track)}:${String(step.sequenceNumber)}`);
  }
  return identities.size === 4;
};
const isFeedbackDisposition = oneOf(["RESOLVED", "DISMISSED"]);
const isSupportCode: FieldValidator = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
const isSelectedImportItemIds: FieldValidator = (value) =>
  Array.isArray(value) &&
  value.length >= 1 &&
  value.length <= 100 &&
  value.every(isUuid) &&
  new Set(value.map((id) => String(id).toLowerCase())).size === value.length;

const rules: readonly BodyRule[] = [
  {
    method: "POST",
    path: /^\/v1\/privacy\/notice-acknowledgements$/,
    fields: { noticeVersion: isNoticeVersion },
  },
  {
    method: "POST",
    path: /^\/v1\/privacy\/consents$/,
    fields: {
      purpose: (value) => value === "HOUSEHOLD_SHARING",
      purposeVersion: isNoticeVersion,
      action: isConsentAction,
    },
  },
  {
    method: "POST",
    path: /^\/v1\/privacy\/requests$/,
    variants: [
      { requestType: (value) => value === "EXPORT" },
      {
        requestType: (value) => value === "CORRECTION",
        correctionValue: isIanaTimeZone,
      },
      { requestType: (value) => value === "DELETION" },
    ],
  },
  {
    method: "POST",
    path: new RegExp(`^/v1/households/${UUID_PATH}/invitations$`, "i"),
    fields: { inviteeEmail: isFakeLocalEmail },
  },
  {
    method: "POST",
    path: /^\/v1\/household-invitations\/accept$/,
    fields: { invitationCode: isInvitationCode },
  },
  {
    method: "PATCH",
    path: new RegExp(`^/v1/commitments/${UUID_PATH}/sharing$`, "i"),
    fields: {
      visibility: isCommitmentVisibility,
      responsibleMemberId: isOptionalUuid,
    },
    validate: (body) =>
      body.visibility === "HOUSEHOLD" || body.responsibleMemberId === null,
  },
  {
    method: "PATCH",
    path: new RegExp(`^/v1/admin/cancellation-guide-drafts/${UUID_PATH}$`, "i"),
    fields: {
      riskNotice: isGuideText,
      reviewIntervalDays: isGuideReviewInterval,
      steps: isGuideSteps,
    },
  },
  {
    method: "POST",
    path: new RegExp(
      `^/v1/admin/cancellation-guide-feedback/${UUID_PATH}/review$`,
      "i",
    ),
    fields: { disposition: isFeedbackDisposition },
  },
  {
    method: "POST",
    path: new RegExp(`^/v1/households/${UUID_PATH}/support-codes$`, "i"),
    fields: {
      acknowledgeReadOnlyDiagnostics: (value) => value === true,
    },
  },
  {
    method: "POST",
    path: /^\/v1\/support\/diagnostics\/resolve$/,
    fields: { supportCode: isSupportCode },
  },
  {
    method: "POST",
    path: new RegExp(`^/v1/occurrences/${UUID_PATH}/decisions$`, "i"),
    fields: { decision: isDecision },
  },
  {
    method: "POST",
    path: new RegExp(
      `^/v1/commitments/${UUID_PATH}/cancellation-attempts$`,
      "i",
    ),
    fields: {
      occurrenceId: isUuid,
      decisionId: isUuid,
      guideId: isUuid,
      guideVersion: isPositiveInt32,
      note: isOptionalNote,
    },
  },
  {
    method: "PATCH",
    path: new RegExp(`^/v1/cancellation-attempts/${UUID_PATH}$`, "i"),
    fields: {
      serviceStatus: isTrackStatus,
      paymentMandateStatus: isTrackStatus,
      abandoned: (value) => typeof value === "boolean",
    },
  },
  {
    method: "POST",
    path: new RegExp(`^/v1/cancellation-attempts/${UUID_PATH}/verify$`, "i"),
    fields: { status: isVerificationStatus },
  },
  {
    method: "POST",
    path: new RegExp(`^/v1/cancellation-guides/${UUID_PATH}/feedback$`, "i"),
    fields: {
      commitmentId: isUuid,
      guideVersion: isPositiveInt32,
      outcome: isFeedbackOutcome,
      note: isOptionalNote,
    },
  },
  {
    method: "POST",
    path: new RegExp(`^/v1/imports/${UUID_PATH}/confirm$`, "i"),
    fields: { selectedItemIds: isSelectedImportItemIds },
  },
];

export function normalizeBffRequestBody(
  method: string,
  pathname: string,
  body: string | undefined,
): NormalizedBffBody {
  if (body !== undefined && inspectDuplicateJsonKeys(body) === "duplicate") {
    return { accepted: false };
  }

  const rawPath = pathname.slice("/api/bff".length);
  const rule = rules.find(
    (candidate) => candidate.method === method && candidate.path.test(rawPath),
  );
  if (!rule) {
    return { accepted: true, body };
  }
  if (body === undefined || body.length === 0) {
    return { accepted: false };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    return { accepted: false };
  }
  if (!isJsonObject(parsed)) {
    return { accepted: false };
  }

  const actualFields = Object.keys(parsed).sort();
  const variants = rule.variants ?? (rule.fields ? [rule.fields] : []);
  const fields = variants.find((candidate) => {
    const expectedFields = Object.keys(candidate).sort();
    return (
      actualFields.length === expectedFields.length &&
      actualFields.every((field, index) => field === expectedFields[index]) &&
      expectedFields.every((field) => candidate[field]?.(parsed[field]))
    );
  });
  if (!fields) {
    return { accepted: false };
  }
  if (rule.validate && !rule.validate(parsed)) {
    return { accepted: false };
  }

  return { accepted: true, body: JSON.stringify(parsed) };
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function oneOf(values: readonly string[]): FieldValidator {
  const allowed = new Set(values);
  return (value) => typeof value === "string" && allowed.has(value);
}

function boundedTrimmedText(maximum: number): FieldValidator {
  return (value) =>
    typeof value === "string" &&
    value === value.trim() &&
    value.length >= 1 &&
    value.length <= maximum &&
    !value.includes("\u0000");
}

function isIanaTimeZone(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    value.length < 3 ||
    value.length > 64 ||
    !/^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/.test(value)
  ) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function isExactObject(
  value: unknown,
  expectedFields: readonly string[],
): value is Record<string, unknown> {
  if (!isJsonObject(value)) {
    return false;
  }
  const actualFields = Object.keys(value).sort();
  const expected = [...expectedFields].sort();
  return (
    actualFields.length === expected.length &&
    actualFields.every((field, index) => field === expected[index])
  );
}

function inspectDuplicateJsonKeys(
  source: string,
): "unique" | "duplicate" | "invalid" {
  let index = 0;
  let duplicate = false;

  const skipWhitespace = () => {
    while (isJsonWhitespace(source[index])) {
      index += 1;
    }
  };

  const parseString = () => {
    const start = index;
    if (source[index] !== '"') {
      throw new Error("Expected a JSON string.");
    }
    index += 1;
    while (index < source.length) {
      if (source[index] === "\\") {
        index += 2;
        continue;
      }
      if (source[index] === '"') {
        index += 1;
        const value = JSON.parse(source.slice(start, index)) as unknown;
        if (typeof value !== "string") {
          throw new Error("Expected a JSON string.");
        }
        return value;
      }
      index += 1;
    }
    throw new Error("Unterminated JSON string.");
  };

  const parseValue = () => {
    skipWhitespace();
    if (source[index] === "{") {
      parseObject();
      return;
    }
    if (source[index] === "[") {
      parseArray();
      return;
    }
    if (source[index] === '"') {
      parseString();
      return;
    }
    const start = index;
    while (
      index < source.length &&
      !isJsonWhitespace(source[index]) &&
      source[index] !== "," &&
      source[index] !== "]" &&
      source[index] !== "}"
    ) {
      index += 1;
    }
    if (index === start) {
      throw new Error("Expected a JSON value.");
    }
  };

  const parseObject = () => {
    index += 1;
    const keys = new Set<string>();
    skipWhitespace();
    if (source[index] === "}") {
      index += 1;
      return;
    }
    while (index < source.length) {
      skipWhitespace();
      const key = parseString();
      if (keys.has(key)) {
        duplicate = true;
      }
      keys.add(key);
      skipWhitespace();
      if (source[index] !== ":") {
        throw new Error("Expected a JSON property separator.");
      }
      index += 1;
      parseValue();
      skipWhitespace();
      if (source[index] === "}") {
        index += 1;
        return;
      }
      if (source[index] !== ",") {
        throw new Error("Expected a JSON object delimiter.");
      }
      index += 1;
    }
    throw new Error("Unterminated JSON object.");
  };

  const parseArray = () => {
    index += 1;
    skipWhitespace();
    if (source[index] === "]") {
      index += 1;
      return;
    }
    while (index < source.length) {
      parseValue();
      skipWhitespace();
      if (source[index] === "]") {
        index += 1;
        return;
      }
      if (source[index] !== ",") {
        throw new Error("Expected a JSON array delimiter.");
      }
      index += 1;
    }
    throw new Error("Unterminated JSON array.");
  };

  try {
    parseValue();
    skipWhitespace();
    if (index !== source.length) {
      return "invalid";
    }
    return duplicate ? "duplicate" : "unique";
  } catch {
    return "invalid";
  }
}

function isJsonWhitespace(value: string | undefined) {
  return value === " " || value === "\t" || value === "\n" || value === "\r";
}
