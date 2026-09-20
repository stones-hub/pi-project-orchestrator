#!/usr/bin/env node
"use strict";

/**
 * Unit tests for spawn-with-evidence.js (node --test).
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { describe, it, beforeEach, afterEach } = require("node:test");
const {
  spawnWithEvidence,
  prepareEvidenceFiles,
  safePrepareEvidenceFiles,
  isStartFailure,
  createBoundedCapture,
  writeAllSync,
  CAPTURE_LIMIT_BYTES,
} = require("./spawn-with-evidence");

function fakeChild(stdoutChunks, stderrChunks = [], exitCode = 0) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  queueMicrotask(() => {
    for (const chunk of stdoutChunks) child.stdout.emit("data", Buffer.from(chunk));
    for (const chunk of stderrChunks) child.stderr.emit("data", Buffer.from(chunk));
    child.emit("close", exitCode, null);
  });
  return child;
}

function fakeChildStreamError(which) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  queueMicrotask(() => {
    const err = Object.assign(new Error(`injected ${which} stream error`), { code: "EIO" });
    child[which].emit("error", err);
    child.emit("close", 1, null);
  });
  return child;
}

describe("spawn-with-evidence", () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "spawn-evidence-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("safePrepareEvidenceFiles returns setupFailed instead of throwing", () => {
    const evidence = path.join(dir, "safe", "out.txt");
    const ok = safePrepareEvidenceFiles(evidence);
    assert.equal(ok.setupFailed, false);
    assert.ok(fs.existsSync(ok.stdoutEvidenceFile));

    const failed = safePrepareEvidenceFiles(evidence, {
      mkdirSync() {
        throw Object.assign(new Error("injected mkdir failure"), { code: "EACCES" });
      },
    });
    assert.equal(failed.setupFailed, true);
    assert.match(String(failed.error.message), /injected mkdir failure/);
    assert.ok(failed.stdoutEvidenceFile);
  });

  it("prepareEvidenceFiles creates empty stdout/stderr before spawn", () => {
    const evidence = path.join(dir, "nested", "out.txt");
    const prepared = prepareEvidenceFiles(evidence);
    assert.equal(prepared.stdoutEvidenceFile, path.resolve(evidence));
    assert.equal(prepared.stderrEvidenceFile, `${path.resolve(evidence)}.stderr`);
    assert.equal(fs.readFileSync(prepared.stdoutEvidenceFile, "utf8"), "");
    assert.equal(fs.readFileSync(prepared.stderrEvidenceFile, "utf8"), "");
  });

  it("isStartFailure recognizes ENOENT-style codes only", () => {
    assert.equal(isStartFailure(Object.assign(new Error("x"), { code: "ENOENT" })), true);
    assert.equal(isStartFailure(Object.assign(new Error("x"), { code: "EACCES" })), true);
    assert.equal(isStartFailure(Object.assign(new Error("x"), { code: "ENOBUFS" })), false);
    assert.equal(isStartFailure(null), false);
  });

  it("createBoundedCapture stops growing memory past the fixed limit", () => {
    const cap = createBoundedCapture(16);
    cap.push(Buffer.from("abcdefghijklmnop"));
    cap.push(Buffer.from("QRST"));
    assert.equal(cap.size, 16);
    assert.equal(cap.truncated, true);
    assert.equal(cap.toString().length, 16);
    assert.ok(cap.totalSeen > 16);
  });

  it("writeAllSync retries short writes until the full chunk is persisted", () => {
    const writes = [];
    const writeSync = (_fd, buf, offset, length) => {
      if (writes.length === 0) {
        writes.push(length);
        return 1;
      }
      writes.push(length);
      return length;
    };
    const n = writeAllSync(1, Buffer.from("abcd"), writeSync);
    assert.equal(n, 4);
    assert.deepEqual(writes, [4, 3]);
  });

  it("writeAllSync treats a zero-byte write as a structured error", () => {
    assert.throws(
      () => writeAllSync(1, Buffer.from("ab"), () => 0),
      (err) => err instanceof Error && /0 bytes/.test(err.message),
    );
  });

  it("open failure before spawn does not start the child and returns setupFailed", async () => {
    const evidence = path.join(dir, "open-fail.txt");
    let spawned = false;
    const result = await spawnWithEvidence({
      command: "/bin/true",
      argv: [],
      cwd: dir,
      evidenceFile: evidence,
      openSync() {
        throw Object.assign(new Error("injected open failure"), { code: "EACCES" });
      },
      spawn() {
        spawned = true;
        throw new Error("spawn must not be called");
      },
    });
    assert.equal(spawned, false);
    assert.equal(result.setupFailed, true);
    assert.equal(result.startFailed, false);
    assert.match(String(result.error.message), /injected open failure/);
    assert.ok(result.stdoutEvidenceFile);
    assert.ok(result.stderrEvidenceFile);
  });

  it("short writes are fully persisted via writeAllSync during streaming", async () => {
    const evidence = path.join(dir, "short-write.txt");
    const writeSync = (fd, buf, offset, length) => {
      const n = length > 1 ? 1 : length;
      return fs.writeSync(fd, buf, offset, n);
    };
    const result = await spawnWithEvidence({
      command: "unused",
      argv: [],
      cwd: dir,
      evidenceFile: evidence,
      writeSync,
      spawn: () => fakeChild(["hello-world"]),
    });
    assert.equal(result.setupFailed, false);
    assert.equal(result.error, null);
    assert.equal(fs.readFileSync(result.stdoutEvidenceFile, "utf8"), "hello-world");
    assert.equal(result.stdout, "hello-world");
  });

  it("zero-byte write during streaming becomes a structured stream failure", async () => {
    const evidence = path.join(dir, "zero-write.txt");
    const result = await spawnWithEvidence({
      command: "unused",
      argv: [],
      cwd: dir,
      evidenceFile: evidence,
      writeSync: () => 0,
      spawn: () => fakeChild(["payload"]),
    });
    assert.equal(result.setupFailed, false);
    assert.equal(result.startFailed, false);
    assert.ok(result.error);
    assert.match(String(result.error.message), /0 bytes/);
    assert.equal(result.stdout, "payload");
  });

  it("stdout readable-stream error becomes structured failure without crashing", async () => {
    const evidence = path.join(dir, "stdout-err.txt");
    const result = await spawnWithEvidence({
      command: "unused",
      argv: [],
      cwd: dir,
      evidenceFile: evidence,
      spawn: () => fakeChildStreamError("stdout"),
    });
    assert.equal(result.setupFailed, false);
    assert.equal(result.startFailed, false);
    assert.ok(result.error);
    assert.match(String(result.error.message), /injected stdout stream error/);
    assert.ok(fs.existsSync(result.stdoutEvidenceFile));
    assert.ok(fs.existsSync(result.stderrEvidenceFile));
  });

  it("stderr readable-stream error becomes structured failure without crashing", async () => {
    const evidence = path.join(dir, "stderr-err.txt");
    const result = await spawnWithEvidence({
      command: "unused",
      argv: [],
      cwd: dir,
      evidenceFile: evidence,
      spawn: () => fakeChildStreamError("stderr"),
    });
    assert.equal(result.setupFailed, false);
    assert.equal(result.startFailed, false);
    assert.ok(result.error);
    assert.match(String(result.error.message), /injected stderr stream error/);
    assert.ok(fs.existsSync(result.stdoutEvidenceFile));
    assert.ok(fs.existsSync(result.stderrEvidenceFile));
  });

  it("streams large stdout to evidence without failing start and bounds memory capture", async () => {
    const evidence = path.join(dir, "large.txt");
    const script = path.join(dir, "writer.js");
    const total = 1200000;
    fs.writeFileSync(
      script,
      `const fs=require("fs");fs.writeSync(1,"x".repeat(${total}));fs.writeSync(2,"e");process.exit(1);`,
      "utf8",
    );
    const result = await spawnWithEvidence({
      command: process.execPath,
      argv: [script],
      cwd: dir,
      evidenceFile: evidence,
    });
    assert.equal(result.startFailed, false);
    assert.equal(result.setupFailed, false);
    assert.equal(result.status, 1);
    assert.equal(result.captureTruncated, true);
    assert.equal(result.captureLimit, CAPTURE_LIMIT_BYTES);
    assert.ok(Buffer.byteLength(result.stdout, "utf8") <= CAPTURE_LIMIT_BYTES);
    assert.ok(fs.statSync(result.stdoutEvidenceFile).size > CAPTURE_LIMIT_BYTES);
    assert.equal(fs.statSync(result.stdoutEvidenceFile).size, total);
    assert.equal(fs.readFileSync(result.stderrEvidenceFile, "utf8"), "e");
  });

  it("with a tiny captureLimit, memory stays capped while full evidence is preserved", async () => {
    const evidence = path.join(dir, "tiny-cap.txt");
    const script = path.join(dir, "writer.js");
    const limit = 64;
    const total = 4096;
    fs.writeFileSync(
      script,
      `const fs=require("fs");fs.writeSync(1,"a".repeat(${total}));process.exit(0);`,
      "utf8",
    );
    const result = await spawnWithEvidence({
      command: process.execPath,
      argv: [script],
      cwd: dir,
      evidenceFile: evidence,
      captureLimit: limit,
    });
    assert.equal(result.captureTruncated, true);
    assert.equal(result.captureLimit, limit);
    assert.ok(Buffer.byteLength(result.stdout, "utf8") <= limit);
    assert.equal(fs.statSync(result.stdoutEvidenceFile).size, total);
    assert.ok(fs.statSync(result.stdoutEvidenceFile).size > Buffer.byteLength(result.stdout, "utf8"));
  });

  it("marks missing binaries as startFailed and still returns evidence paths", async () => {
    const evidence = path.join(dir, "missing.txt");
    const result = await spawnWithEvidence({
      command: path.join(dir, "does-not-exist"),
      argv: [],
      cwd: dir,
      evidenceFile: evidence,
    });
    assert.equal(result.startFailed, true);
    assert.equal(result.setupFailed, false);
    assert.ok(result.error);
    assert.equal(result.error.code, "ENOENT");
    assert.ok(fs.existsSync(result.stdoutEvidenceFile));
    assert.ok(fs.existsSync(result.stderrEvidenceFile));
  });
});
