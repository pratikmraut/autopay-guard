import assert from "node:assert/strict";
import test from "node:test";
import {
  isNarrowLocalApiRole,
  localAccountPolicyMismatches,
  localAccountRealmSettings,
  localDefaultRoleChanges,
  localRegistrationEnabled,
} from "./local-account-policy.mjs";

test("only exact local signup flags are accepted", () => {
  assert.equal(localRegistrationEnabled(), false);
  assert.equal(localRegistrationEnabled("true"), true);
  assert.equal(localRegistrationEnabled("false"), false);
  for (const value of ["TRUE", "yes", "", " true ", null]) {
    assert.throws(() => localRegistrationEnabled(value));
  }
});

test("local verification and recovery send only to the capture server", () => {
  const settings = localAccountRealmSettings(true);
  assert.equal(settings.loginTheme, "autopay-guard");
  assert.equal(settings.registrationAllowed, true);
  assert.equal(settings.verifyEmail, true);
  assert.equal(settings.resetPasswordAllowed, true);
  assert.equal(settings.smtpServer.host, "mailpit");
  assert.deepEqual(localAccountPolicyMismatches(settings, true), []);
  assert.deepEqual(
    localAccountPolicyMismatches({ ...settings, loginTheme: "keycloak" }, true),
    ["loginTheme"],
  );
  assert.deepEqual(
    localAccountPolicyMismatches({ ...settings, verifyEmail: false }, true),
    ["verifyEmail"],
  );
  assert.deepEqual(
    localAccountPolicyMismatches(
      {
        ...settings,
        smtpServer: { ...settings.smtpServer, host: "smtp.external.invalid" },
      },
      true,
    ),
    ["smtpServer"],
  );
  assert.deepEqual(
    localAccountPolicyMismatches(
      {
        ...settings,
        smtpServer: { ...settings.smtpServer, password: "unexpected" },
      },
      true,
    ),
    ["smtpServer"],
  );
});

test("turning signup off preserves recovery, verification, and brute force protection", () => {
  const settings = localAccountRealmSettings(false);
  assert.equal(settings.registrationAllowed, false);
  assert.equal(settings.resetPasswordAllowed, true);
  assert.equal(settings.verifyEmail, true);
  assert.equal(settings.bruteForceProtected, true);
  assert.equal(settings.duplicateEmailsAllowed, false);
  assert.deepEqual(localAccountPolicyMismatches(settings, false), []);
  assert.deepEqual(
    localAccountPolicyMismatches(
      { ...settings, resetPasswordAllowed: false },
      false,
    ),
    ["resetPasswordAllowed"],
  );
});

const userRole = {
  id: "fake-user-role-id",
  name: "USER",
  clientRole: true,
  containerId: "fake-api-client-id",
  composite: false,
};

test("closing registration does not revoke the existing registered-user role", () => {
  let composites = [];
  for (const enabled of [true, false, true, false]) {
    const settings = localAccountRealmSettings(enabled);
    assert.equal(settings.registrationAllowed, enabled);
    const changes = localDefaultRoleChanges(composites, userRole);
    composites = composites.filter((role) => !changes.remove.includes(role));
    composites.push(...changes.add);
    assert.deepEqual(composites, [userRole]);
  }
});

test("default-role reconciliation removes every other role but preserves USER", () => {
  const staffRole = {
    ...userRole,
    id: "fake-staff-role-id",
    name: "PRIVACY_ADMIN",
  };
  const otherClientRole = {
    ...userRole,
    id: "fake-other-role-id",
    containerId: "other-client",
    name: "manage-users",
  };
  assert.deepEqual(
    localDefaultRoleChanges([userRole, staffRole, otherClientRole], userRole),
    {
      remove: [staffRole, otherClientRole],
      add: [],
    },
  );
  assert.deepEqual(localDefaultRoleChanges([staffRole], userRole), {
    remove: [staffRole],
    add: [userRole],
  });
  assert.throws(() => localDefaultRoleChanges(null, userRole));
  assert.throws(() => localDefaultRoleChanges([], null));
});

test("managed API roles reject composite inheritance and malformed role metadata", () => {
  assert.equal(
    isNarrowLocalApiRole(userRole, "USER", "fake-api-client-id"),
    true,
  );
  for (const role of [
    null,
    undefined,
    { ...userRole, composite: true },
    { ...userRole, composite: undefined },
    { ...userRole, composite: "false" },
    { ...userRole, clientRole: false },
    { ...userRole, containerId: "other-client" },
    { ...userRole, name: "PRIVACY_ADMIN" },
    { ...userRole, id: "" },
  ]) {
    assert.equal(
      isNarrowLocalApiRole(role, "USER", "fake-api-client-id"),
      false,
    );
  }
});
