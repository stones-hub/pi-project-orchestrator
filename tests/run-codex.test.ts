import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { EventEmitter } from "node:events";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const WRAPPER = path.resolve(__dirname, "../skill/project-development-orchestrator/scripts/run-codex");
const { defaultCodexCommand, findExecutableOnPath, main } = require(WRAPPER);

function codexEvents(threadId = "t1", message = "ok") {
  return [
    { type: "thread.started", thread_id: threadId },
    { type: "turn.started" },
    { type: "item.completed", item: { id: "i1", type: "agent_message", text: message } },
    { type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } },
  ];
}

function writeFakeCodexShim(dir: string, events: unknown[], exitCode = 0, stderrText = "") {
  const shim = path.join(dir, "fake-codex");
  const observedArgv = path.join(dir, "observed-argv.json");
  const observedCwd = path.join(dir, "observed-cwd.txt");
  const stdout = events.map((event) => JSON.stringify(event)).join("\n") + "\n";
  const body =
    `#!/usr/bin/env node\n` +
    `const fs=require("fs");` +
    `fs.writeFileSync(${JSON.stringify(observedArgv)}, JSON.stringify(process.argv.slice(2)));` +
    `fs.writeFileSync(${JSON.stringify(observedCwd)}, process.cwd());` +
    `process.stderr.write(${JSON.stringify(stderrText)});` +
    `process.stdout.write(${JSON.stringify(stdout)});` +
    `process.exit(${exitCode});\n`;
  fs.writeFileSync(shim, body, { mode: 0o755 });
  return shim;
}

function run(args: string[], env?: NodeJS.ProcessEnv) {
  try {
    const stdout = execFileSync(process.execPath, [WRAPPER, ...args], {
      encoding: "utf8",
      env: env ? { ...process.env, ...env } : process.env,
    });
    return { exitCode: 0, stdout, output: JSON.parse(stdout) };
  } catch (err) {
    const e = err as { status: number; stdout: string };
    return { exitCode: e.status, stdout: e.stdout, output: JSON.parse(e.stdout) };
  }
}

describe("scripts/run-codex", () => {
  let dir: string;
  let evidenceFile: string;

  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "run-codex-")));
    evidenceFile = path.join(dir, "evidence.jsonl");
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("builds read-only investigate argv and parses terminal JSONL", () => {
    const shim = writeFakeCodexShim(dir, codexEvents("thread-1", "investigated"));
    const { exitCode, output } = run([
      "--mode", "investigate", "--prompt", "inspect", "--model", "gpt-5.4",
      "--evidence-file", evidenceFile, "--command", shim,
    ]);
    expect(exitCode).toBe(0);
    expect(output).toMatchObject({ status: "success", sessionId: "thread-1", result: "investigated", model: null });
    expect(JSON.parse(fs.readFileSync(path.join(dir, "observed-argv.json"), "utf8"))).toEqual([
      "--sandbox", "read-only", "--ask-for-approval", "never", "--cd", process.cwd(), "--model", "gpt-5.4", "exec", "--json", "inspect",
    ]);
  });

  it("uses workspace-write in code mode and binds cwd/cd to canonical workspace", () => {
    const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "run-codex-ws-")));
    const shim = writeFakeCodexShim(dir, codexEvents("thread-2", "done"));
    const { exitCode } = run([
      "--mode", "code", "--prompt", "fix", "--model", "gpt-5.4",
      "--evidence-file", evidenceFile, "--workspace", workspace, "--command", shim,
    ]);
    expect(exitCode).toBe(0);
    const argv = JSON.parse(fs.readFileSync(path.join(dir, "observed-argv.json"), "utf8"));
    expect(argv).toEqual(["--sandbox", "workspace-write", "--ask-for-approval", "never", "--cd", workspace, "--model", "gpt-5.4", "exec", "--json", "fix"]);
    expect(fs.readFileSync(path.join(dir, "observed-cwd.txt"), "utf8")).toBe(workspace);
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it("uses codex exec resume for an allowed continuation", () => {
    const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "run-codex-resume-ws-")));
    const shim = writeFakeCodexShim(dir, codexEvents("thread-3", "continued"));
    const { exitCode } = run([
      "--mode", "code", "--prompt", "continue", "--model", "gpt-5.4",
      "--evidence-file", evidenceFile, "--workspace", workspace, "--resume", "old-thread", "--command", shim,
    ]);
    expect(exitCode).toBe(0);
    const argv = JSON.parse(fs.readFileSync(path.join(dir, "observed-argv.json"), "utf8"));
    expect(argv.slice(-4)).toEqual(["resume", "--json", "old-thread", "continue"]);
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it("rejects resume in independent review mode", () => {
    const { exitCode, output } = run([
      "--mode", "review", "--prompt", "review", "--model", "gpt-5.4",
      "--evidence-file", evidenceFile, "--resume", "old-thread",
    ]);
    expect(exitCode).toBe(2);
    expect(output.status).toBe("blocked");
    expect(fs.existsSync(evidenceFile)).toBe(false);
  });

  it("persists stdout/stderr evidence without leaking stderr", () => {
    const secret = "FAKE_TOKEN=synthetic";
    const shim = writeFakeCodexShim(dir, codexEvents("thread-4"), 0, secret);
    const { exitCode, output, stdout } = run([
      "--mode", "review", "--prompt", "review", "--model", "gpt-5.4",
      "--evidence-file", evidenceFile, "--command", shim,
    ]);
    expect(exitCode).toBe(0);
    expect(fs.readFileSync(output.stderrEvidenceFile, "utf8")).toBe(secret);
    expect(fs.readFileSync(output.stdoutEvidenceFile, "utf8")).toContain('"turn.completed"');
    expect(stdout).not.toContain(secret);
  });

  it("prefers CODEX_COMMAND, then PATH, before the macOS app fallback", () => {
    const pathDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "run-codex-path-")));
    const pathCodex = path.join(pathDir, "codex");
    fs.writeFileSync(pathCodex, "#!/bin/sh\n", { mode: 0o755 });
    expect(defaultCodexCommand({ CODEX_COMMAND: "/custom/codex", PATH: pathDir }, "darwin")).toBe("/custom/codex");
    expect(defaultCodexCommand({ PATH: pathDir }, "darwin")).toBe(pathCodex);
    fs.rmSync(pathDir, { recursive: true, force: true });
  });

  it("ignores empty and relative PATH segments and never returns a bare codex name", () => {
    const cwdDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "run-codex-cwd-")));
    const emptyDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "run-codex-empty-")));
    const realDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "run-codex-real-")));
    const cwdFake = path.join(cwdDir, "codex");
    const realCodex = path.join(realDir, "codex");
    fs.writeFileSync(cwdFake, "#!/bin/sh\n", { mode: 0o755 });
    fs.writeFileSync(realCodex, "#!/bin/sh\n", { mode: 0o755 });
    const d = path.delimiter;
    const prevCwd = process.cwd();
    try {
      process.chdir(cwdDir);
      for (const pathValue of [`${d}${emptyDir}`, `${emptyDir}${d}`, `${emptyDir}${d}${d}${emptyDir}`, `.${d}bin`, `bin${d}.`, "."]) {
        expect(findExecutableOnPath("codex", pathValue)).toBeNull();
        expect(defaultCodexCommand({ PATH: pathValue }, "linux")).toBeNull();
      }
      expect(findExecutableOnPath("codex", `${d}${realDir}${d}`)).toBe(realCodex);
      expect(defaultCodexCommand({ PATH: `${d}${realDir}${d}` }, "linux")).toBe(realCodex);
    } finally {
      process.chdir(prevCwd);
      fs.rmSync(cwdDir, { recursive: true, force: true });
      fs.rmSync(emptyDir, { recursive: true, force: true });
      fs.rmSync(realDir, { recursive: true, force: true });
    }
  });

  it("falls back to the macOS app bundled Codex only when PATH has no absolute-dir match", () => {
    const bundled = "/Applications/ChatGPT.app/Contents/Resources/codex";
    const expected = process.platform === "darwin" && fs.existsSync(bundled) ? bundled : null;
    expect(defaultCodexCommand({ PATH: "" }, process.platform)).toBe(expected);
    expect(defaultCodexCommand({ PATH: "" }, "darwin", { macosAppCodex: "/no/such/app/codex" })).toBeNull();
  });

  it("integration: relative PATH + cwd fake codex does not execute; reports executor_unavailable", async () => {
    const marker = path.join(dir, "fake-was-executed");
    const fake = path.join(dir, "codex");
    fs.writeFileSync(fake, `#!/bin/sh\necho ran > ${JSON.stringify(marker)}\n`, { mode: 0o755 });
    const prevCwd = process.cwd();
    const chunks: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    (process.stdout.write as typeof process.stdout.write) = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      process.chdir(dir);
      delete process.env.CODEX_COMMAND;
      const code = await main(
        ["--mode", "investigate", "--prompt", "q", "--model", "gpt-5.4", "--evidence-file", evidenceFile],
        { platform: "linux", macosAppCodex: null, env: { ...process.env, PATH: `.${path.delimiter}bin` } },
      );
      expect(code).toBe(3);
      expect(fs.existsSync(marker)).toBe(false);
      expect(fs.existsSync(evidenceFile)).toBe(true);
      const summary = JSON.parse(chunks.join("").trim());
      expect(summary.status).toBe("executor_unavailable");
    } finally {
      process.stdout.write = originalWrite;
      process.chdir(prevCwd);
    }
  });

  it("code mode: undiscovered command + evidence setup failure releases lock and emits one structured failure", async () => {
    const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "run-codex-lock-ws-")));
    const lockDir = fs.mkdtempSync(path.join(os.tmpdir(), "run-codex-locks-"));
    const badEvidence = path.join(workspace, "ev", "out.jsonl");
    const okEvidence = path.join(workspace, "ok.jsonl");
    const chunks: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    (process.stdout.write as typeof process.stdout.write) = ((chunk: string | Uint8Array) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk));
      return true;
    }) as typeof process.stdout.write;
    const prevLock = process.env.PI_EXECUTOR_LOCK_DIR;
    try {
      process.env.PI_EXECUTOR_LOCK_DIR = lockDir;
      delete process.env.CODEX_COMMAND;
      const code = await main(
        [
          "--mode", "code", "--prompt", "q", "--model", "gpt-5.4",
          "--evidence-file", badEvidence, "--workspace", workspace,
        ],
        {
          platform: "linux",
          macosAppCodex: null,
          env: { ...process.env, PATH: `.${path.delimiter}bin`, PI_EXECUTOR_LOCK_DIR: lockDir },
          evidenceDeps: {
            mkdirSync() {
              throw Object.assign(new Error("injected mkdir failure"), { code: "EACCES" });
            },
          },
        },
      );
      expect(code).toBe(1);
      const lines = chunks.join("").trim().split("\n").filter(Boolean);
      expect(lines).toHaveLength(1);
      const summary = JSON.parse(lines[0]);
      expect(summary.status).toBe("failure");
      expect(summary.parseError).toMatch(/injected mkdir failure/);

      chunks.length = 0;
      const shim = writeFakeCodexShim(dir, codexEvents("thread-lock", "reacquired"));
      const code2 = await main(
        [
          "--mode", "code", "--prompt", "again", "--model", "gpt-5.4",
          "--evidence-file", okEvidence, "--workspace", workspace, "--command", shim,
        ],
        { env: { ...process.env, PI_EXECUTOR_LOCK_DIR: lockDir } },
      );
      expect(code2).toBe(0);
      const summary2 = JSON.parse(chunks.join("").trim());
      expect(summary2.status).toBe("success");
      expect(summary2.sessionId).toBe("thread-lock");
    } finally {
      process.stdout.write = originalWrite;
      if (prevLock === undefined) delete process.env.PI_EXECUTOR_LOCK_DIR;
      else process.env.PI_EXECUTOR_LOCK_DIR = prevLock;
      fs.rmSync(workspace, { recursive: true, force: true });
      fs.rmSync(lockDir, { recursive: true, force: true });
    }
  });

  it("code mode: stdout stream error returns structured failure and releases lock for reacquisition", async () => {
    const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "run-codex-stream-ws-")));
    const lockDir = fs.mkdtempSync(path.join(os.tmpdir(), "run-codex-stream-locks-"));
    const evidence1 = path.join(workspace, "stream-fail.jsonl");
    const evidence2 = path.join(workspace, "stream-ok.jsonl");
    const chunks: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    (process.stdout.write as typeof process.stdout.write) = ((chunk: string | Uint8Array) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk));
      return true;
    }) as typeof process.stdout.write;
    const prevLock = process.env.PI_EXECUTOR_LOCK_DIR;

    const spawnWithStdoutError = () => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      queueMicrotask(() => {
        child.stdout.emit("error", Object.assign(new Error("injected stdout stream error"), { code: "EIO" }));
        child.emit("close", 1, null);
      });
      return child;
    };

    try {
      process.env.PI_EXECUTOR_LOCK_DIR = lockDir;
      const code = await main(
        [
          "--mode", "code", "--prompt", "q", "--model", "gpt-5.4",
          "--evidence-file", evidence1, "--workspace", workspace, "--command", "/bin/true",
        ],
        {
          env: { ...process.env, PI_EXECUTOR_LOCK_DIR: lockDir },
          evidenceDeps: { spawn: spawnWithStdoutError },
        },
      );
      expect(code).toBe(1);
      const lines = chunks.join("").trim().split("\n").filter(Boolean);
      expect(lines).toHaveLength(1);
      const summary = JSON.parse(lines[0]);
      expect(summary.status).toBe("failure");
      expect(summary.parseError).toMatch(/injected stdout stream error/);

      chunks.length = 0;
      const shim = writeFakeCodexShim(dir, codexEvents("thread-stream", "after-stream-error"));
      const code2 = await main(
        [
          "--mode", "code", "--prompt", "again", "--model", "gpt-5.4",
          "--evidence-file", evidence2, "--workspace", workspace, "--command", shim,
        ],
        { env: { ...process.env, PI_EXECUTOR_LOCK_DIR: lockDir } },
      );
      expect(code2).toBe(0);
      const summary2 = JSON.parse(chunks.join("").trim());
      expect(summary2.status).toBe("success");
      expect(summary2.sessionId).toBe("thread-stream");
    } finally {
      process.stdout.write = originalWrite;
      if (prevLock === undefined) delete process.env.PI_EXECUTOR_LOCK_DIR;
      else process.env.PI_EXECUTOR_LOCK_DIR = prevLock;
      fs.rmSync(workspace, { recursive: true, force: true });
      fs.rmSync(lockDir, { recursive: true, force: true });
    }
  });

  it("reports executor_unavailable without fallback", () => {
    const { exitCode, output } = run([
      "--mode", "investigate", "--prompt", "q", "--model", "gpt-5.4",
      "--evidence-file", evidenceFile, "--command", path.join(dir, "missing"),
    ]);
    expect(exitCode).toBe(3);
    expect(output.status).toBe("executor_unavailable");
    expect(fs.existsSync(output.stdoutEvidenceFile)).toBe(true);
  });

  it("rejects --argv-prefix so it cannot inject executor global flags", () => {
    const { exitCode, output } = run([
      "--mode", "investigate", "--prompt", "q", "--model", "gpt-5.4",
      "--evidence-file", evidenceFile, "--argv-prefix", "--dangerously-bypass-approvals-and-sandbox",
    ]);
    expect(exitCode).toBe(2);
    expect(output.status).toBe("blocked");
    expect(output.reason).toMatch(/argv-prefix/);
  });

  it("reports turn.failed as failure even when process exits zero", () => {
    const shim = writeFakeCodexShim(dir, [
      { type: "thread.started", thread_id: "thread-5" },
      { type: "turn.started" },
      { type: "turn.failed", error: { message: "denied" } },
    ]);
    const { exitCode, output } = run([
      "--mode", "investigate", "--prompt", "q", "--model", "gpt-5.4",
      "--evidence-file", evidenceFile, "--command", shim,
    ]);
    expect(exitCode).toBe(1);
    expect(output).toMatchObject({ status: "failure", isError: true, result: "denied" });
  });

  it("rejects incomplete JSONL terminal output", () => {
    const shim = writeFakeCodexShim(dir, [{ type: "thread.started", thread_id: "thread-6" }, { type: "turn.started" }]);
    const { exitCode, output } = run([
      "--mode", "investigate", "--prompt", "q", "--model", "gpt-5.4",
      "--evidence-file", evidenceFile, "--command", shim,
    ]);
    expect(exitCode).toBe(1);
    expect(output.parseError).toContain("terminal");
  });

  it("reports failure for malformed JSONL and keeps stdout/stderr evidence", () => {
    const shim = path.join(dir, "bad-jsonl");
    fs.writeFileSync(
      shim,
      `#!/usr/bin/env node\nprocess.stdout.write("not-json-at-all\\n"); process.stderr.write("trace"); process.exit(0);\n`,
      { mode: 0o755 },
    );
    const { exitCode, output } = run([
      "--mode", "investigate", "--prompt", "q", "--model", "gpt-5.4",
      "--evidence-file", evidenceFile, "--command", shim,
    ]);
    expect(exitCode).toBe(1);
    expect(output.status).toBe("failure");
    expect(output.parseError).toMatch(/invalid JSONL/);
    expect(fs.readFileSync(output.stdoutEvidenceFile, "utf8")).toContain("not-json-at-all");
    expect(fs.readFileSync(output.stderrEvidenceFile, "utf8")).toBe("trace");
  });

  it("handles >1 MiB JSONL stdout without ENOBUFS; capture is bounded and full evidence remains", () => {
    const shim = path.join(dir, "large-codex");
    const total = 1100000;
    fs.writeFileSync(
      shim,
      `#!/usr/bin/env node\nconst fs=require("fs");fs.writeSync(1,"z".repeat(${total})+"\\n");\n`,
      { mode: 0o755 },
    );
    const { exitCode, output, stdout } = run([
      "--mode", "investigate", "--prompt", "q", "--model", "gpt-5.4",
      "--evidence-file", evidenceFile, "--command", shim,
    ]);
    expect(exitCode).toBe(1);
    expect(output.status).toBe("failure");
    expect(output.status).not.toBe("executor_unavailable");
    expect(output.parseError).toMatch(/capture limit/);
    expect(fs.statSync(output.stdoutEvidenceFile).size).toBe(total + 1); // + newline
    expect(fs.statSync(output.stdoutEvidenceFile).size).toBeGreaterThan(1024 * 1024);
    expect(stdout.length).toBeLessThan(10_000);
  });
});
