import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const BASE = "http://127.0.0.1:8081";
const REALM_PATH = "/admin/realms/autopay-guard";

// A narrow operator command for an existing local database. It closes signup
// without reconciling accounts, changing passwords/roles, or resetting data.
export function validateLocalRegistrationEnvironment(environment) {
  const expected = {
    AUTOPAY_GUARD_RUNTIME_MODE: "LOCAL",
    COMPOSE_PROJECT_NAME: "autopay-guard",
    AUTH_URL: "http://localhost:3000",
    AUTH_KEYCLOAK_ISSUER: "http://localhost:8081/realms/autopay-guard",
    LOCAL_SELF_REGISTRATION_ENABLED: "false",
  };
  for (const [name, value] of Object.entries(expected)) {
    if (environment[name] !== value) {
      throw new Error(`Closing local registration requires canonical ${name}.`);
    }
  }
  if ((environment.KEYCLOAK_PORT ?? "8081") !== "8081") {
    throw new Error("Closing local registration requires KEYCLOAK_PORT=8081.");
  }
  for (const name of ["KEYCLOAK_ADMIN_USERNAME", "KEYCLOAK_ADMIN_PASSWORD"]) {
    if (!environment[name]) throw new Error(`Missing ${name}.`);
  }
}

export async function disableLocalRegistration(
  environment = process.env,
  fetchRequest = fetch,
) {
  validateLocalRegistrationEnvironment(environment);
  const request = async (path, options = {}) => {
    let response;
    try {
      response = await fetchRequest(`${BASE}${path}`, {
        ...options,
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new Error("Local registration request could not be completed.");
    }
    if (!response.ok) {
      throw new Error(
        `Local registration request failed (HTTP ${response.status}).`,
      );
    }
    return response;
  };
  const readJson = async (response) => {
    try {
      return await response.json();
    } catch {
      // HTTP bodies, JSON errors and transport diagnostics may contain secrets.
      throw new Error("Local registration response was not valid JSON.");
    }
  };
  const tokenResponse = await request(
    "/realms/master/protocol/openid-connect/token",
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: "admin-cli",
        grant_type: "password",
        username: environment.KEYCLOAK_ADMIN_USERNAME,
        password: environment.KEYCLOAK_ADMIN_PASSWORD,
      }),
    },
  );
  const token = (await readJson(tokenResponse))?.access_token;
  if (typeof token !== "string" || !token) {
    throw new Error(
      "Local registration admin authentication returned no token.",
    );
  }
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
  const before = await readJson(await request(REALM_PATH, { headers }));
  if (
    before?.realm !== "autopay-guard" ||
    typeof before.registrationAllowed !== "boolean"
  ) {
    throw new Error(
      "Unexpected local realm configuration; no setting changed.",
    );
  }
  if (before.registrationAllowed) {
    await request(REALM_PATH, {
      method: "PUT",
      headers,
      // Never send the fetched realm back: only this one setting is authorized.
      body: JSON.stringify({ registrationAllowed: false }),
    });
  }
  const after = await readJson(await request(REALM_PATH, { headers }));
  if (after?.realm !== "autopay-guard" || after.registrationAllowed !== false) {
    throw new Error("Closed local registration could not be verified.");
  }
  return { registrationAllowed: false, changed: before.registrationAllowed };
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  try {
    const result = await disableLocalRegistration();
    console.log(
      `Local registration ${result.changed ? "closed" : "already closed"}. Existing accounts, credentials, roles and recovery are unchanged. Restart API/web with registration disabled to apply their matching settings.`,
    );
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : "Local registration update failed.",
    );
    process.exitCode = 1;
  }
}
