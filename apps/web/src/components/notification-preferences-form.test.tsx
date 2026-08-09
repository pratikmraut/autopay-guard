import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  NotificationPreferencesForm,
  type NotificationPreferenceValues,
} from "@/components/notification-preferences-form";

const defaults: NotificationPreferenceValues = {
  enabled: false,
  inAppEnabled: false,
  emailEnabled: false,
  timezone: "Asia/Kolkata",
  quietHoursEnabled: false,
  quietStart: null,
  quietEnd: null,
};

describe("NotificationPreferencesForm", () => {
  it("submits explicit opt-in values without accepting a recipient address", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <NotificationPreferencesForm
        conflict={false}
        error={null}
        initialValues={defaults}
        onReload={vi.fn()}
        onSubmit={onSubmit}
        saving={false}
        version={0}
      />,
    );

    await user.click(
      screen.getByRole("checkbox", { name: /Enable reminders/i }),
    );
    await user.click(screen.getByRole("checkbox", { name: /In-app inbox/i }));
    await user.click(screen.getByRole("button", { name: "Save preferences" }));

    expect(onSubmit).toHaveBeenCalledWith({
      ...defaults,
      enabled: true,
      inAppEnabled: true,
    });
    expect(
      screen.queryByRole("textbox", { name: /email address/i }),
    ).not.toBeInTheDocument();
  });

  it("rejects an equal quiet-hours interval before calling the API", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <NotificationPreferencesForm
        conflict={false}
        error={null}
        initialValues={{
          ...defaults,
          quietHoursEnabled: true,
          quietStart: "22:00",
          quietEnd: "22:00",
        }}
        onReload={vi.fn()}
        onSubmit={onSubmit}
        saving={false}
        version={4}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Save preferences" }));

    expect(
      screen.getByText("Quiet hours cannot start and end at the same time."),
    ).toBeVisible();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
