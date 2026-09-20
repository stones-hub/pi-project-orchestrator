"use strict";

/**
 * Shared async spawn helper for run-claude / run-cursor / run-codex.
 * Streams stdout/stderr to evidence files as they arrive (no maxBuffer),
 * creates evidence paths and opens descriptors before spawn, and keeps only a
 * fixed-size in-memory capture for parsing.
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

/** Fixed in-memory capture ceiling per stream (bytes). Full output always goes to disk. */
const CAPTURE_LIMIT_BYTES = 1024 * 1024;

function isStartFailure(error) {
  if (!error) return false;
  return error.code === "ENOENT" || error.code === "EACCES" || error.code === "ENOTDIR";
}

/**
 * Persist an entire chunk, looping on short writes. A zero or invalid write is an error.
 * @param {number} fd
 * @param {string | Buffer} chunk
 * @param {typeof fs.writeSync} [writeSync]
 */
function writeAllSync(fd, chunk, writeSync = fs.writeSync) {
  const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8");
  let offset = 0;
  while (offset < buf.length) {
    const written = writeSync(fd, buf, offset, buf.length - offset);
    if (!Number.isInteger(written) || written <= 0) {
      const err = new Error(
        written === 0
          ? "evidence write returned 0 bytes"
          : `evidence write returned invalid byte count: ${written}`,
      );
      err.code = "EIO";
      throw err;
    }
    offset += written;
  }
  return offset;
}

function prepareEvidenceFiles(evidenceFile, deps = {}) {
  const mkdirSync = deps.mkdirSync ?? fs.mkdirSync;
  const writeFileSync = deps.writeFileSync ?? fs.writeFileSync;
  const stdoutEvidenceFile = path.resolve(evidenceFile);
  const stderrEvidenceFile = `${stdoutEvidenceFile}.stderr`;
  mkdirSync(path.dirname(stdoutEvidenceFile), { recursive: true });
  writeFileSync(stdoutEvidenceFile, "", "utf8");
  writeFileSync(stderrEvidenceFile, "", "utf8");
  return { stdoutEvidenceFile, stderrEvidenceFile };
}

/**
 * Same prepare path as spawn setup, but never throws: returns structured setupFailed.
 */
function safePrepareEvidenceFiles(evidenceFile, deps = {}) {
  const stdoutEvidenceFile = path.resolve(evidenceFile);
  const stderrEvidenceFile = `${stdoutEvidenceFile}.stderr`;
  try {
    const prepared = prepareEvidenceFiles(evidenceFile, deps);
    return { setupFailed: false, error: null, ...prepared };
  } catch (err) {
    return {
      setupFailed: true,
      error: err,
      stdoutEvidenceFile,
      stderrEvidenceFile,
    };
  }
}

function createBoundedCapture(limitBytes) {
  const chunks = [];
  let size = 0;
  let truncated = false;
  let totalSeen = 0;

  return {
    push(chunk) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8");
      totalSeen += buf.length;
      if (truncated) return;
      if (size >= limitBytes) {
        truncated = true;
        return;
      }
      const room = limitBytes - size;
      if (buf.length <= room) {
        chunks.push(buf);
        size += buf.length;
      } else {
        chunks.push(buf.subarray(0, room));
        size = limitBytes;
        truncated = true;
      }
    },
    toString() {
      if (chunks.length === 0) return "";
      return Buffer.concat(chunks, size).toString("utf8");
    },
    get truncated() {
      return truncated || totalSeen > size;
    },
    get size() {
      return size;
    },
    get totalSeen() {
      return totalSeen;
    },
  };
}

function captureOverflowParseError(limitBytes) {
  return (
    `stdout/stderr exceeded in-memory capture limit (${limitBytes} bytes); ` +
    "full output was saved to evidence files and cannot be parsed from memory"
  );
}

function emptyResult(extra) {
  return {
    status: null,
    signal: null,
    error: null,
    startFailed: false,
    setupFailed: false,
    stdout: "",
    stderr: "",
    captureLimit: CAPTURE_LIMIT_BYTES,
    captureTruncated: false,
    stdoutTruncated: false,
    stderrTruncated: false,
    stdoutEvidenceFile: null,
    stderrEvidenceFile: null,
    ...extra,
  };
}

/**
 * @param {{
 *   command: string,
 *   argv?: string[],
 *   cwd?: string,
 *   evidenceFile: string,
 *   env?: NodeJS.ProcessEnv,
 *   captureLimit?: number,
 *   spawn?: typeof spawn,
 *   openSync?: typeof fs.openSync,
 *   writeSync?: typeof fs.writeSync,
 *   closeSync?: typeof fs.closeSync,
 *   mkdirSync?: typeof fs.mkdirSync,
 *   writeFileSync?: typeof fs.writeFileSync,
 * }} options
 */
function spawnWithEvidence(options) {
  const { command, argv = [], cwd, evidenceFile, env } = options;
  const captureLimit =
    Number.isSafeInteger(options.captureLimit) && options.captureLimit >= 0
      ? options.captureLimit
      : CAPTURE_LIMIT_BYTES;
  const deps = {
    spawn: options.spawn ?? spawn,
    openSync: options.openSync ?? fs.openSync,
    writeSync: options.writeSync ?? fs.writeSync,
    closeSync: options.closeSync ?? fs.closeSync,
    mkdirSync: options.mkdirSync ?? fs.mkdirSync,
    writeFileSync: options.writeFileSync ?? fs.writeFileSync,
  };

  const resolvedStdout = path.resolve(evidenceFile);
  const resolvedStderr = `${resolvedStdout}.stderr`;

  const prepared = safePrepareEvidenceFiles(evidenceFile, deps);
  if (prepared.setupFailed) {
    return Promise.resolve(emptyResult({
      setupFailed: true,
      error: prepared.error,
      captureLimit,
      stdoutEvidenceFile: prepared.stdoutEvidenceFile ?? resolvedStdout,
      stderrEvidenceFile: prepared.stderrEvidenceFile ?? resolvedStderr,
    }));
  }
  const { stdoutEvidenceFile, stderrEvidenceFile } = prepared;

  let stdoutFd;
  let stderrFd;
  try {
    stdoutFd = deps.openSync(stdoutEvidenceFile, "a");
    stderrFd = deps.openSync(stderrEvidenceFile, "a");
  } catch (err) {
    if (stdoutFd !== undefined) {
      try { deps.closeSync(stdoutFd); } catch { /* ignore */ }
    }
    return Promise.resolve(emptyResult({
      setupFailed: true,
      error: err,
      captureLimit,
      stdoutEvidenceFile,
      stderrEvidenceFile,
    }));
  }

  return new Promise((resolve) => {
    let settled = false;
    const stdoutCapture = createBoundedCapture(captureLimit);
    const stderrCapture = createBoundedCapture(captureLimit);
    let stdoutStreamError = null;
    let stderrStreamError = null;

    const finish = (payload) => {
      if (settled) return;
      settled = true;
      const captureTruncated = stdoutCapture.truncated || stderrCapture.truncated;
      resolve({
        status: payload.status ?? null,
        signal: payload.signal ?? null,
        error: payload.error ?? null,
        startFailed: payload.startFailed === true,
        setupFailed: payload.setupFailed === true,
        stdout: stdoutCapture.toString(),
        stderr: stderrCapture.toString(),
        captureLimit,
        captureTruncated,
        stdoutTruncated: stdoutCapture.truncated,
        stderrTruncated: stderrCapture.truncated,
        stdoutEvidenceFile,
        stderrEvidenceFile,
      });
    };

    const closeFds = () => {
      try { deps.closeSync(stdoutFd); } catch { /* ignore */ }
      try { deps.closeSync(stderrFd); } catch { /* ignore */ }
    };

    let child;
    try {
      child = deps.spawn(command, argv, {
        cwd,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      closeFds();
      finish({ status: null, signal: null, error: err, startFailed: isStartFailure(err) });
      return;
    }

    const writeChunk = (fd, chunk, which) => {
      if (which === "stdout" && stdoutStreamError) return;
      if (which === "stderr" && stderrStreamError) return;
      try {
        writeAllSync(fd, chunk, deps.writeSync);
      } catch (err) {
        if (which === "stdout") stdoutStreamError = err;
        else stderrStreamError = err;
      }
    };

    child.stdout.on("data", (chunk) => {
      writeChunk(stdoutFd, chunk, "stdout");
      stdoutCapture.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      writeChunk(stderrFd, chunk, "stderr");
      stderrCapture.push(chunk);
    });

    // Must listen: unhandled readable-stream errors would crash the wrapper process.
    child.stdout.on("error", (err) => {
      if (!stdoutStreamError) stdoutStreamError = err;
    });
    child.stderr.on("error", (err) => {
      if (!stderrStreamError) stderrStreamError = err;
    });

    child.on("error", (err) => {
      closeFds();
      finish({
        status: null,
        signal: null,
        error: err,
        startFailed: isStartFailure(err),
      });
    });

    child.on("close", (status, signal) => {
      closeFds();
      const streamError = stdoutStreamError || stderrStreamError;
      finish({
        status,
        signal,
        error: streamError,
        startFailed: false,
      });
    });
  });
}

module.exports = {
  spawnWithEvidence,
  prepareEvidenceFiles,
  safePrepareEvidenceFiles,
  isStartFailure,
  createBoundedCapture,
  captureOverflowParseError,
  writeAllSync,
  CAPTURE_LIMIT_BYTES,
};
