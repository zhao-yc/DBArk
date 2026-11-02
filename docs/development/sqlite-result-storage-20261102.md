# SQLite 查询结果类型与快照兼容

## 变化与范围

SQLite 同一列的 `2` 可能是 INTEGER、REAL 或 TEXT，显示文本不能证明存储类型。实际查询回包新增可选 `sqliteStorage: { version: 1, rows: string[] }`，逐行按原列位置保存 `i/r/t/b/n` 标记。标记取自实际 driver 原值；不改变原 `CellValue`、列键、任务、事务或执行次数。脚本累计上限以外的行不加入标记，空结果保留空标记数组。

共享校验检查行列对应、int64 范围、REAL 原文、有效 Unicode、标准 Base64 及总预算；不执行 getter，不把旧结果的显示文本猜成数值。结果投影同步投影标记；已有固定结果的 NULL 筛选保留原行引用。类型对象、数组或标记变化使原整理租约失效，恢复旧值也不能复活原租约。

本轮是 SQLite 查询结果本地整理的基础，**尚未开放完整筛选和多列排序入口**。表页原有服务器分页、类型筛选和多列排序保持独立。

## 快照格式

含类型信息的结果保存为 `dbark.query-result-snapshot` 版本 2，必须完整保留类型信息。没有该字段的旧结果继续保存为版本 1；新客户端继续读取版本 1，类型仍为未知。版本 1 不接受混入新字段，版本 2 不接受缺失字段或原值不匹配。旧客户端不能读取版本 2；不通过丢弃类型信息静默降级。

16 MiB 文件上限包含类型标记、原列键、数值标签、SQL、JSON 转义及换行。快照只含已返回范围，不补读数据库，不恢复连接或执行来源 SQL。

## 本轮验证

WIN11-TEST 远程会话不可达，本轮按既有授权在 Windows 本机执行，未在远端重复派发：

- `pnpm typecheck`、`node scripts/build.mjs` 通过。
- `pnpm exec vitest run tests/unit/sqlite-result-storage.test.ts tests/unit/sqlite-query-session.test.ts query-result-snapshot query-result-filter query-result-sort --maxWorkers=3`：20 份、732 项通过；包括类型、截断、多结果、版本兼容、完整文件预算和原筛选排序回归。已有 React act 警告保留。
- `node scripts/sqlite-workspace-ci.mjs workspace`：真实 Electron 原工作区一整例通过，保留 120 秒、单 worker、零重试与原失败资源保护。原 SQL 执行仍准确四次；原菜单保存一次版本 2 文件，新 owner 原菜单打开一次；独立 JSON 核对 int64、TEXT、NULL、BLOB 与逐格类型。原事务回滚、独立读盘、重启草稿不执行断言保持。两个准确进程退出码均 0，独立核进程及原目录不存在。

原始日志、退出码和原生 JSON 留在被忽略的 `.cache/sqlite-result-storage-20261102/` 与 `test-results/sqlite-workspace/`。仅本例原生选择器返回 owned 合成路径；未验操作系统对话框输入、安装包及 macOS 的本次新路径。未操作 Server-200、用户安装配置、系统剪贴板或发布。

## 既有 CI 结果另记

`e892ae35` 的[菜单专项 41366131813](https://github.com/zhao-yc/DBArk/actions/runs/41366131813)：三平台独立窄栏专项通过，macOS arm64 全流程通过；Intel 原完整表页达到原 120 秒期限，保留失败；Windows 原表及索引通过，导航在测试启动前把未引用逗号参数解析为 `list json`。本轮仅补参数引用，不改断言、期限或重试。

同提交[全量检查 41366131796](https://github.com/zhao-yc/DBArk/actions/runs/41366131796)有 24343 项通过、24 项失败、10 项跳过，失败集中两个表格父级夹具；[SQLite 整套 41366131959](https://github.com/zhao-yc/DBArk/actions/runs/41366131959)另有编辑页清筛选后原 DOM 行集合不全、Intel 导入超时等失败。原因尚须逐项确认，不以本轮 732 项或原工作区专项代替全量验收。暂不正式发布。
