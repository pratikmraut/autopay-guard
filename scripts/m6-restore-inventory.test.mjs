import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

// Pure source checks: never execute the restore script, open a database or
// touch the local fixture baseline while another acceptance test is running.
const restoreSource = await readFile(
  new URL("./m6-restore.sh", import.meta.url),
  "utf8",
);
const migrationsDirectory = new URL(
  "../services/api/src/main/resources/db/migration/",
  import.meta.url,
);
const migrations = (await readdir(migrationsDirectory)).filter((name) =>
  /^V\d+__.+\.sql$/.test(name),
);

test("restore requires the latest checked-in Flyway schema version", () => {
  const expectedVersion = Math.max(
    ...migrations.map((name) => Number(/^V(\d+)__/.exec(name)?.[1])),
  );
  const configuredVersion =
    /^readonly restore_required_schema_version="(\d+)"$/m.exec(
      restoreSource,
    )?.[1];
  assert.equal(configuredVersion, String(expectedVersion));
  assert.equal(
    (
      restoreSource.match(
        /WHERE version = '\$\{restore_required_schema_version\}' AND success/g,
      ) ?? []
    ).length,
    2,
  );
});

test("restore count inventory covers every application table, including enrollment locking", async () => {
  const inventory = /readonly allowlisted_tables=\(\s*([\s\S]*?)\n\)/.exec(
    restoreSource,
  )?.[1];
  assert.ok(
    inventory,
    "Restore table inventory must remain explicit and reviewable.",
  );
  const allowlistedTables = inventory.trim().split(/\s+/);
  assert.equal(
    new Set(allowlistedTables).size,
    allowlistedTables.length,
    "Duplicate table in restore inventory.",
  );
  const schemaTables = new Set();
  for (const migration of migrations) {
    const sql = await readFile(new URL(migration, migrationsDirectory), "utf8");
    for (const match of sql.matchAll(
      /^\s*CREATE\s+TABLE\s+([a-z_][a-z0-9_]*)\s*\(/gim,
    ))
      schemaTables.add(match[1]);
  }
  // Current migrations are additive. A future drop/rename requires updating
  // this test intentionally, not weakening the restore table allowlist.
  assert.deepEqual([...allowlistedTables].sort(), [...schemaTables].sort());
  assert.ok(allowlistedTables.includes("account_enrollment_lock"));
});

test("canonical safety signature covers the V7 singleton without relaxing fake-user limits", () => {
  assert.match(
    restoreSource,
    /SELECT COUNT\(\*\) FROM account_enrollment_lock WHERE id = 1/,
  );
  assert.ok(restoreSource.includes('"autopay_guard|8|4|1|1|0|0|0|0|0|0|0|0"'));
  assert.ok(restoreSource.includes('[[ "${fake_user_count}" == "8" ]]'));
});
