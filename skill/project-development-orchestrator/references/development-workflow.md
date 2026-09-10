# 开发流程细节

本文件展开 `SKILL.md` 的研发主线。命令相对于安装后的 Skill 目录
`~/.pi/agent/skills/project-development-orchestrator/`。

## 1. 进入项目

读取顺序：`AGENTS.md` → `CLAUDE.md` → `HANDOVER.md` → 相关 `docs/` →
当前 `.pi/tasks/` → `git status`、当前分支和基线。叙述与 Git 不一致时以 Git
事实为准并更正交接文档。项目资料只放当前仓库，不读写 Obsidian。

缺文件时从 `templates/` 复制起点，与用户填写真实内容；不知道的字段标为待确认，
不得编造命令、地址或机器。

## 2. 讨论与只读调查

先讨论业务目标、方案、边界、完成标准和本机验收场景。源码事实不确定时调用：

```bash
scripts/run-claude --mode investigate --model <model> --prompt "<具体问题>" --evidence-file <仓库外路径>
```

用户指定 Cursor 时可换 `run-cursor`。调查模式不得修改源码工作区；Pi 在调用前后
都运行 `git status --porcelain` 核对。证据文件默认放仓库外；确需放项目内时，
必须获批且目录已加入 `.gitignore`。

## 3. 方案、授权和任务书

将确认方案写入 `docs/decisions/` 或 `docs/milestones/`。至少说明目标、已确认
事实、方案、范围、关键行为和验证方法。用户明确确认方案并说可以开始编码后，
才从 `templates/task.md` 生成 `.pi/tasks/<task-id>.md`。

任务书必须在编码前固定 Risk、Scope、Verify：当前基线、执行器、允许/禁止文件、
预期行为、自动化测试、本机启动方式、正式入口业务场景、结果检查和清理方法。

## 4. 委派编码

```bash
scripts/run-claude --mode code --model <model> --prompt "<任务书路径和执行要求>" --evidence-file <仓库外路径> [--resume <session_id>]
```

- 默认 Claude Code；只有用户明确指定时用 Cursor 编码。
- 同一真实工作区一次只运行一个写权限编码 Agent；不同工作区允许并行。
  `run-claude`/`run-cursor` 的 `code` 模式通过真实路径对应的共用写锁执行该约束，
  因此 Cursor 与 Claude 也不能交叉写同一工作区。`investigate`/`review` 不占写锁。
  不得额外使用全局 `pgrep cursor-agent` 或 `pgrep claude` 门禁，否则会错误阻塞
  其他项目。
- 仅当同一执行器、同一任务、Git 基线未变化时续接；独立复审禁止 resume。
- wrapper 返回 `success` 只表示执行器调用完成，不表示候选验收通过。
- `failure`、`blocked` 或 `executor_unavailable` 都要停止并报告；不得静默重试或
  fallback。换执行器必须另获用户同意。

## 5. Pi 独立检查和自动化测试

编码 Agent 结束后，Pi 亲自：

1. 运行 `git status --porcelain` 并查看完整 `git diff`。
2. 对照方案、任务书允许/禁止范围和每项验收标准。
3. 检查关键测试是否被删除、跳过或放松。
4. 重新运行任务书规定的相关测试和必要的受影响模块测试。
5. 根据 `references/testing-and-review.md` 判断是否需要关键任务的扩展测试和
   独立复审。

测试失败或范围越界时不得报完成，也不得擅自破坏性回滚工作区。

## 6. 本机候选运行验收

改变程序实际运行行为的候选必须继续完成：

1. 读取 `AGENTS.md` 和 `docs/deployment.md` 的本机验收部分。
2. 检查配置、域名、数据库和凭证来源，证明不会连接生产环境。
3. 隔离旧进程、旧端口、旧容器、旧制品和旧数据，避免验到旧版本。
4. 从当前工作区重新构建或安装真实候选。
5. 按项目真实交付形态启动应用及必要的本地依赖。
6. 等待业务就绪条件满足；PID、容器 running 或单独健康接口都不等于完成。
7. 从 HTTP、浏览器、CLI 或公开 API 等正式入口执行任务书中的核心业务场景。
8. 检查响应、页面、文件或测试数据库的最终结果，并检查运行日志。
9. 按文档停止进程/容器并清理测试数据；需要保留失败现场时明确记录原因和范围。
10. 在 `HANDOVER.md` 记录当前候选身份、命令、结果和未验证项。

Docker Compose、原生进程、正式构建产物、干净虚拟环境或混合方式都可使用；选择
最贴近项目真实交付且可重复的方式，不为了流程强行 Docker 化。

## 7. 失败、窄修和复审

- 方案错误：回到用户讨论并更新 `docs/`，重新获得必要授权。
- 实现或测试缺口：把具体失败证据交回原编码 Agent 窄修；满足续接三条件时才
  resume，否则新会话。
- 环境缺失：写“验证受阻”，列明缺失前提；不得用单元测试替代后报完成。
- 代码、测试、配置、依赖或构建输入发生变化：之前的本机运行验收失效，重新
  构建并重验当前候选。
- 关键任务按 `references/testing-and-review.md` 开一路独立 review 新会话。
  复审结论不能替代 Pi 的 diff、测试和本机业务验收。

全部必要验证通过后，才可写“本机候选验收通过”。

## 8. Git 交付和目标机部署

本机候选通过后，按 `references/git-deployment.md` 依次执行：展示候选和验证证据
→ 申请 commit → commit → 申请 push → push 并核远端 SHA → 冻结待部署 SHA →
申请指定机器部署 → 目标机 Git 更新 → 核对 HEAD → 构建/重启 → 健康与业务验证。

commit、push、部署互不包含。目标机工作区不干净、远程分支头不是批准 SHA、无法
`git pull --ff-only` 或 HEAD 不等于批准 SHA 时必须停止，不覆盖、不强推、不自行清理。

## 9. 交接和续接

每次里程碑、验证、提交、推送、部署或中断后更新 `HANDOVER.md`。记录 executor、
请求模型、响应可证明的真实模型（证明不了写“未证明”）、session_id 和基线。

恢复时先读 `HANDOVER.md`，再核 Git 和实际运行/部署状态。只有同一执行器、同一
任务、基线未变化才可 resume；更换执行器、新任务、基线变化和独立复审都开新会话。
