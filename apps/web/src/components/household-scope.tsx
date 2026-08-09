"use client";

import { ApiClientError } from "@autopay-guard/contracts";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

import { HouseholdApi, type HouseholdAccessDto } from "@/lib/household-api";

type HouseholdLoadState =
  | { status: "loading" }
  | { status: "ready"; households: HouseholdAccessDto[] }
  | { status: "error"; message: string };

const HouseholdContext = createContext<HouseholdAccessDto | null>(null);

export function HouseholdScope({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get("householdId");
  const [state, setState] = useState<HouseholdLoadState>({ status: "loading" });
  const api = useMemo(() => new HouseholdApi({ baseUrl: "/api/bff" }), []);

  useEffect(() => {
    const controller = new AbortController();
    api
      .listHouseholds({ signal: controller.signal })
      .then(({ items }) => setState({ status: "ready", households: items }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        setState({
          status: "error",
          message:
            error instanceof ApiClientError && error.status === 401
              ? "Your session has expired. Sign in again."
              : "We could not load your household access.",
        });
      });
    return () => controller.abort();
  }, [api]);

  if (state.status === "loading") {
    return <WorkspaceLoading />;
  }

  if (state.status === "error") {
    return (
      <div className="resource-state resource-state--error" role="alert">
        <strong>Workspace unavailable</strong>
        <p>{state.message}</p>
      </div>
    );
  }

  if (state.households.length === 0) {
    return (
      <div className="resource-state">
        <p className="card-kicker">Workspace required</p>
        <h1>Create your workspace first</h1>
        <p>
          Recurring commitments always belong to an explicitly selected
          household. You can also accept a fake local invitation.
        </p>
        <a className="secondary-link mt-5" href="/household">
          Accept an invitation
        </a>
        <a className="primary-link mt-5" href="/onboarding">
          Create workspace
          <span aria-hidden="true">→</span>
        </a>
      </div>
    );
  }

  const selected = state.households.find(({ id }) => id === selectedId);
  if (!selected) {
    return (
      <section className="workspace-picker" aria-labelledby="workspace-title">
        <p className="eyebrow">Choose where you are working</p>
        <h1 id="workspace-title">Select a household</h1>
        <p>
          This selection scopes every commitment, amount, and upcoming date.
          AutoPay Guard never combines households silently, and member views
          include only records visible to that member.
        </p>
        {selectedId && (
          <div className="workspace-picker__warning" role="alert">
            That household is unavailable to this account.
          </div>
        )}
        <div className="workspace-picker__options">
          {state.households.map((household) => (
            <button
              key={household.id}
              onClick={() => {
                const next = new URLSearchParams(searchParams);
                next.set("householdId", household.id);
                router.replace(`${pathname}?${next.toString()}`);
              }}
              type="button"
            >
              <span aria-hidden="true">₹</span>
              <span>
                <strong>{household.name}</strong>
                <small>
                  {household.defaultCurrency} · {household.timezone}
                </small>
              </span>
              <i aria-hidden="true">→</i>
            </button>
          ))}
        </div>
      </section>
    );
  }

  return (
    <HouseholdContext value={selected}>
      <div className="workspace-scope-bar">
        <p>
          Workspace <strong>{selected.name}</strong>
        </p>
        <button
          onClick={() => {
            const next = new URLSearchParams(searchParams);
            next.delete("householdId");
            router.replace(
              next.size > 0 ? `${pathname}?${next.toString()}` : pathname,
            );
          }}
          type="button"
        >
          Change
        </button>
      </div>
      {children}
    </HouseholdContext>
  );
}

export function useSelectedHousehold() {
  const household = useContext(HouseholdContext);
  if (!household) {
    throw new Error("useSelectedHousehold must be used inside HouseholdScope.");
  }
  return household;
}

function WorkspaceLoading() {
  return (
    <div className="resource-state resource-state--loading" role="status">
      <span className="loading-pulse" aria-hidden="true" />
      Loading your household access…
    </div>
  );
}
