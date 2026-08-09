"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

export interface NotificationPreferenceValues {
  enabled: boolean;
  inAppEnabled: boolean;
  emailEnabled: boolean;
  timezone: string;
  quietHoursEnabled: boolean;
  quietStart: string | null;
  quietEnd: string | null;
}

interface NotificationPreferencesFormProps {
  initialValues: NotificationPreferenceValues;
  version: number;
  saving: boolean;
  error: string | null;
  conflict: boolean;
  onReload: () => void;
  onSubmit: (values: NotificationPreferenceValues) => Promise<void>;
}

export function NotificationPreferencesForm({
  initialValues,
  version,
  saving,
  error,
  conflict,
  onReload,
  onSubmit,
}: NotificationPreferencesFormProps) {
  const [values, setValues] = useState<NotificationPreferenceValues>(() => ({
    enabled: initialValues.enabled,
    inAppEnabled: initialValues.inAppEnabled,
    emailEnabled: initialValues.emailEnabled,
    timezone: initialValues.timezone,
    quietHoursEnabled: initialValues.quietHoursEnabled,
    quietStart: initialValues.quietStart,
    quietEnd: initialValues.quietEnd,
  }));
  const [validationError, setValidationError] = useState<string | null>(null);

  return (
    <form
      className="notification-form"
      onSubmit={(event) => {
        event.preventDefault();
        const next = {
          ...values,
          timezone: values.timezone.trim(),
          quietStart: values.quietHoursEnabled ? values.quietStart : null,
          quietEnd: values.quietHoursEnabled ? values.quietEnd : null,
        };
        const invalid = validatePreferences(next);
        setValidationError(invalid);
        if (!invalid) {
          void onSubmit(next);
        }
      }}
    >
      {(error || validationError) && (
        <div
          className={`form-alert ${conflict ? "form-alert--conflict" : ""}`}
          role="alert"
        >
          <strong>
            {conflict ? "A newer version exists" : "Could not save preferences"}
          </strong>
          <p>{validationError ?? error}</p>
          {conflict && (
            <button onClick={onReload} type="button">
              Reload latest version
            </button>
          )}
        </div>
      )}

      <fieldset className="notification-form__fieldset" disabled={saving}>
        <legend className="sr-only">Global notification preferences</legend>

        <label className="variable-toggle">
          <input
            checked={values.enabled}
            name="enabled"
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                enabled: event.target.checked,
              }))
            }
            type="checkbox"
          />
          <span>
            <strong>Enable reminders</strong>
            <small>
              This master choice must be on before any reminder can be
              delivered.
            </small>
          </span>
        </label>

        <div className="notification-channel-grid">
          <label className="variable-toggle">
            <input
              checked={values.inAppEnabled}
              name="inAppEnabled"
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  inAppEnabled: event.target.checked,
                }))
              }
              type="checkbox"
            />
            <span>
              <strong>In-app inbox</strong>
              <small>Show eligible reminders inside AutoPay Guard.</small>
            </span>
          </label>
          <label className="variable-toggle">
            <input
              checked={values.emailEnabled}
              name="emailEnabled"
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  emailEnabled: event.target.checked,
                }))
              }
              type="checkbox"
            />
            <span>
              <strong>Local test email</strong>
              <small>
                Development Mailpit only. The signed-in fake address is used
                automatically.
              </small>
            </span>
          </label>
        </div>

        <div className="form-field">
          <label htmlFor="notification-timezone">Preference timezone</label>
          <input
            aria-invalid={validationError?.includes("timezone") || undefined}
            autoComplete="off"
            className="field-input"
            id="notification-timezone"
            maxLength={64}
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                timezone: event.target.value,
              }))
            }
            required
            value={values.timezone}
          />
          <p>
            Quiet hours use this IANA timezone, independently of a workspace
            schedule.
          </p>
        </div>

        <label className="variable-toggle">
          <input
            checked={values.quietHoursEnabled}
            name="quietHoursEnabled"
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                quietHoursEnabled: event.target.checked,
              }))
            }
            type="checkbox"
          />
          <span>
            <strong>Use quiet hours</strong>
            <small>
              Eligible reminders wait until quiet hours end when that remains
              safe for the scheduled date.
            </small>
          </span>
        </label>

        {values.quietHoursEnabled && (
          <div className="form-grid form-grid--two">
            <div className="form-field">
              <label htmlFor="quiet-start">Quiet hours start</label>
              <input
                className="field-input"
                id="quiet-start"
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    quietStart: event.target.value,
                  }))
                }
                required
                type="time"
                value={values.quietStart ?? ""}
              />
            </div>
            <div className="form-field">
              <label htmlFor="quiet-end">Quiet hours end</label>
              <input
                className="field-input"
                id="quiet-end"
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    quietEnd: event.target.value,
                  }))
                }
                required
                type="time"
                value={values.quietEnd ?? ""}
              />
            </div>
          </div>
        )}
      </fieldset>

      <div className="form-actions">
        <Button disabled={saving} type="submit">
          {saving ? "Saving…" : "Save preferences"}
        </Button>
        <span aria-live="polite" className="form-version">
          Version {version}
        </span>
      </div>
    </form>
  );
}

function validatePreferences(values: NotificationPreferenceValues) {
  if (!values.timezone) {
    return "Enter an IANA timezone.";
  }
  if (
    values.quietHoursEnabled &&
    (!isMinuteTime(values.quietStart) || !isMinuteTime(values.quietEnd))
  ) {
    return "Choose both quiet-hour times.";
  }
  if (values.quietHoursEnabled && values.quietStart === values.quietEnd) {
    return "Quiet hours cannot start and end at the same time.";
  }
  return null;
}

function isMinuteTime(value: string | null) {
  return value !== null && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}
