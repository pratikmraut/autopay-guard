# Milestone 4 fictional guide structural-review manifest

Status: normative inventory approved for the bounded fake-local M4 scope. The
corresponding implementation and fake-local acceptance passed on 2026-07-27.
This is not merchant verification, link monitoring, legal review, or a claim
that any real cancellation flow works. The recorded 2026-09-25 review-due date
has not been advanced by Private Beta planning.

## Scope and terminology

M4 uses exactly twenty fictional version-1 guide fixtures. A structural review
means only that the fixture is internally well-formed, uses the documented
two-track model, contains safe demo wording, and can satisfy the static target
policy. Product and test output must call this a **fictional structural review**
and must not shorten it to “merchant verified,” “provider verified,” or
“confirmed by the merchant.”

All fixtures use:

- guide version `1`;
- structural-review date `2026-07-27`;
- review interval `60` days;
- review-due date `2026-09-25`;
- reserved `.example` HTTPS hosts;
- only the non-production `autopayguard-demo` scheme for app-link examples; and
- no real merchant name, brand, app, payment destination, or provider contact.

## Canonical inventory

| Fixture | Fictional merchant | Exact HTTPS host    | Guide version | Reviewed   | Interval | Review due |
| ------- | ------------------ | ------------------- | ------------: | ---------- | -------: | ---------- |
| 01      | StreamBox Demo     | `streambox.example` |             1 | 2026-07-27 |  60 days | 2026-09-25 |
| 02      | CloudNest Demo     | `cloudnest.example` |             1 | 2026-07-27 |  60 days | 2026-09-25 |
| 03      | FitClub Demo       | `fitclub.example`   |             1 | 2026-07-27 |  60 days | 2026-09-25 |
| 04      | Demo Service 04    | `service04.example` |             1 | 2026-07-27 |  60 days | 2026-09-25 |
| 05      | Demo Service 05    | `service05.example` |             1 | 2026-07-27 |  60 days | 2026-09-25 |
| 06      | Demo Service 06    | `service06.example` |             1 | 2026-07-27 |  60 days | 2026-09-25 |
| 07      | Demo Service 07    | `service07.example` |             1 | 2026-07-27 |  60 days | 2026-09-25 |
| 08      | Demo Service 08    | `service08.example` |             1 | 2026-07-27 |  60 days | 2026-09-25 |
| 09      | Demo Service 09    | `service09.example` |             1 | 2026-07-27 |  60 days | 2026-09-25 |
| 10      | Demo Service 10    | `service10.example` |             1 | 2026-07-27 |  60 days | 2026-09-25 |
| 11      | Demo Service 11    | `service11.example` |             1 | 2026-07-27 |  60 days | 2026-09-25 |
| 12      | Demo Service 12    | `service12.example` |             1 | 2026-07-27 |  60 days | 2026-09-25 |
| 13      | Demo Service 13    | `service13.example` |             1 | 2026-07-27 |  60 days | 2026-09-25 |
| 14      | Demo Service 14    | `service14.example` |             1 | 2026-07-27 |  60 days | 2026-09-25 |
| 15      | Demo Service 15    | `service15.example` |             1 | 2026-07-27 |  60 days | 2026-09-25 |
| 16      | Demo Service 16    | `service16.example` |             1 | 2026-07-27 |  60 days | 2026-09-25 |
| 17      | Demo Service 17    | `service17.example` |             1 | 2026-07-27 |  60 days | 2026-09-25 |
| 18      | Demo Service 18    | `service18.example` |             1 | 2026-07-27 |  60 days | 2026-09-25 |
| 19      | Demo Service 19    | `service19.example` |             1 | 2026-07-27 |  60 days | 2026-09-25 |
| 20      | Demo Service 20    | `service20.example` |             1 | 2026-07-27 |  60 days | 2026-09-25 |

Deterministic database UUIDs are implementation identifiers, not review
evidence. The migration/fixture source is authoritative for those UUIDs and
must preserve the fixture-number mapping above.

## Normative structural-review checklist

Each fixture must satisfy every item before M4 acceptance:

### Identity, version, and freshness

- The merchant name and host exactly match the canonical inventory.
- The name is visibly fictional and contains no real brand or affiliation
  claim.
- The guide is immutable version `1`, has one publication instant, one
  structural-review instant on the stated date, and a 60-day interval.
- The API derives `CURRENT` through the review-due date and `REVIEW_DUE`
  afterward using an injected clock.
- A review-due guide remains readable with a warning but exposes no actionable
  target and cannot start an attempt.

### Guide and track shape

- The guide contains a nonempty risk notice explaining that AutoPay Guard does
  not contact the service or change a payment instruction.
- Steps use only `SERVICE` or `PAYMENT_MANDATE`.
- Each track has a stable, gap-free sequence with no duplicate sequence number.
- Step action is exactly `INFORMATION`, `SAFE_LINK`, or `APP_DEEP_LINK`.
- Service text never says that revoking a payment instruction cancels the
  merchant service; mandate text never says that service cancellation revokes
  a payment instruction.
- Every final action, credential entry, and confirmation is described as
  occurring outside AutoPay Guard.
- No step requests a PIN, OTP, password, private key, full card/account number,
  full UPI ID, payment credential, file, screenshot, or evidence upload.

### Safe targets

- Every non-information target is persisted fixture data and matches one
  enabled allowlist entry; no request, note, or feedback field can override it.
- HTTPS is absolute, ASCII, lowercase, and uses the row's exact `.example`
  host with a normalized path beneath its configured prefix.
- A demo deep link, if present, uses exactly
  `autopayguard-demo://mandates/service/` plus its normalized fixture path.
- Targets contain no user-info, port, query, fragment, backslash, encoded
  authority delimiter, traversal, protocol-relative form, or redirect
  parameter.
- No target uses HTTP, UPI, intent, JavaScript, data, file, or another scheme.
- The API reparses the target at read and attempt time but never resolves or
  fetches it. The BFF never accepts or redirects to it.
- HTTPS rendering requires an explicit user gesture and
  `rel="noopener noreferrer"`; demo links also require a user gesture and are
  labelled non-production.

### Ownership, feedback, and claims

- A guide is reachable through an authenticated owned commitment; it is not a
  public provider directory.
- An attempt pins the exact guide ID and version.
- `UNSAFE_LINK` feedback suppresses targets only for the reporting owner and
  exact version and cannot edit global fixture content.
- Copy uses “fictional,” “demo,” “structurally reviewed,” and “user-confirmed”
  consistently. It never uses real-merchant verification, provider
  confirmation, automatic cancellation, automatic mandate revocation, or
  independent verification claims.

## Acceptance evidence

The bounded fake-local implementation and acceptance documented in
`docs/testing/MILESTONE_4_ACCEPTANCE.md` verified that:

- the V4 migration/fixture inventory contains exactly these twenty mappings;
- database constraints reject malformed versions, tracks, sequences,
  freshness intervals, and allowlist rows;
- runtime validation accepts every canonical target and rejects the complete
  malicious-URI corpus without a network request;
- current/review-due and owner-unsafe suppression work with an injected clock
  and two authenticated subjects;
- attempts retain exact version-1 content after another version is introduced
  in tests; and
- desktop/mobile accessibility and guarded fake-local flows display the
  fictional-review disclaimer and never navigate to a real target.

Private Beta planning does not re-review a guide or advance its review date.

Record actual commands, counts, and results in the M4 acceptance and handoff
documents. Do not mark this manifest “merchant verified” when those checks pass.
