#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { acquireWorkspaceWriteLock, lockPathForWorkspace } = require("./workspace-write-lock");

const scripts = __dirname;
const cursor = path.join(scripts, "run-cursor");
const claude = path.join(scripts, "run-claude");
const codex = path.join(scripts, "run-codex");
const fixture = path.join(scripts, "fake-executor.test-fixture.js");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-workspace-lock-test-"));
const lockDir = path.join(root, "locks");
process.env.PI_EXECUTOR_LOCK_DIR = lockDir;
const workspaceA = path.join(root, "a");
const workspaceB = path.join(root, "b");
fs.mkdirSync(workspaceA);
fs.mkdirSync(workspaceB);

function args(wrapper, mode, workspace, evidence) {
  // --command is an explicit trusted override pointing at the local fixture shim.
  const base = [wrapper, "--mode", mode, "--prompt", "test", "--model", "fake", "--evidence-file", evidence,
    "--workspace", workspace, "--command", fixture];
  return base;
}

function run(wrapper, mode, workspace, evidence, extraEnv = {}) {
  return spawnSync(process.execPath, args(wrapper, mode, workspace, evidence), {
    encoding: "utf8",
    env: { ...process.env, PI_EXECUTOR_LOCK_DIR: lockDir, ...extraEnv },
  });
}

function start(wrapper, mode, workspace, evidence, extraEnv = {}) {
  return spawn(process.execPath, args(wrapper, mode, workspace, evidence), {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PI_EXECUTOR_LOCK_DIR: lockDir, ...extraEnv },
  });
}

function waitFor(predicate, timeoutMs = 3000) {
  const startAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startAt > timeoutMs) throw new Error("timed out waiting for condition");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
}

function waitChild(child) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function main() {
  const evidence = (name) => path.join(root, `${name}.json`);

  const holder = start(cursor, "code", workspaceA, evidence("holder"), { FAKE_EXECUTOR_DELAY_MS: "700" });
  const lockA = lockPathForWorkspace(workspaceA, lockDir).lockPath;
  waitFor(() => fs.existsSync(path.join(lockA, "owner.json")));

  let result = run(cursor, "code", workspaceA, evidence("same"));
  assert.equal(result.status, 2);
  assert.equal(JSON.parse(result.stdout).status, "blocked");

  result = run(claude, "code", workspaceA, evidence("cross"));
  assert.equal(result.status, 2);
  assert.match(JSON.parse(result.stdout).reason, /cursor/);

  result = run(codex, "code", workspaceA, evidence("cross-codex"));
  assert.equal(result.status, 2);
  assert.match(JSON.parse(result.stdout).reason, /cursor/);

  result = run(cursor, "code", workspaceB, evidence("different"));
  assert.equal(result.status, 0);

  result = run(claude, "review", workspaceA, evidence("readonly"));
  assert.equal(result.status, 0);

  assert.equal((await waitChild(holder)).code, 0);
  assert.equal(fs.existsSync(lockA), false);

  const alias = path.join(root, "alias-a");
  fs.symlinkSync(workspaceA, alias);
  const direct = acquireWorkspaceWriteLock(workspaceA, "direct-test");
  assert.equal(direct.ok, true);
  result = run(cursor, "code", alias, evidence("alias"));
  assert.equal(result.status, 2);
  direct.release();

  fs.mkdirSync(lockA, { recursive: true });
  fs.writeFileSync(path.join(lockA, "owner.json"), JSON.stringify({
    pid: 2147483647,
    executor: "stale",
    workspace: fs.realpathSync(workspaceA),
    token: "0123456789abcdef",
    acquiredAt: new Date(0).toISOString(),
  }));
  result = run(cursor, "code", workspaceA, evidence("stale"));
  assert.equal(result.status, 0);
  assert.equal(fs.existsSync(lockA), false);

  result = run(cursor, "code", workspaceA, evidence("failure"), { FAKE_EXECUTOR_EXIT_CODE: "1" });
  assert.equal(result.status, 1);
  assert.equal(fs.existsSync(lockA), false);

  result = run(cursor, "code", workspaceA, evidence("after-failure"));
  assert.equal(result.status, 0);

  result = spawnSync(process.execPath, [cursor, "--mode", "code", "--prompt", "test", "--model", "fake",
    "--evidence-file", evidence("spawn-error"), "--workspace", workspaceA,
    "--command", path.join(root, "missing-executor")], {
    encoding: "utf8",
    env: { ...process.env, PI_EXECUTOR_LOCK_DIR: lockDir },
  });
  assert.equal(result.status, 3);
  assert.equal(JSON.parse(result.stdout).status, "executor_unavailable");
  assert.equal(fs.existsSync(lockA), false);

  console.log("workspace write lock tests: 10 scenarios passed");
}

main().catch((err) => {
  console.error(err.stack || err);
  process.exit(1);
}).finally(() => {
  fs.rmSync(root, { recursive: true, force: true });
});
