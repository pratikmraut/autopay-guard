"use client";

import { useId, useState } from "react";

import { Button } from "@/components/ui/button";

export type ReminderChannel = "IN_APP" | "EMAIL";
export type ReminderRuleMode = "INHERIT" | "CUSTOM" | "DISABLED";

export interface ReminderRuleValue {
  channel: ReminderChannel;
  offsetDays: number;
  localSendTime: string;
  enabled: boolean;
}

export interface ReminderRuleEditorValue {
  mode: ReminderRuleMode;
  rules: ReminderRuleValue[];
}

interface ReminderRuleEditorProps {
  scope: "HOUSEHOLD" | "COMMITMENT";
  initialValue: ReminderRuleEditorValue;
  suggestedRules: ReminderRuleValue[];
  version: number;
  saving: boolean;
  error: string | null;
  conflict: boolean;
  onReload: () => void;
  onSubmit: (value: ReminderRuleEditorValue) => Promise<void>;
}

export function ReminderRuleEditor({
  scope,
  initialValue,
  suggestedRules,
  version,
  saving,
  error,
  conflict,
  onReload,
  onSubmit,
}: ReminderRuleEditorProps) {
  const modeId = useId();
  const [value, setValue] = useState(initialValue);
  const [validationError, setValidationError] = useState<string | null>(null);
  const modes: Array<{
    value: ReminderRuleMode;
    label: string;
    description: string;
  }> = [
    ...(scope === "COMMITMENT"
      ? [
          {
            value: "INHERIT" as const,
            label: "Use workspace defaults",
            description: "Follow the selected workspace reminder rules.",
          },
        ]
      : []),
    {
      value: "CUSTOM",
      label: "Use custom rules",
      description:
        scope === "HOUSEHOLD"
          ? "Use these defaults for commitments that inherit."
          : "Replace the workspace defaults for this commitment.",
    },
    {
      value: "DISABLED",
      label: "No reminders",
      description:
        scope === "HOUSEHOLD"
          ? "Keep workspace defaults switched off."
          : "Suppress reminders for this commitment.",
    },
  ];

  return (
    <form
      className="notification-form"
      onSubmit={(event) => {
        event.preventDefault();
        const next = {
          mode: value.mode,
          rules: value.mode === "CUSTOM" ? value.rules : [],
        };
        const invalid = validateRules(next);
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
            {conflict ? "A newer version exists" : "Could not save rules"}
          </strong>
          <p>{validationError ?? error}</p>
          {conflict && (
            <button onClick={onReload} type="button">
              Reload latest version
            </button>
          )}
        </div>
      )}

      <fieldset className="rule-mode-options" disabled={saving}>
        <legend id={modeId}>Reminder behavior</legend>
        {modes.map((mode) => (
          <label className="rule-mode-option" key={mode.value}>
            <input
              checked={value.mode === mode.value}
              name="mode"
              onChange={() =>
                setValue((current) => ({ ...current, mode: mode.value }))
              }
              type="radio"
              value={mode.value}
            />
            <span>
              <strong>{mode.label}</strong>
              <small>{mode.description}</small>
            </span>
          </label>
        ))}
      </fieldset>

      {value.mode === "CUSTOM" && (
        <section aria-labelledby="custom-rule-heading">
          <div className="rule-editor-heading">
            <div>
              <h2 id="custom-rule-heading">Delivery rules</h2>
              <p>
                Offsets use the workspace-local occurrence date. Times are
                minute precise.
              </p>
            </div>
            <Button
              disabled={saving}
              onClick={() =>
                setValue((current) => ({
                  ...current,
                  rules: [...current.rules, nextDefaultRule(current.rules)],
                }))
              }
              variant="secondary"
            >
              Add reminder
            </Button>
          </div>

          {value.rules.length === 0 ? (
            <div className="rule-empty">
              <strong>No custom reminders yet</strong>
              <p>Add a rule or start from one of the suggested offsets.</p>
            </div>
          ) : (
            <div className="rule-list">
              {value.rules.map((rule, index) => (
                <fieldset className="rule-row" key={index}>
                  <legend className="sr-only">Reminder {index + 1}</legend>
                  <div className="form-field">
                    <label htmlFor={`rule-${index}-channel`}>Channel</label>
                    <select
                      className="field-input"
                      disabled={saving}
                      id={`rule-${index}-channel`}
                      onChange={(event) =>
                        updateRule(index, {
                          channel: event.target.value as ReminderChannel,
                        })
                      }
                      value={rule.channel}
                    >
                      <option value="IN_APP">In-app</option>
                      <option value="EMAIL">Local test email</option>
                    </select>
                  </div>
                  <div className="form-field">
                    <label htmlFor={`rule-${index}-offset`}>Days before</label>
                    <input
                      className="field-input"
                      disabled={saving}
                      id={`rule-${index}-offset`}
                      inputMode="numeric"
                      max={90}
                      min={0}
                      onChange={(event) =>
                        updateRule(index, {
                          offsetDays: Number(event.target.value),
                        })
                      }
                      required
                      type="number"
                      value={rule.offsetDays}
                    />
                  </div>
                  <div className="form-field">
                    <label htmlFor={`rule-${index}-time`}>Send time</label>
                    <input
                      className="field-input"
                      disabled={saving}
                      id={`rule-${index}-time`}
                      onChange={(event) =>
                        updateRule(index, {
                          localSendTime: event.target.value,
                        })
                      }
                      required
                      type="time"
                      value={rule.localSendTime}
                    />
                  </div>
                  <label className="rule-enabled">
                    <input
                      checked={rule.enabled}
                      disabled={saving}
                      onChange={(event) =>
                        updateRule(index, { enabled: event.target.checked })
                      }
                      type="checkbox"
                    />
                    Enabled
                  </label>
                  <button
                    className="rule-remove"
                    disabled={saving}
                    onClick={() =>
                      setValue((current) => ({
                        ...current,
                        rules: current.rules.filter(
                          (_candidate, candidateIndex) =>
                            candidateIndex !== index,
                        ),
                      }))
                    }
                    type="button"
                  >
                    Remove
                  </button>
                </fieldset>
              ))}
            </div>
          )}

          {suggestedRules.length > 0 && (
            <div className="suggested-rules">
              <p>Suggested starting points</p>
              <div>
                {suggestedRules.map((rule) => (
                  <button
                    disabled={saving || hasEquivalentRule(value.rules, rule)}
                    key={`${rule.channel}:${rule.offsetDays}:${rule.localSendTime}`}
                    onClick={() =>
                      setValue((current) => ({
                        ...current,
                        rules: [...current.rules, rule],
                      }))
                    }
                    type="button"
                  >
                    {rule.offsetDays} day{rule.offsetDays === 1 ? "" : "s"} ·{" "}
                    {channelLabel(rule.channel)} · {rule.localSendTime}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      <div className="form-actions">
        <Button disabled={saving} type="submit">
          {saving ? "Saving…" : "Save reminder rules"}
        </Button>
        <span aria-live="polite" className="form-version">
          Version {version}
        </span>
      </div>
    </form>
  );

  function updateRule(index: number, patch: Partial<ReminderRuleValue>) {
    setValue((current) => ({
      ...current,
      rules: current.rules.map((rule, ruleIndex) =>
        ruleIndex === index ? { ...rule, ...patch } : rule,
      ),
    }));
  }
}

function validateRules(value: ReminderRuleEditorValue) {
  if (value.mode !== "CUSTOM") {
    return null;
  }
  if (value.rules.length === 0) {
    return "Add at least one rule or choose a different reminder behavior.";
  }
  const keys = new Set<string>();
  for (const rule of value.rules) {
    if (
      !Number.isInteger(rule.offsetDays) ||
      rule.offsetDays < 0 ||
      rule.offsetDays > 90
    ) {
      return "Every reminder offset must be a whole number from 0 to 90.";
    }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(rule.localSendTime)) {
      return "Choose a valid send time for every reminder.";
    }
    const key = `${rule.channel}:${rule.offsetDays}`;
    if (keys.has(key)) {
      return "A channel cannot use the same day offset more than once.";
    }
    keys.add(key);
  }
  return null;
}

function nextDefaultRule(rules: ReminderRuleValue[]): ReminderRuleValue {
  const offsetDays =
    [7, 3, 1, 0].find(
      (candidate) =>
        !rules.some(
          (rule) => rule.channel === "IN_APP" && rule.offsetDays === candidate,
        ),
    ) ?? 0;
  return {
    channel: "IN_APP",
    offsetDays,
    localSendTime: "09:00",
    enabled: true,
  };
}

function hasEquivalentRule(
  rules: ReminderRuleValue[],
  candidate: ReminderRuleValue,
) {
  return rules.some(
    (rule) =>
      rule.channel === candidate.channel &&
      rule.offsetDays === candidate.offsetDays,
  );
}

function channelLabel(channel: ReminderChannel) {
  return channel === "IN_APP" ? "In-app" : "Email";
}
