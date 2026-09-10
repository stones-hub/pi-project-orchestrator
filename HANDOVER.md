# Handover

## 当前状态：v0.2.0 公开发布候选

本仓库正在准备作为 Pi 原生 Git package 公开发布（目标标签 `v0.2.0`）。当前
仍然没有任何 Git commit、tag 或推送；下面描述的是本机工作区的候选状态。

## 已完成内容

- Skill 本体位于 `skill/project-development-orchestrator/`：`SKILL.md`、5 个
  `references/*.md`、5 个 `templates/*.md`、两个执行器 wrapper
  （`scripts/run-claude`、`scripts/run-cursor`）、共用的工作区写锁实现
  （`scripts/workspace-write-lock.js`）及其测试。
- 两个 wrapper 用真实本机验证过的 CLI 参数形状实现（Claude Code
  investigate/code/review、Cursor investigate/code/review，含 `--sandbox`
  显式值），argv 用数组传给 `spawnSync`，不拼 shell 字符串；不自动
  fallback/重试/commit/push/deploy；不读取或保存凭证。stdout/stderr 分别落盘
  为独立证据文件，摘要 JSON 不回显原始内容。
- 同一真实工作区同一时刻只允许一个有写权限的编码 Agent
  （`workspace-write-lock.js`），只读调用不占锁，不同工作区互不阻塞。
- 公开发布打包：新增 `LICENSE`（MIT）、`CHANGELOG.md`；`package.json` 新增
  `pi-package` keyword 和显式 `pi.skills` manifest 指向
  `skill/project-development-orchestrator`；`README.md`、
  `docs/installation-guide.md` 改为以固定 tag 的
  `pi install git:github.com/stones-hub/pi-project-orchestrator@<tag>` 作为
  推荐安装方式，保留手工复制方式给 Skill 开发/贡献者使用；`docs/design.md`
  的 Skill 目录结构说明补齐了写锁实现和测试文件。
- 第二轮窄修：`package.json` 的 `engines.node` 改成
  `^22.19.0 || ^24.0.0 || >=26.0.0`（同时满足 Pi 0.85.1 的 `>=22.19.0` 下限
  和 vitest 5 实际支持的 `^22.12.0 || ^24.0.0 || >=26.0.0`，不再用会误纳
  Node 23.x/25.x 的简单 `>=22.19.0`）；用 `npm install --package-lock-only`
  把这个 `engines` 和 `license` 同步进 `package-lock.json` 根 package 条目
  （已核对未改动任何依赖解析版本）；README 的 Pi 链接改成安装包
  `package.json` 自己声明的 `repository` 地址，不再链接可能只是组织首页的
  URL。

## 已验证内容

- `npm test`（vitest）：`tests/run-claude.test.ts`、`tests/run-cursor.test.ts`
  全部通过。
- `node --test skill/project-development-orchestrator/scripts/workspace-write-lock.test.js`：
  通过。
- 两个 wrapper 和 `workspace-write-lock.js` 的 `node --check` 语法检查通过。
- `git diff --check`：本仓库当前没有 HEAD（无任何 commit），已改用适用于
  未跟踪文件的等价检查（对每个待发布文件单独跑
  `git diff --no-index --check /dev/null <file>` 或等效方式）确认没有空白/
  冲突标记问题；这不是标准 `git diff --check` 的完整替代，属于本轮的已知
  限制。
- 用本机已安装的 Pi（0.85.1）核对了 `package.json` 的 `pi.skills` manifest
  能被正确解析。方法：在独立的临时目录里跑
  `pi install <本仓库路径> -l -a` 完成一次隔离的项目级 package 安装（只写入
  临时目录自己的 `.pi/settings.json`，未触碰全局配置或本仓库），再直接调用
  `pi` CLI 自身源码里的 `DefaultResourceLoader`（与真实 CLI 启动时相同的
  代码路径）对该临时项目做 `reload()` + `getSkills()`。
  - 用真实的本机 `agentDir`（已装有一份手工同步的同名 Skill）探测时，
    manifest 指向的 Skill 被正确解析、命名为
    `project-development-orchestrator`，但在最终列表里以“collision”
    诊断的 loser 身份出现——因为 user-scope 已有同名同内容 Skill 优先命中，
    这是 Pi 的正常去重/优先级规则，不是打包缺陷；collision 诊断本身反而
    证明 manifest 路径被成功发现和解析。
  - 用一个空的 `agentDir`（模拟没有预装该 Skill 的干净机器）重新探测，
    manifest 指向的 Skill 被正确解析且没有任何 diagnostics，确认在没有
    本机既有安装冲突的环境下，Git package 安装能让 Pi 干净发现该 Skill。
  - 两次探测用的临时目录和脚本均在验证后删除，未污染全局或本仓库配置。

## 未解决问题 / 未验证项

- 尚未创建/推送 `v0.2.0` tag，因此 README/安装指南中的
  `pi install git:github.com/stones-hub/pi-project-orchestrator@v0.2.0` 命令
  本身未在真实网络环境跑通；这需要在获得 commit/push/tag 授权之后才能验证。
- 未做真实 Pi 新项目端到端验收（讨论 → 调查 → 授权编码 → Agent 编码 → Pi
  diff/测试 → 本机候选启动和业务验收 → 复审/窄修 → HANDOVER 续接）。

## 下一步

1. 用户复核本次公开发布打包改动（README、安装指南、LICENSE、CHANGELOG、
   `package.json` manifest、`docs/design.md` 结构说明、本文件）。
2. 复核通过后，由用户分别授权 commit、push 和创建 `v0.2.0` tag。
3. tag 推送后，实际执行一次
   `pi install git:github.com/stones-hub/pi-project-orchestrator@v0.2.0`
   做真实网络安装验收，确认 Pi 能发现并加载 `project-development-orchestrator`
   Skill。
4. 在一个新的测试项目中走完整“接入 → 讨论 → 只读调查 → 授权编码 → 编码 →
   Pi diff/测试 → 本机候选启动和业务验收 → 复审/窄修 → 交接续接”流程。

## 执行器会话信息

本次公开发布打包（含本轮两次窄修）由 Pi 通过已安装 Skill 的
`scripts/run-claude --mode code` 调用 Claude Code 执行，并在窄修轮次中
resume 同一会话（公开 HANDOVER 不写本机具体安装绝对路径）：

- 请求模型：`sonnet`
- 响应中实际证明使用的模型：`claude-sonnet-5`
- session_id：`6b401440-2b24-4d8e-ada8-3124886b1630`
- 基线：本仓库当前没有任何 Git commit（无 HEAD），本次改动全部落在未跟踪
  文件上；候选状态就是这些未跟踪文件本身，commit/push/tag 均未执行。
