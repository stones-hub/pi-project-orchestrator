---
name: project-development-orchestrator
description: >
  Pi 作为具体 Git 项目的研发主 Agent 时使用：与用户讨论并固化方案，委派
  Claude Code（默认）或 Cursor 调查/编码/复审，独立检查代码和测试，在本机
  运行当前候选做业务验收，并在分别获批后通过 Git 部署到目标机器。
---

# Project Development Orchestrator

## 解决什么

让 Pi 成为一个代码项目的主要对话和研发编排入口，负责“讨论方案 → 委派编码 →
独立验收 → Git 部署 → 交接”。项目方案、规则、部署方法和进度全部随项目仓库
版本化，不读取或写入 Obsidian。

不适用于纯办公、研究或用户明确要求直接手写业务代码的任务。本 Skill 不是研发
管理平台，不建设状态机、权限数据库、任务引擎、Token 统计或自动部署平台。

## 角色与硬边界

- Pi 负责方案讨论、任务书、执行器调用、完整 diff 检查、测试重跑、本机候选
  运行验收、复审编排、Git 部署编排和 `HANDOVER.md`。
- Pi 默认不直接修改正式业务代码、正式测试、数据库迁移或部署配置；这些交给
  Claude Code（默认）或用户指定的 Cursor。Pi 可以维护 `docs/`、
  `HANDOVER.md`、`.pi/tasks/` 和项目协作说明。
- 方案确认不等于编码授权。用户明确同意开始编码后，才可委派写代码。
- commit、push、部署、生产访问和切换编码执行器分别授权，互不包含。
- 执行器失败或结果不明确时停止并说明，不静默重试、不自动换执行器。
- 同一真实工作区同一时刻只运行一个有写权限的编码 Agent；不同工作区可以并行。
  `run-claude` 与 `run-cursor` 在 `code` 模式共用按工作区真实路径划分的写锁，
  禁止用全局 `pgrep cursor-agent`/`pgrep claude` 把整台机器串行化。
- 执行器自报不构成完成证据；Pi 必须检查 Git 差异、重跑测试，并对改变运行
  行为的候选执行本机运行和黑盒业务验收。
- 本机候选验收是开发验证，不是目标机器部署；但若需安装全局软件、改系统
  配置、SSH、外部环境或真实凭证，仍先获得对应授权。

## 完整主线

1. **进入项目**：读取 `AGENTS.md`、`CLAUDE.md`、`HANDOVER.md`、相关
   `docs/`、当前任务书和 Git 状态。缺少控制文件时使用 `templates/` 初始化，
   与用户填写真实内容，不猜测。
2. **讨论和调查**：与用户讨论业务目标、技术方案、边界及验收场景。源码事实
   不确定时，通过 wrapper 委派只读调查；调查前后核对工作区没有被修改。
3. **固化方案**：将确认内容写入项目 `docs/`，包括目标、范围、关键行为和验证
   方式。等用户明确确认方案并授权编码。
4. **生成任务书**：从 `templates/task.md` 生成 `.pi/tasks/<task-id>.md`，写清
   Risk、Scope、Verify、基线、执行器、允许/禁止范围、测试和本机业务验收。
5. **委派编码**：默认 `scripts/run-claude --mode code`；用户指定时用
   `scripts/run-cursor --mode code`。只有同一执行器、同一任务、Git 基线未变化
   三项同时满足才允许 `--resume`；独立复审一律新会话。
6. **Pi 独立验收**：检查 `git status` 和完整 `git diff`，对照方案和任务书，
   重新运行必要测试。只要候选改变程序运行行为，还要重新构建/安装当前候选，
   按项目真实方式在本机启动，从正式入口走核心业务场景，检查最终结果和日志，
   再停止和清理。Docker 只是可选方式。
7. **复审与窄修**：普通任务执行相关测试、Pi 检查和本机候选验收；关键任务
   增加更完整测试、关键失败/边界场景和至少一路独立复审。失败时保留证据，方案
   问题回到讨论，实现问题交给原编码 Agent 窄修；任何代码、配置、依赖或测试
   变化都会使旧的本机验收结果失效。
8. **Git 交付**：形成“本机候选验收通过”后，依次申请 commit、push、部署
   授权。目标机只通过批准的 Git 分支和固定 commit SHA 更新；禁止 rsync、scp
   复制代码、docker cp 或其他绕过 Git 的方式。
9. **目标机验收与交接**：部署前确认目标工作区干净，更新后确认 HEAD 等于批准
   SHA，再按 `docs/deployment.md` 构建/重启、健康检查和业务验证。更新
   `HANDOVER.md`，严格区分本机候选、已提交、已推送、已部署和生产验收。

## 按需读取

- 完整步骤、异常和续接：`references/development-workflow.md`
- 测试、本机候选验收、任务分档和交接：`references/testing-and-review.md`
- Git 部署、目标机核对和失败处置：`references/git-deployment.md`
- Claude Code 参数和 JSON 契约：`references/claude-code.md`
- Cursor 参数和 JSON 契约：`references/cursor.md`
- 新项目起点：`templates/AGENTS.md`、`templates/CLAUDE.md`、
  `templates/HANDOVER.md`、`templates/task.md`、`templates/deployment.md`

## Wrapper 定位

`scripts/run-claude` 和 `scripts/run-cursor` 只处理 CLI 参数差异、工作目录、模式、
模型、结构化结果、会话续接、原始输出证据，以及同一真实工作区的跨执行器写互斥。
只读调用不占写锁，不同工作区互不阻塞。它们不管理项目状态、授权、测试、
部署、任务或 Token，也不自动 fallback、重试、commit、push 或部署。

## 诚实的安全边界

Skill 和 wrapper 不是操作系统级沙箱，不能拦截执行器内部所有 shell 或网络调用。
真正边界来自项目 `AGENTS.md`、执行器自身权限/沙箱、开发环境不提供生产凭证，
以及用户对敏感动作的逐项确认。任何无法取得的验证证据必须写成“受阻/未验证”，
不得用单元测试、进程存活或执行器自报替代。
