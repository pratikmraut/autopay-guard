# Private Beta guide-freshness plan

Status: **fake-data-only local rehearsal is authorized. No real merchant guide,
target, verification, link monitoring, or participant access is authorized.**

## Current truth

The application contains exactly twenty fictional structural-review fixtures
with reserved `.example`/demo targets. Their recorded structural-review date is
2026-07-27 and their review-due date is 2026-09-25. That date has not been
advanced, and this plan does not perform a new review.

Fictional structural review is not merchant verification, provider approval,
legal review, or evidence that a real cancellation path works.

## Blocking catalog decision

Before any beta candidate, the human sponsor must choose and document one of
these mutually exclusive scopes:

1. **Feature disabled** - disable guide/cancellation UI and routes for the beta
   candidate, prove fail-closed behavior, and exclude action/savings hypotheses;
2. **Fictional training only** - isolate the current demo fixtures, expose no
   real actionable target, label the surface non-production, and exclude it
   from action/savings and guide-effectiveness metrics; or
3. **Real-guide workstream** - authorize a separate milestone with a real-guide
   inventory, purpose/retention and threat-model updates, specialist perimeter
   review, source evidence, safe-target monitoring, human ownership, and a new
   acceptance gate.

Readiness planning defaults to option 1 because option 3 is not authorized.
Option 2 may support an authorized seeded training rehearsal but cannot produce
real cancellation, savings, or guide-effectiveness evidence.

## Required ownership

| Role                 | Responsibility                                               | Status                |
| -------------------- | ------------------------------------------------------------ | --------------------- |
| Guide/content owner  | Catalog scope, priority and final publish/disable decision   | Unassigned - blocking |
| Primary reviewer     | Reproduce every step and validate wording/source/target      | Unassigned - blocking |
| Independent reviewer | Verify the record and conflicts before publication           | Unassigned - blocking |
| Security reviewer    | Host/scheme/path policy, redirect and unsafe-target review   | Unassigned - blocking |
| Support liaison      | Unsafe/outdated feedback triage and participant response     | Unassigned - blocking |
| Backup owner         | Performs expiry and emergency disable when primary is absent | Unassigned - blocking |

## Proposed future review record

Every guide version would require immutable evidence containing:

- internal guide/version identifier and exact merchant/service identity;
- country, platform and participant-visible scope;
- reviewed source types and retrieval dates, without copying credentials or
  personal data;
- exact service and payment-mandate tracks kept visibly separate;
- exact allowlisted HTTPS/app targets and redirect observations;
- reviewer and independent reviewer decisions;
- reviewed-at, review interval, review-due and published-at timestamps;
- disclaimer, known limitations and escalation path;
- safe-target automated results and manual journey evidence; and
- superseded/retired/disabled reason without rewriting history.

## Proposed freshness controls

- Review interval is 30-90 days and selected per guide risk/volatility.
- A due or retired guide remains non-actionable; no stale target is exposed.
- Unsafe-link feedback immediately suppresses that owner/version as already
  designed and opens a global human triage decision.
- Repeated reports, ownership changes, target redirects, app changes, legal
  concerns, or security findings trigger out-of-cycle review.
- Link monitoring must use a separately approved safe egress design and must
  never send participant data, cookies, tokens, identifiers, or financial
  content.
- Emergency disable is append-only/audited and requires no database history
  rewrite.
- Product copy always says the user performs the final action elsewhere and
  never claims AutoPay Guard contacted or verified with a provider.

## Proposed service hypotheses

These require accountable approval before use:

- unsafe target: disable exposure immediately after credible confirmation;
- potentially outdated/high-volume guide: triage within one supported business
  day;
- normal outdated report: triage within three supported business days; and
- scheduled review: complete before the recorded review-due instant or allow
  the guide to fail closed.

## Future acceptance evidence

A real-guide workstream would need tests and manual evidence for exact catalog
mapping, immutable versions, dual review, expiry/fail-closed behavior,
malicious/redirecting target rejection, emergency disable, feedback triage,
audit redaction, accessibility, and non-enumerating owner authorization.

## Stop condition

Do not edit fixtures, advance review dates, publish real names/targets, fetch a
real provider URL, or invite participants. Stop for a human catalog decision
and separately authorized real-guide milestone if option 3 is requested.
