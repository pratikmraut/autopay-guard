import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const THEME = "autopay-guard";
const BASE = "http://127.0.0.1:8081";
const REALM_PATH = "/admin/realms/autopay-guard";

// This operator command changes presentation only. It must not reconcile users,
// passwords, roles, registration, SMTP, sessions, or any other realm settings.
export function validateLocalThemeEnvironment(environment) {
  const expected = {
    AUTOPAY_GUARD_RUNTIME_MODE: "LOCAL",
    COMPOSE_PROJECT_NAME: "autopay-guard",
    AUTH_URL: "http://localhost:3000",
    AUTH_KEYCLOAK_ISSUER: "http://localhost:8081/realms/autopay-guard",
  };
  for (const [name, value] of Object.entries(expected)) {
    if (environment[name] !== value) {
      throw new Error(`Local login theme requires canonical ${name}.`);
    }
  }
  if ((environment.KEYCLOAK_PORT ?? "8081") !== "8081") {
    throw new Error("Local login theme requires KEYCLOAK_PORT=8081.");
  }
  for (const name of ["KEYCLOAK_ADMIN_USERNAME", "KEYCLOAK_ADMIN_PASSWORD"]) {
    if (!environment[name]) throw new Error(`Missing ${name}.`);
  }
}

export async function applyLocalLoginTheme(
  environment = process.env,
  fetchRequest = fetch,
) {
  validateLocalThemeEnvironment(environment);
  const request = async (path, options = {}) => {
    let response;
    try {
      response = await fetchRequest(`${BASE}${path}`, {
        ...options,
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      // Transport errors can contain URLs or credential-bearing diagnostics.
      throw new Error("Local theme request could not be completed.");
    }
    if (!response.ok) {
      // Do not include response bodies, tokens or credentials in diagnostics.
      throw new Error(`Local theme request failed (HTTP ${response.status}).`);
    }
    return response;
  };
  const readJson = async (response) => {
    try {
      return await response.json();
    } catch {
      // JSON parse errors can quote the response body, even for an HTTP 200.
      throw new Error("Local theme response was not valid JSON.");
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
  const token = (await readJson(tokenResponse)).access_token;
  if (typeof token !== "string" || !token) {
    throw new Error("Local theme admin authentication returned no token.");
  }
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
  const server = await readJson(
    await request("/admin/serverinfo", { headers }),
  );
  if (!server.themes?.login?.some((theme) => theme.name === THEME)) {
    throw new Error(
      "Mount the AutoPay Guard login theme before activating it.",
    );
  }
  const before = await readJson(await request(REALM_PATH, { headers }));
  if (before.realm !== "autopay-guard") {
    throw new Error("Unexpected realm; no theme setting changed.");
  }
  if (before.loginTheme !== THEME) {
    await request(REALM_PATH, {
      method: "PUT",
      headers,
      body: JSON.stringify({ loginTheme: THEME }),
    });
  }
  const after = await readJson(await request(REALM_PATH, { headers }));
  if (after.realm !== "autopay-guard" || after.loginTheme !== THEME) {
    throw new Error("The local login theme could not be verified.");
  }
  return { theme: THEME, changed: before.loginTheme !== THEME };
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  try {
    const result = await applyLocalLoginTheme();
    console.log(
      `Local login theme ${result.changed ? "activated" : "already active"}: ${result.theme}. No user or credential reconciliation performed.`,
    );
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Theme update failed.",
    );
    process.exitCode = 1;
  }
}
