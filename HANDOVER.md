# Handover

## 当前状态：v0.3.0 发布候选验收通过

当前 HEAD 为已打 `v0.2.0` 标签的 `55108f0b1d0bfd34590e37816ee95eb18b839114`。
工作区已完成 OpenAI Codex CLI 同级执行器、三个 wrapper 的流式证据加固和
`v0.3.0` 版本信息；本轮尚未 commit、push 或创建 `v0.3.0` tag。

## 已完成

- 新增 `scripts/run-codex`：支持只读调查、编码、续接和独立复审；只读模式使用
  `read-only`，编码使用 `workspace-write`，并接入跨执行器工作区写锁。
- Codex 自动发现只接受 PATH 中绝对目录，不接受空段/相对目录，不回退裸命令；
  `CODEX_COMMAND` / `--command` 是调用方显式信任覆盖；三个 wrapper 均拒绝
  `--argv-prefix` 参数注入。
- 新增共享 `scripts/spawn-with-evidence.js`：异步启动执行器，启动前准备并打开证据
  文件，完整处理短写、零写、setup/open、子进程和 stdout/stderr 流错误；完整原始
  输出落盘，每流只保留固定 1 MiB 内存解析缓冲，避免 `spawnSync` 的 ENOBUFS 和
  无限制内存增长。
- 证据 setup、执行器启动、运行、解析和流错误均有结构化结果；`code` 模式所有已知
  成功/失败路径均通过 `finally` 释放写锁。
- 新增/更新 Codex、三个 wrapper、共享 helper、写锁和公开发布测试；默认
  `npm test` 已包含 helper 专项测试。
- README、设计、安装指南、Skill、参考文档、模板、CHANGELOG、package 元数据均
  已同步为三个执行器和 `v0.3.0`。

## Pi 独立验收

- `npm test`：Vitest 4 个文件、56 个测试通过；共享 helper 14 个测试通过。
- `node --test skill/project-development-orchestrator/scripts/workspace-write-lock.test.js`：
  10 个跨进程写锁场景通过。
- 三个 wrapper、共享 helper、helper 测试、写锁及 fixture 的 `node --check` 通过。
- `git diff --check` 通过；全部未跟踪发布文件也分别通过空白/冲突标记检查。
- 三个 wrapper 均有 >1 MiB 输出回归：不再 ENOBUFS，不错报执行器不可用，完整
  证据落盘，内存捕获有界；helper 另覆盖短写、零写、open/setup 和 stdout/stderr
  流错误。
- 使用 PATH 中独立 `/opt/homebrew/bin/codex` 0.155.1 和第三方 provider 的
  `gpt-5.6-terra` 完成最终真实只读探针，返回 `codex-stream-error-probe-ok`，
  调用前后 Git 状态一致。
- `npm pack --dry-run --json`：候选包 `pi-project-orchestrator-0.3.0.tgz`，32 个文件，
  三个 wrapper、共享 helper、Codex 参考文档和测试均在清单中。
- 在隔离 Git 项目和空 agent 目录中，通过 Pi 0.85.1 `DefaultResourceLoader` 精确
  发现一个当前候选 `project-development-orchestrator`，无 diagnostics。

## 独立复审

- Cursor 两次只读复审未形成完整最终结论，但暴露了 PATH 空段线索；该问题随后
  修复并有回归测试。
- Codex 使用全新 `review` 会话完成多轮独立只读复审，依次发现并推动关闭：PATH
  裸回退/相对目录、`--argv-prefix` 注入、`spawnSync` 大输出丢证据、短写、spawn 后
  open 失败、无命令特殊分支锁泄漏、stdout/stderr 未处理 `error` 等问题。
- 最终复审未发现新的源码级发布阻断；它因只读沙箱不能创建 Vitest/npm 临时文件，
  无法自行运行测试，但明确确认所有已知实现阻断项静态关闭。测试、打包、真实探针
  和 Skill 发现已由 Pi 在真实可写开发环境独立完成，故不构成候选阻断。

## 剩余风险

- Codex JSONL 成功事件没有可靠实际模型字段，摘要 `model` 保持 `null`；只能记录
  请求模型，不能声称响应证明了真实模型。
- Codex CLI 后续版本可能改变 argv 或 JSONL 事件形状；当前真实验证基于 0.155.1。
- npm pack 提示未提供 `.npmignore`，当前按 `.gitignore` 打包；实际 32 文件清单已
  核对正确，因此不是阻断项。
- 尚未 commit、push 或创建 `v0.3.0` tag；README/安装指南中的 tag 安装命令只有
  tag 推送后才可用。

## 下一步

1. 用户复核候选并单独授权 commit。
2. commit 后核对候选 SHA，再单独授权 push。
3. push 后单独授权创建并推送 `v0.3.0` annotated tag。
4. tag 推送后执行真实 Git package 安装验收。

## 执行器会话信息

Cursor 修复任务：`.pi/tasks/fix-v030-review-blockers.md`

- executor：Cursor
- 请求模型：`auto`
- 响应证明的真实模型：未证明
- session_id：`216b693c-e297-44d9-b804-53cc1223c680`
- 基线：HEAD `55108f0b1d0bfd34590e37816ee95eb18b839114` 加未提交 v0.3.0 候选

最终 Codex 独立复审：

- executor：Codex
- 请求模型：`gpt-5.6-terra`
- 响应证明的真实模型：未证明
- session_id：`01a0bdd5-bcc4-7ed2-9834-608730d3c0a8`
- 结论：所有已知源码级阻断项关闭；只读环境无法自行重跑测试
