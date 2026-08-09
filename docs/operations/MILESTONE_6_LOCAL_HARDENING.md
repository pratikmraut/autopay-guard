# Milestone 6 local hardening and load runbook

This runbook is for the canonical fake-local stack only. It does not authorize
real identities, real financial data, external email, cloud resources, or
private-beta operation.

## Preconditions

Use the repository-generated `.env`, Docker Desktop, Bash, Node 22.19, pnpm
11.9, Java 21, and the exact five Compose services. Finish the normal baseline
first:

```powershell
.\make.ps1 bootstrap
.\make.ps1 up
.\make.ps1 seed
.\make.ps1 check
```

Bootstrap generates a stable 32-byte `IMPORT_FINGERPRINT_KEY` for the local
HMAC-SHA-256 import fingerprint. It is gitignored, required at API startup, and
must not be logged, exported, or hand-rotated while import/idempotency rows
remain. Production key storage and rotation require a separate approved design.

The guarded M6 commands reject a changed project name, URLs, database roles,
or any of the eight fake identity names. They also require an atomic local lock
so two M6 mutation or restore exercises cannot overlap.

The normal `seed` command runs a narrowly guarded final M6 baseline step. It
deletes only the canonical fake owner's import jobs and CSV commitments in
foreign-key-safe order, removes that owner's matching import control rows,
then requires globally zero M6 jobs/items/errors/CSV commitments and
import audit/idempotency/rate/lock rows. It also reasserts exactly four active
manual commitments. Residue belonging to any other identity fails the seed
instead of being silently deleted.

Set the explicit acknowledgements in the same PowerShell session:

```powershell
$env:M6_LIVE_ACCEPTANCE_ACK = "I_ACKNOWLEDGE_LOCAL_FAKE_M6_ACCEPTANCE"
$env:M6_LOAD_ACCEPTANCE_ACK = "I_ACKNOWLEDGE_BOUNDED_LOCAL_FAKE_M6_LOAD"
```

## Deterministic import and UI evidence

```powershell
.\make.ps1 m6-live
.\make.ps1 m6-ui-live
```

`m6-live` uses controlled CSV bytes and reserved `M6 Live Fixture ...` names.
It verifies preview-only upload, redacted invalid rows, deterministic duplicate
states, replay, confirmation, stale ETag preservation, formula rejection,
an API-only restart with a 120-second readiness bound, persisted normalized
preview state, exactly-once discard, zero committed raw payload, and exact
database cleanup.

`m6-ui-live` runs only the dedicated real-OIDC import journey against the
already-running production-mode local web container. It does not start a
second web server.

## Bounded load hypothesis

```powershell
.\make.ps1 m6-load
```

Defaults and hard caps are deliberately small:

| Input                  | Hard minimum | Default | Hard maximum |
| ---------------------- | -----------: | ------: | -----------: |
| `M6_LOAD_READS`        |           50 |     120 |          500 |
| `M6_LOAD_CONCURRENCY`  |            1 |       8 |           16 |
| `M6_LOAD_WRITE_CYCLES` |            3 |       3 |            5 |

Each write cycle uploads one controlled row and immediately discards it. No
commitment is confirmed or created. The runner warms normal read routes,
measures the requested reads and upload/discard writes, rejects incorrect
status/schema/state, and prints sample count, P50, P95, and maximum latency.

Both measured read and write P95 must be below 400 ms on the accepted local
machine. This is a beta hypothesis for the recorded environment. It is not a
portable SLO and should not be weakened or raised through an environment
override. Shared CI may record timings, but a different runner's speed is not
evidence that the accepted local measurement passed.

The runner deletes only jobs bearing its exact IDs or reserved names, their
`IMPORT_JOB` audit rows, the fake owner's matching import idempotency/rate rows,
and the fake owner's M6 rate-lock rows. It then proves there is no load fixture
or import residue.

## Failure handling

Every M6 script releases its lock in a trap. Live and load verifiers attempt
their exact database cleanup even when a check fails. Do not manually delete
the lock while its owning process is running.

If a process was killed and the lock remains:

1. Confirm no `m6-live`, `m6-ui-live`, `m6-load`, or `m6-restore` process is
   active.
2. Read the `owner` file in the reported lock directory.
3. Remove only that stale `autopay-guard-milestone6.lock` directory.
4. Run `.\make.ps1 seed` and `.\make.ps1 check` before retrying.

Do not report a pass from partial output. Preserve the failing command,
bounded counts/timings, and redacted logs for diagnosis.

When finished:

```powershell
Remove-Item Env:M6_LOAD_ACCEPTANCE_ACK
Remove-Item Env:M6_LIVE_ACCEPTANCE_ACK
```
