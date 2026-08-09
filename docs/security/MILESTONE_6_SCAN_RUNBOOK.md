# Milestone 6 security scan and SBOM runbook

Status: refreshed local repository, exact-image, CycloneDX, and Gitleaks gates
passed on 2026-08-03. The user-authorized dependency-registry audit and complete
delivery `make check` passed on 2026-08-04. The external CodeQL workflow has a
documented user-accepted deferral and is not claimed as a pass. Explicit
Milestone 6 human approval was recorded on 2026-08-04.

The mandatory workflow is
`.github/workflows/m6-security.yml`. It complements the existing Maven,
frontend, generated-contract, dependency-review, and checksum-verified
Gitleaks gates.

## Gates

On pull requests, `main` pushes, and manual dispatch, the workflow:

1. runs CodeQL `security-extended` analysis for Java and
   JavaScript/TypeScript;
2. scans the repository with Trivy for dependency vulnerabilities,
   configuration findings, and secrets;
3. builds the exact API and web production Dockerfiles;
4. generates a CycloneDX JSON SBOM for each built image and retains both as
   immutable workflow artifacts for 30 days; and
5. fails each image gate on any high or critical OS or library vulnerability,
   including unfixed findings.

CodeQL code-scanning upload must be enabled for repositories whose GitHub plan
requires GitHub Code Security. A missing license or disabled repository
feature is an unmet gate, not a successful scan.

## Recorded local evidence - 2026-08-03

Trivy 0.70.0 used freshly updated vulnerability and Java databases. The final
repository scan reported:

- zero high/critical dependency vulnerabilities;
- zero high/critical configuration findings; and
- zero detected secrets.

The exact final image evidence is:

| Runtime | Exact local image ID | High/critical findings | CycloneDX components |
| ------- | -------------------- | ---------------------- | -------------------- |
| API | `sha256:ca2ef11ae0f3e5a69f284c09467d6540c86f1d03ef2b9dd12a7c824cfaf3d943` | 0 | 190 |
| Web | `sha256:988460eac8e103d498402ecdee0a465911528f9118a0ed4f27d7aa6307fc40a3` | 0 | 40 |

The final Gitleaks scan was clean. Scan reports, SBOMs, image identities, and
SHA-256 evidence manifests remain in the ignored local
`.tools/m6-security-evidence` directory and contain package/image metadata, not
raw or normalized import content.

The first fresh image scan was intentionally treated as blocking. It found
Alpine CVEs for which package fixes were available and CVEs in npm tooling
bundled in the web runtime. Both runtime images now apply the available Alpine
package upgrades with `apk upgrade`. The web runtime also removes npm and
corepack because the standalone application does not use them. The recorded
zero-finding results and component counts are for the rebuilt exact images
above.

On 2026-08-04 the user authorized transmission of the production dependency
inventory to the configured advisory registry. A standalone
`pnpm audit --prod --audit-level=high` and the audit inside the complete
delivery `make check` both reported no known vulnerabilities. The complete
gate exited 0 in 747.2 seconds.

CodeQL has not run. This workspace has no commit, no remote, no local CodeQL
installation, and no authorization to commit or push. The user accepted this
documented deferral for the local milestone decision. The external workflow is
not represented as a successful scan, and future repository/production gates
still require it unless separately decided.

The bounded local implementation and automated acceptance exercises passed,
and the user explicitly approved Milestone 6 on 2026-08-04. The CodeQL
deferral remains a recorded limitation rather than a passing scan.

## Action supply-chain policy

Every action introduced by the M6 workflow is pinned to a full 40-character
commit SHA and annotated with its reviewed release. Dependabot watches GitHub
Actions, but an update still requires review of the upstream release and the
new immutable commit.

This is especially important for Trivy. Aqua reported a Trivy/Trivy Action
supply-chain incident in March 2026. M6 uses the signed, immutable v0.36.0
release commit and must not be changed to a mutable tag such as `@v0.36.0` or
`@master`.

Reviewed upstream references:

- <https://github.com/aquasecurity/trivy-action/releases/tag/v0.36.0>
- <https://github.com/aquasecurity/trivy/discussions/10425>
- <https://github.com/github/codeql-action/releases/tag/v4.37.3>
- <https://github.com/actions/checkout/releases/tag/v5.0.0>
- <https://github.com/actions/upload-artifact/releases/tag/v4.6.2>

## Review and exception rule

A green workflow means the configured tools completed at that point in time;
it is not a general security certification. Review the workflow summary and
download both SBOM artifacts before recording M6 evidence.

No unresolved high or critical finding may be silently ignored. A temporary
human risk decision must be a repository document that records:

- scanner, rule/CVE, affected package or image, and observed version;
- exploitability and exposure in this exact architecture;
- compensating controls and verification evidence;
- accountable owner, decision date, and an expiry no more than 30 days away;
- the tracked remediation work; and
- explicit approval by the authorized reviewer.

Do not use `ignore-unfixed`, severity downgrades, broad skip paths, an
unreviewed ignore file, or a non-zero-command suppression as an exception.
When the decision expires, the gate is blocking again.
