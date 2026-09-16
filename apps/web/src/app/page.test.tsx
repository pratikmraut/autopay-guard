import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ environment: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ signIn: vi.fn(), auth: vi.fn() }));
vi.mock("@/lib/env", () => ({ getServerEnvironment: mocks.environment }));

import HomePage from "./page";

const localEnvironment = {
  AUTOPAY_GUARD_RUNTIME_MODE: "LOCAL",
  AUTH_URL: "http://localhost:3000",
  AUTH_KEYCLOAK_ISSUER: "http://localhost:8081/realms/autopay-guard",
  AUTH_SELF_REGISTRATION_ENABLED: "false",
};

describe("home account entry policy", () => {
  beforeEach(() => {
    mocks.environment.mockReturnValue(localEnvironment);
  });

  it("prioritizes the saved demo workspace when local signup is closed", () => {
    render(<HomePage />);
    expect(
      screen.getByRole("link", { name: "Open demo workspace" }),
    ).toHaveAttribute("href", "/signin");
    expect(screen.getByRole("link", { name: "Demo sign in" })).toHaveAttribute(
      "href",
      "/signin",
    );
    expect(
      screen.getByRole("link", { name: "Try a temporary sample" }),
    ).toHaveAttribute("href", "/demo");
    expect(
      screen.getByText(/New account registration is closed/),
    ).toBeVisible();
    expect(document.querySelector('a[href="/signup"]')).toBeNull();
  });

  it("keeps an explicitly enabled registration rehearsal distinct", () => {
    mocks.environment.mockReturnValue({
      ...localEnvironment,
      AUTH_SELF_REGISTRATION_ENABLED: "true",
    });
    render(<HomePage />);
    expect(
      screen.getByRole("link", { name: "Create your private account" }),
    ).toHaveAttribute("href", "/signup");
    expect(screen.getByRole("link", { name: "Try the demo" })).toHaveAttribute(
      "href",
      "/demo",
    );
    expect(
      screen.queryByRole("link", { name: "Open demo workspace" }),
    ).not.toBeInTheDocument();
  });

  it.each([
    { AUTOPAY_GUARD_RUNTIME_MODE: "PRODUCTION" },
    { AUTH_URL: "http://localhost:3001" },
    {
      AUTH_KEYCLOAK_ISSUER:
        "https://identity.autopayguard.in/realms/autopay-guard",
    },
  ])(
    "does not advertise local shared sign-in outside its exact boundary: %j",
    (change) => {
      mocks.environment.mockReturnValue({ ...localEnvironment, ...change });
      render(<HomePage />);
      expect(
        screen.queryByRole("link", { name: "Open demo workspace" }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: "Sign in to your account" }),
      ).toHaveAttribute("href", "/signin");
      expect(document.querySelector('a[href="/signup"]')).toBeNull();
    },
  );
});
