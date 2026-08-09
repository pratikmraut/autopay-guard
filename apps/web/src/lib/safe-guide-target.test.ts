import { describe, expect, it } from "vitest";

import { parseSafeGuideTarget } from "@/lib/safe-guide-target";

describe("parseSafeGuideTarget", () => {
  it.each([
    [
      "https://support.streambox.example/manage/subscription",
      {
        href: "https://support.streambox.example/manage/subscription",
        kind: "HTTPS",
        displayHost: "support.streambox.example",
      },
    ],
    [
      "autopayguard-demo://mandates/service/manage",
      {
        href: "autopayguard-demo://mandates/service/manage",
        kind: "DEMO_APP",
        displayHost: "AutoPay Guard demo app",
      },
    ],
  ])("accepts a canonical fixture target: %s", (value, expected) => {
    expect(parseSafeGuideTarget(value)).toEqual(expected);
  });

  it.each([
    "http://support.streambox.example/manage/subscription",
    "https://support.streambox.example.evil.test/manage/subscription",
    "https://example/manage/subscription",
    "https://user@support.streambox.example/manage/subscription",
    "https://support.streambox.example:443/manage/subscription",
    "https://support.streambox.example/manage/subscription?next=evil",
    "https://support.streambox.example/manage/subscription#step",
    "https://SUPPORT.streambox.example/manage/subscription",
    "https://support..streambox.example/manage/subscription",
    "https://xn--streambox-9za.example/manage/subscription",
    "https://support.-streambox.example/manage/subscription",
    "https://support.streambox.example/a/../manage/subscription",
    "https://support.streambox.example/%2e%2e/manage/subscription",
    "https://support.streambox.example\\@evil.test/manage/subscription",
    "https://support.streambox.example/cancel/",
    "javascript:alert(1)",
    "data:text/html,unsafe",
    "file:///tmp/unsafe",
    "upi://mandate/revoke",
    "intent://mandate",
    "//support.streambox.example/cancel/",
    "autopayguard-demo://mandates/payment/start",
    "autopayguard-demo://evil/service/streambox/manage",
    "autopayguard-demo://mandates/service/streambox/manage",
    "autopayguard-demo://mandates/service/streambox",
    "autopayguard-demo://mandates/service/StreamBox/manage",
    "autopayguard-demo://mandates/service/streambox/manage?token=secret",
  ])("rejects an unsafe or non-canonical target: %s", (value) => {
    expect(parseSafeGuideTarget(value)).toBeNull();
  });
});
