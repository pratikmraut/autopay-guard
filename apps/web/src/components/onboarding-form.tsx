"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  ApiClientError,
  type CreateHouseholdRequest,
  FoundationApi,
} from "@autopay-guard/contracts";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";

const PRIVACY_NOTICE_VERSION = "foundation-v1" as const;

const onboardingSchema = z.object({
  householdName: z
    .string()
    .trim()
    .min(2, "Enter at least 2 characters.")
    .max(80, "Use 80 characters or fewer."),
  ageConfirmed: z.literal(true, {
    error: "Confirm that you are 18 or older.",
  }),
  privacyNoticeAccepted: z.literal(true, {
    error: "Accept the privacy notice to continue.",
  }),
});

type OnboardingValues = z.infer<typeof onboardingSchema>;

interface OnboardingFormProps {
  defaultName: string;
}

export function OnboardingForm({ defaultName }: OnboardingFormProps) {
  const router = useRouter();
  const nameId = useId();
  const ageId = useId();
  const privacyId = useId();
  const [submissionError, setSubmissionError] = useState<string | null>(null);

  const api = useMemo(
    () =>
      new FoundationApi({
        baseUrl: "/api/bff",
      }),
    [],
  );

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<OnboardingValues>({
    resolver: zodResolver(onboardingSchema),
    defaultValues: {
      householdName: defaultName,
      ageConfirmed: undefined,
      privacyNoticeAccepted: undefined,
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    setSubmissionError(null);

    const request: CreateHouseholdRequest = {
      name: values.householdName.trim(),
      defaultCurrency: "INR",
      timezone: resolvedTimeZone(),
      ageConfirmed: true,
      privacyNoticeAccepted: true,
      privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
    };

    try {
      await api.createHousehold(request);
      router.push("/dashboard?onboarded=1");
      router.refresh();
    } catch (error) {
      setSubmissionError(toSafeMessage(error));
    }
  });

  return (
    <form className="grid gap-6" noValidate onSubmit={onSubmit}>
      {submissionError && (
        <div
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-900"
          role="alert"
        >
          {submissionError}
        </div>
      )}

      <div>
        <label
          className="mb-2 block text-sm font-bold text-slate-900"
          htmlFor={nameId}
        >
          Workspace name
        </label>
        <input
          {...register("householdName")}
          aria-describedby={
            errors.householdName ? `${nameId}-error` : undefined
          }
          aria-invalid={Boolean(errors.householdName)}
          autoComplete="organization"
          className="field-input"
          id={nameId}
          maxLength={80}
        />
        <p className="mt-2 text-xs leading-5 text-slate-500">
          You can use your name, “My household”, or any private label you
          recognise.
        </p>
        {errors.householdName && (
          <p
            className="mt-2 text-sm font-semibold text-red-700"
            id={`${nameId}-error`}
            role="alert"
          >
            {errors.householdName.message}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3" aria-label="Workspace defaults">
        <div className="readonly-field">
          <span>Currency</span>
          <strong>INR · ₹</strong>
        </div>
        <div className="readonly-field">
          <span>Timezone</span>
          <strong>{resolvedTimeZone()}</strong>
        </div>
      </div>

      <fieldset className="grid gap-3">
        <legend className="mb-2 text-sm font-bold text-slate-900">
          Before you continue
        </legend>
        <label className="consent-row" htmlFor={ageId}>
          <input
            {...register("ageConfirmed")}
            aria-describedby={
              errors.ageConfirmed ? `${ageId}-error` : undefined
            }
            id={ageId}
            type="checkbox"
          />
          <span>
            <strong>I confirm that I am 18 or older.</strong>
            <small>AutoPay Guard is designed for adults.</small>
          </span>
        </label>
        {errors.ageConfirmed && (
          <p className="field-error" id={`${ageId}-error`} role="alert">
            {errors.ageConfirmed.message}
          </p>
        )}

        <label className="consent-row" htmlFor={privacyId}>
          <input
            {...register("privacyNoticeAccepted")}
            aria-describedby={
              errors.privacyNoticeAccepted ? `${privacyId}-error` : undefined
            }
            id={privacyId}
            type="checkbox"
          />
          <span>
            <strong>I have read and accept the privacy notice.</strong>
            <small>
              We collect only what is needed to run your workspace.{" "}
              <a href="/privacy" rel="noreferrer" target="_blank">
                Read the notice
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
              .
            </small>
          </span>
        </label>
        {errors.privacyNoticeAccepted && (
          <p className="field-error" id={`${privacyId}-error`} role="alert">
            {errors.privacyNoticeAccepted.message}
          </p>
        )}
      </fieldset>

      <Button
        className="w-full sm:w-auto"
        disabled={isSubmitting}
        type="submit"
      >
        {isSubmitting ? "Creating secure workspace…" : "Create my workspace"}
      </Button>
    </form>
  );
}

function resolvedTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata";
  } catch {
    return "Asia/Kolkata";
  }
}

function toSafeMessage(error: unknown) {
  if (error instanceof ApiClientError) {
    if (error.status === 401) {
      return "Your sign-in has expired. Sign in again and retry.";
    }
    if (error.status === 409) {
      return (
        error.problem?.detail ??
        "The request conflicts with the current workspace state. Refresh and try again."
      );
    }
    if (error.status >= 400 && error.status < 500) {
      return error.problem?.detail ?? "Check your details and try again.";
    }
  }

  return "We could not create your workspace. Please try again.";
}
