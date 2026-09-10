# 安装与项目接入指南

本 Skill 不提供 curl|bash 脚本，也不代管 Pi 全局 `AGENTS.md` 或
`settings.json`。模型和登录按 Pi 正常方式配置。

## 1. 安装固定版本 Pi

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent@0.85.1
```

固定版本，不使用 `@latest`。安装完成后进入 Pi 执行 `/login`。

## 2. 安装或升级 Skill（推荐：Git package）

Pi 原生支持从 Git 仓库安装 package，`package.json` 已声明
`pi.skills: ["skill/project-development-orchestrator"]`，安装后 Pi 会自动
发现该 Skill，不需要手工复制目录。

固定 tag 安装（全局，写入 `~/.pi/agent/settings.json`）：

```bash
pi install git:github.com/stones-hub/pi-project-orchestrator@v0.2.0
```

只在当前项目生效（写入项目 `.pi/settings.json`，不改全局配置）：

```bash
pi install git:github.com/stones-hub/pi-project-orchestrator@v0.2.0 -l
```

> 以上命令假设目标仓库已经存在 `v0.2.0` 这个 tag。tag 需要在候选验收通过、
> 用户授权 commit/push 之后才会存在；执行前请先确认该 tag 确实存在，或改用
> 下方的“不写入 settings 的试用方式”“本地开发方式”。

安装完成后：

```bash
pi list      # 确认包已注册
```

在 Pi 中执行 `/reload`，然后在项目里显式加载：

```text
/skill:project-development-orchestrator
```

升级到新版本：

固定 Git ref（tag/commit）安装后不会自动前移。`pi update <source>` 只会把
已有 checkout 重新协调/重置到**当前配置的** ref（例如本地 clone 被改动
后用它恢复），不会帮你切换到新 tag；`pi update`（不带参数）默认只更新
Pi 自身，会跳过所有 package 并提示
`Run pi update --extensions to update extensions.`。

要真正升级版本，显式用新 tag 重新执行 `pi install`（原地更新 settings
里记录的 source，而不是新增一条）：

```bash
pi install git:github.com/stones-hub/pi-project-orchestrator@<new-tag>
```

只有在需要重新拉取/重置到**当前已配置的同一个 tag** 时才用：

```bash
pi update git:github.com/stones-hub/pi-project-orchestrator
```

或对所有已安装 package 统一执行 `pi update --extensions`。

卸载：

```bash
pi remove git:github.com/stones-hub/pi-project-orchestrator
```

### 不写入任何 settings 的试用方式

克隆仓库后，可以在一次性会话里直接引用本地 Skill 目录，不注册到任何
`settings.json`，进程结束不留痕迹：

```bash
pi --skill /path/to/pi-project-orchestrator/skill/project-development-orchestrator -p "介绍一下这个 Skill 能做什么"
```

### 本地开发/贡献者方式（手工复制，不经过 Git package）

只有在修改 Skill 本身、需要验证尚未发布的改动时才用这条路径。先在本仓库
根目录执行；已有目标目录时先改名备份，避免 `cp -R` 产生嵌套：

```bash
mkdir -p ~/.pi/agent/skills
```

如果目标目录已存在，单独执行备份：

```bash
mv ~/.pi/agent/skills/project-development-orchestrator ~/.pi/agent/skills/project-development-orchestrator.bak-$(date +%Y%m%d%H%M%S)
```

然后复制新 Skill：

```bash
cp -R skill/project-development-orchestrator ~/.pi/agent/skills/project-development-orchestrator
```

首次安装时目标目录不存在，跳过备份命令，直接复制。不要把这些命令用 `;`、
`&&` 或管道拼成一条。复制完成后同样执行 `/reload` 和
`/skill:project-development-orchestrator`。

卸载手工复制的版本：

```bash
rm -rf ~/.pi/agent/skills/project-development-orchestrator
```

卸载 Pi 本体：

```bash
npm uninstall -g @earendil-works/pi-coding-agent
```

## 3. 核对编码执行器

Skill 依赖已安装并登录的 `claude`，以及用户选择使用 Cursor 时的
`cursor-agent`。安装前可分别运行只读探针：

```bash
claude -p "reply with the single word: ack" --permission-mode plan --permission-prompts none --tools Read,Glob,Grep --disallowedTools "mcp__*" --strict-mcp-config --output-format json --model sonnet

cursor-agent -p "reply with the single word: ack" --trust --mode plan --output-format json --model auto
```

探针失败时先解决登录、安装或网络问题；不要静默切换执行器。

## 4. 新项目接入

进入新的 Git 项目根目录，复制五个模板。模板所在的具体路径取决于安装方式：

- **Git package 安装**（本文档第 2 节推荐方式）：不会复制到
  `~/.pi/agent/skills/`。先用 `pi list` 找到 Pi 实际管理的 package
  checkout 绝对路径，例如：

  ```text
  $ pi list
  User packages:
    git:github.com/stones-hub/pi-project-orchestrator@v0.2.0
      $HOME/.pi/agent/git/github.com/stones-hub/pi-project-orchestrator
  ```

  （项目级 `-l` 安装时，checkout 在项目自己的
  `<项目根目录>/.pi/git/github.com/stones-hub/pi-project-orchestrator`
  下。）把上面 `pi list` 打印出的那一行路径记作 `<PKG_CHECKOUT>`，模板在
  `<PKG_CHECKOUT>/skill/project-development-orchestrator/templates/`。

- **手工复制安装**（本文档第 2 节末尾“本地开发/贡献者方式”）：模板在
  `~/.pi/agent/skills/project-development-orchestrator/templates/`。

- 也可以不管安装方式，直接从已克隆的源仓库工作区复制：
  `skill/project-development-orchestrator/templates/`。

以 Git package 安装为例（把 `<PKG_CHECKOUT>` 换成 `pi list` 输出的实际路径）：

```bash
mkdir -p docs .pi/tasks
cp <PKG_CHECKOUT>/skill/project-development-orchestrator/templates/AGENTS.md AGENTS.md
cp <PKG_CHECKOUT>/skill/project-development-orchestrator/templates/CLAUDE.md CLAUDE.md
cp <PKG_CHECKOUT>/skill/project-development-orchestrator/templates/HANDOVER.md HANDOVER.md
cp <PKG_CHECKOUT>/skill/project-development-orchestrator/templates/deployment.md docs/deployment.md
cp <PKG_CHECKOUT>/skill/project-development-orchestrator/templates/task.md .pi/tasks/example.md
```

手工复制安装时把上面的 `<PKG_CHECKOUT>/skill/project-development-orchestrator`
替换成 `~/.pi/agent/skills/project-development-orchestrator`。

与 Pi 一起按项目真实情况填写 TODO，重点确认：

- 技术栈、构建和测试入口；
- 本机候选如何启动、业务就绪、黑盒验收和清理；
- 是否使用容器（可选，不强制）；
- 测试数据库和防止连接生产的边界；
- 远程 Git、部署分支、目标机绝对路径；
- 目标机 Git 更新、构建、重启、健康、业务验证和回滚方法。

不要在模板里写真实密码、Token、SSH 私钥、数据库密码或 API Key。

## 5. 第一次真实验收

静态安装成功不代表 Skill 已签收。新建一个测试项目，真实走通：

1. Pi 读取项目文档和 Git 状态；
2. 讨论并将方案写入 `docs/`；
3. 编码 Agent 只读调查；
4. 用户确认方案并授权编码；
5. Claude Code 编码和自测；
6. Pi 检查完整 diff、重跑测试；
7. Pi 重新构建并在本机运行候选，从正式入口完成业务验收；
8. 必要时独立复审、窄修和重新验收；
9. 更新 `HANDOVER.md` 并验证跨会话续接；
10. 有测试远程机时，再分别授权 commit、push 和 Git 部署，核对固定 SHA、健康和
    业务结果。
