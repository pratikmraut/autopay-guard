# `@autopay-guard/contracts`

Typed AutoPay Guard API models and a fetch client generated from the API's
committed OpenAPI snapshot. The client covers identity, owned households,
recurring commitments, merchant search, occurrences, and dashboard projections.
It also covers global notification preferences, household and commitment
reminder rules, the owner-scoped notification inbox, read state, and safe
delivery diagnostics. Milestone 4 adds renewal decisions, fictional
cancellation guides, optimistic cancellation-attempt tracking, user-attested
verification, guide feedback, and state-separated savings summaries.

The source is intentionally kept free of browser state and authentication
concerns. Callers provide the base URL, headers, and fetch implementation;
browser code talks only to the same-origin BFF.

After changing API annotations or DTOs, first export the authoritative runtime
snapshot:

```sh
cd services/api
./mvnw -Dtest=OpenApiDriftTest -Dapi.updateOpenApi=true test
cd ../..
```

Then regenerate deterministically from `services/api/openapi/openapi.json`:

```sh
pnpm --filter @autopay-guard/contracts generate
```

Normal `mvn test` checks the runtime API against that snapshot.
`check:generated` renders the same client in memory and fails when the committed
snapshot has drifted. It also protects the Milestone 2 full-payload,
required-response, nullable-field, and update-status contract from silently
weakening. Milestone 3 checks additionally pin exact preference/rule mutation
payloads, complete notification responses, operation IDs, mandatory `If-Match`
headers, returned ETags, and the product boundary that excludes recipient,
provider, retry-attempt, semantic-key, and outbox details. The repository-owned
Node generator is pinned by source control and formats its output with the
workspace's exact Prettier version.

Milestone 4 checks pin the ten cancellation, decision, guide, attempt,
feedback, and savings operations; complete response shapes; closed exact
request bodies; UUID ownership references; and the precise permitted
query/path/header combinations. They also require printable-ASCII
`Idempotency-Key` bounds, quoted numeric `If-Match` values, returned attempt
ETags, documented idempotency/precondition failures, and reject request fields
that could mass-assign ownership, money, guide targets, savings state, or
server timestamps.

Milestone 6 checks pin the four controlled import operations, their complete
request and response envelopes, bounded item/file/count fields, exact status
and duplicate/error enums, strict ETags/idempotency headers, safe response
headers, and the import audit-event/resource allowlist. The generated
`FoundationApi` remains JSON-only: the validated `multipart/form-data` upload
operation is deliberately omitted so callers must construct the bounded
`FormData` request at their transport boundary. Preview reads, JSON
confirmation, and bodyless discard remain generated normally.
