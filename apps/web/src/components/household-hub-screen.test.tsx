import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HouseholdHubScreen } from "@/components/household-hub-screen";

const navigation = vi.hoisted(() => ({
  replace: vi.fn(),
  search: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: navigation.replace }),
  useSearchParams: () => navigation.search,
}));

const householdId = "00000000-0000-4000-8000-000000000010";
const ownerId = "00000000-0000-4000-8000-000000000011";
const memberId = "00000000-0000-4000-8000-000000000012";
const invitationId = "00000000-0000-4000-8000-000000000013";
const code = "a".repeat(43);

const ownerHousehold = {
  id: householdId,
  name: "Demo household",
  ownerUserId: ownerId,
  defaultCurrency: "INR",
  timezone: "Asia/Kolkata",
  createdAt: "2026-07-01T00:00:00Z",
  updatedAt: "2026-07-01T00:00:00Z",
  accessRole: "OWNER",
  canManage: true,
};

const ownerMember = {
  id: ownerId,
  userId: ownerId,
  displayName: "Demo Owner",
  role: "OWNER",
  status: "ACTIVE",
  version: 0,
  joinedAt: "2026-07-01T00:00:00Z",
  removedAt: null,
};

const readOnlyMember = {
  id: memberId,
  userId: memberId,
  displayName: "Demo Member",
  role: "MEMBER",
  status: "ACTIVE",
  version: 0,
  joinedAt: "2026-07-28T00:00:00Z",
  removedAt: null,
};

describe("HouseholdHubScreen", () => {
  beforeEach(() => {
    navigation.replace.mockReset();
    navigation.search = new URLSearchParams();
    vi.restoreAllMocks();
  });

  it("creates a one-time fake-local invitation without sending email", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (url === "/api/bff/v1/households") {
          return jsonResponse({ items: [ownerHousehold] });
        }
        if (url === "/api/bff/v1/household-invitations") {
          return jsonResponse({ items: [] });
        }
        if (url.endsWith(`/households/${householdId}/members`)) {
          return jsonResponse({ items: [ownerMember, readOnlyMember] });
        }
        if (
          url.endsWith(`/households/${householdId}/invitations`) &&
          init?.method === "GET"
        ) {
          return jsonResponse({ items: [] });
        }
        if (
          url.endsWith(`/households/${householdId}/invitations`) &&
          init?.method === "POST"
        ) {
          return jsonResponse({
            invitation: {
              id: invitationId,
              householdId,
              householdName: ownerHousehold.name,
              inviteeEmail: "member@autopayguard.local",
              status: "PENDING",
              version: 0,
              expiresAt: "2026-07-29T00:00:00Z",
              createdAt: "2026-07-28T00:00:00Z",
            },
            invitationCode: code,
            emailSent: false,
          });
        }
        throw new Error(`Unexpected test request: ${init?.method} ${url}`);
      });

    render(<HouseholdHubScreen />);
    const email = await screen.findByRole(
      "textbox",
      {
        name: "Fake local email",
      },
      { timeout: 5_000 },
    );
    await user.type(email, "member@autopayguard.local");
    await user.click(
      screen.getByRole("button", { name: "Create invitation code" }),
    );

    expect(
      await screen.findByText("Invitation created locally. No email was sent."),
    ).toBeVisible();
    expect(screen.getByText(code, { selector: "output" })).toHaveTextContent(
      code,
    );
    const createCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith(`/households/${householdId}/invitations`) &&
        init?.method === "POST",
    );
    expect(createCall).toBeDefined();
    expect(
      new Headers(createCall?.[1]?.headers).get("idempotency-key"),
    ).toBeNull();
    expect(JSON.parse(String(createCall?.[1]?.body))).toEqual({
      inviteeEmail: "member@autopayguard.local",
    });
    expect(String(createCall?.[0])).not.toContain(code);
  });

  it("renders a member as read-only and never requests owner invitation history", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url === "/api/bff/v1/households") {
          return jsonResponse({
            items: [
              {
                ...ownerHousehold,
                accessRole: "MEMBER",
                canManage: false,
              },
            ],
          });
        }
        if (url === "/api/bff/v1/household-invitations") {
          return jsonResponse({ items: [] });
        }
        if (url.endsWith(`/households/${householdId}/members`)) {
          return jsonResponse({ items: [ownerMember, readOnlyMember] });
        }
        throw new Error(`Unexpected test request: ${url}`);
      });

    render(<HouseholdHubScreen />);

    expect(
      await screen.findByText("Owner controls stay with the founder"),
    ).toBeVisible();
    expect(
      screen.getByText(
        /You are a read-only member. Totals cover only records visible to you/i,
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole("textbox", { name: "Fake local email" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Remove" }),
    ).not.toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).endsWith(`/households/${householdId}/invitations`),
      ),
    ).toBe(false);
  });

  it("accepts a code from a zero-household state using a stable idempotency key", async () => {
    const user = userEvent.setup();
    let householdLoads = 0;
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (url === "/api/bff/v1/households") {
          householdLoads += 1;
          return jsonResponse({
            items:
              householdLoads === 1
                ? []
                : [
                    {
                      ...ownerHousehold,
                      accessRole: "MEMBER",
                      canManage: false,
                    },
                  ],
          });
        }
        if (url === "/api/bff/v1/household-invitations") {
          return jsonResponse({
            items:
              householdLoads <= 1
                ? [
                    {
                      id: invitationId,
                      householdId,
                      householdName: ownerHousehold.name,
                      inviteeEmail: "member@autopayguard.local",
                      status: "PENDING",
                      version: 0,
                      expiresAt: "2026-07-29T00:00:00Z",
                      createdAt: "2026-07-28T00:00:00Z",
                    },
                  ]
                : [],
          });
        }
        if (
          url === "/api/bff/v1/household-invitations/accept" &&
          init?.method === "POST"
        ) {
          return jsonResponse(readOnlyMember);
        }
        if (url.endsWith(`/households/${householdId}/members`)) {
          return jsonResponse({ items: [ownerMember, readOnlyMember] });
        }
        throw new Error(`Unexpected test request: ${init?.method} ${url}`);
      });

    render(<HouseholdHubScreen />);
    expect(
      await screen.findByText("No household membership yet"),
    ).toBeVisible();
    await user.type(
      screen.getByRole("textbox", { name: "One-time invitation code" }),
      code,
    );
    await user.click(screen.getByRole("button", { name: "Accept invitation" }));

    expect(await screen.findByText("Invitation accepted")).toBeVisible();
    expect(
      screen.getByText(/Shared commitments are now visible read-only/i),
    ).toBeVisible();
    const acceptCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url) === "/api/bff/v1/household-invitations/accept" &&
        init?.method === "POST",
    );
    const idempotencyKey = new Headers(acceptCall?.[1]?.headers).get(
      "idempotency-key",
    );
    expect(idempotencyKey).toMatch(/^m5-invitation-accept-/);
    expect(String(acceptCall?.[0])).not.toContain(code);
    expect(JSON.parse(String(acceptCall?.[1]?.body))).toEqual({
      invitationCode: code,
    });
    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith(
        `/household?householdId=${householdId}`,
      ),
    );
  });

  it("loads more households, incoming invitations, members, and owner invitation history", async () => {
    const user = userEvent.setup();
    const nextHouseholdId = "00000000-0000-4000-8000-000000000020";
    const cursor = {
      households: "00000000-0000-4000-8000-000000000091",
      incoming: "00000000-0000-4000-8000-000000000092",
      members: "00000000-0000-4000-8000-000000000093",
      invitations: "00000000-0000-4000-8000-000000000094",
    };
    const secondMember = {
      ...readOnlyMember,
      id: "00000000-0000-4000-8000-000000000021",
      userId: "00000000-0000-4000-8000-000000000022",
      displayName: "Second Demo Member",
    };
    const firstInvitation = {
      id: invitationId,
      householdId,
      householdName: ownerHousehold.name,
      inviteeEmail: "first@autopayguard.local",
      status: "PENDING",
      version: 0,
      expiresAt: "2026-07-29T00:00:00Z",
      createdAt: "2026-07-28T00:00:00Z",
    };
    const secondInvitation = {
      ...firstInvitation,
      id: "00000000-0000-4000-8000-000000000023",
      inviteeEmail: "second@autopayguard.local",
    };

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input), "https://autopay-guard.test");
      const pageCursor = url.searchParams.get("cursor");
      if (url.pathname === "/api/bff/v1/households") {
        return pageCursor
          ? jsonResponse({
              items: [
                {
                  ...ownerHousehold,
                  id: nextHouseholdId,
                  name: "Second household",
                },
              ],
              nextCursor: null,
            })
          : jsonResponse({
              items: [ownerHousehold],
              nextCursor: cursor.households,
            });
      }
      if (url.pathname === "/api/bff/v1/household-invitations") {
        return pageCursor
          ? jsonResponse({ items: [secondInvitation], nextCursor: null })
          : jsonResponse({
              items: [firstInvitation],
              nextCursor: cursor.incoming,
            });
      }
      if (url.pathname === `/api/bff/v1/households/${householdId}/members`) {
        return pageCursor
          ? jsonResponse({ items: [secondMember], nextCursor: null })
          : jsonResponse({
              items: [ownerMember],
              nextCursor: cursor.members,
            });
      }
      if (
        url.pathname === `/api/bff/v1/households/${householdId}/invitations`
      ) {
        return pageCursor
          ? jsonResponse({ items: [secondInvitation], nextCursor: null })
          : jsonResponse({
              items: [firstInvitation],
              nextCursor: cursor.invitations,
            });
      }
      throw new Error(`Unexpected test request: ${url}`);
    });

    render(<HouseholdHubScreen />);

    await user.click(
      await screen.findByRole("button", { name: "Load more households" }),
    );
    expect(
      screen.getByRole("option", { name: "Second household · owner" }),
    ).toBeVisible();

    await user.click(
      screen.getByRole("button", {
        name: "Load more pending invitations",
      }),
    );
    expect(screen.getByText("2 pending")).toBeVisible();

    await user.click(
      screen.getByRole("button", {
        name: "Load more household members",
      }),
    );
    expect(screen.getByText("Second Demo Member")).toBeVisible();

    await user.click(
      screen.getByRole("button", {
        name: "Load more invitation history",
      }),
    );
    expect(screen.getByText("second@autopayguard.local")).toBeVisible();
  });

  it("keeps a failed next-page action retryable and announces the error", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input), "https://autopay-guard.test");
      if (url.pathname === "/api/bff/v1/households") {
        return jsonResponse({ items: [ownerHousehold], nextCursor: null });
      }
      if (url.pathname === "/api/bff/v1/household-invitations") {
        return jsonResponse({ items: [], nextCursor: null });
      }
      if (url.pathname === `/api/bff/v1/households/${householdId}/members`) {
        return jsonResponse({ items: [ownerMember], nextCursor: null });
      }
      if (
        url.pathname === `/api/bff/v1/households/${householdId}/invitations`
      ) {
        return url.searchParams.has("cursor")
          ? new Response(null, { status: 503 })
          : jsonResponse({
              items: [],
              nextCursor: "00000000-0000-4000-8000-000000000099",
            });
      }
      throw new Error(`Unexpected test request: ${url}`);
    });

    render(<HouseholdHubScreen />);
    const loadMore = await screen.findByRole("button", {
      name: "Load more invitation history",
    });
    await user.click(loadMore);

    const errorHeading = await screen.findByText(
      "More invitation history could not be loaded",
    );
    expect(errorHeading.closest('[role="alert"]')).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: "Load more invitation history",
      }),
    ).toBeEnabled();
  });

  it("restores action focus on cancel and focuses the live result after removal", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = new URL(String(input), "https://autopay-guard.test");
      if (url.pathname === "/api/bff/v1/households") {
        return jsonResponse({
          items: [ownerHousehold],
          nextCursor: null,
        });
      }
      if (url.pathname === "/api/bff/v1/household-invitations") {
        return jsonResponse({ items: [], nextCursor: null });
      }
      if (url.pathname === `/api/bff/v1/households/${householdId}/members`) {
        return jsonResponse({
          items: [ownerMember, readOnlyMember],
          nextCursor: null,
        });
      }
      if (
        url.pathname === `/api/bff/v1/households/${householdId}/invitations`
      ) {
        return jsonResponse({ items: [], nextCursor: null });
      }
      if (
        url.pathname ===
          `/api/bff/v1/households/${householdId}/members/${memberId}` &&
        init?.method === "DELETE"
      ) {
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected test request: ${init?.method} ${url}`);
    });

    render(<HouseholdHubScreen />);
    const remove = await screen.findByRole("button", { name: "Remove" });
    await user.click(remove);
    const dialog = screen.getByRole("alertdialog");
    await waitFor(() => expect(dialog).toHaveFocus());

    await user.click(screen.getByRole("button", { name: "Keep unchanged" }));
    await waitFor(() => expect(remove).toHaveFocus());

    await user.click(remove);
    await user.click(screen.getByRole("button", { name: "Remove member" }));

    const resultHeading = await screen.findByText("Household change completed");
    const result = resultHeading.parentElement;
    expect(result).not.toBeNull();
    await waitFor(() => expect(result).toHaveFocus());
    expect(result).toHaveTextContent(
      "The member was removed and shared access ended.",
    );
  });
});

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
