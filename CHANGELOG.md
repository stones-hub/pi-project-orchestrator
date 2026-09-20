# Changelog

本文件记录 `pi-project-orchestrator` 各版本的内容。格式参考
[Keep a Changelog](https://keepachangelog.com/)。

## [v0.3.0] — 2026-09-20

### 新增

- OpenAI Codex CLI 成为与 Claude Code、Cursor 同级的可选执行器，支持调查、
  编码、窄修和独立复审。
- `scripts/run-codex`：封装 Codex 非交互 `exec --json` / `exec resume`，按模式
  使用 `read-only` 或 `workspace-write` 沙箱，输出结构化摘要并保存 stdout/stderr
  证据。
- `references/codex.md` 与 `tests/run-codex.test.ts`：记录 Codex CLI 0.155.1
  参数/JSONL 契约和 fake-CLI 契约测试。

### 变更

- 三个执行器的 `code` 模式共用现有按真实工作区划分的写锁；模板、README、设计
  与安装指南同步支持 Codex。
- Codex CLI 发现优先使用 `CODEX_COMMAND` / `--command`（调用方显式信任覆盖）和
  PATH 中绝对目录下的独立 CLI；忽略空段与相对 PATH 项，失败时不回退裸命令名；
  macOS App 内置 CLI 仅作为明确回退。
- 三个 wrapper 移除生产 `--argv-prefix` 测试缝；共用异步 `spawn-with-evidence`
  边写证据文件（完整写循环、spawn 前打开证据 FD），内存解析缓冲固定 1 MiB/流，
  超出判 `failure` 并保留完整落盘证据，避免大输出 ENOBUFS 错报
  `executor_unavailable`。

### 验证

- 已通过 PATH 中独立安装的 `codex-cli 0.155.1`，使用第三方 provider 的
  `gpt-5.6-terra` 完成 `run-codex --mode investigate` 真实只读探针；PATH 加固后
  重新探针仍返回预期结果，调用前后 Git 工作区状态一致。

### 已知限制

- Codex JSONL 终态事件未提供可证明的实际模型字段，wrapper 摘要中的 `model`
  保持为 `null`，不能用请求模型名冒充响应证据。

## [v0.2.0] — 2026-09-20

### 新增

- `project-development-orchestrator` Pi Skill：`SKILL.md`、5 个
  `references/*.md`（development-workflow、claude-code、cursor、
  testing-and-review、git-deployment）、5 个 `templates/*.md`
  （AGENTS、CLAUDE、HANDOVER、task、deployment）。
- 两个薄 CLI 执行器 wrapper：`scripts/run-claude`、`scripts/run-cursor`，
  分别封装真实 `claude`/`cursor-agent` 参数形状，输出结构化 JSON 摘要和
  独立的 stdout/stderr 证据文件。
- `scripts/workspace-write-lock.js`：跨 `run-claude`/`run-cursor` 共用的
  按工作区真实路径划分的写锁，保证同一工作区同一时刻只有一个有写权限的
  编码 Agent，只读调用不占锁。
- `tests/run-claude.test.ts`、`tests/run-cursor.test.ts`：两个 wrapper 的
  fake-CLI 契约测试（vitest）。
- `skill/project-development-orchestrator/scripts/workspace-write-lock.test.js`：
  写锁的跨进程场景测试（`node --test`）。
- 面向公开发布的打包元数据：`LICENSE`（MIT）、`package.json` 中的
  `pi-package` keyword 与显式 `pi.skills` manifest，用于 Pi 的 Git package
  安装和发现。

### 变更

- `README.md`、`docs/installation-guide.md` 改为以固定 tag 的
  `pi install git:github.com/stones-hub/pi-project-orchestrator@<tag>` 作为
  推荐安装方式，保留手工复制方式作为 Skill 开发/贡献者本地调试用途。
- `HANDOVER.md` 重写为不含个人本机路径、备份归档信息和内部轮次历史的
  公开交接状态说明。
- `docs/design.md` 的 Skill 目录结构说明补齐写锁实现及其测试文件。

### 已知限制

- 未做真实 Pi 新项目端到端验收（讨论 → 调查 → 编码 → diff/测试 → 本机
  候选验收 → Git 部署）。
