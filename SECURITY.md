# Security policy

## Supported code

Only the current `main` branch is considered for security fixes. This public
repository is source code, not an operational or production service.

## Reporting a vulnerability

Use GitHub's private vulnerability-reporting or Security Advisory feature for
this repository. Do not open a public issue containing exploit details,
credentials, tokens, personal data, financial metadata, or live targets.

Include the affected commit, component, reproduction using synthetic data,
impact, and any suggested mitigation. Never test against systems or accounts
you do not own or have explicit permission to assess.

There is no bug-bounty program or guaranteed response time. Public disclosure
should wait for coordinated review and remediation.

## Product boundary

AutoPay Guard must never receive bank passwords, UPI PINs, OTPs, full card or
account numbers, or payment credentials. It does not initiate payments or
revoke mandates. Report any path that appears to cross this boundary privately.
