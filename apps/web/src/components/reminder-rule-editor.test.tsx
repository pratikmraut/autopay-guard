import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ReminderRuleEditor } from "@/components/reminder-rule-editor";

describe("ReminderRuleEditor", () => {
  it("lets a commitment inherit without sending stale custom rules", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <ReminderRuleEditor
        conflict={false}
        error={null}
        initialValue={{
          mode: "CUSTOM",
          rules: [
            {
              channel: "IN_APP",
              offsetDays: 7,
              localSendTime: "09:00",
              enabled: true,
            },
          ],
        }}
        onReload={vi.fn()}
        onSubmit={onSubmit}
        saving={false}
        scope="COMMITMENT"
        suggestedRules={[]}
        version={3}
      />,
    );

    await user.click(
      screen.getByRole("radio", { name: /Use workspace defaults/i }),
    );
    await user.click(
      screen.getByRole("button", { name: "Save reminder rules" }),
    );

    expect(onSubmit).toHaveBeenCalledWith({
      mode: "INHERIT",
      rules: [],
    });
  });

  it("rejects duplicate channel and offset pairs", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const duplicate = {
      channel: "EMAIL" as const,
      offsetDays: 3,
      localSendTime: "09:00",
      enabled: true,
    };

    render(
      <ReminderRuleEditor
        conflict={false}
        error={null}
        initialValue={{ mode: "CUSTOM", rules: [duplicate, duplicate] }}
        onReload={vi.fn()}
        onSubmit={onSubmit}
        saving={false}
        scope="HOUSEHOLD"
        suggestedRules={[]}
        version={0}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Save reminder rules" }),
    );

    expect(
      screen.getByText(
        "A channel cannot use the same day offset more than once.",
      ),
    ).toBeVisible();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
