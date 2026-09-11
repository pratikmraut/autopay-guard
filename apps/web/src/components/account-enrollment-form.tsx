"use client";

import type { PrivacyNotice } from "@autopay-guard/contracts";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useState } from "react";

import { Button } from "@/components/ui/button";

export function AccountEnrollmentForm() {
  const router = useRouter();
  const ageId = useId();
  const noticeId = useId();
  const [notice, setNotice] = useState<PrivacyNotice | null>(null);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [noticeAccepted, setNoticeAccepted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadNotice = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    setNotice(null);
    setNoticeAccepted(false);
    try {
      const response = await fetch("/api/bff/v1/privacy/notices/current", {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        headers: { accept: "application/json" },
        signal,
      });
      if (!response.ok) {
        throw new Error("Notice unavailable.");
      }
      const current = (await response.json()) as PrivacyNotice;
      if (
        typeof current.noticeVersion !== "string" ||
        !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(current.noticeVersion) ||
        current.acknowledgementType !== "ACKNOWLEDGED" ||
        !/^[a-f0-9]{64}$/.test(current.contentSha256)
      ) {
        throw new Error("Notice unavailable.");
      }
      if (!signal?.aborted) {
        setNotice(current);
      }
    } catch {
      if (!signal?.aborted) {
        setError(
          "We could not load the current notice. Retry before continuing.",
        );
      }
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => void loadNotice(controller.signal));
    return () => controller.abort();
  }, [loadNotice]);

  return (
    <form
      className="grid gap-6"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!notice || !ageConfirmed || !noticeAccepted || submitting) {
          return;
        }
        setSubmitting(true);
        setError(null);
        try {
          const response = await fetch("/api/bff/v1/account/enrollment", {
            method: "POST",
            credentials: "same-origin",
            cache: "no-store",
            headers: {
              "content-type": "application/json",
              accept: "application/json",
            },
            body: JSON.stringify({
              ageConfirmed: true,
              privacyNoticeAccepted: true,
              privacyNoticeVersion: notice.noticeVersion,
            }),
          });
          if (!response.ok) {
            if (response.status === 409) {
              setNotice(null);
              setNoticeAccepted(false);
              setError(
                "The notice or account state changed. Reload the notice and retry. If this continues, sign out and use your existing account.",
              );
            } else if (response.status === 401 || response.status === 422) {
              setError(
                "Verify your email with the sign-in provider, then sign out and sign in again before retrying.",
              );
            } else if (response.status === 403 || response.status === 404) {
              setError(
                "Account registration is unavailable for this identity. No access was granted.",
              );
            } else if (response.status === 429) {
              setError("Too many attempts. Wait a little before trying again.");
            } else {
              setError("We could not finish account setup. Please try again.");
            }
            return;
          }
          router.push("/onboarding");
          router.refresh();
        } catch {
          setError("We could not finish account setup. Please try again.");
        } finally {
          setSubmitting(false);
        }
      }}
    >
      {loading && <p role="status">Loading the current privacy notice…</p>}
      {error && (
        <p className="resource-state resource-state--error" role="alert">
          {error}
        </p>
      )}
      {!loading && !notice && (
        <Button type="button" onClick={() => void loadNotice()}>
          Reload notice
        </Button>
      )}
      {notice && (
        <>
          <p className="text-sm leading-6 text-slate-600">
            Current privacy notice · Version {notice.noticeVersion}.{" "}
            <a
              className="font-bold text-emerald-800 underline"
              href="/privacy"
              target="_blank"
              rel="noreferrer"
            >
              Read the privacy notice
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </p>
          <fieldset className="grid gap-3" disabled={submitting}>
            <legend className="mb-3 font-bold">
              Confirm before creating your app account
            </legend>
            <label className="consent-row" htmlFor={ageId}>
              <input
                id={ageId}
                type="checkbox"
                checked={ageConfirmed}
                onChange={(event) => setAgeConfirmed(event.target.checked)}
              />
              <span>
                <strong>I confirm that I am 18 or older.</strong>
                <small>AutoPay Guard is designed for adults.</small>
              </span>
            </label>
            <label className="consent-row" htmlFor={noticeId}>
              <input
                id={noticeId}
                type="checkbox"
                checked={noticeAccepted}
                onChange={(event) => setNoticeAccepted(event.target.checked)}
              />
              <span>
                <strong>I have read and accept the privacy notice.</strong>
                <small>
                  Your confirmation is recorded with notice version{" "}
                  {notice.noticeVersion}.
                </small>
              </span>
            </label>
          </fieldset>
          <Button
            type="submit"
            disabled={submitting || !ageConfirmed || !noticeAccepted}
          >
            {submitting ? "Creating app account…" : "Create my app account"}
          </Button>
        </>
      )}
    </form>
  );
}
