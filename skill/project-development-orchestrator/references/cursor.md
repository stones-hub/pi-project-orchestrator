# Cursor Agent 适配细节

对应实现：`scripts/run-cursor`。Cursor 在本 Skill 中用于：用户明确指定
Cursor 编码，或作为独立复审器复审 Claude Code 的产出。参数形状来自本机对
真实 Cursor Agent CLI 的实测探针。

## 只读模式（`investigate` / `review`）

```
cursor-agent -p "<prompt>" \
  --trust \
  --mode plan \
  [--resume <chat_id>]   # investigate 允许；review 禁止
  [--workspace <dir>] \
  --output-format json \
  --model <model>
```

- `--mode plan` 且不加 `--force`：只读规划模式，不写入工作区。
- `mode: review` 携带 `--resume` 会被 `run-cursor` 在发起调用前直接拒绝，
  与 Claude 适配脚本的隔离规则一致——独立复审必须是全新 chat。
- `--workspace` 收到相对路径时，`run-cursor` 会先用 `path.resolve` 解析成
  绝对路径一次，然后把同一个绝对路径同时用于子进程的 `cwd` 和传给
  `cursor-agent` 的 `--workspace` 值，避免两者算出不同路径（这是本机测试
  发现并修复过的真实 bug：早期实现只对 `cwd` 做了解析，`--workspace` 参数
  仍然传的是调用方给的原始相对路径）。

## 编码模式（`code`）

```
cursor-agent -p "<prompt>" \
  --trust --force \
  --sandbox enabled|disabled \
  [--resume <chat_id>] \
  [--workspace <dir>] \
  --output-format json \
  --model <model>
```

- `--trust --force` 是 Cursor 非交互写模式的必需参数。
- wrapper 启动进程前会按 `realpath(workspace)` 获取与 Claude 共用的写锁；同一
  真实工作区已有任一写 Agent 时返回 `blocked`，不同工作区不互相阻塞。锁在
  子进程成功、失败或启动报错后都会释放，死 PID 遗留锁可恢复。只读模式不占锁。
  禁止在调用外层再用全局 `pgrep cursor-agent` 判断并发。
- `--sandbox` **必须始终带显式值**（`enabled` 或 `disabled`）。这是本机实测
  发现的真实 CLI 行为：裸 `--sandbox`（不带值）会导致 Cursor CLI 把下一个
  argv token 误当成 sandbox 的值吃掉，从而破坏后续参数——`run-cursor` 默认
  传 `--sandbox enabled`，只有调用方显式要求关闭沙箱时才传
  `--sandbox disabled`，从不省略这个值。

## 模型

同 Claude：`--model` 必须显式非空。不要把 CLI 的 `auto` 别名当作已知的具体
模型写进最终交付报告；应以响应 JSON 中能拿到的字段为准（Cursor 的 JSON
输出未必总带 `model` 字段，此时如实说明"模型别名 auto，实际生效模型未在
响应中给出"）。

## 输出解析

Cursor 支持 `json` 和 `stream-json` 两种输出格式；`run-cursor` 按"最后一行
有效 JSON 为准"解析（stream-json 逐行输出增量事件，终态摘要通常是最后一
行）：

| 字段 | 用途 |
|---|---|
| `session_id` / `chatId` / `chat_id` | 三选一，任一存在即视为会话标识；
  三者都缺失则判定失败 |
| `is_error` | 必须是布尔值且和 `result` 同时存在，二者缺一即视为响应不是
  合法终态结果对象，判定失败；语义同 Claude |
| `result` | 文本结果摘要；必须是字符串，缺失视为响应不完整 |
| `usage` | 若提供，包含 input/output/cacheRead/cacheWrite 等统计 |

判定成功不能只看会话标识是否存在：空输出、全部行均非法 JSON、末尾有效对象
缺少任一会话标识字段、或 `is_error`/`result` 二者任一缺失/类型不对，均判定
为 `failure`。完整原始 stdout（包括 stream-json 的所有行）和 stderr 分别写入
`--evidence-file` 指定路径（stdout）及其 `.stderr` 后缀路径（stderr）；wrapper
打印给调用方（Pi）的摘要 JSON 不会整段回显原始 stdout/stderr，但会包含解析后的
`result` 结构化字段，供 Pi 读取正常调用正文。调用方必须把它当作模型输出处理，
不能向执行器提供真实凭证或要求其回显敏感文件。

## 会话续接（resume）

与 Claude 相同：是否续接由调用方（Pi）判断，`run-cursor` 只透传收到的
`--resume`，自己不保存状态。任务从 Claude 换成 Cursor（或反之）算切换执行
器，不是同一会话的续接，不要把上一个执行器的 session id 传给另一个执行器。

## 独立复审场景下的典型用法

审阅 Claude Code 写的代码，让 Cursor 只读复审：

1. 用新的、独立的调用，`--mode review`，不带 `--resume`。
2. `--prompt` 里写清楚需要复审的具体 diff 范围、关注点（并发/权限/边界
   条件等），而不是让 Cursor 自己去猜要看哪里。
3. 复审是只读的：`--mode plan` 且不带 `--force`，Cursor 不会写入工作区。
4. 复审结论是定性判断，仍需要配合 Pi 自己的 `git diff` 核对、测试重跑和
   本机候选业务验收一起使用，参见 `references/testing-and-review.md`。
