import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  environment: vi.fn(),
  sessionUser: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ signIn: vi.fn(), auth: vi.fn() }));
vi.mock("@/lib/env", () => ({ getServerEnvironment: mocks.environment }));
vi.mock("@/lib/session", () => ({ getOptionalSessionUser: mocks.sessionUser }));

import SignupPage from "./page";

const localEnvironment = {
  AUTOPAY_GUARD_RUNTIME_MODE: "LOCAL",
  AUTH_URL: "http://localhost:3000",
  AUTH_KEYCLOAK_ISSUER: "http://localhost:8081/realms/autopay-guard",
  AUTH_SELF_REGISTRATION_ENABLED: "false",
};

describe("closed local signup page", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.environment.mockReturnValue(localEnvironment);
    mocks.sessionUser.mockResolvedValue(null);
  });

  it("offers the existing saved demo but no registration form", async () => {
    render(await SignupPage());
    expect(
      screen.getByRole("heading", { name: "Registration is not open" }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Open demo workspace" }),
    ).toHaveAttribute("href", "/signin");
    expect(screen.getByText(/New accounts are disabled/)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Create account securely" }),
    ).not.toBeInTheDocument();
    expect(mocks.sessionUser).not.toHaveBeenCalled();
  });

  it("preserves only the explicitly enabled provider-owned rehearsal", async () => {
    mocks.environment.mockReturnValue({
      ...localEnvironment,
      AUTH_SELF_REGISTRATION_ENABLED: "true",
    });
    render(await SignupPage());
    expect(
      screen.getByRole("button", { name: "Create account securely" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("link", { name: "Open demo workspace" }),
    ).not.toBeInTheDocument();
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });

  it("does not advertise the local account in a non-local environment", async () => {
    mocks.environment.mockReturnValue({
      ...localEnvironment,
      AUTOPAY_GUARD_RUNTIME_MODE: "PRODUCTION",
    });
    render(await SignupPage());
    expect(
      screen.queryByRole("link", { name: "Open demo workspace" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Registration is not open" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Create account securely" }),
    ).not.toBeInTheDocument();
  });
});
