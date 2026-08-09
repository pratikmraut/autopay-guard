# ADR-002: Keep the MVP non-transactional

- Status: Accepted
- Date: 2026-07-26

## Context

Initiating payments, holding credentials, revoking mandates, handling refunds,
or acting inside payment networks changes the security, legal, operational, and
partner perimeter. The product hypothesis can be tested through control,
guidance, records, and verification without moving money.

## Decision

The MVP never initiates or receives a payment instruction and never asks for or
stores bank passwords, UPI PINs, OTPs, private keys, full card/account numbers,
or full UPI IDs. It records user actions/status only. Users complete merchant
service cancellation and payment-mandate actions independently in the
responsible external application.

## Consequences

The product cannot promise universal cancellation or automatic mandate
revocation. Copy, APIs, guides, analytics, and support must preserve this
boundary. Any transactional capability requires a new ADR, written specialist
perimeter/security review, partner contracts, and a separately approved
milestone.
