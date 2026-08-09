import { describe, expect, it } from "vitest";

import { APP_CLIENT_ROLES, extractAppClientRoles } from "@/lib/app-roles";

describe("extractAppClientRoles", () => {
  it.each(APP_CLIENT_ROLES)("returns the one exact %s role", (role) => {
    expect(
      extractAppClientRoles(
        token({
          resource_access: {
            "autopay-guard-api": { roles: [role] },
          },
        }),
      ),
    ).toEqual([role]);
  });

  it.each([
    { roles: ["USER", "UNKNOWN_ADMIN"] },
    { roles: ["USER", "SUPPORT_READ"] },
    { roles: ["USER", "USER"] },
    { roles: ["user"] },
    { roles: ["default-roles-autopay-guard"] },
    { roles: [] },
  ])("rejects a non-exact API-client role set: $roles", ({ roles }) => {
    expect(
      extractAppClientRoles(
        token({
          resource_access: {
            "autopay-guard-api": { roles },
          },
        }),
      ),
    ).toEqual([]);
  });

  it("fails closed for malformed tokens and claims", () => {
    expect(extractAppClientRoles(undefined)).toEqual([]);
    expect(extractAppClientRoles("not-a-jwt")).toEqual([]);
    expect(
      extractAppClientRoles(
        token({
          resource_access: {
            "autopay-guard-api": { roles: "USER" },
          },
        }),
      ),
    ).toEqual([]);
    expect(
      extractAppClientRoles(
        token({
          resource_access: {
            "autopay-guard-api": { roles: [7] },
          },
        }),
      ),
    ).toEqual([]);
  });

  it("ignores realm and other-client roles", () => {
    expect(
      extractAppClientRoles(
        token({
          realm_access: { roles: ["USER", "GUIDE_ADMIN"] },
          resource_access: {
            "autopay-guard-web": { roles: ["PRIVACY_ADMIN"] },
          },
        }),
      ),
    ).toEqual([]);
  });
});

function token(payload: unknown) {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode(payload)}.signature`;
}
