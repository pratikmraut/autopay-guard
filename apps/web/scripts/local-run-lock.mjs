import { randomUUID } from "node:crypto";
import { link, lstat, mkdtemp, open, rmdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Claim a shared rehearsal lock without opening a predictable temporary file.
 * The private directory is atomically generated with owner-only permissions;
 * its owner file is exclusively created with mode 0600. An atomic hard-link
 * claim preserves cross-process exclusion at the shared lock name and refuses
 * all existing entries, including symlinks. On Windows, the private directory
 * inherits the user's temporary-directory ACL instead of POSIX mode bits.
 */
export async function acquireLocalRunLock(
  name,
  { temporaryRoot = tmpdir(), suite = "local-rehearsal" } = {},
) {
  if (!/^autopay-guard-[a-z0-9-]+\.lock$/.test(name)) {
    throw new Error("A canonical AutoPay Guard lock name is required.");
  }
  const privateDirectory = await mkdtemp(
    join(temporaryRoot, "autopay-guard-run-"),
  );
  const ownerPath = join(privateDirectory, "owner.json");
  const lockPath = join(temporaryRoot, name);
  let handle;
  let ownedFile;

  try {
    handle = await open(ownerPath, "wx", 0o600);
    await handle.writeFile(
      JSON.stringify({
        token: randomUUID(),
        pid: process.pid,
        startedAt: new Date().toISOString(),
        suite,
      }),
    );
    ownedFile = await handle.stat();
    await handle.close();
    handle = undefined;
    await link(ownerPath, lockPath);
  } catch (error) {
    await handle?.close();
    await removePrivateFiles();
    if (error?.code === "EEXIST") {
      throw new Error(
        `Another local rehearsal may be running. After checking processes, inspect the stale lock at ${lockPath}.`,
      );
    }
    throw error;
  }

  let released = false;
  return async () => {
    if (released) {
      return;
    }
    const current = await lstat(lockPath).catch((error) => {
      if (error?.code === "ENOENT") {
        return null;
      }
      throw error;
    });
    // Never read a replacement symlink or remove a different process's lock.
    if (
      current?.isFile() &&
      current.dev === ownedFile.dev &&
      current.ino === ownedFile.ino
    ) {
      await unlink(lockPath);
    }
    await removePrivateFiles();
    released = true;
  };

  async function removePrivateFiles() {
    await unlink(ownerPath).catch((error) => {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    });
    // Deliberately non-recursive: unexpected entries must never be erased.
    await rmdir(privateDirectory);
  }
}
