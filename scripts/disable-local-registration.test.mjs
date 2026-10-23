import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { disableLocalRegistration } from "./disable-local-registration.mjs";

const environment = {
  AUTOPAY_GUARD_RUNTIME_MODE: "LOCAL",
  COMPOSE_PROJECT_NAME: "autopay-guard",
  AUTH_URL: "http://localhost:3000",
  AUTH_KEYCLOAK_ISSUER: "http://localhost:8081/realms/autopay-guard",
  LOCAL_SELF_REGISTRATION_ENABLED: "false",
  KEYCLOAK_ADMIN_USERNAME: "fake-operator",
  KEYCLOAK_ADMIN_PASSWORD: "test-only-not-a-real-password",
};

function fixture({ enabled = true, ignoreUpdate = false } = {}) {
  const realm = {
    realm: "autopay-guard",
    registrationAllowed: enabled,
    resetPasswordAllowed: true,
    verifyEmail: true,
    bruteForceProtected: true,
    loginTheme: "autopay-guard",
    smtpServer: { host: "mailpit", port: "1025" },
    defaultRole: { name: "default-roles-autopay-guard" },
  };
  const requests = [];
  return {
    realm,
    requests,
    fetch: async (url, options) => {
      requests.push({ url, ...options });
      assert.equal(new URL(url).origin, "http://127.0.0.1:8081");
      assert.equal(options.redirect, "error");
      assert.ok(options.signal instanceof AbortSignal);
      if (url.endsWith("/token")) {
        assert.equal(options.method, "POST");
        return Response.json({ access_token: "fake-local-admin-token" });
      }
      assert.equal(new URL(url).pathname, "/admin/realms/autopay-guard");
      if (options.method === "PUT") {
        assert.deepEqual(JSON.parse(options.body), {
          registrationAllowed: false,
        });
        if (!ignoreUpdate) realm.registrationAllowed = false;
        return new Response(null, { status: 204 });
      }
      assert.equal(options.method, undefined);
      return Response.json(realm);
    },
  };
}

test("closing signup writes only registrationAllowed and preserves other settings", async () => {
  const mock = fixture();
  const initial = structuredClone(mock.realm);
  assert.deepEqual(await disableLocalRegistration(environment, mock.fetch), {
    registrationAllowed: false,
    changed: true,
  });
  assert.deepEqual(mock.realm, { ...initial, registrationAllowed: false });
  assert.equal(
    mock.requests.filter((request) => request.method === "PUT").length,
    1,
  );
  assert.equal(mock.requests.length, 4);
});

test("already closed signup is idempotent and performs no realm writes", async () => {
  const mock = fixture({ enabled: false });
  assert.deepEqual(await disableLocalRegistration(environment, mock.fetch), {
    registrationAllowed: false,
    changed: false,
  });
  assert.equal(
    mock.requests.filter((request) => request.method === "PUT").length,
    0,
  );
  assert.equal(mock.requests.length, 3);
});

test("non-local, non-canonical, absent or enabled signup flags fail before network access", async () => {
  for (const overrides of [
    { AUTOPAY_GUARD_RUNTIME_MODE: "PRODUCTION" },
    { COMPOSE_PROJECT_NAME: "other-project" },
    { AUTH_URL: "https://guard.example.org" },
    { AUTH_URL: "http://localhost:3000/" },
    { AUTH_KEYCLOAK_ISSUER: "http://localhost:8081/realms/master" },
    { KEYCLOAK_PORT: "8082" },
    { LOCAL_SELF_REGISTRATION_ENABLED: "true" },
    { LOCAL_SELF_REGISTRATION_ENABLED: undefined },
    { LOCAL_SELF_REGISTRATION_ENABLED: false },
    { KEYCLOAK_ADMIN_USERNAME: "" },
    { KEYCLOAK_ADMIN_PASSWORD: "" },
  ]) {
    await assert.rejects(
      disableLocalRegistration({ ...environment, ...overrides }, async () => {
        assert.fail("Invalid configuration must not make a network request.");
      }),
    );
  }
});

test("an unexpected realm or malformed registration setting is not changed", async () => {
  for (const overrides of [
    { realm: "master" },
    { registrationAllowed: "true" },
    { registrationAllowed: undefined },
  ]) {
    const mock = fixture();
    Object.assign(mock.realm, overrides);
    await assert.rejects(disableLocalRegistration(environment, mock.fetch), {
      message: "Unexpected local realm configuration; no setting changed.",
    });
    assert.equal(mock.requests.length, 2);
  }
});

test("a setting that did not persist is not reported as success", async () => {
  const mock = fixture({ ignoreUpdate: true });
  await assert.rejects(disableLocalRegistration(environment, mock.fetch), {
    message: "Closed local registration could not be verified.",
  });
});

test("failed HTTP responses do not expose provider response bodies", async () => {
  await assert.rejects(
    disableLocalRegistration(
      environment,
      async () =>
        new Response("private-diagnostic-must-not-be-printed", { status: 401 }),
    ),
    { message: "Local registration request failed (HTTP 401)." },
  );
});

test("missing authentication token has a safe diagnostic", async () => {
  await assert.rejects(
    disableLocalRegistration(environment, async () =>
      Response.json({ access_token: null }),
    ),
    { message: "Local registration admin authentication returned no token." },
  );
});

for (const [stage, requestNumber] of [
  ["admin token", 1],
  ["initial realm", 2],
  ["final realm", 4],
]) {
  test(`malformed ${stage} JSON does not expose its contents`, async () => {
    const mock = fixture();
    let count = 0;
    await assert.rejects(
      disableLocalRegistration(environment, async (url, options) => {
        count += 1;
        return count === requestNumber
          ? new Response("private-response-diagnostic-must-not-be-printed", {
              status: 200,
            })
          : mock.fetch(url, options);
      }),
      { message: "Local registration response was not valid JSON." },
    );
    assert.equal(count, requestNumber);
  });
}

test("transport errors do not expose provider URLs or authorization diagnostics", async () => {
  const mock = fixture();
  let count = 0;
  await assert.rejects(
    disableLocalRegistration(environment, async (url, options) => {
      count += 1;
      if (count === 2)
        throw new Error(
          `private-diagnostic ${url} ${options.headers.authorization}`,
        );
      return mock.fetch(url, options);
    }),
    { message: "Local registration request could not be completed." },
  );
  assert.equal(count, 2);
});

test("fresh local configuration defaults to closed registration everywhere", () => {
  const read = (path) =>
    readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  assert.match(
    read(".env.example"),
    /^LOCAL_SELF_REGISTRATION_ENABLED=false$/m,
  );
  const bootstrap = read("scripts/bootstrap.sh");
  assert.match(bootstrap, /^LOCAL_SELF_REGISTRATION_ENABLED=false$/m);
  assert.match(bootstrap, /LOCAL_SELF_REGISTRATION_ENABLED \\\r?\n\s+"false"/);
  assert.equal(
    JSON.parse(read("infra/local/keycloak/autopay-guard-realm.json"))
      .registrationAllowed,
    false,
  );
  for (const path of ["compose.yaml", "scripts/dev.sh", "scripts/quality.sh"]) {
    const source = read(path);
    assert.ok(
      source.includes("${LOCAL_SELF_REGISTRATION_ENABLED:-false}"),
      path,
    );
    assert.ok(
      !source.includes("${LOCAL_SELF_REGISTRATION_ENABLED:-true}"),
      path,
    );
  }
});
