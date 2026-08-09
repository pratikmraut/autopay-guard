const REALM = "autopay-guard";
const API_CLIENT_ID = "autopay-guard-api";
const LOCAL_IDENTITY_SUFFIX = "@autopayguard.local";
const REQUEST_TIMEOUT_MS = 10_000;

const managedRoles = new Map([
  ["USER", "Normal AutoPay Guard user"],
  ["GUIDE_ADMIN", "Publishes and manages fictional local cancellation guides"],
  [
    "PRIVACY_ADMIN",
    "Processes fake-local privacy requests and simulated holds",
  ],
  ["AUDIT_READ", "Reads redacted fake-local audit events"],
  ["SUPPORT_READ", "Reads time-bound redacted fake-local support diagnostics"],
]);

const identityDefinitions = [
  {
    seedId: "11111111-1111-4111-8111-111111111111",
    expectedUsername: "demo@autopayguard.local",
    usernameEnvironment: "KEYCLOAK_FAKE_USER_USERNAME",
    passwordEnvironment: "KEYCLOAK_FAKE_USER_PASSWORD",
    firstName: "Demo",
    lastName: "User",
    roles: ["USER"],
  },
  {
    seedId: "22222222-2222-4222-8222-222222222222",
    expectedUsername: "member@autopayguard.local",
    usernameEnvironment: "KEYCLOAK_FAKE_MEMBER_USERNAME",
    passwordEnvironment: "KEYCLOAK_FAKE_MEMBER_PASSWORD",
    firstName: "Member",
    lastName: "User",
    roles: ["USER"],
  },
  {
    seedId: "55555555-5555-4555-8555-555555555555",
    expectedUsername: "foreign@autopayguard.local",
    usernameEnvironment: "KEYCLOAK_FAKE_FOREIGN_USERNAME",
    passwordEnvironment: "KEYCLOAK_FAKE_FOREIGN_PASSWORD",
    firstName: "Foreign",
    lastName: "User",
    roles: ["USER"],
  },
  {
    seedId: "33333333-3333-4333-8333-333333333333",
    expectedUsername: "admin@autopayguard.local",
    usernameEnvironment: "KEYCLOAK_FAKE_GUIDE_ADMIN_USERNAME",
    passwordEnvironment: "KEYCLOAK_FAKE_GUIDE_ADMIN_PASSWORD",
    firstName: "Admin",
    lastName: "Operator",
    roles: ["GUIDE_ADMIN"],
  },
  {
    seedId: "66666666-6666-4666-8666-666666666666",
    expectedUsername: "privacy-admin@autopayguard.local",
    usernameEnvironment: "KEYCLOAK_FAKE_PRIVACY_ADMIN_USERNAME",
    passwordEnvironment: "KEYCLOAK_FAKE_PRIVACY_ADMIN_PASSWORD",
    firstName: "Privacy",
    lastName: "Operator",
    roles: ["PRIVACY_ADMIN"],
  },
  {
    seedId: "77777777-7777-4777-8777-777777777777",
    expectedUsername: "audit-reader@autopayguard.local",
    usernameEnvironment: "KEYCLOAK_FAKE_AUDIT_READ_USERNAME",
    passwordEnvironment: "KEYCLOAK_FAKE_AUDIT_READ_PASSWORD",
    firstName: "Audit",
    lastName: "Reader",
    roles: ["AUDIT_READ"],
  },
  {
    seedId: "88888888-8888-4888-8888-888888888888",
    expectedUsername: "deletion@autopayguard.local",
    usernameEnvironment: "KEYCLOAK_FAKE_DELETION_USERNAME",
    passwordEnvironment: "KEYCLOAK_FAKE_DELETION_PASSWORD",
    firstName: "Disposable",
    lastName: "User",
    roles: ["USER"],
  },
  {
    seedId: "44444444-4444-4444-8444-444444444444",
    expectedUsername: "support@autopayguard.local",
    usernameEnvironment: "KEYCLOAK_FAKE_SUPPORT_USERNAME",
    passwordEnvironment: "KEYCLOAK_FAKE_SUPPORT_PASSWORD",
    firstName: "Support",
    lastName: "Operator",
    roles: ["SUPPORT_READ"],
  },
];

const requiredEnvironment = [
  "KEYCLOAK_ADMIN_USERNAME",
  "KEYCLOAK_ADMIN_PASSWORD",
  ...identityDefinitions.flatMap((identity) => [
    identity.usernameEnvironment,
    identity.passwordEnvironment,
  ]),
];

for (const name of requiredEnvironment) {
  if (!process.env[name]) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
}

const identities = identityDefinitions.map((definition) => {
  const username = process.env[definition.usernameEnvironment];
  const password = process.env[definition.passwordEnvironment];

  if (
    username !== definition.expectedUsername ||
    username !== username.toLowerCase() ||
    username.length > 320 ||
    !username.endsWith(LOCAL_IDENTITY_SUFFIX) ||
    !/^[a-z0-9][a-z0-9._+-]*@autopayguard\.local$/.test(username)
  ) {
    throw new Error(
      `${definition.usernameEnvironment} must remain the reserved fake-local identity ${definition.expectedUsername}.`,
    );
  }
  if (
    password.length < 32 ||
    password.includes("generated-by-make-bootstrap") ||
    password.includes("change-me")
  ) {
    throw new Error(
      `${definition.passwordEnvironment} must contain at least 32 characters of local-only secret data.`,
    );
  }

  return { ...definition, username, password };
});

if (
  new Set(identities.map((identity) => identity.username)).size !==
  identities.length
) {
  throw new Error("Every fake Keycloak identity must use a distinct username.");
}
if (
  new Set(identities.map((identity) => identity.password)).size !==
  identities.length
) {
  throw new Error(
    "Every fake Keycloak identity must use an independent generated password.",
  );
}

const port = process.env.KEYCLOAK_PORT ?? "8081";
const parsedPort = Number.parseInt(port, 10);

if (!/^\d+$/.test(port) || parsedPort < 1 || parsedPort > 65535) {
  throw new Error("KEYCLOAK_PORT must be a valid TCP port.");
}

const baseUrl = `http://127.0.0.1:${parsedPort}`;

const readJson = async (response, description) => {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error(`${description} did not return JSON.`);
  }

  return response.json();
};

const tokenResponse = await fetch(
  `${baseUrl}/realms/master/protocol/openid-connect/token`,
  {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: "admin-cli",
      grant_type: "password",
      username: process.env.KEYCLOAK_ADMIN_USERNAME,
      password: process.env.KEYCLOAK_ADMIN_PASSWORD,
    }),
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  },
);

if (!tokenResponse.ok) {
  throw new Error(
    `Keycloak rejected the local admin login (HTTP ${tokenResponse.status}).`,
  );
}

const tokenPayload = await readJson(tokenResponse, "Keycloak admin login");
if (
  typeof tokenPayload !== "object" ||
  tokenPayload === null ||
  typeof tokenPayload.access_token !== "string" ||
  tokenPayload.access_token.length === 0
) {
  throw new Error("Keycloak returned an invalid admin token response.");
}

const adminRequest = async (
  path,
  { method = "GET", body, description, expectedStatuses = [200] } = {},
) => {
  const headers = new Headers({
    authorization: `Bearer ${tokenPayload.access_token}`,
    accept: "application/json",
  });
  if (body !== undefined) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!expectedStatuses.includes(response.status)) {
    throw new Error(
      `Keycloak rejected ${description} (HTTP ${response.status}).`,
    );
  }
  return response;
};

const realmAdminPath = `/admin/realms/${encodeURIComponent(REALM)}`;

const realmResponse = await adminRequest(realmAdminPath, {
  description: "the fake-local realm configuration lookup",
});
const realmRepresentation = await readJson(
  realmResponse,
  "Keycloak fake-local realm configuration lookup",
);
const identityProvidersResponse = await adminRequest(
  `${realmAdminPath}/identity-provider/instances`,
  { description: "the fake-local identity-provider inventory lookup" },
);
const identityProviders = await readJson(
  identityProvidersResponse,
  "Keycloak fake-local identity-provider inventory lookup",
);
const realmPolicyMismatches = [];
for (const [property, expected] of [
  ["registrationAllowed", false],
  ["resetPasswordAllowed", false],
  ["rememberMe", false],
  ["editUsernameAllowed", false],
  ["duplicateEmailsAllowed", false],
  ["bruteForceProtected", true],
]) {
  if (realmRepresentation?.[property] !== expected) {
    realmPolicyMismatches.push(property);
  }
}
if (!Array.isArray(identityProviders) || identityProviders.length > 0) {
  realmPolicyMismatches.push("identityProviders");
}
if (realmPolicyMismatches.length > 0) {
  throw new Error(
    `The fake-local realm does not preserve its closed-registration identity policy: ${realmPolicyMismatches.join(", ")}.`,
  );
}

const clientsUrl = new URL(`${baseUrl}${realmAdminPath}/clients`);
clientsUrl.searchParams.set("clientId", API_CLIENT_ID);
clientsUrl.searchParams.set("search", "true");
const clientsResponse = await adminRequest(
  `${clientsUrl.pathname}${clientsUrl.search}`,
  {
    description: "the API client lookup",
  },
);
const clients = await readJson(clientsResponse, "Keycloak API client lookup");
if (!Array.isArray(clients)) {
  throw new Error("Keycloak returned an invalid API client search.");
}
const exactApiClients = clients.filter(
  (client) => client?.clientId === API_CLIENT_ID,
);
if (
  exactApiClients.length !== 1 ||
  typeof exactApiClients[0]?.id !== "string" ||
  exactApiClients[0].id.length === 0
) {
  throw new Error("The fake-local API client is not ready.");
}
const apiClientInternalId = exactApiClients[0].id;
const apiClientResponse = await adminRequest(
  `${realmAdminPath}/clients/${encodeURIComponent(apiClientInternalId)}`,
  { description: "the API client configuration lookup" },
);
const apiClient = await readJson(
  apiClientResponse,
  "Keycloak API client configuration lookup",
);
if (
  typeof apiClient !== "object" ||
  apiClient === null ||
  apiClient.enabled !== true ||
  apiClient.bearerOnly !== true ||
  apiClient.publicClient !== false ||
  apiClient.standardFlowEnabled !== false ||
  apiClient.implicitFlowEnabled !== false ||
  apiClient.directAccessGrantsEnabled !== false ||
  apiClient.serviceAccountsEnabled !== false
) {
  throw new Error("The fake-local API client does not preserve its closed grant policy.");
}

const webClientId = process.env.KEYCLOAK_WEB_CLIENT_ID ?? "autopay-guard-web";
if (webClientId !== "autopay-guard-web") {
  throw new Error(
    "The fake-local web client must retain its exact application identifier.",
  );
}
const webClientsUrl = new URL(`${baseUrl}${realmAdminPath}/clients`);
webClientsUrl.searchParams.set("clientId", webClientId);
webClientsUrl.searchParams.set("search", "true");
const webClientsResponse = await adminRequest(
  `${webClientsUrl.pathname}${webClientsUrl.search}`,
  { description: "the web client lookup" },
);
const webClients = await readJson(
  webClientsResponse,
  "Keycloak web client lookup",
);
const exactWebClients = Array.isArray(webClients)
  ? webClients.filter((client) => client?.clientId === webClientId)
  : [];
if (
  exactWebClients.length !== 1 ||
  typeof exactWebClients[0]?.id !== "string" ||
  exactWebClients[0].id.length === 0
) {
  throw new Error("The fake-local web client is not ready.");
}
const webClientInternalId = exactWebClients[0].id;
const webClientResponse = await adminRequest(
  `${realmAdminPath}/clients/${encodeURIComponent(webClientInternalId)}`,
  { description: "the web client configuration lookup" },
);
const webClient = await readJson(
  webClientResponse,
  "Keycloak web client configuration lookup",
);
const expectedWebOrigin = `http://localhost:${process.env.WEB_PORT ?? "3000"}`;
const expectedRedirectUri = `${expectedWebOrigin}/api/auth/callback/keycloak`;
if (
  typeof webClient !== "object" ||
  webClient === null ||
  webClient.enabled !== true ||
  webClient.bearerOnly !== false ||
  webClient.publicClient !== false ||
  webClient.standardFlowEnabled !== true ||
  webClient.implicitFlowEnabled !== false ||
  webClient.directAccessGrantsEnabled !== false ||
  webClient.serviceAccountsEnabled !== false ||
  webClient.rootUrl !== expectedWebOrigin ||
  webClient.baseUrl !== expectedWebOrigin ||
  webClient.adminUrl !== expectedWebOrigin ||
  !Array.isArray(webClient.redirectUris) ||
  webClient.redirectUris.length !== 1 ||
  webClient.redirectUris[0] !== expectedRedirectUri ||
  !Array.isArray(webClient.webOrigins) ||
  webClient.webOrigins.length !== 1 ||
  webClient.webOrigins[0] !== expectedWebOrigin ||
  webClient.attributes?.["pkce.code.challenge.method"] !== "S256" ||
  webClient.attributes?.["post.logout.redirect.uris"] !== `${expectedWebOrigin}/*`
) {
  throw new Error("The fake-local web client does not preserve its closed grant policy.");
}
const apiClientRolesPath = `${realmAdminPath}/clients/${encodeURIComponent(apiClientInternalId)}/roles`;

const getRole = async (roleName) => {
  const response = await adminRequest(
    `${apiClientRolesPath}/${encodeURIComponent(roleName)}`,
    {
      description: "the local API client-role lookup",
      expectedStatuses: [200, 404],
    },
  );
  return response.status === 404
    ? null
    : readJson(response, "Keycloak API client-role lookup");
};

const ensureRole = async (roleName, description) => {
  let role = await getRole(roleName);
  if (role === null) {
    await adminRequest(apiClientRolesPath, {
      method: "POST",
      body: { name: roleName, description },
      description: "the local API client-role creation",
      expectedStatuses: [201, 204],
    });
    role = await getRole(roleName);
  } else if (role.description !== description) {
    await adminRequest(
      `${apiClientRolesPath}/${encodeURIComponent(roleName)}`,
      {
        method: "PUT",
        body: { name: roleName, description },
        description: "the local API client-role update",
        expectedStatuses: [204],
      },
    );
    role = await getRole(roleName);
  }

  if (
    typeof role !== "object" ||
    role === null ||
    typeof role.id !== "string" ||
    role.id.length === 0 ||
    role.name !== roleName ||
    role.description !== description ||
    role.clientRole !== true ||
    role.containerId !== apiClientInternalId
  ) {
    throw new Error(
      `The ${roleName} fake-local API client role is not ready.`,
    );
  }
  return role;
};

const roleRepresentations = new Map();
for (const [roleName, description] of managedRoles) {
  roleRepresentations.set(roleName, await ensureRole(roleName, description));
}

const removeLegacyRealmRole = async (roleName) => {
  const rolePath = `${realmAdminPath}/roles/${encodeURIComponent(roleName)}`;
  const response = await adminRequest(rolePath, {
    description: "the legacy local realm-role lookup",
    expectedStatuses: [200, 404],
  });
  if (response.status === 200) {
    await adminRequest(rolePath, {
      method: "DELETE",
      description: "the legacy local realm-role removal",
      expectedStatuses: [204],
    });
  }
};

for (const roleName of managedRoles.keys()) {
  await removeLegacyRealmRole(roleName);
}

const getUserById = async (userId) => {
  const response = await adminRequest(
    `${realmAdminPath}/users/${encodeURIComponent(userId)}`,
    {
      description: "the fake-local identity lookup",
      expectedStatuses: [200, 404],
    },
  );
  return response.status === 404
    ? null
    : readJson(response, "Keycloak fake-local identity lookup");
};

const findUserByUsername = async (username) => {
  const usersUrl = new URL(`${baseUrl}${realmAdminPath}/users`);
  usersUrl.searchParams.set("username", username);
  usersUrl.searchParams.set("exact", "true");
  usersUrl.searchParams.set("briefRepresentation", "false");

  const response = await adminRequest(
    `${usersUrl.pathname}${usersUrl.search}`,
    {
      description: "the fake-local identity search",
    },
  );
  const users = await readJson(response, "Keycloak fake-local identity search");
  if (!Array.isArray(users)) {
    throw new Error("Keycloak returned an invalid fake-local identity search.");
  }

  const exactUsers = users.filter((user) => user?.username === username);
  if (exactUsers.length > 1) {
    throw new Error("Keycloak returned duplicate fake-local identities.");
  }
  return exactUsers[0] ?? null;
};

const getApiClientMappings = async (userId) => {
  const response = await adminRequest(
    `${realmAdminPath}/users/${encodeURIComponent(userId)}/role-mappings/clients/${encodeURIComponent(apiClientInternalId)}`,
    {
      description: "the fake-local identity API role-mapping lookup",
    },
  );
  const mappings = await readJson(
    response,
    "Keycloak fake-local identity API role-mapping lookup",
  );
  if (!Array.isArray(mappings)) {
    throw new Error("Keycloak returned invalid fake-local API role mappings.");
  }
  return mappings;
};

const reconcileManagedRoleMappings = async (userId, expectedRoleNames) => {
  const currentMappings = await getApiClientMappings(userId);
  const currentManagedNames = new Set(
    currentMappings
      .map((mapping) => mapping?.name)
      .filter((name) => managedRoles.has(name)),
  );
  const expectedNames = new Set(expectedRoleNames);

  const rolesToRemove = [...currentManagedNames]
    .filter((roleName) => !expectedNames.has(roleName))
    .map((roleName) => roleRepresentations.get(roleName));
  if (rolesToRemove.length > 0) {
    await adminRequest(
      `${realmAdminPath}/users/${encodeURIComponent(userId)}/role-mappings/clients/${encodeURIComponent(apiClientInternalId)}`,
      {
        method: "DELETE",
        body: rolesToRemove,
        description: "the fake-local identity API role-mapping removal",
        expectedStatuses: [204],
      },
    );
  }

  const rolesToAdd = [...expectedNames]
    .filter((roleName) => !currentManagedNames.has(roleName))
    .map((roleName) => roleRepresentations.get(roleName));
  if (rolesToAdd.length > 0) {
    await adminRequest(
      `${realmAdminPath}/users/${encodeURIComponent(userId)}/role-mappings/clients/${encodeURIComponent(apiClientInternalId)}`,
      {
        method: "POST",
        body: rolesToAdd,
        description: "the fake-local identity API role-mapping creation",
        expectedStatuses: [204],
      },
    );
  }
};

const validateIdentity = async (userId, identity) => {
  const user = await getUserById(userId);
  if (
    typeof user !== "object" ||
    user === null ||
    user.username !== identity.username ||
    user.email !== identity.username ||
    user.enabled !== true ||
    user.emailVerified !== true ||
    user.firstName !== identity.firstName ||
    user.lastName !== identity.lastName ||
    !Array.isArray(user.requiredActions) ||
    user.requiredActions.length !== 0
  ) {
    throw new Error("A reserved fake-local Keycloak identity is not ready.");
  }

  const credentialsResponse = await adminRequest(
    `${realmAdminPath}/users/${encodeURIComponent(userId)}/credentials`,
    {
      description: "the fake-local identity credential lookup",
    },
  );
  const credentials = await readJson(
    credentialsResponse,
    "Keycloak fake-local identity credential lookup",
  );
  if (
    !Array.isArray(credentials) ||
    !credentials.some((credential) => credential?.type === "password")
  ) {
    throw new Error(
      "A reserved fake-local Keycloak password credential is missing.",
    );
  }

  const mappings = await getApiClientMappings(userId);
  const actualApplicationRoles = mappings
    .map((mapping) => mapping?.name)
    .sort();
  const expectedApplicationRoles = [...identity.roles].sort();
  if (
    actualApplicationRoles.some(
      (roleName) => typeof roleName !== "string" || roleName.length === 0,
    ) ||
    actualApplicationRoles.length !== expectedApplicationRoles.length ||
    actualApplicationRoles.some(
      (roleName, index) => roleName !== expectedApplicationRoles[index],
    )
  ) {
    throw new Error(
      "A reserved fake-local Keycloak identity has an unexpected application role.",
    );
  }
};

const reconcileIdentity = async (identity) => {
  const seedUser = await getUserById(identity.seedId);
  const usernameUser = await findUserByUsername(identity.username);
  if (
    seedUser !== null &&
    usernameUser !== null &&
    seedUser.id !== usernameUser.id
  ) {
    throw new Error(
      "A reserved fake-local Keycloak identity conflicts with its stable seed identifier.",
    );
  }

  let user = seedUser ?? usernameUser;
  if (user === null) {
    await adminRequest(`${realmAdminPath}/users`, {
      method: "POST",
      body: {
        id: identity.seedId,
        username: identity.username,
        email: identity.username,
        emailVerified: true,
        enabled: true,
        firstName: identity.firstName,
        lastName: identity.lastName,
        requiredActions: [],
      },
      description: "the fake-local identity creation",
      expectedStatuses: [201, 204],
    });
    user = await getUserById(identity.seedId);
    if (user === null) {
      user = await findUserByUsername(identity.username);
    }
  }

  if (
    typeof user !== "object" ||
    user === null ||
    typeof user.id !== "string" ||
    user.id.length === 0
  ) {
    throw new Error(
      "Keycloak did not create the reserved fake-local identity.",
    );
  }

  await adminRequest(`${realmAdminPath}/users/${encodeURIComponent(user.id)}`, {
    method: "PUT",
    body: {
      username: identity.username,
      email: identity.username,
      emailVerified: true,
      enabled: true,
      firstName: identity.firstName,
      lastName: identity.lastName,
      requiredActions: [],
    },
    description: "the fake-local identity update",
    expectedStatuses: [204],
  });
  await adminRequest(
    `${realmAdminPath}/users/${encodeURIComponent(user.id)}/reset-password`,
    {
      method: "PUT",
      body: {
        type: "password",
        value: identity.password,
        temporary: false,
      },
      description: "the fake-local identity credential reconciliation",
      expectedStatuses: [204],
    },
  );
  await reconcileManagedRoleMappings(user.id, identity.roles);
  await validateIdentity(user.id, identity);
};

for (const identity of identities) {
  await reconcileIdentity(identity);
}

console.log(
  `Reconciled and validated ${identities.length} reserved fake-local Keycloak identities and five narrow API client roles.`,
);
