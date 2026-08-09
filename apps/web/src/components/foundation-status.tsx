"use client";

import {
  ApiClientError,
  FoundationApi,
  type CurrentUser,
  type Household,
} from "@autopay-guard/contracts";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; user: CurrentUser; households: Household[] }
  | { status: "error"; message: string };

export function FoundationStatus() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const api = useMemo(() => new FoundationApi({ baseUrl: "/api/bff" }), []);

  useEffect(() => {
    const controller = new AbortController();

    Promise.all([
      api.getCurrentUser({ signal: controller.signal }),
      api.listHouseholds({}, { signal: controller.signal }),
    ])
      .then(([user, householdList]) => {
        setState({ status: "ready", user, households: householdList.items });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        setState({
          status: "error",
          message:
            error instanceof ApiClientError && error.status === 401
              ? "Your secure session has expired. Please sign in again."
              : "Live workspace details are temporarily unavailable.",
        });
      });

    return () => controller.abort();
  }, [api]);

  if (state.status === "loading") {
    return (
      <div
        className="foundation-status foundation-status--loading"
        role="status"
      >
        Checking your secure workspace…
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="foundation-status foundation-status--error" role="alert">
        {state.message}
      </div>
    );
  }

  const workspace = state.households[0];
  if (!workspace) {
    return (
      <section
        className="foundation-status"
        aria-label="Workspace setup needed"
      >
        <p>
          <span aria-hidden="true">○</span>
          Connected as <strong>{state.user.displayName}</strong>
        </p>
        <Link className="primary-link" href="/onboarding">
          Set up my workspace
          <span aria-hidden="true">→</span>
        </Link>
      </section>
    );
  }

  return (
    <section className="foundation-status" aria-label="Connected workspace">
      <p>
        <span aria-hidden="true">✓</span>
        Connected as <strong>{state.user.displayName}</strong>
      </p>
      <p>
        Workspace <strong>{workspace.name}</strong>
      </p>
    </section>
  );
}
