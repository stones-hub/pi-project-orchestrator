import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

const WRAPPER = path.resolve(__dirname, "../skill/project-development-orchestrator/scripts/run-claude");

/** Write an executable shim that records argv and emits fixed stdout/stderr. */
function writeFakeClaudeShim(dir: string, outputJson: unknown, exitCode = 0, stderrText = "") {
  const shim = path.join(dir, "fake-claude");
  const observedArgv = path.join(dir, "observed-argv.json");
  const observedCwd = path.join(dir, "observed-cwd.txt");
  const body =
    `#!/usr/bin/env node\n` +
    `const fs=require("fs");` +
    `fs.writeFileSync(${JSON.stringify(observedArgv)}, JSON.stringify(process.argv.slice(2)));` +
    `fs.writeFileSync(${JSON.stringify(observedCwd)}, process.cwd());` +
    `process.stderr.write(${JSON.stringify(stderrText)});` +
    `process.stdout.write(${JSON.stringify(JSON.stringify(outputJson))});` +
    `process.exit(${exitCode});\n`;
  fs.writeFileSync(shim, body, { mode: 0o755 });
  return shim;
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

describe("scripts/run-claude", () => {
  let dir: string;
  let evidenceFile: string;

  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "run-claude-")));
    evidenceFile = path.join(dir, "evidence.json");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("builds the real investigate-mode argv shape and reports success", () => {
    const shim = writeFakeClaudeShim(dir, {
      session_id: "s1",
      is_error: false,
      result: "ok",
      modelUsage: { "claude-sonnet-5-20260101": { canonicalModel: "claude-sonnet-5-20260101" } },
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const { exitCode, output } = run([
      "--mode", "investigate", "--prompt", "find the auth module", "--model", "sonnet",
      "--evidence-file", evidenceFile, "--command", shim,
    ]);

    expect(exitCode).toBe(0);
    expect(output.status).toBe("success");
    expect(output.sessionId).toBe("s1");
    expect(output.model).toBe("claude-sonnet-5-20260101");

    const argv = JSON.parse(fs.readFileSync(path.join(dir, "observed-argv.json"), "utf8"));
    expect(argv).toEqual([
      "-p", "find the auth module",
      "--permission-mode", "plan",
      "--permission-prompts", "none",
      "--tools", "Read,Glob,Grep",
      "--disallowedTools", "mcp__*",
      "--strict-mcp-config",
      "--output-format", "json",
      "--model", "sonnet",
    ]);
    expect(fs.readFileSync(evidenceFile, "utf8")).toContain('"session_id":"s1"');
  });

  it("explicitly disables all MCP tools in both investigate and review read-only modes", () => {
    for (const mode of ["investigate", "review"]) {
      const localDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "run-claude-mcp-")));
      const localEvidence = path.join(localDir, "evidence.json");
      const shim = writeFakeClaudeShim(localDir, { session_id: "mcp1", is_error: false, result: "ok", usage: {} });
      const { exitCode } = run([
        "--mode", mode, "--prompt", "q", "--model", "sonnet",
        "--evidence-file", localEvidence, "--command", shim,
      ]);
      expect(exitCode).toBe(0);
      const argv = JSON.parse(fs.readFileSync(path.join(localDir, "observed-argv.json"), "utf8"));
      expect(argv).toContain("--strict-mcp-config");
      expect(argv).toContain("Read,Glob,Grep");
      expect(argv).toContain("--disallowedTools");
      expect(argv[argv.indexOf("--disallowedTools") + 1]).toBe("mcp__*");
      fs.rmSync(localDir, { recursive: true, force: true });
    }
  });

  it("builds the code-mode argv with allowedTools and resume", () => {
    const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "run-claude-code-")));
    const shim = writeFakeClaudeShim(dir, { session_id: "s2", is_error: false, result: "done", usage: {} });
    const { exitCode, output } = run([
      "--mode", "code", "--prompt", "fix the bug", "--model", "sonnet",
      "--evidence-file", evidenceFile, "--workspace", workspace, "--resume", "prev-session", "--command", shim,
    ]);
    expect(exitCode).toBe(0);
    expect(output.status).toBe("success");

    const argv = JSON.parse(fs.readFileSync(path.join(dir, "observed-argv.json"), "utf8"));
    expect(argv).toEqual([
      "-p", "fix the bug",
      "--permission-mode", "acceptEdits",
      "--permission-prompts", "none",
      "--allowedTools", "Read,Write,Edit,Bash,Glob,Grep",
      "--resume", "prev-session",
      "--output-format", "json",
      "--model", "sonnet",
    ]);
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it("rejects --resume combined with --mode review before spawning anything", () => {
    const { exitCode, output } = run([
      "--mode", "review", "--prompt", "review this", "--model", "sonnet",
      "--evidence-file", evidenceFile, "--resume", "prev-session",
    ]);
    expect(exitCode).toBe(2);
    expect(output.status).toBe("blocked");
    expect(fs.existsSync(evidenceFile)).toBe(false);
  });

  it("binds the spawned process cwd to --workspace", () => {
    const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "run-claude-ws-")));
    const shim = writeFakeClaudeShim(dir, { session_id: "s3", is_error: false, result: "ok", usage: {} });
    const { exitCode } = run([
      "--mode", "investigate", "--prompt", "q", "--model", "sonnet",
      "--evidence-file", evidenceFile, "--workspace", workspace, "--command", shim,
    ]);
    expect(exitCode).toBe(0);
    expect(fs.readFileSync(path.join(dir, "observed-cwd.txt"), "utf8")).toBe(workspace);
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it("reports executor_unavailable without a fallback when the binary is missing", () => {
    const { exitCode, output } = run([
      "--mode", "investigate", "--prompt", "q", "--model", "sonnet",
      "--evidence-file", evidenceFile, "--command", path.join(dir, "does-not-exist-binary"),
    ]);
    expect(exitCode).toBe(3);
    expect(output.status).toBe("executor_unavailable");
    expect(fs.existsSync(output.stdoutEvidenceFile)).toBe(true);
    expect(fs.existsSync(output.stderrEvidenceFile)).toBe(true);
  });

  it("rejects --argv-prefix and other unknown test seams", () => {
    const { exitCode, output } = run([
      "--mode", "investigate", "--prompt", "q", "--model", "sonnet",
      "--evidence-file", evidenceFile, "--argv-prefix", "inject",
    ]);
    expect(exitCode).toBe(2);
    expect(output.status).toBe("blocked");
    expect(output.reason).toMatch(/argv-prefix/);

    const unknown = run([
      "--mode", "investigate", "--prompt", "q", "--model", "sonnet",
      "--evidence-file", evidenceFile, "--dangerously-bypass",
    ]);
    expect(unknown.exitCode).toBe(2);
    expect(unknown.output.status).toBe("blocked");
    expect(unknown.output.reason).toMatch(/unknown argument/);
  });

  it("persists stdout and stderr to separate evidence files and returns both paths without leaking raw content in the summary", () => {
    const secret = "FAKE_TOKEN=sk-synthetic-not-a-real-credential";
    const shim = writeFakeClaudeShim(dir, { session_id: "s6", is_error: false, result: "ok", usage: {} }, 0, secret);
    const { exitCode, output, stdout } = run([
      "--mode", "investigate", "--prompt", "q", "--model", "sonnet",
      "--evidence-file", evidenceFile, "--command", shim,
    ]);
    expect(exitCode).toBe(0);
    expect(output.stdoutEvidenceFile).toBe(path.resolve(evidenceFile));
    expect(output.stderrEvidenceFile).toBe(`${path.resolve(evidenceFile)}.stderr`);
    expect(fs.readFileSync(output.stderrEvidenceFile, "utf8")).toBe(secret);
    expect(stdout).not.toContain(secret);
    expect(output.evidenceFile).toBeUndefined();
  });

  it("handles >1 MiB stdout without ENOBUFS; capture is bounded and full evidence remains", () => {
    const shim = path.join(dir, "large-claude");
    const total = 1100000;
    fs.writeFileSync(
      shim,
      `#!/usr/bin/env node\nconst fs=require("fs");fs.writeSync(1,"x".repeat(${total}));\n`,
      { mode: 0o755 },
    );
    const { exitCode, output, stdout } = run([
      "--mode", "investigate", "--prompt", "q", "--model", "sonnet",
      "--evidence-file", evidenceFile, "--command", shim,
    ]);
    expect(exitCode).toBe(1);
    expect(output.status).toBe("failure");
    expect(output.status).not.toBe("executor_unavailable");
    expect(output.parseError).toMatch(/capture limit/);
    expect(fs.statSync(output.stdoutEvidenceFile).size).toBe(total);
    expect(fs.statSync(output.stdoutEvidenceFile).size).toBeGreaterThan(1024 * 1024);
    expect(stdout.length).toBeLessThan(10_000);
  });

  it("does not report success when the response JSON has a session_id but no terminal result/is_error shape", () => {
    const shim = writeFakeClaudeShim(dir, { session_id: "s5", usage: {} });
    const { exitCode, output } = run([
      "--mode", "investigate", "--prompt", "q", "--model", "sonnet",
      "--evidence-file", evidenceFile, "--command", shim,
    ]);
    expect(exitCode).toBe(1);
    expect(output.status).toBe("failure");
    expect(output.ok).toBe(false);
  });

  it("reports failure when is_error is true even with exit code 0", () => {
    const shim = writeFakeClaudeShim(dir, { session_id: "s4", is_error: true, result: "denied", usage: {} });
    const { exitCode, output } = run([
      "--mode", "investigate", "--prompt", "q", "--model", "sonnet",
      "--evidence-file", evidenceFile, "--command", shim,
    ]);
    expect(exitCode).toBe(1);
    expect(output.status).toBe("failure");
  });
});
