import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

const WRAPPER = path.resolve(__dirname, "../skill/project-development-orchestrator/scripts/run-cursor");

function writeFakeCursor(dir: string, outputJson: unknown, exitCode = 0, stderrText = "") {
  const file = path.join(dir, "fake-cursor.js");
  fs.writeFileSync(
    file,
    `const fs=require("fs");fs.writeFileSync(${JSON.stringify(path.join(dir, "observed-argv.json"))}, JSON.stringify(process.argv.slice(2)));` +
      `fs.writeFileSync(${JSON.stringify(path.join(dir, "observed-cwd.txt"))}, process.cwd());` +
      `process.stderr.write(${JSON.stringify(stderrText)});` +
      `process.stdout.write(${JSON.stringify(JSON.stringify(outputJson))}); process.exit(${exitCode});`,
    "utf8",
  );
  return file;
}

function run(args: string[]) {
  try {
    const stdout = execFileSync(process.execPath, [WRAPPER, ...args], { encoding: "utf8" });
    return { exitCode: 0, stdout, output: JSON.parse(stdout) };
  } catch (err) {
    const e = err as { status: number; stdout: string };
    return { exitCode: e.status, stdout: e.stdout, output: JSON.parse(e.stdout) };
  }
}

describe("scripts/run-cursor", () => {
  let dir: string;
  let evidenceFile: string;

  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "run-cursor-")));
    evidenceFile = path.join(dir, "evidence.json");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("builds the read-only argv shape (--mode plan, no --force)", () => {
    const script = writeFakeCursor(dir, { session_id: "c1", is_error: false, result: "ok", usage: {} });
    const { exitCode, output } = run([
      "--mode",
      "investigate",
      "--prompt",
      "find the auth module",
      "--model",
      "auto",
      "--evidence-file",
      evidenceFile,
      "--command",
      process.execPath,
      "--argv-prefix",
      script,
    ]);
    expect(exitCode).toBe(0);
    expect(output.status).toBe("success");
    expect(output.sessionId).toBe("c1");

    const argv = JSON.parse(fs.readFileSync(path.join(dir, "observed-argv.json"), "utf8"));
    expect(argv).toEqual(["-p", "find the auth module", "--trust", "--mode", "plan", "--output-format", "json", "--model", "auto"]);
  });

  it("always passes an explicit --sandbox value in code mode (never bare --sandbox)", () => {
    const script = writeFakeCursor(dir, { session_id: "c2", is_error: false, result: "done", usage: {} });
    const { exitCode } = run([
      "--mode",
      "code",
      "--prompt",
      "fix it",
      "--model",
      "auto",
      "--evidence-file",
      evidenceFile,
      "--command",
      process.execPath,
      "--argv-prefix",
      script,
    ]);
    expect(exitCode).toBe(0);
    const argv = JSON.parse(fs.readFileSync(path.join(dir, "observed-argv.json"), "utf8"));
    expect(argv).toEqual([
      "-p",
      "fix it",
      "--trust",
      "--force",
      "--sandbox",
      "enabled",
      "--output-format",
      "json",
      "--model",
      "auto",
    ]);
  });

  it("--no-sandbox passes an explicit disabled value, still never bare", () => {
    const script = writeFakeCursor(dir, { session_id: "c3", is_error: false, result: "done", usage: {} });
    run([
      "--mode",
      "code",
      "--prompt",
      "fix it",
      "--model",
      "auto",
      "--evidence-file",
      evidenceFile,
      "--no-sandbox",
      "--command",
      process.execPath,
      "--argv-prefix",
      script,
    ]);
    const argv = JSON.parse(fs.readFileSync(path.join(dir, "observed-argv.json"), "utf8"));
    expect(argv).toContain("--sandbox");
    expect(argv[argv.indexOf("--sandbox") + 1]).toBe("disabled");
  });

  it("resolves a relative --workspace to an absolute path and binds it as the spawned process cwd", () => {
    const workspaceAbs = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "run-cursor-ws-")));
    const relWorkspace = path.relative(process.cwd(), workspaceAbs);
    const script = writeFakeCursor(dir, { session_id: "wcwd", is_error: false, result: "ok", usage: {} });
    const { exitCode } = run([
      "--mode",
      "investigate",
      "--prompt",
      "q",
      "--model",
      "auto",
      "--evidence-file",
      evidenceFile,
      "--workspace",
      relWorkspace,
      "--command",
      process.execPath,
      "--argv-prefix",
      script,
    ]);
    expect(exitCode).toBe(0);
    expect(fs.readFileSync(path.join(dir, "observed-cwd.txt"), "utf8")).toBe(workspaceAbs);
    fs.rmSync(workspaceAbs, { recursive: true, force: true });
  });

  it("passes the same resolved absolute workspace path as the --workspace argv value", () => {
    const workspaceAbs = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "run-cursor-ws-")));
    const relWorkspace = path.relative(process.cwd(), workspaceAbs);
    const script = writeFakeCursor(dir, { session_id: "wargv", is_error: false, result: "ok", usage: {} });
    const { exitCode } = run([
      "--mode",
      "investigate",
      "--prompt",
      "q",
      "--model",
      "auto",
      "--evidence-file",
      evidenceFile,
      "--workspace",
      relWorkspace,
      "--command",
      process.execPath,
      "--argv-prefix",
      script,
    ]);
    expect(exitCode).toBe(0);
    const argv = JSON.parse(fs.readFileSync(path.join(dir, "observed-argv.json"), "utf8"));
    expect(argv).toContain("--workspace");
    expect(argv[argv.indexOf("--workspace") + 1]).toBe(workspaceAbs);
    fs.rmSync(workspaceAbs, { recursive: true, force: true });
  });

  it("writes the raw stdout to the evidence file", () => {
    const script = writeFakeCursor(dir, { session_id: "evid", is_error: false, result: "ok", usage: {} });
    const { exitCode } = run([
      "--mode",
      "investigate",
      "--prompt",
      "q",
      "--model",
      "auto",
      "--evidence-file",
      evidenceFile,
      "--command",
      process.execPath,
      "--argv-prefix",
      script,
    ]);
    expect(exitCode).toBe(0);
    expect(fs.readFileSync(evidenceFile, "utf8")).toBe(JSON.stringify({ session_id: "evid", is_error: false, result: "ok", usage: {} }));
  });

  it("passes --resume through to argv in investigate mode", () => {
    const script = writeFakeCursor(dir, { session_id: "res1", is_error: false, result: "ok", usage: {} });
    const { exitCode } = run([
      "--mode",
      "investigate",
      "--prompt",
      "q",
      "--model",
      "auto",
      "--evidence-file",
      evidenceFile,
      "--resume",
      "prev-chat",
      "--command",
      process.execPath,
      "--argv-prefix",
      script,
    ]);
    expect(exitCode).toBe(0);
    const argv = JSON.parse(fs.readFileSync(path.join(dir, "observed-argv.json"), "utf8"));
    expect(argv).toContain("--resume");
    expect(argv[argv.indexOf("--resume") + 1]).toBe("prev-chat");
  });

  it("rejects --resume combined with --mode review before spawning anything", () => {
    const { exitCode, output } = run([
      "--mode",
      "review",
      "--prompt",
      "review this",
      "--model",
      "auto",
      "--evidence-file",
      evidenceFile,
      "--resume",
      "prev-chat",
    ]);
    expect(exitCode).toBe(2);
    expect(output.status).toBe("blocked");
    expect(fs.existsSync(evidenceFile)).toBe(false);
  });

  it("accepts chatId as a session identifier when session_id is absent", () => {
    const script = writeFakeCursor(dir, { chatId: "chat-1", is_error: false, result: "ok", usage: {} });
    const { exitCode, output } = run([
      "--mode",
      "investigate",
      "--prompt",
      "q",
      "--model",
      "auto",
      "--evidence-file",
      evidenceFile,
      "--command",
      process.execPath,
      "--argv-prefix",
      script,
    ]);
    expect(exitCode).toBe(0);
    expect(output.sessionId).toBe("chat-1");
  });

  it("parses the last valid JSON line for stream-json output", () => {
    const file = path.join(dir, "fake-cursor-stream.js");
    fs.writeFileSync(
      file,
      `process.stdout.write('{"event":"partial"}\\n');` +
        `process.stdout.write(${JSON.stringify(JSON.stringify({ session_id: "c4", is_error: false, result: "final", usage: {} }))});`,
      "utf8",
    );
    const { exitCode, output } = run([
      "--mode",
      "investigate",
      "--prompt",
      "q",
      "--model",
      "auto",
      "--evidence-file",
      evidenceFile,
      "--command",
      process.execPath,
      "--argv-prefix",
      file,
    ]);
    expect(exitCode).toBe(0);
    expect(output.sessionId).toBe("c4");
    expect(output.result).toBe("final");
  });

  it("reports executor_unavailable without a fallback when the binary is missing", () => {
    const { exitCode, output } = run([
      "--mode",
      "investigate",
      "--prompt",
      "q",
      "--model",
      "auto",
      "--evidence-file",
      evidenceFile,
      "--command",
      path.join(dir, "does-not-exist-binary"),
    ]);
    expect(exitCode).toBe(3);
    expect(output.status).toBe("executor_unavailable");
  });

  it("persists stdout and stderr to separate evidence files and returns both paths without leaking raw content in the summary", () => {
    const secret = "FAKE_TOKEN=sk-synthetic-not-a-real-credential";
    const script = writeFakeCursor(dir, { session_id: "c6", is_error: false, result: "ok", usage: {} }, 0, secret);
    const { exitCode, output, stdout } = run([
      "--mode",
      "investigate",
      "--prompt",
      "q",
      "--model",
      "auto",
      "--evidence-file",
      evidenceFile,
      "--command",
      process.execPath,
      "--argv-prefix",
      script,
    ]);
    expect(exitCode).toBe(0);
    expect(output.stdoutEvidenceFile).toBe(path.resolve(evidenceFile));
    expect(output.stderrEvidenceFile).toBe(`${path.resolve(evidenceFile)}.stderr`);
    expect(fs.readFileSync(output.stderrEvidenceFile, "utf8")).toBe(secret);
    expect(stdout).not.toContain(secret);
    expect(output.evidenceFile).toBeUndefined();
  });

  it("does not report success when the response JSON has a session id but no terminal result/is_error shape", () => {
    const script = writeFakeCursor(dir, { session_id: "c7", usage: {} });
    const { exitCode, output } = run([
      "--mode",
      "investigate",
      "--prompt",
      "q",
      "--model",
      "auto",
      "--evidence-file",
      evidenceFile,
      "--command",
      process.execPath,
      "--argv-prefix",
      script,
    ]);
    expect(exitCode).toBe(1);
    expect(output.status).toBe("failure");
    expect(output.ok).toBe(false);
  });

  it("reports failure when is_error is true even with exit code 0", () => {
    const script = writeFakeCursor(dir, { session_id: "c8", is_error: true, result: "denied", usage: {} });
    const { exitCode, output } = run([
      "--mode",
      "investigate",
      "--prompt",
      "q",
      "--model",
      "auto",
      "--evidence-file",
      evidenceFile,
      "--command",
      process.execPath,
      "--argv-prefix",
      script,
    ]);
    expect(exitCode).toBe(1);
    expect(output.status).toBe("failure");
  });
});
