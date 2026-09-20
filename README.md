# pi-project-orchestrator

一个轻量 Pi Skill：Pi 在具体 Git 项目中与用户讨论并固化方案，默认调用 Claude
Code，也可按用户指定调用 Cursor 或 Codex 做调查/编码/复审；编码后 Pi 独立检查
diff、重跑测试，并把当前候选按项目真实方式在本机运行起来，从正式入口完成业务
验收；候选通过后，再分别获批 commit、push 和目标机 Git 部署。

它不是研发平台，不含状态机、权限数据库、Token 统计、自动测试平台或自动部署
平台，也不强制项目使用 Docker。项目文档和状态全部保存在项目仓库，不以
Obsidian 为真源。

## 前提条件

- Node.js `^22.19.0 || ^24.0.0 || >=26.0.0`（与本仓库 `package.json`
  `engines.node` 一致：既满足当前实测的 `@earendil-works/pi-coding-agent` 0.86.0
  所声明的 `>=22.19.0` 下限，也落在 `vitest` 5 实际支持的
  `^22.12.0 || ^24.0.0 || >=26.0.0` 范围内——不能简单写成 `>=22.19.0`，
  否则会包含 vitest 5 不支持的 Node 23.x/25.x。版本升级后请以两者实际
  声明的 `engines` 为准）。
- 已安装并登录 [Pi](https://github.com/earendil-works/pi)（`@earendil-works/pi-coding-agent`，npm 包名同上；此链接取自当前安装包 `package.json` 中声明的 `repository` 字段），建议固定版本安装，不用 `@latest`。
- 已安装并登录 Claude Code CLI（`claude`），这是默认执行器。
- 如需使用 Cursor，另外安装并登录 `cursor-agent`。
- 如需使用 OpenAI Codex，推荐全局安装独立 CLI：

  ```bash
  npm install -g @openai/codex
  ```

  wrapper 优先使用 PATH 中的独立 `codex`；macOS ChatGPT/Codex App 内置 CLI 只在
  PATH 找不到时作为兼容回退。使用官方服务时按官方方式登录，使用第三方中转站时
  配置该服务要求的 API Key 即可。

Skill 本身不是操作系统级沙箱，也不代管你的 Pi 全局 `AGENTS.md`/`settings.json`；
真正的安全边界见下方[安全边界](#安全边界)。

## 安装（推荐：固定 tag 的 Git 安装）

```bash
pi install git:github.com/stones-hub/pi-project-orchestrator@v0.3.0
```

只在当前项目生效、不改全局配置：

```bash
pi install git:github.com/stones-hub/pi-project-orchestrator@v0.3.0 -l
```

`v0.3.0` 已发布；以上命令会安装固定 tag，不会自动跟随后续版本。

安装完成后确认包已注册：

```bash
pi list
```

在 Pi 交互会话中执行 `/reload`，然后在项目里显式加载：

```text
/skill:project-development-orchestrator
```

## 试用（不写入任何 settings）

克隆本仓库到本地后，可以在一次性会话里直接引用 Skill 目录，不注册到
`~/.pi` 或项目 `.pi/settings.json`，进程结束不留痕迹：

```bash
pi --skill /path/to/pi-project-orchestrator/skill/project-development-orchestrator -p "介绍一下这个 Skill 能做什么"
```

## 升级

固定 Git ref（tag/commit）安装后不会自动前移——`pi update <source>` 只会把已有
checkout 重新协调/重置到**当前配置的** ref（用于修复本地 clone 被改动的情况），
不会帮你跳到新 tag；`pi update`（不带参数）默认只更新 Pi 自身，会跳过所有
package，并提示 `Run pi update --extensions to update extensions.`。

要升级到新版本，显式用新 tag 重新执行一次 `pi install`（会原地更新
settings 里记录的 source，而不是新增一条）：

```bash
pi install git:github.com/stones-hub/pi-project-orchestrator@<new-tag>
```

（项目级安装同样加 `-l`。）只有在需要重新拉取/重置到**当前已配置的同一个
tag**时，才用：

```bash
pi update git:github.com/stones-hub/pi-project-orchestrator
```

或对所有已安装 package 统一执行 `pi update --extensions`。

## 卸载

```bash
pi remove git:github.com/stones-hub/pi-project-orchestrator
```

## 快速开始

1. 进入一个具体的 Git 项目，加载 Skill（见上方安装/试用）。
2. 按 `docs/installation-guide.md` 的“新项目接入”一节，把
   `templates/AGENTS.md`、`templates/CLAUDE.md`、`templates/HANDOVER.md`、
   `templates/deployment.md`、`templates/task.md` 复制到项目里并填写真实内容。
   模板所在的具体路径取决于安装方式：Git package 安装时在 Pi 管理的 package
   checkout 里（`pi list` 可查看该 checkout 的绝对路径），手工复制安装时在
   `~/.pi/agent/skills/project-development-orchestrator/templates/`；详见
   `docs/installation-guide.md` 第 4 节。
3. 与 Pi 讨论方案，方案写入项目 `docs/`，用户明确确认后再授权编码。
4. Pi 生成任务书，委派 Claude Code（默认）或用户指定的 Cursor / Codex 编码。
5. Pi 检查完整 diff、重跑测试；候选改变运行行为时，在本机重新构建/启动并
   从正式入口完成业务验收。
6. 分别获批后，Pi 才执行 commit、push 和目标机 Git 部署。

完整设计和异常处理见 `docs/design.md`；固定版本安装、升级、新项目接入和
卸载的完整命令见 `docs/installation-guide.md`。

## 安全边界

- Skill 和三个 wrapper（`run-claude`/`run-cursor`/`run-codex`）不是操作系统级
  沙箱，不能拦截执行器内部所有 shell 或网络调用。真正边界来自项目自身
  `AGENTS.md`、执行器自身的权限/沙箱、开发环境不提供生产凭证，以及用户对
  敏感动作的逐项确认。
- Pi 默认不直接编写正式业务代码、正式测试、迁移或部署配置，这些交给
  Claude Code、Cursor 或 Codex；Pi 负责讨论、任务书、diff 检查、测试重跑、
  本机候选验收和 Git 部署编排。
- commit、push、部署、生产访问和切换编码执行器分别授权，互不包含；方案
  确认不等于编码授权。
- 不自动 fallback、重试、commit、push 或部署；执行器失败或结果不明确时
  停止并如实说明。
- 执行器自报不构成完成证据，Pi 必须检查 Git 差异、重跑测试，并对改变运行
  行为的候选做本机业务验收。
- 同一真实工作区同一时刻只允许一个有写权限的编码 Agent（`run-claude`/
  `run-cursor`/`run-codex` 在 `code` 模式共用按工作区路径划分的写锁）；不同
  工作区互不阻塞。
- 无法取得的验证证据必须写成“受阻/未验证”，不得用单元测试、进程存活或
  执行器自报替代。

## 开发与测试

```bash
npm ci
npm test
node --test skill/project-development-orchestrator/scripts/workspace-write-lock.test.js
```

## 目录

- `skill/project-development-orchestrator/`：Skill 本体，也是 `package.json`
  中 `pi.skills` manifest 指向的目录。
- `docs/design.md`：完整产品和流程设计。
- `docs/installation-guide.md`：固定版本安装、升级、项目接入与卸载。
- `tests/`：三个薄 wrapper 的 fake-CLI 契约测试。
- `LICENSE`：MIT。
- `CHANGELOG.md`：版本变更记录。

## 主流程

```text
讨论并固方案 → 授权编码 → 编码 Agent 实现 → Pi diff/测试
→ 本机启动当前候选并做黑盒业务验收 → 必要复审/窄修
→ 分别授权 commit、push、部署 → 目标机 Git 更新固定 SHA
→ 构建/重启、健康和业务验证 → HANDOVER
```
