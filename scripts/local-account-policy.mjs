// Only used by loopback-only local orchestration. Never import this into a
// production deployment: Mailpit captures verification/recovery messages.
export function localRegistrationEnabled(value = "false") {
  if (value !== "true" && value !== "false") {
    throw new Error("LOCAL_SELF_REGISTRATION_ENABLED must be true or false.");
  }
  return value === "true";
}

export function localAccountRealmSettings(enabled) {
  return {
    loginTheme: "autopay-guard",
    registrationAllowed: enabled,
    registrationEmailAsUsername: true,
    verifyEmail: true,
    // Closing new registration must not lock existing users out of recovery.
    resetPasswordAllowed: true,
    loginWithEmailAllowed: true,
    rememberMe: false,
    editUsernameAllowed: false,
    duplicateEmailsAllowed: false,
    bruteForceProtected: true,
    passwordPolicy: "length(12)",
    smtpServer: {
      host: "mailpit",
      port: "1025",
      from: "no-reply@autopayguard.local",
      fromDisplayName: "AutoPay Guard local rehearsal",
      ssl: "false",
      starttls: "false",
      auth: "false",
    },
  };
}

export function localAccountPolicyMismatches(realm, enabled) {
  const expected = localAccountRealmSettings(enabled);
  return Object.entries(expected)
    .filter(([key, value]) =>
      key === "smtpServer"
        ? Object.keys(realm?.smtpServer ?? {}).length !==
            Object.keys(value).length ||
          Object.entries(value).some(([k, v]) => realm?.smtpServer?.[k] !== v)
        : realm?.[key] !== value,
    )
    .map(([key]) => key);
}

export function isNarrowLocalApiRole(role, expectedName, apiClientInternalId) {
  return (
    typeof role === "object" &&
    role !== null &&
    typeof role.id === "string" &&
    role.id.length > 0 &&
    role.name === expectedName &&
    role.clientRole === true &&
    role.containerId === apiClientInternalId &&
    // Composite roles can inherit privileges from other clients that are not
    // visible in the application's own five-role claim validation.
    role.composite === false
  );
}

export function localDefaultRoleChanges(composites, userRole) {
  if (!Array.isArray(composites) || !userRole?.id) {
    throw new Error("Invalid local default role configuration.");
  }
  // Deliberately independent of registrationAllowed: existing registered
  // users inherit USER through this default role and must retain it.
  return {
    remove: composites.filter((role) => role?.id !== userRole.id),
    add: composites.some((role) => role?.id === userRole.id) ? [] : [userRole],
  };
}
