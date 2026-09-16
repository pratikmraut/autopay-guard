import assert from "node:assert/strict";
import test from "node:test";
import { applyLocalLoginTheme } from "./apply-local-login-theme.mjs";

const environment = {
  AUTOPAY_GUARD_RUNTIME_MODE: "LOCAL",
  COMPOSE_PROJECT_NAME: "autopay-guard",
  AUTH_URL: "http://localhost:3000",
  AUTH_KEYCLOAK_ISSUER: "http://localhost:8081/realms/autopay-guard",
  KEYCLOAK_ADMIN_USERNAME: "fake-operator",
  KEYCLOAK_ADMIN_PASSWORD: "test-only-not-a-real-password",
};

function fixture({ installed = true, active = false } = {}) {
  let theme = active ? "autopay-guard" : "keycloak";
  const requests = [];
  return {
    requests,
    fetch: async (url, options) => {
      requests.push({ url, ...options });
      assert.equal(new URL(url).origin, "http://127.0.0.1:8081");
      assert.equal(options.redirect, "error");
      assert.ok(options.signal instanceof AbortSignal);
      if (url.endsWith("/token")) {
        return Response.json({ access_token: "fake-local-admin-token" });
      }
      if (url.endsWith("/serverinfo")) {
        return Response.json({
          themes: { login: installed ? [{ name: "autopay-guard" }] : [] },
        });
      }
      assert.equal(new URL(url).pathname, "/admin/realms/autopay-guard");
      if (options.method === "PUT") {
        assert.deepEqual(JSON.parse(options.body), {
          loginTheme: "autopay-guard",
        });
        theme = "autopay-guard";
        return new Response(null, { status: 204 });
      }
      return Response.json({
        realm: "autopay-guard",
        loginTheme: theme,
        registrationAllowed: true,
        bruteForceProtected: true,
      });
    },
  };
}

test("theme activation updates only loginTheme on the exact local realm", async () => {
  const mock = fixture();
  assert.deepEqual(await applyLocalLoginTheme(environment, mock.fetch), {
    theme: "autopay-guard",
    changed: true,
  });
  assert.equal(
    mock.requests.filter((request) => request.method === "PUT").length,
    1,
  );
});

test("already active theme is a read-only realm check", async () => {
  const mock = fixture({ active: true });
  assert.equal(
    (await applyLocalLoginTheme(environment, mock.fetch)).changed,
    false,
  );
  assert.equal(
    mock.requests.filter((request) => request.method === "PUT").length,
    0,
  );
});

test("missing theme fails before changing realm configuration", async () => {
  const mock = fixture({ installed: false });
  await assert.rejects(applyLocalLoginTheme(environment, mock.fetch), /Mount/);
  assert.equal(mock.requests.length, 2);
});

test("non-canonical and production environments fail before any network request", async () => {
  for (const overrides of [
    { AUTOPAY_GUARD_RUNTIME_MODE: "PRODUCTION" },
    { COMPOSE_PROJECT_NAME: "other-project" },
    { AUTH_URL: "https://guard.example.org" },
    { AUTH_KEYCLOAK_ISSUER: "http://localhost:8081/realms/master" },
    { KEYCLOAK_PORT: "8082" },
    { KEYCLOAK_ADMIN_PASSWORD: "" },
  ]) {
    await assert.rejects(
      applyLocalLoginTheme({ ...environment, ...overrides }, async () => {
        assert.fail(
          "No network request is permitted for invalid configuration.",
        );
      }),
    );
  }
});

test("failed responses do not expose bodies containing secrets", async () => {
  await assert.rejects(
    applyLocalLoginTheme(
      environment,
      async () =>
        new Response("private-diagnostic-must-not-be-printed", { status: 401 }),
    ),
    { message: "Local theme request failed (HTTP 401)." },
  );
});

for (const [stage, requestNumber] of [
  ["admin token", 1],
  ["theme inventory", 2],
  ["initial realm", 3],
  ["final realm", 5],
]) {
  test(`malformed successful ${stage} JSON does not expose response contents`, async () => {
    const mock = fixture();
    let count = 0;
    await assert.rejects(
      applyLocalLoginTheme(environment, async (url, options) => {
        count += 1;
        return count === requestNumber
          ? new Response("private-response-diagnostic-must-not-be-printed", {
              status: 200,
            })
          : mock.fetch(url, options);
      }),
      { message: "Local theme response was not valid JSON." },
    );
    assert.equal(count, requestNumber);
  });
}

test("transport failures do not expose provider URLs or private diagnostics", async () => {
  const mock = fixture();
  let count = 0;
  await assert.rejects(
    applyLocalLoginTheme(environment, async (url, options) => {
      count += 1;
      if (count === 2) {
        throw new Error(
          `private-transport-diagnostic ${url} ${options.headers.authorization}`,
        );
      }
      return mock.fetch(url, options);
    }),
    { message: "Local theme request could not be completed." },
  );
  assert.equal(count, 2);
});
