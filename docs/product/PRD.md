# Product requirements - Milestones 1 through 4

## Product thesis

AutoPay Guard is a cross-rail recurring-money control and cancellation system,
not another reminder list. Its durable value comes from a unified recurring
commitment model, independent merchant-service and payment-mandate cancellation
tracks, versioned guides, attempt history, honestly labelled user-attested
verification, separate savings states, and privacy-aware household ownership.

## Target users

Launch users are adults in India, initially salaried professionals, freelancers,
and household managers who manage several subscriptions or recurring
obligations across UPI AutoPay, cards, NACH/eNACH, app stores, and direct
merchant billing.

## Jobs to be done

- Show what is expected to debit next.
- Remind the user early enough to make their own decision.
- Explain confusing recurring items without pretending certainty.
- Provide current and safe cancellation steps.
- Keep service cancellation separate from mandate revocation.
- Preserve attempt status and ask the user to attest what happened after the
  expected debit date.
- Report potential, self-reported, user-confirmed, and reversed savings
  separately.

## Milestone 1 user story

As a fake local user, I can sign in through Keycloak, see and complete a minimal
adult/privacy onboarding flow, call the authenticated `GET /v1/me` endpoint,
create a personal household, list only households I own, and reach an empty
responsive dashboard that displays the trust promise.

## Acceptance criteria

1. The web application uses an OIDC authorization-code flow and a server-side
   BFF session; tokens are absent from browser storage.
2. The API validates Keycloak JWTs and maps the OIDC subject to one local user.
3. The database contains only the initial `users` and `households` domain tables
   plus Flyway metadata.
4. `GET /v1/me` returns the authenticated local user and never exposes an access
   token.
5. Household creation and listing are constrained to the authenticated user;
   tests prove another subject cannot read an owner's data.
6. API validation failures and security-safe domain errors use
   `application/problem+json`.
7. The web application provides an accessible onboarding path, authenticated
   shell, empty dashboard, sign-out, and the exact trust message.
8. Liveness and readiness endpoints exist without exposing sensitive
   configuration.
9. OpenAPI is generated and the typed web client is reproducible.
10. Local PostgreSQL, Keycloak, and Mailpit use fake development-only data and
    secrets from ignored configuration.

## Milestone 2 user story

As the owner of a personal household, I can create, inspect, edit, and archive a
recurring commitment, see its deterministic upcoming occurrences for at least
90 days in list and calendar views, and understand exact monthly and annualized
dashboard projections without connecting a bank or surrendering control.

## Milestone 2 acceptance criteria

1. Commitment and occurrence records use UUIDs, integer minor-unit money, ISO
   currency, local billing dates, a separately stored timezone, and optimistic
   versions.
2. All commitment CRUD, archive, occurrence, dashboard, upcoming, and calendar
   operations are scoped to a household owned by the authenticated local user.
   Cross-subject requests fail without revealing whether an object exists.
3. Weekly, monthly, quarterly, half-yearly, yearly, and bounded custom
   recurrences are deterministic. Last-day schedules remain last-day schedules;
   other month-end anchors clamp without drifting the original anchor.
4. Creation and reconciliation materialize an idempotent rolling horizon of at
   least 90 days, including leap years and short months.
5. Merchant search uses only a small fictional local catalog and normalized
   aliases. Manual names remain supported.
6. Upcoming list, calendar, and dashboard summaries are derived from owned
   commitments and generated occurrences. Variable or estimated amounts remain
   visibly estimates.
7. Category-safe action policy never recommends cancellation of an EMI/loan,
   insurance, or investment commitment.
8. Updates and archive operations require the current version/ETag and reject a
   stale writer with a safe Problem Details response.
9. OpenAPI and the generated TypeScript client remain in sync; responsive,
   keyboard-accessible screens cover create, edit, archive, upcoming, calendar,
   empty, loading, validation, and failure states.
10. Automated tests cover recurrence boundaries and properties, money,
    timezones, optimistic locking, invalid category/action combinations,
    migration from Milestone 1, and two-subject IDOR attempts.

Milestone 2 explicitly excludes reminders, renewal decisions, imports,
cancellation execution or guides, evidence, savings, household sharing, real
financial data, payments, and production deployment.

## Milestone 3 user story

As the owner of a personal household, I can explicitly opt in to in-app and
fake-local-email reminders, choose household defaults or commitment-specific
rules, observe deterministic delivery without duplicate in-app reminders, and
inspect safe delivery status without exposing recurring financial details.

## Milestone 3 acceptance criteria

1. Migration and startup preserve existing data and create neither consent nor
   delivery work. Missing preferences and household rules are inert synthetic
   version `0` resources.
2. Global master, in-app, and email preferences plus quiet hours are explicit,
   validated, versioned, and conditional on the current ETag.
3. Household rule templates and commitment `INHERIT`, `CUSTOM`, or `DISABLED`
   overrides accept bounded channel, offset, and local-send-time values.
4. Scheduling resolves the occurrence local date/time in the household
   timezone, handles daylight-saving gaps/overlaps deterministically, evaluates
   quiet hours in the preference timezone, suppresses too-late deferrals, and
   limits downtime catch-up to two hours.
5. One database transaction creates the notification intent, delivery row, and
   outbox event. A stable semantic key prevents repeated scheduler or worker
   execution from creating another logical notification.
6. In-app delivery is effectively once. Development SMTP is at least once, uses
   a stable `Message-ID`, accepts only identity-derived fake recipients, and
   never claims absolute exactly-once delivery.
7. Local email is generic and contains no commitment name, merchant, amount,
   payment label, credential, or token. Raw SMTP responses do not enter logs,
   stored failure text, or diagnostics.
8. Transient failures use bounded retry and expired-lease recovery; permanent
   and exhausted failures become terminal and appear in owner-safe diagnostics.
9. Preference, rule, notification, read-state, and diagnostic APIs are
   owner-scoped with uniform foreign-resource behavior, exact BFF allowlists,
   bounded pagination, and stale-write protection.
10. Generated contracts, migration/authorization/concurrency/time/retry tests,
    production build, desktop/mobile accessibility journeys, Mailpit inspection,
    and the full repository gate pass.

Milestone 3 explicitly excludes renewal decisions, cancellation guides or
execution, provider links, evidence, savings, imports, sharing, privacy export
or deletion, SMS, push, Gmail, real email or data, payments, cloud resources,
and production deployment.

## Milestone 4 user story

As the owner of a personal household, I can record a category-safe decision for
an expected debit, follow a structurally reviewed fictional guide, track
merchant-service and payment-mandate steps independently, attest the result
after the expected date, and see honest savings states without AutoPay Guard
contacting a provider or changing my commitment tracking.

## Milestone 4 acceptance criteria

1. Renewal decisions are append-only occurrence snapshots and accept only an
   action from the server-derived category policy. Protected categories cannot
   manufacture a cancellation decision.
2. The local catalog contains twenty immutable, published, version-1 fictional
   guides with ordered `SERVICE` and `PAYMENT_MANDATE` tracks, risk notices,
   explicit structural-review dates, and deterministic freshness.
3. Guide targets come only from persisted fixtures and pass an exact
   scheme/host/path allowlist. The API never fetches a target, the BFF never
   redirects to one, and review-due or owner-reported-unsafe versions expose no
   actionable targets.
4. An attempt requires an owned non-archived commitment and occurrence, a
   current `CANCEL_WITH_PROVIDER` decision, a current guide, and an idempotency
   key. It pins the occurrence, recurrence, money, required tracks, guide
   version, and twelve-month savings period.
5. Whole-attempt updates require the current ETag. The two track state machines
   are deterministic, completion is server-derived, one unresolved attempt is
   allowed per commitment, and conditional abandonment closes an attempt
   without erasing its history.
6. `SELF_REPORTED` means only that the user reports completing the external
   steps. `VERIFIED` is allowed only on or after the day following the expected
   debit and is always labelled user-confirmed, never bank-, merchant-,
   provider-, or independently verified.
7. Decisions, attempts, verification, and savings never change a commitment or
   occurrence status. Existing projections and reminders continue until the
   owner separately uses the existing archive flow.
8. Quantified savings project exact recurrence dates over the immutable
   one-year attempt period using bounded integer minor units. Fixed and
   estimated values remain distinct, unknown values remain unquantified, and
   unlike currencies or savings states are never combined.
9. `POTENTIAL`, `SELF_REPORTED`, `VERIFIED`, and `REVERSED` are immutable,
   superseding records. Abandonment and a reported debit reverse the current
   state without initiating or claiming a refund.
10. Decision, attempt, guide, feedback, verification, and savings APIs are
    owner-scoped, validation-safe, replay-safe, and exposed only through exact
    BFF routes. Generated contracts, migrations, concurrency tests, unsafe-URI
    tests, desktop/mobile accessibility journeys, and the repository gate pass.

Milestone 4 explicitly excludes real merchant guides or verification, provider
contact, cancellation execution, direct mandate revocation, binary evidence,
object storage, admin guide operations, independent financial verification,
automatic commitment/occurrence status changes, refunds, imports, household
sharing, privacy operations, real data/email, cloud resources, payments, and
production deployment.

## Cross-milestone commitments

Supported categories are subscription, utility, membership, software, EMI/loan,
insurance, investment commitment, education, and other. Actions must be
category-safe: the product must never recommend cancelling an EMI, insurance
policy, or investment commitment.

Money is integer minor units plus ISO currency. Billing dates are local dates
with a separately stored household/user timezone; system timestamps are
instants. Recurrence, authorization, money, cancellation decisions, and savings
are deterministic code paths, never LLM decisions.

## Explicit non-goals

- Bank login, UPI PIN, OTP, private key, full card/account number, or full UPI ID
- Payment initiation, money movement, refunds, or universal mandate revocation
- Live Account Aggregator, Gmail, inbox, or SMS integration
- Personalized investment, insurance, lending, or credit advice
- Direct cancellation recommendations for loans, insurance, or investments
- Real merchant affiliation, provider confirmation, or independent verification
- Binary evidence, object storage, or accepting a guide target from user content
- Automatic changes to commitment or occurrence tracking after an attestation
- Admin guide authoring, publishing, retirement, or feedback operations in M4
- Production deployment or cloud infrastructure in the current milestone
- Kafka, Redis, microservices, GraphQL, native mobile, or WhatsApp

## Activation and product metrics

The later MVP activation definition is three commitments, at least one reminder
rule, and one renewal decision. The north-star metric is recurring rupees
reviewed before debit; the outcome metric is user-confirmed annualized savings
with its attestation provenance visible. Potential, self-reported,
user-confirmed, and reversed savings must never be combined. Total cancellations
are not an optimization target.
