import { describe, expect, it } from "vitest";

import {
  commitmentFormSchema,
  createCommitmentFormSchema,
} from "@/lib/commitment-form-schema";

const valid = {
  displayName: "StreamBox Demo",
  category: "SUBSCRIPTION",
  paymentRail: "UPI_AUTOPAY",
  amount: "499.00",
  variableAmount: false,
  frequency: "MONTHLY",
  intervalCount: 1,
  anchorDate: "2026-07-31",
  monthDayPolicy: "LAST_DAY",
  maskedPaymentLabel: "UPI mandate ••42",
  status: "ACTIVE",
} as const;

describe("commitment form validation", () => {
  it("accepts a fixed month-end commitment", () => {
    expect(commitmentFormSchema.safeParse(valid).success).toBe(true);
  });

  it("normalizes an empty optional merchant field", () => {
    const parsed = commitmentFormSchema.safeParse({
      ...valid,
      merchantId: "",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.merchantId).toBeUndefined();
    }
  });

  it("keeps unknown variable amounts distinct from fixed amounts", () => {
    expect(
      commitmentFormSchema.safeParse({
        ...valid,
        variableAmount: true,
        amount: "",
      }).success,
    ).toBe(true);
    expect(
      commitmentFormSchema.safeParse({ ...valid, amount: "" }).success,
    ).toBe(false);
  });

  it("validates amount precision for the selected ISO currency", () => {
    const jpySchema = createCommitmentFormSchema("JPY");
    const kwdSchema = createCommitmentFormSchema("KWD");

    expect(jpySchema.safeParse({ ...valid, amount: "499" }).success).toBe(true);
    expect(jpySchema.safeParse({ ...valid, amount: "499.00" }).success).toBe(
      false,
    );
    expect(kwdSchema.safeParse({ ...valid, amount: "1.234" }).success).toBe(
      true,
    );
    expect(kwdSchema.safeParse({ ...valid, amount: "1.2345" }).success).toBe(
      false,
    );
  });

  it("requires and constrains a custom interval unit", () => {
    expect(
      commitmentFormSchema.safeParse({
        ...valid,
        frequency: "CUSTOM",
        customIntervalUnit: "YEARS",
      }).success,
    ).toBe(true);
    expect(
      commitmentFormSchema.safeParse({
        ...valid,
        frequency: "CUSTOM",
      }).success,
    ).toBe(false);
    expect(
      commitmentFormSchema.safeParse({
        ...valid,
        customIntervalUnit: "MONTHS",
      }).success,
    ).toBe(false);
  });

  it("rejects credentials and full UPI identifiers in masked labels", () => {
    for (const maskedPaymentLabel of [
      "4111111111111111",
      "real.user@bank",
      "OTP 123456",
    ]) {
      expect(
        commitmentFormSchema.safeParse({
          ...valid,
          maskedPaymentLabel,
        }).success,
      ).toBe(false);
    }
  });

  it("allows LAST_DAY only for an actual month-end anchor", () => {
    expect(
      commitmentFormSchema.safeParse({
        ...valid,
        anchorDate: "2026-07-30",
      }).success,
    ).toBe(false);
    expect(
      commitmentFormSchema.safeParse({
        ...valid,
        frequency: "WEEKLY",
      }).success,
    ).toBe(false);
  });
});
