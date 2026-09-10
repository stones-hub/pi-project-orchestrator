"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const OWNER_FILE = "owner.json";

function canonicalizeWorkspace(workspace) {
  return fs.realpathSync(path.resolve(workspace));
}

function lockRoot() {
  if (process.env.PI_EXECUTOR_LOCK_DIR) {
    return path.resolve(process.env.PI_EXECUTOR_LOCK_DIR);
  }
  const uid = typeof process.getuid === "function" ? process.getuid() : "user";
  return path.join(os.tmpdir(), `pi-executor-workspace-locks-${uid}`);
}

function lockPathForWorkspace(workspace, root = lockRoot()) {
  const canonicalWorkspace = canonicalizeWorkspace(workspace);
  const digest = crypto.createHash("sha256").update(canonicalWorkspace).digest("hex");
  return { canonicalWorkspace, lockPath: path.join(root, `${digest}.lock`) };
}

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (err && err.code === "ESRCH") return false;
    if (err && err.code === "EPERM") return true;
    return null;
  }
}

function readOwner(lockPath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(lockPath, OWNER_FILE), "utf8"));
    if (
      !parsed ||
      !Number.isSafeInteger(parsed.pid) ||
      parsed.pid <= 0 ||
      typeof parsed.executor !== "string" ||
      typeof parsed.workspace !== "string" ||
      typeof parsed.token !== "string" ||
      parsed.token.length < 16
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function removeKnownStaleLock(lockPath) {
  const quarantine = `${lockPath}.stale-${process.pid}-${crypto.randomUUID()}`;
  try {
    fs.renameSync(lockPath, quarantine);
  } catch (err) {
    if (err && (err.code === "ENOENT" || err.code === "EEXIST")) return false;
    throw err;
  }
  fs.rmSync(quarantine, { recursive: true, force: true });
  return true;
}

function acquireWorkspaceWriteLock(workspace, executor) {
  const root = lockRoot();
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const { canonicalWorkspace, lockPath } = lockPathForWorkspace(workspace, root);

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const token = crypto.randomUUID();
    try {
      fs.mkdirSync(lockPath, { mode: 0o700 });
      const owner = {
        pid: process.pid,
        executor: String(executor).slice(0, 32),
        workspace: canonicalWorkspace,
        token,
        acquiredAt: new Date().toISOString(),
      };
      const temporaryOwner = path.join(lockPath, `.owner-${token}.tmp`);
      try {
        fs.writeFileSync(temporaryOwner, JSON.stringify(owner) + "\n", { mode: 0o600, flag: "wx" });
        fs.renameSync(temporaryOwner, path.join(lockPath, OWNER_FILE));
      } catch (err) {
        fs.rmSync(lockPath, { recursive: true, force: true });
        throw err;
      }

      let released = false;
      return {
        ok: true,
        canonicalWorkspace,
        release() {
          if (released) return;
          released = true;
          const current = readOwner(lockPath);
          if (current && current.token === token && current.pid === process.pid) {
            fs.rmSync(lockPath, { recursive: true, force: true });
          }
        },
      };
    } catch (err) {
      if (!err || err.code !== "EEXIST") throw err;
    }

    const owner = readOwner(lockPath);
    if (!owner) {
      return {
        ok: false,
        reason: "workspace write lock exists but its owner cannot be verified; refusing to remove it automatically",
      };
    }
    const alive = processIsAlive(owner.pid);
    if (alive !== false) {
      const holder = owner.executor.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32) || "executor";
      return {
        ok: false,
        reason: `another write-capable coding agent (${holder}, pid ${owner.pid}) is active for this workspace`,
      };
    }
    removeKnownStaleLock(lockPath);
  }

  return { ok: false, reason: "workspace write lock changed repeatedly; try again after the current operation settles" };
}

module.exports = {
  acquireWorkspaceWriteLock,
  canonicalizeWorkspace,
  lockPathForWorkspace,
  processIsAlive,
  readOwner,
};
