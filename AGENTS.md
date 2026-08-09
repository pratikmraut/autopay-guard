# AutoPay Guard repository rules

Before every task, read this file plus `docs/ROADMAP.md`, `docs/STATUS.md`, and
`docs/codex/NEXT_TASK.md`.

- Execute only the current explicitly authorized milestone or phase and stop at
  its human gate.
- Use fake or seeded data only. Never access production, paid cloud resources,
  or real financial data.
- Never accept or store bank credentials, PINs, OTPs, full payment credentials,
  full account numbers, full card numbers, or full UPI IDs. Never initiate a
  payment.
- Prefer a package-by-feature modular monolith and deterministic domain logic.
- Store money as integer minor units plus an ISO currency code.
- Keep authentication tokens out of browser `localStorage`; use the OIDC BFF.
- Do not use an LLM for recurrence, money, authorization, cancellation
  decisions, or savings calculations.
- Run `make check` before completion.
- Update documentation, ADRs, `docs/STATUS.md`, `docs/codex/NEXT_TASK.md`, and
  `CODEX_RESULT.md` when work changes their truth.
- Public source publication to `github.com/pratikmraut/autopay-guard` was
  explicitly authorized on 2026-08-09. Commit and push only sanitized source;
  never include local secrets, generated credentials, runtime data, or ignored
  artifacts. Stop before deployment, real-user enrollment, vendor setup, or
  real-data processing unless each is separately authorized.
