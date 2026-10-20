# SQL 片段候选：WIN11-TEST 验收交接

状态：**已推送，虚拟机验收进行中，未发布**。开发仍由原会话唯一执行，WIN11-TEST 只测试，不修改产品或断言、不新增 helper/服务/框架。最小接入及前批任务收尾已由开发会话直接读回核准，当前只在用户指定的“dbark测试”会话串行执行；消息送达或候选推送不能代替通过证据。本机不再新启动 Windows 类型、单元、构建或桌面测试。

## 精确基线与候选

- 仓库：`https://github.com/zhao-yc/DBArk.git`。
- 原测试机基线：`915d3dcb3ee44731c1a703bdb04179754d027b45`。
- 候选分支：`codex/snippet-transfer-20261020`。
- 功能提交：`e31420bf325a1dfef676b5864b7d64a1a1061736`，基线之上只有一个功能提交，19 个本任务文件。
- 四条桌面用例提交：`c843f92861a125084dc3a6418a717fe48828d304`，文件为 `tests/e2e/snippet-transfer.spec.ts`。
- 终态后迟到取消的反例候选：`16366dfb3e6543d22aebb582c4c7ff5a4b7dd0e5`，只新增四项 React 回归，产品仍为修补前逻辑；尚未实测失败。
- 本次待验完整候选：`f173f4146460c01df8b9cf21fa7965e33e97de4a`，终态统一推进代次，使迟到取消回包不能覆盖原操作结局。未改依赖、锁文件或既有夹具。新增测试、修复、类型和构建均须由测试机验证，不能沿用旧 SHA 的通过结果。
- 仅提取 `fa5a47b` 固定增量，新增取消失败/退出等待修复和真实 SQLite/文件测试；旧六份 dirty/untracked 没有带入。依赖及锁文件、QueryTab/ResultsGrid、原桌面 fixture、原退出协议和发布工作流不改。

既有普通克隆先核远端、当前分支及 dirty；仅在工作区干净且无运行中的验收时切到专用测试分支并固定完整 SHA，不覆盖未知改动、不 stash/reset、不用工作树。确认准确 Node24、pnpm12.11.2 与锁文件；基线已有的本克隆依赖可复用，不连接业务库、不运行虚拟机本机 Docker、不复制原电脑凭据。

## 最小定向入口

最小接入经协调确认后，先在干净且无运行验收的普通克隆固定反例候选 `16366dfb3e6543d22aebb582c4c7ff5a4b7dd0e5`，单次执行以下文件，保留原退出码与 JSON。静态推演预期新四项失败，**不是已取得的红灯证据**；若观察不同，报告真实结果并交回开发，不改断言或原样重试：

```powershell
node node_modules/vitest/vitest.mjs run tests/unit/snippet-transfer.react.test.tsx --maxWorkers=1 --reporter=json --outputFile=.cache/snippet-late-cancel-before.json
```

收尾完成且工作区干净后，固定修复候选 `f173f4146460c01df8b9cf21fa7965e33e97de4a`。两个候选的该测试文件字节相同，SHA256 为 `b9107a8d305ac28017da9ee0966e6a8dfc0740c35c6ec7664eb26a8969d9cb0c`；确认 SHA 后再执行下述入口，不带入测试机的源码修改。

在准确候选根目录执行，原始退出码与日志必须保留；类型只运行一次，随后指定测试与构建：

```powershell
node scripts/check-local.mjs --build tests/unit/snippet-transfer.test.ts tests/unit/snippet-transfer-main-ram.test.ts tests/unit/snippet-transfer-main-entry-ram.test.ts tests/unit/snippet-transfer-storage-ram.test.ts tests/unit/snippet-transfer.react.test.tsx tests/unit/snippet-transfer-sqlite-storage.test.ts tests/unit/snippets.test.ts
```

旧功能候选为 7 文件 64 项，其中 SQLite/临时磁盘 4 项；当前新增四项迟到取消回归，静态计数预计 68 项，实际以 VM 结果为准。平台/运行时若实际数量不同应报告原结果，不为匹配数字更改测试。

上述通过后，以较少并行度执行同一完整集合，适配测试机 4 逻辑处理器/8GB，保留原用例及超时：

```powershell
New-Item -ItemType Directory -Path '.cache' -Force | Out-Null
node node_modules/vitest/vitest.mjs run --maxWorkers=2 --reporter=json --outputFile=.cache/snippet-transfer-vm-full-unit.json
```

原本机在迁移指令前已发起的检查全部结算：类型/构建通过、64 项定向通过；完整 576 文件/10925 通过/1 POSIX 平台跳过。此为历史本机证据，**不是 VM 结果**。取消和退出四项反例原先失败、修后通过，细节与报告摘要见[功能说明](../snippet-transfer-0.29.md)。

## 桌面边界与回报

只有协调聊天核准最小测试机验证后才安排桌面验收。既有离线片段库用例 `tests/e2e/snippets.spec.ts` 可验证原片段功能回归，但不能据此声称新的 JSON 文件工作流通过。共享剪贴板隔离未确认前不写系统剪贴板。

新增四条桌面用例使用真实 Electron、父弹窗、preload/Main IPC、LocalStore 和实际文件；只替换系统文件选择的返回值，不伪造导入/导出成功响应或修改组件状态。使用原 `preserveOnUnconfirmedExit` 门，未确认正常退出及所属 PID 时保留现场，不修改共享夹具或增加退出框架。用例覆盖：

- 未保存草稿确认前不打开文件选择；取消保存框不覆盖旧文件；导出只含用户字段且无暂存残留。
- 同 ID、同名和内置模板同名均默认跳过，显式新增/替换/跳过整批确认，混合行尾和精确数值字符串保持原文；源文件在预览后被改写不能替换 Main 快照。
- 空库导出不打开文件框；取消文件选择、取消差异、含未知字段的文件均不改片段库。
- 真实保存 IPC 的并发修改使旧预览失效，失败不覆盖新内容，不保留重复确认入口。

类型、构建及上述回归通过后，在同一固定 SHA 单次运行；沿用默认用例超时、一个 worker、零重试，不调整断言或超时来追求通过：

```powershell
node node_modules/@playwright/test/cli.js test tests/e2e/snippet-transfer.spec.ts --workers=1 --retries=0 --reporter=json --trace=off > .cache/snippet-transfer-vm-e2e.json
```

四条通过也只证明“系统选择框回答替换”的真实 IPC/磁盘路径。弹窗重新打开读取的是同一 Main，不是应用重启；以下原生项目仍须在 VM 用同一候选、独立临时配置目录补验：

1. 不替换 `dialog.showOpenDialog/showSaveDialog`，在片段库实际选择 JSON 打开/保存框，核窗口归属、JSON 筛选、取消和覆盖旧文件确认。
2. 导入差异中显式替换同 ID、新增不同 ID、保留默认跳过；确认后正常退出，核本例进程结束，再用同一临时配置目录重新启动并在片段库核正文、分组、ID 和条数。
3. 重启后实际导出 JSON，独立解析核白名单、内容和 SQL 原文；任务/历史仍为空。只清理已确认退出的本例目录，失败保留原报告和所属现场。

原生文件框、重启、传输中退出等待和取消失败仍没有新的实测证据；不能用四条新用例或旧 SQLite 重开测试替代。这一轮不覆盖安装包、系统剪贴板、macOS，也不发布。

测试机在原会话回报机器/克隆路径、分支/完整 SHA、工具版本、实际命令与退出码、测试数量/阶段耗时、报告路径和 SHA256、工作区及资源收尾。失败保留原报告及所属现场，不自动重跑、强停、删除未知目录或改阈值；所需产品修复交回开发会话。安装包、macOS、原生文件对话框和系统剪贴板不能由单元/构建推断。

## 本轮VM直接观察：修复前反例

开发会话已直接读取测试会话命令输出：`WIN11-TEST\tester`，普通克隆 `C:\Users\tester\Documents\Codex\2026-10-20\hi\work\DBArk`，测试分支 `codex/vm-snippet-late-cancel-red-20261020`，HEAD严格为16366df。上述React文件SHA256与交接值相同；原命令仅运行一次，退出1，2.9663985秒，13项中9通过、4失败、0跳过。

四项失败均为新增迟到取消时序：原导出成功后被“发布中”提示覆盖、成功后追加迟到取消错误、原导出失败后错误地恢复“发布中”提示、失败后原错误被迟到取消错误覆盖。开发会话已读到四项具体断言与位置，符合反例目的；这不是修复后通过结果。测试机随后核工作区干净、无剩余任务进程；原报告保留在克隆的 `.cache/snippet-late-cancel-before.json`，摘要及交付副本校验仍待最终回报。

当前f173f41的定向、完整单元及四条桌面用例继续按上述顺序验收，不能把本节红例、历史本机结果或其它候选通过记到它。实库连接配置不影响本批离线片段测试，也没有因此创建连接、测试用户、密钥或迁移凭据。
