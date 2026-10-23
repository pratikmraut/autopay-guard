import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  environment: vi.fn(),
  sessionUser: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ signIn: mocks.signIn, auth: vi.fn() }));
vi.mock("@/lib/env", () => ({ getServerEnvironment: mocks.environment }));
vi.mock("@/lib/session", () => ({
  getOptionalSessionUser: mocks.sessionUser,
}));

import SignInPage from "./page";

const localEnvironment = {
  AUTOPAY_GUARD_RUNTIME_MODE: "LOCAL",
  AUTH_URL: "http://localhost:3000",
  AUTH_KEYCLOAK_ISSUER: "http://localhost:8081/realms/autopay-guard",
  AUTH_SELF_REGISTRATION_ENABLED: "true",
} as const;

describe("sign-in demo entry points", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.environment.mockReturnValue(localEnvironment);
    mocks.sessionUser.mockResolvedValue(null);
  });

  it("distinguishes the password-protected local account from the isolated sample", async () => {
    render(await SignInPage({ searchParams: Promise.resolve({}) }));

    expect(
      screen.getByRole("button", { name: "Continue securely" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Use local demo account" }),
    ).toBeVisible();
    expect(screen.getByText("demo@autopayguard.local")).toBeVisible();
    expect(
      screen.getByText(/Enter the existing local demo password/),
    ).toBeVisible();
    expect(screen.getByText(/saved in the local demo workspace/)).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Try sample without signing in" }),
    ).toHaveAttribute("href", "/demo");
    expect(screen.getByText(/Changes reset on refresh/)).toBeVisible();
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(mocks.signIn).not.toHaveBeenCalled();
  });

  it.each([
    { AUTOPAY_GUARD_RUNTIME_MODE: "PRODUCTION" },
    { AUTH_URL: "http://localhost:3001" },
    {
      AUTH_KEYCLOAK_ISSUER:
        "https://identity.autopayguard.in/realms/autopay-guard",
    },
  ])(
    "hides the local account when its boundary does not match: %j",
    async (change) => {
      mocks.environment.mockReturnValue({ ...localEnvironment, ...change });
      render(await SignInPage({ searchParams: Promise.resolve({}) }));

      expect(
        screen.queryByRole("button", { name: "Use local demo account" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText("demo@autopayguard.local"),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Continue securely" }),
      ).toBeVisible();
      expect(
        screen.getByRole("link", { name: "Try sample without signing in" }),
      ).toHaveAttribute("href", "/demo");
    },
  );

  it("puts the saved demo first and hides signup when registration is closed", async () => {
    mocks.environment.mockReturnValue({
      ...localEnvironment,
      AUTH_SELF_REGISTRATION_ENABLED: "false",
    });
    render(await SignInPage({ searchParams: Promise.resolve({}) }));
    expect(
      screen.getByRole("heading", { name: "Your saved demo workspace" }),
    ).toBeVisible();
    expect(
      screen.getByText("No new account is needed. Registration is closed."),
    ).toBeVisible();
    expect(screen.getAllByRole("button")[0]).toHaveTextContent(
      "Use local demo account",
    );
    expect(
      screen.queryByRole("link", { name: "Create account" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Continue securely" }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Forgot password?" }),
    ).toHaveAttribute("href", "/signin?recovery=1");
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });
});
