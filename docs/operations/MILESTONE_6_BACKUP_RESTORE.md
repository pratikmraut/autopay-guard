# Milestone 6 fake-local backup and restore drill

The M6 restore command validates logical backup mechanics against fake local
data. It is not a production backup policy, recovery-point objective,
recovery-time objective, encryption design, or disaster-recovery claim.

## Safety invariants

`m6-restore`:

- accepts no database name or positional argument;
- requires the exact canonical fake-local acknowledgement and environment;
- requires exactly five healthy canonical services;
- requires exactly eight fake-local database identities and refuses a source
  containing a non-fake identity;
- refuses any import job/item/error/CSV commitment, retained raw CSV,
  import idempotency/rate/lock row, or `IMPORT_JOB` audit residue;
- stops only the API while reading the source so the logical snapshot cannot
  change through the application;
- writes into a mode-0700 temporary directory;
- generates a target matching only
  `autopay_guard_restore_<10-digit-epoch>_<pid>_<random>`;
- explicitly rejects the canonical `autopay_guard` name as a target;
- uses a custom-format, no-owner, no-privilege dump plus SHA-256 checksum;
- restores in one transaction into a newly created disposable database;
- compares the full Flyway history and exact counts for an explicit table
  allowlist, including the M6 import and rate-lock tables;
- verifies all foreign keys are validated and the four canonical commitments
  remain active; and
- drops only the validated disposable database, deletes only its two temporary
  files, restarts the API, waits for health, and releases the M6 lock in an
  exit trap.

One invocation runs a normal restore and then repeats the drill with an
internal exact forced-validation canary. The second restore must reach the
post-restore canary and fail. The guarded parent then proves that no matching
database or temporary path remains, the canonical database's fake identities,
fixtures, migration and zero-import signature is unchanged, and all five
services are healthy.

The canonical database is never a `createdb`, `pg_restore`, or `dropdb` target.

## Normal drill

Start from a seeded, clean stack:

```powershell
$env:M6_LIVE_ACCEPTANCE_ACK = "I_ACKNOWLEDGE_LOCAL_FAKE_M6_ACCEPTANCE"
.\make.ps1 up
.\make.ps1 seed
.\make.ps1 m6-restore
```

Record the command result, allowlisted table count, dump SHA-256, cleanup
result for both phases, and final service health. The checksums identify these
ephemeral exercises only; both dumps are intentionally deleted.

## Forced-failure cleanup proof

The public command manages the exact force flag itself; do not set
`M6_RESTORE_FORCE_VALIDATION_FAILURE`. Its internal second phase must fail
after the disposable restore completes, while the phase trap still drops the
database, removes the dump/checksum directory, and restarts the API. The
parent command fails if the canary was never reached or if cleanup/health is
not exact.

The following read-only checks may be recorded again after the command:

```powershell
docker compose --project-directory . --env-file .env --file compose.yaml exec -T postgres psql --no-psqlrc --tuples-only --no-align --username autopay_guard_admin --dbname postgres --command "SELECT COUNT(*) FROM pg_database WHERE datname LIKE 'autopay_guard_restore_%';"
docker compose --project-directory . --env-file .env --file compose.yaml ps
```

The query must return `0`, and all five services must be running and healthy.
The command already performs equivalent checks before reporting success. If
either manual check differs, stop and diagnose; never substitute the canonical
database into a cleanup command.

Remove the acknowledgement after the normal and forced-failure evidence is
complete:

```powershell
Remove-Item Env:M6_LIVE_ACCEPTANCE_ACK
```
