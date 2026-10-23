import assert from "node:assert/strict";
import {
  mkdtemp,
  open,
  readFile,
  readdir,
  rmdir,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { acquireLocalRunLock } from "./local-run-lock.mjs";

const name = "autopay-guard-test-rehearsal.lock";

async function fixture(context) {
  const root = await mkdtemp(join(tmpdir(), "autopay-guard-lock-test-"));
  context.after(async () => {
    // Tests clean their known files explicitly; do not recursively erase an
    // unexpected entry if a lock implementation regresses.
    await rmdir(root);
  });
  return { root, lockPath: join(root, name), options: { temporaryRoot: root } };
}

test("uses an atomically created private directory and an owner-only lock file", async (context) => {
  const { root, lockPath, options } = await fixture(context);
  const release = await acquireLocalRunLock(name, options);
  const entries = await readdir(root);
  const privateName = entries.find((entry) =>
    entry.startsWith("autopay-guard-run-"),
  );
  assert.ok(privateName);
  assert.equal(entries.length, 2);
  const privateDirectory = join(root, privateName);
  const privateStat = await stat(privateDirectory);
  const ownerStat = await stat(join(privateDirectory, "owner.json"));
  const lockHandle = await open(lockPath, "r");
  try {
    const lockStat = await lockHandle.stat();
    assert.equal(ownerStat.ino, lockStat.ino);
    assert.equal(ownerStat.nlink, 2);
    assert.equal(
      JSON.parse(await lockHandle.readFile("utf8")).pid,
      process.pid,
    );
    if (process.platform !== "win32") {
      assert.equal(privateStat.mode & 0o777, 0o700);
      assert.equal(ownerStat.mode & 0o777, 0o600);
    }
  } finally {
    await lockHandle.close();
  }
  await release();
  await release();
  assert.deepEqual(await readdir(root), []);
});

test("preserves exclusion across independent acquisitions and can reacquire after release", async (context) => {
  const { root, options } = await fixture(context);
  const release = await acquireLocalRunLock(name, options);
  await assert.rejects(
    acquireLocalRunLock(name, options),
    /Another local rehearsal/,
  );
  assert.equal((await readdir(root)).length, 2);
  await release();
  const releaseAgain = await acquireLocalRunLock(name, options);
  await releaseAgain();
  assert.deepEqual(await readdir(root), []);
});

test("refuses a preexisting symlink or junction without reading or modifying its target", async (context) => {
  const { root, lockPath, options } = await fixture(context);
  const target = await mkdtemp(join(root, "sentinel-"));
  const sentinel = join(target, "unchanged.txt");
  await writeFile(sentinel, "preserve this fixture", {
    flag: "wx",
    mode: 0o600,
  });
  await symlink(
    target,
    lockPath,
    process.platform === "win32" ? "junction" : "dir",
  );
  try {
    await assert.rejects(
      acquireLocalRunLock(name, options),
      /Another local rehearsal/,
    );
    assert.equal(await readFile(sentinel, "utf8"), "preserve this fixture");
    assert.equal((await readdir(root)).length, 2);
  } finally {
    await unlink(lockPath);
    await unlink(sentinel);
    await rmdir(target);
  }
});

test("release never removes a replacement lock owned by another acquisition", async (context) => {
  const { root, lockPath, options } = await fixture(context);
  const releaseOriginal = await acquireLocalRunLock(name, options);
  await unlink(lockPath);
  const releaseReplacement = await acquireLocalRunLock(name, options);
  const replacementContents = await readFile(lockPath, "utf8");
  await releaseOriginal();
  assert.equal(await readFile(lockPath, "utf8"), replacementContents);
  await releaseReplacement();
  assert.deepEqual(await readdir(root), []);
});

test("rejects noncanonical names before creating any temporary files", async (context) => {
  const { root, options } = await fixture(context);
  for (const candidate of [
    "../escape.lock",
    "arbitrary.lock",
    "autopay-guard-../escape.lock",
    "/autopay-guard-test.lock",
  ]) {
    await assert.rejects(acquireLocalRunLock(candidate, options), /canonical/);
  }
  assert.deepEqual(await readdir(root), []);
});
