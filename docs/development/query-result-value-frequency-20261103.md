# 查询结果不同值按次数整理

## 使用与范围

在结果筛选条件中打开“从结果选择值”，可选择“原结果首次出现顺序”“出现次数最多优先”或“出现次数最少优先”。对原已返回全部行中的不同值计数，在完整搜索匹配集合中排序后分页；同次数沿首次出现顺序。排序切回首页并保留搜索和全部勾选，不重新执行 SQL。

选中值先“写入条件草稿”，再由外层“应用筛选”改变结果。切换排序不改变父草稿、结果多列排序、原值或候选编号。NULL、空文本和文本 NULL 独立；SQLite 同显示值仍按 INTEGER／REAL／TEXT／BLOB 原存储类型分别计数和选择。

这仅整理已返回结果。原查询截断警告保留，次数不代表未返回的数据库行；表页的[服务器全集分组排序](table-value-frequency-20261103.md)是另一入口。沿用完整扫描的 100000 行／2000 种候选和最多勾选 128 种的预算，超限不返回部分集合。

## 实现

`searchQueryResultValueOptions` 增加受限排序参数，旧调用仍按首次出现顺序。只重排稳定编号，不改冻结的候选数组、精确字面值或首个数值原文；数值次数比较不按字符串排序。显示顺序不参与候选身份。

选择器排序成为本地草稿的一部分，复用原来源捕获、永久失效、同值 ABA、组合输入及父级全树校验。迟到事件不能撤销后继选择或写入其它来源。不改 IPC、数据库引擎、凭据、配置格式、会话及数据写协议。

## 验证

WIN11-TEST 本轮读取不可达、未派发；按既有授权回退本机。最终六文件 184 项通过，含新增次数顺序／跨页／搜索、精确数值原文、SQLite 类型和完整父面板。原来源、NULL 补集、预算与事件保护断言保留。

Windows 原生组件最终一例通过，用例 6.248 秒，原 120 秒、单 worker、零重试，零跳过／flaky。实际产品过滤器、条件面板及选择器运行在 Electron 窗口；输入明确为合成 MySQL／SQLite 结果，不提供真实驱动或 IPC：

- 普通结果 168 行、60 种候选，原第二页热门值排序回首页；100 与 9 按次数数值比较，最少次数及切回原序保留选择。
- 搜索缩小和恢复集合不丢已选；内层 Ctrl／Cmd+Enter 只写草稿，外层明确应用后才匹配热门及次热门的 109 行。
- SQLite 175 行、64 种候选，同显示 TEXT／INTEGER／REAL 分开；TEXT 的 3 次排序及 REAL 的独立勾选，最终只匹配 REAL 的准确源行。
- 明暗截图已审阅，原结果完整保持、IPC 调用零。原 App 正常 exit0、无强停，独立 CIM／准确路径核 PID 与临时目录不存在。

严格类型及全部生产构建最终退出 0；构建保留原大块提示，没有调整阈值掩盖。默认关闭与 `--list` 各一项登记检查通过，不启动窗口或读取外库凭据。

原失败保留：两轮 RAM 测试误选父启用框／使用未反射的 class；首轮原生环境在 Vite 初始化前冻结，次轮过早读取尚未渲染的观察端口；初次类型检查为合成类型代码数组的过窄推断，初次构建入口为不存在的本地 pnpm 脚本。均修正测试／运行入口后另开新轮，不改业务断言、超时或跳过计数。两次失败 App 均正常退出、准确 PID 已核不存在，目录保留。

原件保存在私有 `.cache/result-value-frequency-20261103/`，不入库。本轮不使用剪贴板、真实数据库或已安装配置。完整生产工作区、真实驱动、Mac 和安装包仍另验；不增加完整工作包或发行计数，暂不发布。

## 命令

单元：`pnpm exec vitest run tests/unit/query-result-value-frequency.test.ts tests/unit/ui-query-result-value-picker.test.tsx tests/unit/ui-query-result-filter-value-options.test.tsx --maxWorkers=1`。

原生组件：在无外库认证及模块注入的干净进程设置 `DBARK_INTEGRATION_ENABLED=0`、`DBARK_RESULT_FREQUENCY_NATIVE=1`，运行 `node node_modules/@playwright/test/cli.js test tests/e2e/query-result-value-frequency-native.spec.ts --reporter=json`。失败保留准确目录；核原进程终态后才能开新轮。
