# Milestone 5 privacy-export inventory

This document is the field-by-field reconciliation for the
`autopay-guard-export-v1` artifact. It describes a bounded fake-local app-data
export; it is not a legal-compliance claim.

Milestone 6 intentionally introduces `autopay-guard-export-v2` for safe
controlled-import provenance; that additive manifest is reconciled in
`docs/compliance/MILESTONE_6_IMPORT_INVENTORY.md`. This document and the pinned
v1 artifact remain immutable historical evidence.

The export is built inside the privacy-request transaction at repeatable-read
isolation. PostgreSQL stores the exact canonical UTF-8 JSON bytes and their
SHA-256. The artifact is all-or-nothing, is capped at 5 MiB, and is physically
purged no later than its bounded retention deadline.

## Canonical manifest

The exact top-level keys, in lexicographic byte order, are:

```text
auditEvents
cancellationData
consentEvents
generatedAt
households
memberships
noticeAcknowledgements
notificationData
privacyRequests
schemaVersion
subject
supportGrants
```

Every object is serialized from a lexicographically sorted map. JSON is
compact UTF-8 without a BOM or insignificant whitespace. Instants are UTC
`Z`, local dates and times remain local ISO values, UUIDs remain strings,
money remains integer minor units, and SQL nulls remain JSON nulls.

Arrays use these stable domain orders:

| Location | Order |
| --- | --- |
| `auditEvents` | `(occurredAt, id)` |
| `cancellationData.decisions`, `.attempts`, `.guideFeedback` | `(createdAt, id)` |
| attempt `verifications`, `savingsEvents` | `(createdAt, id)` |
| `consentEvents` | `(occurredAt, id)` |
| `households`, `memberships` | `(createdAt, id)` |
| household `commitments` | `(createdAt, id)` |
| commitment `occurrences` | `(scheduledDate, id)` |
| household/commitment `reminderRuleSets` | `(createdAt, id)` |
| reminder-set `rules` | `(channel, offsetDays, id)` |
| `noticeAcknowledgements` | `(acknowledgedAt, id)` |
| `notificationData.notifications` | `(createdAt, id)` |
| `privacyRequests` | `(createdAt, id)` |
| privacy-request `events` | `(occurredAt, id)` |
| `subject.invitations`, `supportGrants` | `(createdAt, id)` |

## V1-V5 table and field reconciliation

“Parent-scoped” means the foreign key is omitted only because the record is
nested under that exact parent. “Referenced” means global fictional catalog
content is represented by a stable identifier rather than duplicated.

| Table | Exported fields | Deliberately excluded or represented elsewhere |
| --- | --- | --- |
| `users` | `subject`: `id`, `email`, `display_name`, `timezone`, `locale`, `age_confirmed_at`, `privacy_notice_accepted_at`, `privacy_notice_version`, `created_at`, `updated_at` | `oidc_subject` is an identity credential/linkage; `deleted_at` and `deletion_protected` are internal policy state. A deleted subject cannot create a new export. |
| `households` | `id`, `name`, `owner_user_id`, `default_currency`, `timezone`, `created_at`, `updated_at`, plus the requester's membership ID/role/status | None for an accessible subject household. |
| `merchants` | Stable `merchant_id` references on commitments/guides | Global fictional catalog names, aliases, hosts, and metadata are not duplicated. |
| `merchant_aliases` | Referenced through `merchant_id` only | Global fictional matching catalog. |
| `recurring_commitments` | `id`, `household_id`, `data_owner_user_id`, `responsible_member_id`, `merchant_id`, `display_name`, `category`, `payment_rail`, `masked_payment_label`, `variable_amount`, `amount_minor`, `estimated_amount_minor`, `currency`, `frequency`, `interval_count`, `custom_interval_unit`, `anchor_date`, `month_day_policy`, `next_due_date`, `status`, `source`, `source_confidence`, `visibility`, `optimistic_version`, `created_at`, `updated_at` | Only owner-owned rows and currently authorized household-visible rows are in scope. |
| `commitment_occurrences` | Nested: `id`, `scheduled_date`, `expected_amount_minor`, `amount_kind`, `currency`, `state`, `created_at`, `updated_at` | `commitment_id` is parent-scoped. |
| `notification_preferences` | `id`, `enabled`, `in_app_enabled`, `email_enabled`, `timezone`, quiet-hours fields, enabled timestamps, `optimistic_version`, `created_at`, `updated_at` | `user_id` is subject-scoped. |
| `reminder_rule_sets` | `id`, `household_id`, `commitment_id`, `scope_type`, `scope_reference_id`, `mode`, `activated_at`, `optimistic_version`, `created_at`, `updated_at` | A member receives none of another user's private reminder configuration. |
| `reminder_rules` | Nested: `id`, `channel`, `offset_days`, `local_send_time`, `enabled`, `activated_at`, `created_at`, `updated_at` | `rule_set_id` is parent-scoped. |
| `notifications` | `id`, `household_id`, `commitment_id`, `occurrence_id`, `reminder_rule_id`, `scheduled_date`, `channel`, `offset_days`, `planned_for`, `read_at`, `optimistic_version`, `created_at`, `updated_at` | `recipient_user_id` is subject-scoped. `semantic_key` is an operational deduplication fingerprint. |
| `notification_deliveries` | Nested: `id`, `status`, `attempt_count`, `available_at`, `failure_category`, `delivered_at`, `suppressed_at`, `created_at`, `updated_at` | `notification_id` is parent-scoped. `lease_token`, `lease_until`, and `provider_message_id` are worker/provider internals. |
| `outbox_events` | Nested: `id`, `event_type`, `status`, `available_at`, `attempt_count`, `last_failure_category`, `processed_at`, `created_at`, `updated_at` | `delivery_id` is parent-scoped. `idempotency_key`, `lease_token`, and `lease_until` are operational secrets/internals. |
| `idempotency_records` | None | Keys, request fingerprints, cached bodies, and replay state are internal security/operation data. Subject-owned resources themselves are exported. |
| `occurrence_decisions` | `id`, `household_id`, `commitment_id`, `occurrence_id`, `scheduled_date`, `sequence_number`, `commitment_version`, snapshot name/category/payment fields, amount/currency fields, `action`, `created_at` | `owner_user_id` is subject-scoped. |
| `cancellation_target_allowlist` | Stable target/guide references only | Global fictional safe-target catalog is not duplicated; target content is intentionally excluded. |
| `cancellation_guides` | Stable `guide_id` on attempts/feedback | Global fictional catalog. |
| `cancellation_guide_versions` | Stable `(guide_id, guide_version)` references | Global fictional guide text and administration state. |
| `cancellation_guide_steps` | Stable guide/version reference only | Global fictional guide text and target content. |
| `cancellation_attempts` | All subject-owned snapshot and lifecycle fields except those at right: IDs/references, schedule/timezone, version, name/category/payment, amount/currency/recurrence, service/mandate/verification state, savings projection, subject note, terminal timestamps, `optimistic_version`, `created_at`, `updated_at` | `owner_user_id` is subject-scoped. `unresolved_key` is an operational uniqueness key. |
| `cancellation_attempt_verifications` | Nested: `id`, `from_status`, `to_status`, `verification_basis`, `attempt_version`, `created_at` | `attempt_id` is parent-scoped. |
| `savings_events` | Nested: `id`, `event_type`, `reversal_reason`, `amount_minor`, `currency`, `estimated`, `period_start`, `period_end`, `method`, `created_at` | `attempt_id` is parent-scoped. |
| `cancellation_guide_feedback` | `id`, `household_id`, `commitment_id`, `guide_id`, `guide_version`, `outcome`, subject `note`, `created_at`, and joined review disposition/version/timestamps | `owner_user_id` is subject-scoped. Reviewer identity is excluded. |
| `cancellation_guide_locks` | None | Immutable duplicate/integrity snapshot of global fictional guide catalog. |
| `cancellation_published_version_locks` | None | Immutable duplicate/integrity snapshot of global fictional guide catalog. |
| `cancellation_published_step_locks` | None | Immutable duplicate/integrity snapshot of global fictional guide catalog. |
| `cancellation_published_target_locks` | None | Immutable duplicate/integrity snapshot of global fictional guide targets. |
| `cancellation_target_locks` | None | Immutable duplicate/integrity snapshot of global fictional target allowlist. |
| `household_members` | `memberships`: `id`, `household_id`, `role`, `status`, `optimistic_version`, `joined_at`, `removed_at`, `created_at`, `updated_at` | `user_id` is subject-scoped. Other users' membership rows are not subject data. |
| `household_invitations` | `subject.invitations`: `id`, `household_id`, subject-safe `invitee_email`, `role`, `status`, `optimistic_version`, expiry/terminal timestamps, `created_at`, `updated_at`, and `subject_relationship` | `token_hash` and `pending_key` are secrets. `accepted_by_user_id` is another linkage. A sent invitation's third-party email is null; a received invitation may contain the subject's own email. |
| `privacy_notice_acknowledgements` | `id`, `notice_version`, `content_digest`, `event_type`, `acknowledged_at`, `created_at` | `user_id` is subject-scoped. |
| `privacy_notice_acknowledgement_locks` | None | Immutable duplicate/integrity snapshot. |
| `consent_events` | `id`, `purpose`, `purpose_version`, `action`, `occurred_at`, `created_at` | `user_id` is subject-scoped. |
| `consent_event_locks` | None | Immutable duplicate/integrity snapshot. |
| `privacy_requests` | `id`, `request_type`, `status`, `correction_field`, `correction_value`, `optimistic_version`, lifecycle timestamps, plus safe export schema/digest/count/generation/expiry/purge metadata | `requester_user_id` is subject-scoped. |
| `privacy_request_events` | Nested: `id`, nullable `from_status`, `to_status`, nullable `reason_code`, `occurred_at`, `created_at` | `request_id` is parent-scoped; `actor_user_id` is staff/subject linkage not needed to describe the subject's lifecycle. |
| `privacy_request_event_locks` | None | Immutable duplicate/integrity snapshot. |
| `privacy_export_artifacts` | Safe metadata is joined to `privacyRequests`: `schema_version`, `payload_sha256`, `byte_count`, `generated_at`, `expires_at`, `purged_at` | Payload is excluded to avoid recursive self-embedding. `requester_user_id` is subject-scoped. |
| `deletion_tombstones` | None | The one-way, domain-separated fake-local subject digest is never disclosed. A deleted subject cannot authenticate/provision to request an export. |
| `cancellation_guide_catalog_state` | Stable guide reference only | Global fictional guide-administration head state. |
| `cancellation_guide_draft_states` | None | Staff-only draft ownership and operational version state. |
| `guide_lifecycle_events` | Stable published guide/version references through subject attempts | Global fictional staff-admin history, not subject data. |
| `guide_lifecycle_event_locks` | None | Immutable duplicate/integrity snapshot. |
| `guide_feedback_reviews` | Joined safe `disposition`, `optimistic_version`, `reviewed_at`, `updated_at` into subject feedback | `reviewed_by_user_id` and duplicate `created_at` are staff-operational metadata. |
| `audit_events` | Subject-linked events: `id`, `actor_role`, allowlisted `action`, `resource_type`, opaque `resource_id`, `outcome`, `correlation_id`, `occurred_at`, `created_at` | Raw `actor_user_id` is excluded. Only events where the subject is actor or the opaque resource affects the subject are selected. |
| `audit_event_locks` | None | Immutable duplicate/integrity snapshot. |
| `support_diagnostic_grants` | `id`, `household_id`, `status`, `optimistic_version`, `expires_at`, `revoked_at`, `created_at`, `updated_at` | `owner_user_id` is subject-scoped. `code_hash` and `active_key` are secrets/internal uniqueness state. |
| `m5_idempotency_records` | None | Keys, request fingerprints, cached bodies, and replay state are internal security/operation data. |
| `operation_rate_events` | None | Domain-separated actor key, operation, and enforcement timestamps are security telemetry, not product data. |

## Subject and visibility boundaries

- Owner exports include the owner's private and household-visible commitments,
  their complete dependent history, and their reminder rules.
- Member exports include household-visible commitments only while both current
  owner and member consent authorize the read. They do not include owner-only
  reminder rules.
- Foreign-only household, commitment, identity, notification, cancellation,
  support, and audit data is absent.
- Global fictional merchant/guide catalogs remain references, so changing a
  catalog label cannot silently rewrite a historical subject artifact.

## Pinned fixture

`PrivacyExportCanonicalFixtureTest` inserts fixed UUIDs, timestamps, local
dates, integer money, null provenance, and bounded delivery failure categories.
It asserts exact canonical reserialization, the frozen manifest, forbidden
operational-field absence, and the exact SHA-256:

```text
03e487578edd0f9ab6e66306b02a6a8c3bfb2ad34318d7ccbbe190ee758dce99
```

The pin may change only with an intentional versioned export change and a
field-by-field update to this inventory.
