# Q05 执行 SQL 并完整导出验收记录（2026-10-14）

## 当前状态

本批 v0.5.0 开发源码最新 Windows 真实 Electron 八项验收全部通过：8 通过、0 失败、0 跳过、0 不稳定结果，耗时 43.917 秒，包含真实 utility 退出与导出期间正常退出。相同本机 NSIS 安装包在补充结果导出取消回归后，完整 **38/38 通过，0 失败/跳过/flaky，246.978 秒**；此前首轮 37 项的 36 通过、1 失败及两轮诊断均保留。MySQL 8.4.11 的阶段引擎完整 19 项（包含百万行）全部通过，其余四基线合并覆盖各 18 项普通用例。SSH 首轮真实断线挂起修复后，SSH、直连和严格 TLS 三轮分别 18 通过、1 百万行跳过。373 项全量单元及类型检查通过；本批原生 CI 与公开文件尚未验收，不能外推。

较早六项桌面结果对应 build02（04:56:51），引擎百万行完整轮次对应 05:01:20 启动的代码。其后主进程在 05:01:34 修复“准备期间 worker 退出后迟到投递”，引擎在 05:02:01 修复“文件清理异常后的事务状态刷新与脱敏”。这两处不能由旧轮次外推，但已纳入 build03 的八项桌面复验；百万行阶段结果仍单独记录，不声称最后补丁后又跑过百万行。

最新协议修复时间为 05:14:55，处理 SSH 仅发连接结束事件的断线；其后三路引擎及 build03 桌面复验已实际读取原始日志核对。`.cache/q05-query-stream-stage-files-0515.json` 保留旧 dist 与后续源码不同步的阶段快照；最终开发构建的源码与 dist SHA256、修改时间另存 `.cache/q05-query-stream-build03-files.json`，不覆盖前者。

首轮桌面 4 通过、2 失败包含一个真实界面问题：双击确认时，原位置的按钮立即变成“取消任务”，第二击导致误取消。前端保留并禁用确认按钮，把取消放在独立位置后，原双击用例完整通过。另一项为测试中的动态 import 不受 Electron 调试 evaluate 支持，改用同一 Node 内建模块后通过；没有替换 IPC、SQL、文件内容或任务返回值。

本批与 `961c4de` 冻结的 v0.4.0 分开。v0.4.0 安装包、原生 CI 与公开文件的既有验收记录保持原样；不能把本批开发功能补计入旧发布版本。

## 环境和资源边界

- 仅在显式启用 `DBARK_INTEGRATION_ENABLED=1` 并提供已核对的远程测试地址后运行。凭据从忽略环境文件载入，不打印、不提交，不出现在截图和跟踪文件中。
- 复用已核对的 Server-200 / `192.168.31.200` 隔离实例。桌面验收使用 MySQL 8.4.11 的专用 `13384` 端口；多版本、SSH、TLS 结果须分别记录，不能外推。
- 新增引擎文件为 `engine-query-stream.integration.test.ts`，桌面文件为 `tests/e2e/query-stream-export.spec.ts`。默认跳过真实数据库测试，不更改既有测试或发布文件清单。
- 每例只操作本例随机数据库。清理前关闭应用/引擎会话，精确删除本例库和临时账户，再从服务器目录表读取并断言零残留；不按模糊前缀删除其他智能体的资源。
- 百万行造数使用专用随机库，并由 `DBARK_TEST_MILLION=1` 显式启用。不使用本机 Docker，本测试本身不创建、重启或删除远端容器。
- 文件写入本轮临时目录。原文件保护断言使用测试生成的标记文件；保留的日志、截图和统计信息放入忽略的 `.cache/q05-query-stream-*`，不会复制真实业务数据。

## 验收矩阵与覆盖边界

| 编号 | 真实输入与观察方式 | 必须满足的断言 | 当前结果 |
| --- | --- | --- | --- |
| S01 | 在已有标签会话中创建临时表、变量和显式事务，再完整导出含写入及读取的脚本 | 连接编号不变；临时表/变量可见；导出只写一次；独立观察连接看不到未提交行；文件完成不自动提交或回滚；明确回滚后为零行 | 五基线引擎及 MySQL 8.4 桌面通过 |
| S02 | UPDATE 后 ROW_COUNT、受限查询后 FOUND_ROWS、CAST 警告后 SHOW WARNINGS；分别验证首次准备和缓存命中 | 诊断值及所属行结果 warningCount 正确；不支持准备不透明回退或重放 | 五基线通过；额外出站命令探针 5/5 证明首次/缓存及 11 类控制路径 |
| S03 | DELIMITER 存储过程返回不同列结构、零行集和最终状态包，并切换静态/动态 sql_mode | 三种序号连续且不混用；零行集占行结果序号；CALL 状态不占行结果序号 | 五基线引擎通过；未知词法歧义另由协议单元覆盖，未单列本批 UI 用例 |
| S04 | 重复/空列名、`__proto__`/`constructor`、NULL/空串、Unicode、BIGINT、DECIMAL、DATETIME 微秒、BLOB、相邻 FLOAT/DOUBLE、POINT/LineString | 位置和值保持；严格文本浮点失败保护原件；显式二进制保持相邻浮点；几何值保持现有 JSON 字符串语义 | 五基线通过；桌面另验 BIGINT/NULL/BLOB/原型列及相邻浮点；BIT 本批未单列 |
| S05 | CSV 选择第 N 个实际行结果，脚本同时包含 DML/空行集/CALL；再指定不存在的 N | 只导出所选行集但执行后续语句；不存在 N 保留原件；已提交前缀只有一次 | 五基线通过；桌面实际第 2 个行集 100001 行及不存在的序号通过 |
| S06 | JSON 导出全结果封装 | `format`/版本/结果元数据正确；状态和行集顺序正确；默认无 SQL 正文或展开参数 | 五基线及桌面通过；该封装不能直接用旧表 JSON 导入恢复 |
| S07 | 100001 行和 MySQL 8.4 百万行扩展；增量解析实际文件 | 文件每行、总数、校验和正确；预览 200 行；真实队列峰值 1 行；RSS 辅助记录 | 五基线 100001 行、MySQL 8.4 阶段引擎百万行及桌面 100001 行通过；SSH 首轮后置清理失败未计通过 |
| S08 | 已提交写入后 SQL 错误、字段预算、目标父目录缺失、实际 rename 目标为非空目录，以及真实断线 | 停止后续语句、不重放、原件保留、partial 清理；失败进度和事务未知标记准确 | 五基线通过；编码、行/结果预算另有单元证据；真实 ENOSPC 和 ACL 拒绝未测 |
| S09 | 真实 SLEEP 期间取消、实际文件已写入后取消，随后复用同标签 | 等真实终态和服务端命令结束，尾 SQL 不执行，同一会话可继续使用 | 五基线及桌面通过；本批未另造锁等待场景 |
| S10 | 短写、同步/rename 边界取消，以及两个任务同目标路径 | 短写完整消费；替换开始后取消仍报告真实提交；并发写入在 SQL 发送前拒绝 | 真实文件与可控 IO 边界单元通过；同路径真实引擎通过；不冒称自然桌面发生过磁盘满或 rename 时序 |
| S11 | 参数秘密标记，成功和实际重复键错误 | 静态错误在首写前拒绝；历史、任务、工作区、SQLite 无实参及展开 Hex；文件不默认附 SQL | 五基线引擎及 MySQL 8.4 桌面通过 |
| S12 | 真实 UI 模态、目标选择、固定选区、双击确认、模态快捷键、错误后再次确认 | 准备阶段零执行；只一次新执行；不自动重试；旧结果导出仍不重放 | 最终八项桌面通过；主进程准备取消用真实 realpath 完成后的可控边界；原生选择器取消本批未单列 |
| S13 | 真实导出期间调用引擎 closeAll，以及 Electron 正常退出/准备时真实 utility 死亡 | 等取消、句柄清理、真实服务端线程消失；未提交事务断开回滚，旧文件保持；准备时死亡不迟到投递 | 五基线引擎、最终桌面两种退出场景均通过；只终止当前测试 app 已核对 PID 的 utility |

## 证据强度及待确认的设计边界

1. 文件超过 100000 行且内容正确，只能证明完整性。内存有界另需可观测的队列峰值、预览大小和 IPC 批次预算；单独一次 RSS 截图不能证明背压正确。mysql2 的单个协议行仍可能先被缓冲，应明确该边界。
2. 取消必须等待真实任务终态和服务器命令消失，不能以窗口关闭或按钮变灰代替资源释放。测试按真实任务/进度条件触发，不增加任意延时或重试写 SQL。
3. 磁盘短写、ENOSPC 和 rename 开始后的取消，需要可控的文件操作边界。若采用 IO 依赖注入，仍使用真实文件系统处理数据，并单列为故障注入证据；不能冒称真实桌面运行自然发生过这些故障。
4. CSV 的 N 专指本次执行的 `rowResultOrdinal`，状态包不占 N，有列但零行的结果占 N。全部 `resultOrdinal` 则包含 DDL/DML/CALL 状态包。
5. 文件提交和数据库提交是独立事件。任何“原文件未改”结果均不能推导为“SQL 未执行”；已提交的数据库前缀必须由独立观察连接核验。
6. 文件窗口只授权路径并固定 SQL 模板，不能为列预览或总行数执行用户 SQL。真实原生保存对话框可在测试中仅替换路径选择；这不等于已验证各操作系统的覆盖提示交互。
7. 文本严格与显式二进制模式分别验收。成功准备可能改变警告，准备失败可能改变诊断，因此禁止先试 PREPARE 再透明回退。未覆盖的控制语句和各服务器差异继续明确保留。
8. 本轮应明确同一目标路径的并发写入、目标是目录/链接、编码变化后文件授权是否仍有效，以及退出阶段的行为。未实测的组合不得由普通成功导出外推。

## 实际执行与清理记录

所有轮次均保留独立目录，未覆盖最初失败结果。以下路径在本机 Git 忽略目录，不随公开源码发布；测试输入只有合成数据。

### 本机 NSIS 首轮与既有结果导出取消诊断

本机 0.5.0 NSIS 首轮完整 37 项为 **36 通过、1 失败**，`259325.669 ms`；新增 8 项 Q05 和 5 项关联记录全部通过，唯一失败为既有结果导出用例无条件期待取消错误框。安装包 SHA256 `970336FCB280F9D3ECD0D2B3FB8814CB975707F863AFA06A7295BFC651C63A4A`，137468585 字节。证据 `.cache/local-v0.5.0-install-validation{.json,.log,-results.json}`；真实卸载、临时目录删除、安装注册零已核对，不能把首轮写成全绿。

保持同一安装包和原断言，在忽略目录复制测试，仅增加真实事件和文件观察，不修改 worker、SQL、文件 IO 或生产代码：

- `.cache/q05-result-cancel-diagnostic/`：仍在原取消断言失败，但任务唯一终态为 completed，实际文件 44882 行、16237209 字节，所有 ID 唯一合法、每行 payload 精确，partial 零。真实目标 rename 观察为 UTC `21:40:45.552`，completed 为 `45.560`，从初始 running 到完成约 242 ms；没有捕获到取消按钮的实际 click，不能把此轮称为“IPC 取消已经送达却丢失”。
- `.cache/q05-result-cancel-diagnostic02/`：原测试 1/1 通过，8.9 秒。真实可信取消 click 为 UTC `21:42:27.925`，20 ms 后 cancelled；原38字节目标与 SHA256 完全不变，partial 零且无目标 rename。两轮均真实卸载并核对临时目录、注册零。
- 两轮原始 `cancel-observation.json`、截图、日志及详细 `.cache/q05-result-cancel-diagnosis.md` 保留。六实例随机库、临时目录和诊断进程零另见 `.cache/q05-result-cancel-diagnostics-{cleanup,processes}.json`。

旧测试把“已看到 DOM 写入进度”视作后续自然点击必然抵达原子替换前，因 64 KiB 缓冲后的文件写入较快而暴露时序假设；实际早取消生效，不能通过修改生产性能或固定延时迎合测试。修正后的自然点击回归严格只接受两个真实唯一终态：cancelled 时原件逐字节不变；completed 时读取 CSV 并按实际查询批次收到的 ID 序列逐行比对 ID、字段数及完整 payload，行数必须与实际返回值一致。两分支都核对唯一任务、历史不变、partial 零，不接受 failed，也不把“点击动作返回”当作取消已送达。

另新增独立强回归：真实 UI 点击开始后，由第一条真实 running 事件回调发送一次真实 `query.cancel`，必须 cancelled、原件不变、partial 零，独立观察连接确认原 INSERT 仍只有一次。此项明确属于真实 IPC 提前取消，不能声称鼠标点击取消；没有模拟 worker、SQL 或文件 IO。更新后全部桌面用例准确为 **38 项**。

同包定向回归 `.cache/q05-result-cancel-regression{.json,.log,-results.json}` 已实际 **2/2 通过**，0 跳过/失败/flaky，`15101.147 ms`，开始 UTC `2026-10-13T21:48:50.934Z`。自然 UI 分支实际 completed，文件按收到的全部 44882 行顺序逐 ID、每字段严格比较通过；新增提前取消在首条 running（0 行）即发 IPC，6 ms 后 cancelled（已处理 182 行），原件保持、partial 零、原 INSERT 仅1次。结果/事件分别存输出目录的 `query-result-export-terminal.json` 与 `query-result-export-early-cancel.json`，截图已查看取消错误框及成功完成状态。此次真实卸载、目录删除及注册零由安装 JSON 证实。完整 38 项另轮执行，不能用定向两项替代。

### 同包完整 NSIS 复验：38/38

- 未重建或修改运行时代码，仍使用 SHA256 `970336FCB280F9D3ECD0D2B3FB8814CB975707F863AFA06A7295BFC651C63A4A` 的 137468585 字节本机包。只修改测试及本验收文档，原首轮 37 项和诊断文件不覆盖。
- 实际命令 `node .cache/test-q05-final-full.mjs`：安装前拒绝覆盖已有 DBArk 注册，随机临时目录内真实静默安装；Electron 保持沙箱，实库使用专用 13384，百万行显式启用。
- JSON 开始时间 `2026-10-13T21:49:53.829Z`，总时长 `246978.299 ms`；**38 expected、0 unexpected、0 skipped、0 flaky**。不是 37 项，也不是仅新增 8 项。实际进入系统凭据加密分支，包含全部原有查询/编辑/对象/文件/参数/外键与百万行工作流。
- 自然取消竞争实际终态 completed，真实返回的全部 44882 行 ID 顺序与每个 payload、字段数均逐行核验；真实早取消用例在首 running 后 5 ms cancelled（182 行），原件不变、partial 零，旧 SQL 无重放。事件文件位于本轮输出目录；没有用 failed 或部分文件冒充成功。
- 证据：`.cache/local-v0.5.0-final-install-validation{.json,.log,-results.json}` 及同名前缀输出目录。安装记录开始 UTC `21:49:44.645Z`、结束 `21:54:05.256Z`，`testsPassed/uninstalled/temporaryRemoved` 均为 true、`remainingInstallations=0`，执行退出码 0。
- 被测测试文件 `tests/e2e/query-results-export.spec.ts` SHA256 为 `074BEDEDF59EAC5B0C79E2B350FD8F2E55D5A640A878C6A3034301425BB376D9`；最终类型检查和 diff 检查均通过，没有重新编译生产包以改变取消时序。
- UTC `21:54:27.349Z` 只读清理核对 `.cache/local-v0.5.0-final-cleanup.json`：六端口本批随机数据库、临时测试用户、相应服务器线程均零，新临时目录零，13 个旧诊断目录保持原样。`21:54:28.808Z` 的 `.cache/local-v0.5.0-final-processes.json` 证明安装应用、源码 Electron 和本轮测试进程均零；六容器/卷/网络仍保留，由主智能体统一安排公开包验证。

本轮只证明 Windows 本机 NSIS 产物，macOS 原生测试、三平台 CI、公开 Release 下载文件须各自另行验收后再补记录。

### 最新源码桌面：build03 / run03-final

- 实际命令 `node scripts/build.mjs`，日志 `.cache/q05-query-stream-build03.log`，退出 0；版本 0.5.0。主进程和 worker 于北京时间 05:17:36 生成，renderer 于 05:18:02 生成，晚于全部已列修复。
- 实际命令 `node .cache/run-q05-query-stream-e2e.mjs run03-final`；只运行新增八项，旧 29 项没有混入该通过数字。Playwright JSON 开始 `2026-10-13T21:18:23.543Z`，`43917.119 ms`，8 expected、0 unexpected、0 skipped、0 flaky；运行器开始 `21:18:22.971Z`，44509 ms，退出 0。
- 证据目录 `.cache/q05-query-stream-e2e/run03-final/` 含 `desktop.log`、`results.json`、`summary.json` 和 `output/`。八项依次约 6.5、6.9、5.4、6.0、7.3、4.2、2.4、4.3 秒。此轮未修改断言、未重试任何数据库写操作。
- 第七项使用真实 `app.getAppMetrics()`，按唯一数据库 utility 服务名和实际 PID 两次核对归属，再终止该测试应用的工作进程。真实 IPC/任务记录最终失败；释放真实路径准备边界后没有迟到 SQL、目标替换或 partial，独立数据库计数为零。没有伪造 worker 退出事件。
- 第八项在独立观察连接确认 `SLEEP(30)` 正在执行时发起真实 `app.quit()`，仅替换原生确认对话框回答。真实关闭流程等待取消，既有事务断开后回滚、尾 INSERT 未执行、目标原件保持、partial 为零；同次 app 的所有 PID 与服务端线程均消失。夹具检测已关闭状态，不重复发起退出。
- 已实际查看 `stream-fixed-selection.png`、`stream-binary-float-success.png`、`stream-before-normal-quit.png`：新执行说明、协议限制、SQL 固定文本与独立取消/确认按钮可见；二进制成功显示已提交 2 行、371 字节；运行时关闭按钮禁用但取消入口可用。长内容主体有垂直滚动，页脚固定，没有遮挡主要操作。

构建和测试文件的完整 SHA256 保存在 `.cache/q05-query-stream-build03-files.json`。其中 worker 为 `298FA2FBA47C9940606F9364FA90B32D283BA139793FA10E5828DEB2BC37C065`，主进程为 `F136F23FEE918D4E4CA6203192CDEB69A8F35A9EFAEFC9D66A49AB652D06337E`，新增桌面 spec 为 `114CB36CA3FEA7C77A9EEE93825106A26F9B02411947FEF891DB4EE3391CBB9C`。这只是本机开发构建身份，不是安装包或公开文件校验和。

### 保留的阶段源码桌面：build02 / run02-current

- 构建日志：`.cache/q05-query-stream-build02.log`，`pnpm build` 实际退出 0。`dist/main/worker.cjs` 的生成时间为北京时间 04:56:51，晚于最后协议修改 04:51:29，包含 v0.5.0 开发源码和双击修复。
- 命令：`node .cache/run-q05-query-stream-e2e.mjs run02-current`。该本机运行器只加载忽略凭据、设置真实数据库开关并运行独立新 spec；不重新构建。
- 结果：`.cache/q05-query-stream-e2e/run02-current/results.json`；实际开始 `2026-10-13T20:57:53.515Z`，持续 `36456.091 ms`，6 通过、0 失败、0 跳过、0 flaky。
- 同目录 `desktop.log`、`summary.json` 保存原始输出和运行器时间。六例耗时依次约 5.6、6.6、6.0、6.0、7.3、4.0 秒。
- Playwright 保持 `chromiumSandbox:true`；真实应用保留沙箱，没有 force click、固定 sleep 或写操作自动重试。
- 第六例仅在主进程内拦住本例父目录的真实 `fs.realpath` 完成返回点，发出真实 `query.cancel` 后放行，并在 finally 恢复原方法。实际 Preload、主进程任务、授权、数据库和文件行为均未模拟。该证据是可控准备时序，不是自然磁盘延迟。

截图根目录为 `.cache/q05-query-stream-e2e/run02-current/output/`，文件名分别为 `stream-fixed-selection.png`、`stream-single-execution-success.png`、`stream-missing-result-protected.png`、`stream-complete-over-limit.png`、`stream-strict-float-failure.png`、`stream-binary-float-success.png`、`stream-writing-cancelled.png`。长 SQL 的窗口主体可滚动，固定页脚仍可见；文件内容和进度由测试独立断言，截图不能代替实际文件读取。

### 引擎五基线与百万行

独立命令入口为 `node .cache/run-q05-query-stream.mjs <轮次> <端口>`；实际被测文件为 `tests/integration/engine-query-stream.integration.test.ts`。基础矩阵最终轮次均包含几何值和行 EOF 警告的真实断言；05:02:01 的清理异常补丁需另记后续复验，不与此前结果混同。

| 实例 | 实际版本 | 基础轮次 | 新增退出补验 | 结论 |
| --- | --- | --- | --- | --- |
| 13357 | MySQL 5.7.44 | `run05-mysql-old-corrected`：17 通过、1 百万行跳过 | `run11-shutdown-mysql-old`：退出 1 项通过，其余按过滤未运行 | 合并覆盖 18 个普通用例，未跑该版百万行 |
| 13380 | MySQL 8.0.46 | `run06-mysql-current`：17 通过、1 百万行跳过 | `run12-shutdown-mysql-current`：退出 1 项通过，其余按过滤未运行 | 合并覆盖 18 个普通用例，未跑该版百万行 |
| 13384 | MySQL 8.4.11 | `run10-frozen-million`：19 项全部通过，0 跳过，日志总时长 36.54 秒 | 已包含 | 同一阶段轮次含退出、几何、警告和百万行；早于 05:02:01 清理补丁 |
| 13310 | MariaDB 10.11.19 | `run07-maria-old`：17 通过、1 百万行跳过 | `run13-shutdown-maria-old`：退出 1 项通过，其余按过滤未运行 | 合并覆盖 18 个普通用例，未跑该版百万行 |
| 13311 | MariaDB 11.4.13 | `run08-maria-current`：17 通过、1 百万行跳过 | `run14-shutdown-maria-current`：退出 1 项通过，其余按过滤未运行 | 合并覆盖 18 个普通用例，未跑该版百万行 |

每轮均有 `.cache/q05-query-stream-integration/<轮次>/{integration.log,results.json,summary.json}`。这是不同轮次的合并覆盖，不伪称五库一次执行 95 项全绿。上述阶段有效覆盖共 91 个“实例 × 用例”，其中 90 为五库各 18 个普通用例，1 为 MySQL 8.4 百万行。

`run10-frozen-million` 的真实文件统计：

| 数据规模 | 文件字节 | ID 校验和 | 预览行 | 实际待消费峰值 | RSS 最大增量 |
| --- | --- | --- | --- | --- | --- |
| 100001 行 | 10389012 | 5000150001 | 200 | 1 行 / 102 字节 | 36179968 字节 |
| 1000000 行 | 104888908 | 500000500000 | 200 | 1 行 / 103 字节 | 73502720 字节 |

文件通过独立 CSV 流逐行校验 ID 顺序与完整 payload，没有将完整文件读入内存。队列峰值来自实际已排队及正在消费的数据行计数；RSS 仍包括驱动和测试运行器分配，不冒称全过程固定堆大小。桌面另导出的纯 ID CSV 为 100001 行、688907 字节，普通查询显示上限设置为 2 仍得到完整文件，成功后预览为 200 行，DOM 虚拟行数小于 80。

### 清理补丁后的真实传输验证

- `run15-strict-tls`：开始 `2026-10-13T21:09:27.329Z`，MySQL 8.4.11 / 13484，18 通过、1 百万行显式跳过；Vitest 8.50 秒，运行器 9221 ms。使用已有测试 CA，保持证书信任与主机名验证，不降低 TLS 校验。
- `run16-ssh`：开始 `2026-10-13T21:09:31.800Z`，MySQL 8.4.11 / 13384，15 通过、3 失败、1 百万行显式跳过；Vitest 118.72 秒，运行器 119438 ms。复用 `ssh -G server-200` 的现有身份配置，并从服务器现有 Ed25519 公钥计算、核验 SSH 指纹；没有生成或输出私钥。
- SSH 的前 15 项实际通过，包括查询取消、磁盘写入中取消、并发目标锁、精度与参数脱敏。第 16 项由独立观察连接真正 `KILL CONNECTION` 后，导出 Promise 和引擎关闭均未收尾，出现测试、afterEach、afterAll 各 30 秒超时。没有靠加长超时或跳过断线绕过此问题。
- 后续退出和 100001 行用例的失败点都是本轮目录中遗留的 `disconnect.json.*.partial` 零字节文件；其局部 SQL/文件断言虽已越过，仍不能将这两项计为完整通过。服务器独立核对仅前缀 `id=118,hits=1` 已提交，119/120/121/122 均不存在，原目标文件仍保留。
- 失败证据在 `run16-ssh/{integration.log,results.json,residue.json,cleanup-before-directory.json,cleanup-directory.json}`，原件与零字节 partial 复制至 `run16-ssh/failed-files/`。05:13:42 的只读核对显示本轮数据库线程 0、测试 Node 进程 0；随后精确 DROP `dbark_stream_1791925773013_3531a239` 并 SELECT 零残留，05:14:27 核对本轮临时目录已删除。此清理没有删除失败证据、其他库或容器。

两轮均晚于 05:02:01 的引擎清理异常补丁。后端通过独立真实事件探针 `.cache/q05-ssh-close-evidence.json` 证实 SSH KILL 后只有 connection/channel end，没有 command error/end 或 connection error；协议消费者原来只监听 error，因此未唤醒。05:14:55 最小修复新增连接 end 失败唤醒，并在 finally 清除监听，没有修改 SSH 依赖或以重连掩盖断线。

修复后的独立完整轮次均包含 100001 行与真实断线，不启用百万行扩展：

| 传输 | 轮次与实际开始时间（UTC） | 结果 | Vitest / 运行器时长 |
| --- | --- | --- | --- |
| SSH / 13384 | `run92-ssh-fixed`，`2026-10-13T21:15:23.620Z` | 18 通过、1 百万行跳过 | 29.91 秒 / 30736 ms |
| 直连 / 13384 | `run93-direct-fixed`，`2026-10-13T21:15:43.483Z` | 18 通过、1 百万行跳过 | 9.18 秒 / 9908 ms |
| 严格 TLS / 13484 | `run94-tls-fixed`，`2026-10-13T21:15:41.272Z` | 18 通过、1 百万行跳过 | 9.17 秒 / 9865 ms |

这三轮由后端负责人使用同一测试文件与忽略运行器执行，本验收独立读取各轮 `summary.json` 和 `integration.log` 核对，不将它们称为桌面验证。SSH 断线后的失败终态、原件/partial、仅提交前缀、断线会话拒绝复用均完整通过；原 `run16` 失败及独立 `run91-ssh-close` 探针保持原样。

### 协议探针与文件单元

- 后端独立真实协议探针 `.cache/q05-engine-wire-probe.log` 为 5/5，通过实际 Engine 观察出站命令，不改变发送内容；详细数据 `.cache/q05-engine-wire-evidence.json`。
- 五库首次准备为命令 22/23，缓存命中仅 23；事务内准备 EOF 位为 3，实际导出结果仍明确事务活动。11 类诊断/控制语句（含 GET DIAGNOSTICS、`@@error_count`、SQL PREPARE/EXECUTE/DEALLOCATE）只发命令 3。
- 非法准备五库只发 22，没有 EXECUTE、文本回退或尾部 INSERT。CREATE PROCEDURE 在三个 MySQL 为 ER_UNSUPPORTED_PS 且只发 22；两个 MariaDB 实际支持，发 22/23，不能谎称它们也“不支持”。探针每例精确 DROP 后读取 SCHEMATA 为零。
- `.cache/q05-query-stream-unit-verification.log` 和 `q05-query-stream-unit-results.json` 独立复核 `query-stream-file.test.ts` 与 `query-stream-protocol.test.ts`：2 文件、31/31 通过，869 ms。短写、编码拒绝、同步期取消、进入 rename 后晚取消、目标锁和字节预算使用实际临时文件及明确的可控 IO 边界；协议事件泵单元与真实服务器集成分别记录。
- SSH 结束事件修复后的全量单元日志 `.cache/q05-ssh-eof-all-unit.log`：36 文件、373/373 通过，05:15:21 开始、2.68 秒；本验收已读取日志尾部核对，保留前述 31 项独立阶段记录，不把模拟事件单元称作实库或桌面通过。
- 类型检查另用 `node node_modules/typescript/bin/tsc --noEmit` 完成；新增文件 diff 检查通过。没有为本次验证修改依赖、锁文件、旧 spec 或 v0.4.0 验收文档。

### 保留的失败与阶段轮次

1. `run01-mysql`：12 通过、4 失败、1 百万行跳过。测试 SQL 的 LAST_VALUE 是 MySQL 8 保留字；CHAR 未指定字符集实际为二进制；两处小整数常量以 LONGLONG 字符串返回而测试误期待 number。修正测试输入和类型语义后 `run02-corrected` 16 通过、1 百万行跳过，未改运行时以迎合断言。
2. `run03-million`：当时 17 项含百万行全部通过，但开始时间 04:51:19 早于最后协议快路修改 04:51:29，因此作为较早阶段证据保留；协议快路后的百万行见 `run10-frozen-million`，该轮仍早于后续清理异常补丁。
3. `run04-mysql-old`：MySQL 5.7 为 15 通过、2 失败、1 跳过。常量 SELECT 的 WHERE 需要 FROM DUAL；REPEAT 生成 8 MiB 以上内容超过该版服务器包限制，实际返回 NULL/警告，未触发客户端字段预算。改用约 1.4 MiB NUL 字符，实际 JSON 转义后超过 8 MiB，验证真实序列化预算；没有修改服务器全局配置，也没有删去原文件保护/尾 SQL 不执行断言。
4. 桌面 `run01-source`：4 通过、2 失败，`96205.089 ms`。此轮误用了尚缺最后协议变更的 build01，不能当最终版本结论；但双击导致误取消的实际 UI 缺陷与协议无关，已保留失败截图并修复。第二项是测试动态 import 的宿主限制，改为 `process.getBuiltinModule`；构建 build02 后原六项完整通过。

### 资源核对

- 每个集成套件设计为在 finally 先结束引擎，再精确删除自己的 `dbark_stream_<时间>_<随机值>` 库，并查询 SCHEMATA 断言为零。已通过轮次完成此步骤；SSH `run16` 因引擎关闭挂起未能完成 finally，按上述独立脚本核对并精确清理，不能声称自动清理通过。每个已通过桌面用例复用独立夹具，先真实退出应用，再精确 DROP 本例库和查询零残留。
- 20:59:44 UTC 的额外只读核对 `.cache/q05-query-stream-cleanup.json`：五端口本批命名空间均为零，本轮临时目录为零；`.cache/q05-query-stream-processes.json` 核对源码 Electron/本轮测试进程为零。其后的退出/百万补验仍完成各例自身 DROP 与零查询断言，最终额外检查见同目录后续记录。
- build03 八项完成后，`2026-10-13T21:19:23.430Z` 的 `.cache/q05-query-stream-final-cleanup.json` 只读核对六端口（含严格 TLS）本批 `dbark_stream` 与 `dbark_e2e` 随机库均为零，20:45 UTC 后创建的本批测试临时目录为零。`21:19:24.506Z` 的 `.cache/q05-query-stream-final-processes.json` 显示本项目 Electron 与本轮测试进程为零。没有以关闭窗口代替进程检查。
- 本批没有创建数据库用户、保留密钥或证书。200 容器、卷和网络保持原状，由主智能体统筹后续测试；没有借清理删除旧失败证据或其他任务资源。

恢复复验时先确认旧任务和本轮随机资源是否已清理，再使用新的随机库与文件目录；不得复用失败写操作的 SQL 自动重放。保留的忽略证据只用于复核，不作为应用配置或凭据来源。

## 明确保留的后续范围

CSV 多结果容器及整体提交、JSON 全结果封装导入/恢复、断点续写、已完成查询的服务器游标续读，以及更广的预处理协议兼容范围，不属于本批首个完整流式导出的通过结论。
