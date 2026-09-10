# Changelog

本文件记录 `pi-project-orchestrator` 各版本的内容。格式参考
[Keep a Changelog](https://keepachangelog.com/)。

## [v0.2.0] — 发布候选

> **状态说明**：本仓库当前没有任何 Git commit、tag 或 GitHub Release；下面的
> 条目描述的是达到 v0.2.0 目标的候选内容，用于打包和复审，不代表
> `git:github.com/stones-hub/pi-project-orchestrator@v0.2.0` 已经可以安装。
> 该 tag 需要在候选通过验收、经用户授权 commit/push 后才会存在。

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

### 未验证 / 已知限制

- 尚未创建/推送 Git tag，因此未在真实网络环境验证
  `pi install git:github.com/stones-hub/pi-project-orchestrator@v0.2.0`
  这条命令本身；只验证了 `package.json` 的 `pi.skills` manifest 能被本机
  已安装的 Pi（0.85.1）正确解析并发现 `project-development-orchestrator`
  Skill（见 `HANDOVER.md`）。
- 未做真实 Pi 新项目端到端验收（讨论 → 调查 → 编码 → diff/测试 → 本机
  候选验收 → Git 部署）。
