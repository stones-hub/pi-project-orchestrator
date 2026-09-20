# Claude Code 适配细节

对应实现：`scripts/run-claude`。本文件记录"为什么是这些参数"，具体行为以
脚本源码和其测试为准。这些参数形状来自本机对真实 Claude Code CLI（2.1.260）
的实测探针，不是凭文档猜测的。

## 只读模式（`investigate` / `review`）

```
claude -p "<prompt>" \
  --permission-mode plan \
  --permission-prompts none \
  --tools Read,Glob,Grep \
  --disallowedTools "mcp__*" \
  --strict-mcp-config \
  [--resume <session_id>]   # investigate 允许；review 禁止
  --output-format json \
  --model <model>
```

- `--tools Read,Glob,Grep`：明确限制为只读内建工具集，不给
  `Write`/`Edit`/`Bash`，即使提示词要求修改文件也没有工具可用。
- `--disallowedTools "mcp__*"`：`--tools` 只限制内建工具，不限制 MCP；因此
  显式拒绝全部 MCP 工具。`--strict-mcp-config` 同时阻止加载普通用户/项目 MCP
  配置。在企业托管 MCP 场景，仍应以组织策略与真实探针为准。
- `--permission-mode plan --permission-prompts none`：非交互环境下不弹权限
  确认，直接按 plan（只读）模式运行，避免无人值守场景卡住等待确认。
- `mode: review` 时携带 `--resume` 会被 `run-claude` 在发起调用前直接拒绝
  并报错退出——独立复审必须是全新会话，不能读取/延续被复审的编码会话上下文。

## 编码模式（`code`）

```
claude -p "<prompt>" \
  --permission-mode acceptEdits \
  --permission-prompts none \
  --allowedTools Read,Write,Edit,Bash,Glob,Grep \
  [--resume <session_id>] \
  --output-format json \
  --model <model>
```

- wrapper 启动进程前会按 `realpath(workspace)` 获取与 Cursor、Codex 共用的写锁；
  同一真实工作区已有任一写 Agent 时返回 `blocked`，不同工作区不互相阻塞。锁在
  子进程成功、失败或启动报错后都会释放，死 PID 遗留锁可恢复。只读模式不占锁。
  禁止在调用外层再用全局进程查找判断并发。
- 使用显式 `--allowedTools` 白名单，而不是
  `--dangerously-skip-permissions`——后者会绕过 Claude Code 自身的权限系统。
- `--permission-mode acceptEdits`：允许在白名单工具范围内自动应用编辑，权限
  系统仍然生效（工具集仍被 `--allowedTools` 限制）。

## 模型

`--model` 必须显式传入非空字符串，`run-claude` 校验不到就直接报错，不会用
任何隐式默认值——模型身份必须来自任务书或用户的明确选择。当前真实本机 Claude
Code CLI 的 JSON 响应顶层（与 `session_id`/`result`/`is_error`/`usage` 同级）
带一个 `modelUsage` 对象，真实验证过的层级结构是：

```json
{
  "modelUsage": {
    "<模型 canonical id，例如 claude-sonnet-5>": {
      "canonicalModel": "<同上，与外层 key 相同>",
      "inputTokens": 0,
      "...": "..."
    }
  }
}
```

即 `modelUsage` 本身在响应顶层，不嵌在 `usage` 里面；恢复真实生效模型时优先
级是：先取 `modelUsage` 对象里第一个 key 对应值的 `canonicalModel` 字段（正常
情况下应该有），只有这个字段缺失时才退回用该 key 本身当作模型名。wrapper 输出
的 `model` 字段只在能从响应 JSON 里按这个优先级证明时才填，证明不了就是
`null`，绝不用请求时传的别名（如 `sonnet`）去顶替。

## 输出解析

只信任 `--output-format json` 的整体 JSON 输出，wrapper 从中提取：

| 字段 | 用途 |
|---|---|
| `session_id` | 会话 ID；缺失即视为失败/不可续接，不当成静默成功 |
| `is_error` | 必须是布尔值且和 `result` 同时存在，二者缺一即视为响应不是
  合法终态结果对象，判定失败；`true` 时即使进程退出码 0 也判定失败 |
| `modelUsage` | 用于恢复真实生效模型，见上一节的层级和优先级说明 |
| `result` | 文本结果摘要；必须是字符串，缺失视为响应不完整 |
| `usage` | token/cache 统计，原样写入证据文件 |

判定成功不能只看 `session_id` 是否存在：JSON 解析失败、缺 `session_id`、或
`is_error`/`result` 二者任一缺失/类型不对，都判定为 `failure`，绝不当成成功
静默通过。完整原始 stdout 和 stderr 在子进程启动前即创建证据文件，并边产生边
写入 `--evidence-file` 指定路径（stdout）及其 `.stderr` 后缀路径（stderr），
不管解析是否成功；不受 Node `spawnSync` maxBuffer 限制。内存中仅保留每流固定
1 MiB 解析缓冲；超出时完整证据仍落盘，摘要以 `failure` + 明确 `parseError`
返回。`executor_unavailable` 仅表示无法启动执行器（如 ENOENT）；执行中失败、
信号退出或输出解析失败归 `failure`。wrapper 不会把原始 stdout/stderr 整段回显，
但会把解析后的 `result` 作为结构化字段返回给 Pi，因为它是正常调用正文。
`--command` 若使用，是调用方显式信任覆盖，不是自动发现；`--argv-prefix` 不被
接受。调用方必须把 `result` 当作模型输出处理，不能向执行器提供真实凭证或要求其
回显敏感文件。

## 会话续接（resume）

是否能续接由调用方（Pi）判断——`run-claude` 本身不保存状态、不记忆上一次的
`session_id`，只在收到显式 `--resume <id>` 时透传。Pi 需要自己决定这次调用
是否属于“同一执行器、同一任务且基线未变化的窄修”，三项都满足才把上一次成功调用
返回的 `sessionId` 传回来；缺一项就开新会话。
