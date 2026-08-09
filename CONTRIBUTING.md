# Contributing

Thank you for reviewing AutoPay Guard. Before proposing a change:

- use only fictional, reserved-domain, or seeded data;
- never commit `.env`, credentials, tokens, real identity/financial data, logs,
  browser traces, database dumps, generated secrets, or runtime artifacts;
- preserve the non-transactional boundary: no payment initiation, bank access,
  mandate action, inbox/SMS scraping, or collection of payment credentials;
- keep authorization, money, recurrence, cancellation and savings logic
  deterministic and covered by tests; and
- run the relevant checks described in `README.md`.

Open an issue before a broad architectural, identity, privacy, data, vendor, or
deployment change. Security issues must follow `SECURITY.md`, not a public issue.

Public visibility does not currently grant an open-source license. Contributions
should not be submitted until contribution and licensing terms are explicitly
published.
