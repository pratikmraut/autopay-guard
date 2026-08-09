const UUID =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CURSOR = /^[A-Za-z0-9_-]{1,200}$/;
const SEARCH_TEXT = /^[\p{L}\p{N} .&'()+_-]{1,80}$/u;
const CATEGORY =
  /^(SUBSCRIPTION|UTILITY|MEMBERSHIP|SOFTWARE|EMI_LOAN|INSURANCE|INVESTMENT_COMMITMENT|EDUCATION|OTHER)$/;
const YEAR_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const NOTIFICATION_FILTER = /^(ALL|UNREAD|FAILED)$/;
const SAVINGS_STATE = /^(POTENTIAL|SELF_REPORTED|VERIFIED|REVERSED)$/;
const UUID_PATH =
  "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}";

type Validator = (value: string) => boolean;
export type HeaderRequirement = "forbidden" | "required";
export type BodyRequirement = "forbidden" | "required" | "multipart-import";

interface RouteRule {
  methods: ReadonlySet<string>;
  path: RegExp;
  query?: Readonly<Record<string, Validator>>;
  requiredQuery?: readonly string[];
  ifMatch?: HeaderRequirement;
  idempotencyKey?: HeaderRequirement;
  body?: BodyRequirement;
}

export interface BffHeaderPolicy {
  ifMatch: HeaderRequirement;
  idempotencyKey: HeaderRequirement;
}

const integerInRange =
  (minimum: number, maximum: number): Validator =>
  (value) => {
    if (!/^\d+$/.test(value)) {
      return false;
    }
    const parsed = Number(value);
    return (
      Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    );
  };

const rules: readonly RouteRule[] = [
  { methods: new Set(["GET"]), path: /^\/v1\/me$/ },
  {
    methods: new Set(["GET"]),
    path: /^\/v1\/households$/,
    query: {
      cursor: (value) => UUID.test(value),
      limit: integerInRange(1, 100),
    },
  },
  { methods: new Set(["POST"]), path: /^\/v1\/households$/ },
  {
    methods: new Set(["GET"]),
    path: new RegExp(`^/v1/households/${UUID_PATH}/members$`),
    query: {
      cursor: (value) => UUID.test(value),
      limit: integerInRange(1, 100),
    },
  },
  {
    methods: new Set(["DELETE"]),
    path: new RegExp(`^/v1/households/${UUID_PATH}/members/${UUID_PATH}$`),
    ifMatch: "required",
  },
  {
    methods: new Set(["GET"]),
    path: new RegExp(`^/v1/households/${UUID_PATH}/invitations$`),
    query: {
      cursor: (value) => UUID.test(value),
      limit: integerInRange(1, 100),
    },
  },
  {
    methods: new Set(["POST"]),
    path: new RegExp(`^/v1/households/${UUID_PATH}/invitations$`),
  },
  {
    methods: new Set(["DELETE"]),
    path: new RegExp(`^/v1/households/${UUID_PATH}/invitations/${UUID_PATH}$`),
    ifMatch: "required",
  },
  {
    methods: new Set(["GET"]),
    path: /^\/v1\/household-invitations$/,
    query: {
      cursor: (value) => UUID.test(value),
      limit: integerInRange(1, 100),
    },
  },
  {
    methods: new Set(["POST"]),
    path: /^\/v1\/household-invitations\/accept$/,
    idempotencyKey: "required",
  },
  {
    methods: new Set(["GET"]),
    path: /^\/v1\/privacy\/notices\/current$/,
  },
  {
    methods: new Set(["GET"]),
    path: /^\/v1\/privacy\/notice-acknowledgements$/,
    query: {
      cursor: (value) => UUID.test(value),
      limit: integerInRange(1, 100),
    },
  },
  {
    methods: new Set(["POST"]),
    path: /^\/v1\/privacy\/notice-acknowledgements$/,
    idempotencyKey: "required",
  },
  {
    methods: new Set(["GET"]),
    path: /^\/v1\/privacy\/consents$/,
    query: {
      cursor: (value) => UUID.test(value),
      limit: integerInRange(1, 100),
    },
  },
  {
    methods: new Set(["POST"]),
    path: /^\/v1\/privacy\/consents$/,
    idempotencyKey: "required",
  },
  {
    methods: new Set(["GET"]),
    path: /^\/v1\/privacy\/requests$/,
    query: {
      cursor: (value) => UUID.test(value),
      limit: integerInRange(1, 100),
    },
  },
  {
    methods: new Set(["POST"]),
    path: /^\/v1\/privacy\/requests$/,
    idempotencyKey: "required",
  },
  {
    methods: new Set(["GET"]),
    path: new RegExp(`^/v1/privacy/requests/${UUID_PATH}$`),
  },
  {
    methods: new Set(["POST"]),
    path: new RegExp(`^/v1/privacy/requests/${UUID_PATH}/cancel$`),
    ifMatch: "required",
    idempotencyKey: "required",
    body: "forbidden",
  },
  {
    methods: new Set(["GET"]),
    path: new RegExp(`^/v1/privacy/requests/${UUID_PATH}/export$`),
  },
  {
    methods: new Set(["GET"]),
    path: /^\/v1\/admin\/privacy\/requests$/,
    query: {
      cursor: (value) => UUID.test(value),
      limit: integerInRange(1, 100),
    },
  },
  {
    methods: new Set(["POST"]),
    path: new RegExp(`^/v1/admin/privacy/requests/${UUID_PATH}/execute$`),
    ifMatch: "required",
    idempotencyKey: "required",
    body: "forbidden",
  },
  {
    methods: new Set(["GET"]),
    path: /^\/v1\/admin\/cancellation-guides$/,
  },
  {
    methods: new Set(["GET"]),
    path: new RegExp(`^/v1/admin/cancellation-guides/${UUID_PATH}$`),
  },
  {
    methods: new Set(["GET"]),
    path: new RegExp(`^/v1/admin/cancellation-guides/${UUID_PATH}/versions$`),
    query: {
      cursor: (value) => UUID.test(value),
      limit: integerInRange(1, 100),
    },
  },
  {
    methods: new Set(["POST"]),
    path: new RegExp(`^/v1/admin/cancellation-guides/${UUID_PATH}/drafts$`),
    idempotencyKey: "required",
    body: "forbidden",
  },
  {
    methods: new Set(["POST"]),
    path: new RegExp(`^/v1/admin/cancellation-guides/${UUID_PATH}/retire$`),
    ifMatch: "required",
    idempotencyKey: "required",
    body: "forbidden",
  },
  {
    methods: new Set(["GET"]),
    path: new RegExp(`^/v1/admin/cancellation-guide-drafts/${UUID_PATH}$`),
  },
  {
    methods: new Set(["PATCH"]),
    path: new RegExp(`^/v1/admin/cancellation-guide-drafts/${UUID_PATH}$`),
    ifMatch: "required",
  },
  {
    methods: new Set(["POST"]),
    path: new RegExp(
      `^/v1/admin/cancellation-guide-drafts/${UUID_PATH}/publish$`,
    ),
    ifMatch: "required",
    idempotencyKey: "required",
    body: "forbidden",
  },
  {
    methods: new Set(["GET"]),
    path: /^\/v1\/admin\/cancellation-guide-feedback$/,
    query: {
      cursor: (value) => UUID.test(value),
      limit: integerInRange(1, 100),
    },
  },
  {
    methods: new Set(["POST"]),
    path: new RegExp(
      `^/v1/admin/cancellation-guide-feedback/${UUID_PATH}/review$`,
    ),
    ifMatch: "required",
    idempotencyKey: "required",
  },
  {
    methods: new Set(["GET"]),
    path: /^\/v1\/admin\/audit-events$/,
    query: {
      cursor: (value) => UUID.test(value),
      limit: integerInRange(1, 100),
    },
  },
  {
    methods: new Set(["POST"]),
    path: new RegExp(`^/v1/households/${UUID_PATH}/support-codes$`),
  },
  {
    methods: new Set(["DELETE"]),
    path: new RegExp(
      `^/v1/households/${UUID_PATH}/support-codes/${UUID_PATH}$`,
    ),
    ifMatch: "required",
  },
  {
    methods: new Set(["POST"]),
    path: /^\/v1\/support\/diagnostics\/resolve$/,
  },
  {
    methods: new Set(["GET"]),
    path: /^\/v1\/commitments$/,
    query: {
      householdId: (value) => UUID.test(value),
      cursor: (value) => CURSOR.test(value),
      limit: integerInRange(1, 100),
      includeArchived: (value) => /^(true|false)$/.test(value),
    },
    requiredQuery: ["householdId"],
  },
  {
    methods: new Set(["POST"]),
    path: /^\/v1\/commitments$/,
  },
  {
    methods: new Set(["POST"]),
    path: /^\/v1\/imports$/,
    idempotencyKey: "required",
    body: "multipart-import",
  },
  {
    methods: new Set(["GET"]),
    path: new RegExp(`^/v1/imports/${UUID_PATH}$`, "i"),
  },
  {
    methods: new Set(["POST"]),
    path: new RegExp(`^/v1/imports/${UUID_PATH}/confirm$`, "i"),
    ifMatch: "required",
    idempotencyKey: "required",
    body: "required",
  },
  {
    methods: new Set(["DELETE"]),
    path: new RegExp(`^/v1/imports/${UUID_PATH}$`, "i"),
    ifMatch: "required",
    body: "forbidden",
  },
  {
    methods: new Set(["GET"]),
    path: /^\/v1\/commitments\/[0-9a-f-]{36}$/i,
  },
  {
    methods: new Set(["PATCH"]),
    path: new RegExp(`^/v1/commitments/${UUID_PATH}/sharing$`),
    ifMatch: "required",
  },
  {
    methods: new Set(["PATCH", "DELETE"]),
    path: /^\/v1\/commitments\/[0-9a-f-]{36}$/i,
    ifMatch: "required",
  },
  {
    methods: new Set(["GET"]),
    path: /^\/v1\/commitments\/[0-9a-f-]{36}\/occurrences$/i,
    query: {
      from: (value) => LOCAL_DATE.test(value),
      to: (value) => LOCAL_DATE.test(value),
    },
    requiredQuery: ["from", "to"],
  },
  {
    methods: new Set(["GET"]),
    path: /^\/v1\/commitments\/upcoming$/,
    query: {
      householdId: (value) => UUID.test(value),
      from: (value) => LOCAL_DATE.test(value),
      to: (value) => LOCAL_DATE.test(value),
    },
    requiredQuery: ["householdId"],
  },
  {
    methods: new Set(["GET"]),
    path: /^\/v1\/merchants\/search$/,
    query: {
      q: (value) =>
        value === value.trim() &&
        !/[\r\n]/.test(value) &&
        SEARCH_TEXT.test(value),
      category: (value) => CATEGORY.test(value),
      limit: integerInRange(1, 20),
    },
    requiredQuery: ["q"],
  },
  {
    methods: new Set(["GET"]),
    path: /^\/v1\/dashboard\/summary$/,
    query: {
      householdId: (value) => UUID.test(value),
      month: (value) => YEAR_MONTH.test(value),
    },
    requiredQuery: ["householdId", "month"],
  },
  {
    methods: new Set(["GET"]),
    path: /^\/v1\/dashboard\/calendar$/,
    query: {
      householdId: (value) => UUID.test(value),
      from: (value) => LOCAL_DATE.test(value),
      to: (value) => LOCAL_DATE.test(value),
    },
    requiredQuery: ["householdId", "from", "to"],
  },
  {
    methods: new Set(["GET"]),
    path: /^\/v1\/notification-preferences$/,
  },
  {
    methods: new Set(["PUT"]),
    path: /^\/v1\/notification-preferences$/,
    ifMatch: "required",
  },
  {
    methods: new Set(["GET"]),
    path: new RegExp(`^/v1/households/${UUID_PATH}/reminder-rules$`, "i"),
  },
  {
    methods: new Set(["PUT"]),
    path: new RegExp(`^/v1/households/${UUID_PATH}/reminder-rules$`, "i"),
    ifMatch: "required",
  },
  {
    methods: new Set(["GET"]),
    path: new RegExp(`^/v1/commitments/${UUID_PATH}/reminder-rules$`, "i"),
  },
  {
    methods: new Set(["PUT"]),
    path: new RegExp(`^/v1/commitments/${UUID_PATH}/reminder-rules$`, "i"),
    ifMatch: "required",
  },
  {
    methods: new Set(["GET"]),
    path: /^\/v1\/notifications$/,
    query: {
      householdId: (value) => UUID.test(value),
      filter: (value) => NOTIFICATION_FILTER.test(value),
      cursor: (value) => CURSOR.test(value),
      limit: integerInRange(1, 100),
    },
    requiredQuery: ["householdId"],
  },
  {
    methods: new Set(["GET"]),
    path: new RegExp(`^/v1/notifications/${UUID_PATH}$`, "i"),
  },
  {
    methods: new Set(["PATCH"]),
    path: new RegExp(`^/v1/notifications/${UUID_PATH}$`, "i"),
    ifMatch: "required",
  },
  {
    methods: new Set(["GET"]),
    path: /^\/v1\/notification-diagnostics$/,
    query: {
      householdId: (value) => UUID.test(value),
    },
    requiredQuery: ["householdId"],
  },
  {
    methods: new Set(["GET"]),
    path: /^\/v1\/decisions\/inbox$/,
    query: {
      householdId: (value) => UUID.test(value),
      from: (value) => LOCAL_DATE.test(value),
      to: (value) => LOCAL_DATE.test(value),
      cursor: (value) => CURSOR.test(value),
      limit: integerInRange(1, 100),
    },
    requiredQuery: ["householdId"],
  },
  {
    methods: new Set(["POST"]),
    path: new RegExp(`^/v1/occurrences/${UUID_PATH}/decisions$`, "i"),
    idempotencyKey: "required",
  },
  {
    methods: new Set(["GET"]),
    path: new RegExp(`^/v1/commitments/${UUID_PATH}/cancellation-guide$`, "i"),
  },
  {
    methods: new Set(["GET"]),
    path: new RegExp(
      `^/v1/commitments/${UUID_PATH}/cancellation-attempts$`,
      "i",
    ),
    query: {
      householdId: (value) => UUID.test(value),
      cursor: (value) => CURSOR.test(value),
      limit: integerInRange(1, 100),
    },
    requiredQuery: ["householdId"],
  },
  {
    methods: new Set(["POST"]),
    path: new RegExp(
      `^/v1/commitments/${UUID_PATH}/cancellation-attempts$`,
      "i",
    ),
    idempotencyKey: "required",
  },
  {
    methods: new Set(["GET"]),
    path: new RegExp(`^/v1/cancellation-attempts/${UUID_PATH}$`, "i"),
  },
  {
    methods: new Set(["PATCH"]),
    path: new RegExp(`^/v1/cancellation-attempts/${UUID_PATH}$`, "i"),
    ifMatch: "required",
  },
  {
    methods: new Set(["POST"]),
    path: new RegExp(`^/v1/cancellation-attempts/${UUID_PATH}/verify$`, "i"),
    ifMatch: "required",
    idempotencyKey: "required",
  },
  {
    methods: new Set(["POST"]),
    path: new RegExp(`^/v1/cancellation-guides/${UUID_PATH}/feedback$`, "i"),
    idempotencyKey: "required",
  },
  {
    methods: new Set(["GET"]),
    path: /^\/v1\/savings$/,
    query: {
      householdId: (value) => UUID.test(value),
      state: (value) => SAVINGS_STATE.test(value),
      cursor: (value) => CURSOR.test(value),
      limit: integerInRange(1, 100),
    },
    requiredQuery: ["householdId"],
  },
];

export interface ResolvedBffRoute {
  path: string;
  search: string;
}

export function resolveBffRoute(
  method: string,
  pathname: string,
  searchParams: URLSearchParams,
): ResolvedBffRoute | null {
  const rawPath = pathname.slice("/api/bff".length);
  if (
    !rawPath.startsWith("/v1/") ||
    rawPath.includes("\\") ||
    rawPath.includes("%")
  ) {
    return null;
  }

  const rule = rules.find(
    (candidate) =>
      candidate.methods.has(method) && candidate.path.test(rawPath),
  );
  if (!rule) {
    return null;
  }

  const allowedQuery = rule.query ?? {};
  for (const key of searchParams.keys()) {
    const validator = allowedQuery[key];
    const values = searchParams.getAll(key);
    if (!validator || values.length !== 1 || !validator(values[0] ?? "")) {
      return null;
    }
  }
  if (
    rule.requiredQuery?.some((key) => searchParams.getAll(key).length !== 1)
  ) {
    return null;
  }

  const normalized = new URLSearchParams();
  for (const key of Object.keys(allowedQuery).sort()) {
    const value = searchParams.get(key);
    if (value !== null) {
      normalized.set(key, value.trim());
    }
  }

  const commitmentPath = rawPath.match(
    /^\/v1\/commitments\/([^/]+)(?:\/occurrences)?$/,
  );
  if (
    commitmentPath &&
    commitmentPath[1] !== "upcoming" &&
    !UUID.test(commitmentPath[1] ?? "")
  ) {
    return null;
  }

  return {
    path: rawPath,
    search: normalized.toString(),
  };
}

export function isSafeEntityTag(value: string | null) {
  return value === null || /^"(?:0|[1-9]\d{0,18})"$/.test(value);
}

export function acceptsEntityTag(method: string) {
  return method === "PUT" || method === "PATCH" || method === "DELETE";
}

export function isSafeIdempotencyKey(value: string | null) {
  return value === null || /^[A-Za-z0-9][A-Za-z0-9._~-]{15,99}$/.test(value);
}

export function resolveBffHeaderPolicy(
  method: string,
  pathname: string,
): BffHeaderPolicy | null {
  const rawPath = pathname.slice("/api/bff".length);
  if (
    !rawPath.startsWith("/v1/") ||
    rawPath.includes("\\") ||
    rawPath.includes("%")
  ) {
    return null;
  }
  const rule = rules.find(
    (candidate) =>
      candidate.methods.has(method) && candidate.path.test(rawPath),
  );
  if (!rule) {
    return null;
  }
  return {
    ifMatch: rule.ifMatch ?? "forbidden",
    idempotencyKey: rule.idempotencyKey ?? "forbidden",
  };
}

export function resolveBffBodyPolicy(
  method: string,
  pathname: string,
): BodyRequirement | null {
  const rawPath = pathname.slice("/api/bff".length);
  if (
    !rawPath.startsWith("/v1/") ||
    rawPath.includes("\\") ||
    rawPath.includes("%")
  ) {
    return null;
  }
  const rule = rules.find(
    (candidate) =>
      candidate.methods.has(method) && candidate.path.test(rawPath),
  );
  if (!rule) {
    return null;
  }
  return (
    rule.body ??
    (method === "GET" || method === "HEAD" || method === "DELETE"
      ? "forbidden"
      : "required")
  );
}
