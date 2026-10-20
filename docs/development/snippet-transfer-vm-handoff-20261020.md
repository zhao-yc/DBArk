# SQL 片段候选：WIN11-TEST 验收交接

状态：**已推送、待虚拟机验收，未发布**。开发仍由原会话唯一执行，WIN11-TEST 只测试，不修改产品或断言、不新增 helper/服务/框架。测试机最小接入未确认前，不开始本候选测试；消息送达或候选推送不能代替就绪及通过证据。本机不再新启动 Windows 类型、单元、构建或桌面测试。

## 精确基线与候选

- 仓库：`https://github.com/zhao-yc/DBArk.git`。
- 原测试机基线：`915d3dcb3ee44731c1a703bdb04179754d027b45`。
- 候选分支：`codex/snippet-transfer-20261020`。
- 必测候选：`e31420bf325a1dfef676b5864b7d64a1a1061736`，基线之上只有一个功能提交，19 个本任务文件。
- 仅提取 `fa5a47b` 固定增量，新增取消失败/退出等待修复和真实 SQLite/文件测试；旧六份 dirty/untracked 没有带入。依赖及锁文件、QueryTab/ResultsGrid、原桌面 fixture、原退出协议和发布工作流不改。

既有普通克隆先核远端、当前分支及 dirty；仅在工作区干净且无运行中的验收时切到专用测试分支并固定完整 SHA，不覆盖未知改动、不 stash/reset、不用工作树。确认准确 Node24、pnpm12.11.2 与锁文件；基线已有的本克隆依赖可复用，不连接业务库、不运行虚拟机本机 Docker、不复制原电脑凭据。

## 最小定向入口

在准确候选根目录执行，原始退出码与日志必须保留；类型只运行一次，随后指定测试与构建：

```powershell
node scripts/check-local.mjs --build tests/unit/snippet-transfer.test.ts tests/unit/snippet-transfer-main-ram.test.ts tests/unit/snippet-transfer-main-entry-ram.test.ts tests/unit/snippet-transfer-storage-ram.test.ts tests/unit/snippet-transfer.react.test.tsx tests/unit/snippet-transfer-sqlite-storage.test.ts tests/unit/snippets.test.ts
```

当前用例数为 7 文件 64 项，其中 SQLite/临时磁盘 4 项。平台/运行时若实际数量不同应报告原结果，不为匹配数字更改测试。

上述通过后，以较少并行度执行同一完整集合，适配测试机 4 逻辑处理器/8GB，保留原用例及超时：

```powershell
New-Item -ItemType Directory -Path '.cache' -Force | Out-Null
node node_modules/vitest/vitest.mjs run --maxWorkers=2 --reporter=json --outputFile=.cache/snippet-transfer-vm-full-unit.json
```

原本机在迁移指令前已发起的检查全部结算：类型/构建通过、64 项定向通过；完整 576 文件/10925 通过/1 POSIX 平台跳过。此为历史本机证据，**不是 VM 结果**。取消和退出四项反例原先失败、修后通过，细节与报告摘要见[功能说明](../snippet-transfer-0.29.md)。

## 桌面边界与回报

只有协调聊天核准最小测试机验证后才安排桌面验收。既有离线片段库用例 `tests/e2e/snippets.spec.ts` 可验证原片段功能回归，但不能据此声称新的 JSON 文件工作流通过。新 JSON 仍需真实父弹窗、Main IPC、差异选择、原子导出及重启持久化验收；不以直接调用 store 或替换 IPC 成功响应代替。共享剪贴板隔离未确认前不写系统剪贴板。

测试机在原会话回报机器/克隆路径、分支/完整 SHA、工具版本、实际命令与退出码、测试数量/阶段耗时、报告路径和 SHA256、工作区及资源收尾。失败保留原报告及所属现场，不自动重跑、强停、删除未知目录或改阈值；所需产品修复交回开发会话。安装包、macOS、原生文件对话框和系统剪贴板不能由单元/构建推断。
