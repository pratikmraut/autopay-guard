# ADR-003: Exclude SMS, Gmail, and Account Aggregator from the MVP

- Status: Accepted
- Date: 2026-07-26

## Context

Broad inbox/SMS access is privacy-invasive, uneven across platforms, and subject
to platform approval. Live Account Aggregator access requires a suitable
regulated/contracted role and approved use case. Manual and previewed CSV entry
can validate the core decision/cancellation workflow with less data.

## Decision

MVP ingestion is manual entry and a controlled CSV template with validation,
preview, confirmation, and request-memory-only raw processing. There is no Gmail OAuth,
broad inbox access, SMS permission, iOS SMS ingestion, or live Account
Aggregator integration.

Later research order is selectively forwarded receipts, an Android on-device
SMS pilot after Google Play approval, then a regulated partner only after
written perimeter review, contracts, security review, and dummy-data UAT.

## Consequences

Initial setup is more manual and detection coverage is lower, but the product
remains cross-platform and privacy-minimizing. The CSV milestone needs malicious
file, formula-injection, duplicate, size, preview-expiry, and consent controls.
