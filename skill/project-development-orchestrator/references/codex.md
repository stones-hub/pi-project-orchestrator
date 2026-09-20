# OpenAI Codex CLI 适配细节

对应实现：`scripts/run-codex`。Codex 与 Claude Code、Cursor 同级，可用于调查、
编码、窄修或独立复审。参数形状已用本机 ChatGPT/Codex App 随附的真实
`codex-cli 0.152.1`，以及 npm 安装的 `codex-cli 0.155.1` 的 `--help`、
`exec --help`、`exec resume --help` 和失败 JSONL 探针核对。官方服务可使用 Codex
登录；第三方中转站不要求官方登录，只需配置 provider 所需的 API Key。成功响应
形状由 CLI 事件契约配合 fake-CLI 测试覆盖。真实第三方 provider + `gpt-5.6-terra`
的只读探针已成功（返回预期探针标记，调用前后 Git 工作区状态一致）。

## 命令发现

wrapper 按以下顺序选择 CLI：

1. 环境变量 `CODEX_COMMAND`：调用方显式信任覆盖（不是自动安全发现）；
2. PATH 中**绝对目录**下的独立 `codex`（推荐，适合长期自动化）；空段与相对
   目录（`.`、`bin` 等）一律忽略，失败时不回退为裸命令名再交给系统 PATH；
3. macOS ChatGPT/Codex App 内置绝对路径
   `/Applications/ChatGPT.app/Contents/Resources/codex`（明确回退）；
4. 仍未发现时返回 `executor_unavailable`，绝不把裸 `codex` 交给系统按原始
   PATH（含空段）再解析。

wrapper 的 `--command <path>` 同样是调用方显式信任覆盖，语义同 `CODEX_COMMAND`，
不是自动发现。PATH 中独立 CLI 优先于 App 内置旧版。`--argv-prefix` 等测试缝
参数不被接受；测试应使用可执行 shim 作为 `--command`。

## 新会话

```text
codex \
  --sandbox read-only|workspace-write \
  --ask-for-approval never \
  --cd <workspace> \
  --model <model> \
  exec --json "<prompt>"
```

- `investigate` / `review` 使用 `read-only`；`code` 使用 `workspace-write`。
- 不使用 `danger-full-access` 或 `--dangerously-bypass-approvals-and-sandbox`。
- `--ask-for-approval never` 避免非交互调用等待人工输入；命令失败直接返回 Agent。
- `--cd` 与子进程 `cwd` 使用同一个 `realpath(workspace)`，避免路径身份不一致。
- `code` 模式启动前按真实工作区获取与 Claude Code、Cursor 共用的写锁；只读模式
  不占锁，不同工作区互不阻塞。

## 续接

```text
codex \
  --sandbox read-only|workspace-write \
  --ask-for-approval never \
  --cd <workspace> \
  --model <model> \
  exec resume --json <thread_id> "<prompt>"
```

wrapper 只在显式收到 `--resume` 时切换为 `exec resume`。Pi 仍须先证明“同一
执行器、同一任务、Git 基线未变化”；`review` 一律拒绝 resume，确保独立复审使用
新会话。Codex、Claude Code、Cursor 的会话 ID 不能跨执行器传递。

## 模型和输出

`--model` 必须显式非空。`--json` 输出 JSONL，wrapper 要求至少存在：

1. `thread.started` 且有字符串 `thread_id`；
2. 终态 `turn.completed` 或 `turn.failed`；
3. 成功时至少一个 `item.completed`，且 `item.type == "agent_message"`、`text` 为字符串。

成功摘要取最后一个 Agent message；`turn.completed.usage` 原样带回。`turn.failed`
即使进程退出码为 0 也判为失败。当前已核对的 JSONL 事件没有可靠的实际模型字段，
所以摘要 `model` 固定为 `null`，交接中应写“请求模型为 X，响应未证明实际模型”，
不能用请求参数冒充响应证据。

stdout/stderr 在子进程启动前即创建证据文件，并边产生边写入；内存中仅保留固定上限
（1 MiB/流）的解析缓冲，超出时完整证据仍落盘，摘要判为 `failure` 并给出明确
`parseError`，不会 OOM 或错报 `executor_unavailable`。摘要不会整段回显原始
stderr。`executor_unavailable` 仅表示无法启动执行器（如 ENOENT 或命令发现失败）；
执行中非零退出、信号、流错误或 JSONL 解析失败归 `failure`。调用方不得向执行器
提供真实凭证或要求其回显敏感文件。

## 已知验证边界

开发本 wrapper 时确认本机已通过 npm 全局安装独立 `@openai/codex@0.155.1`，
命令位于 `/opt/homebrew/bin/codex`；同时安装了 ChatGPT/Codex App，其内置 CLI 为
0.152.1，仅作为 PATH 找不到独立 CLI 时的兼容回退。当前使用第三方 provider
`aimodel`，因此 `codex login status` 是否为官方登录状态不构成可用性前提；关键是
provider、精确模型 ID、协议、地址和 API Key 是否匹配。成功场景使用 fake CLI 做
契约测试，并用真实第三方 provider + `gpt-5.6-terra` 完成只读探针。使用前应按
安装指南运行只读探针；探针失败时停止，不得自动切换执行器。
