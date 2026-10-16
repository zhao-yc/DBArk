# TRUNCATE正式UI退出未确认时保留所属资源

从已推送的 `968628d22ea55faed705710e440ce859f4a22996` 建立独立普通克隆与 `codex/employee3-truncate-exit-preserve-20261017` 分支。此片只改后续正式验收夹具，不改应用产品、ROOT的0.20候选、实库期望或原用例期限；本轮实际操作为0。

## 最窄显式选项

桌面夹具增加默认false的 `preserveOnUnconfirmedExit`；只有 `table-truncate-live.ts` 用 `test.use` 启用。`isolatedDatabase` 与自动桌面夹具通过本次同一TestInfo的WeakMap状态识别该选项，不通过全局环境变量影响其他用例，不另建执行器或factory。

- 本例清库前先读取该独立应用的TRUNCATE apply任务；尚未终态或无法读到状态，立即停链，保留库、observer和原生现场，不借退出请求取消未终态apply。
- 正常退出调用原 `quitDesktop`，原函数仍等待真实close事件和已记录进程消失。只有它完整返回、当前实例相同且closed已观察，才记录该实例的清理许可；退出请求返回、关闭调用响应、kill响应或别的实例close均不放行。
- 退出完整确认后才允许删除本轮精确UI随机库、证明目录缺失、关闭observer；自动夹具只在上述流程成功后删除自己的临时目录。
- 任一确认或清理失败都会记录不可自动复活的停链状态。随后自动夹具不再重试退出、不调用原强制结束兜底、不删临时目录。原异常不被吞掉；若原用例异常与清理异常同时存在，用AggregateError保留原对象为cause和首项。

只依赖现有实际close及进程证明，没有新增forceExit、KILL、超时扩展、自动重试、权限授予、数据库残留清理器或产品IPC。未确认时保留资源是有意行为，后续只能由ROOT按本轮归属证据决定处理。

## 默认路径未变的证明

原 `isolatedDatabase` 的finally完整片段放在默认else分支，Git规范化字节SHA256仍为 `f19c4b4b1be278aff98a0081fb052bf415bd877350d279745805dc62c2303dc9`。原桌面自动夹具默认主体在显式分支return后逐字保留，SHA256仍为 `b8284b726f3cf8cf347b0e483ad162115ea1b57369eb492f99410b7f5ed37cd4`。两个摘要来自固定基线，纯测试直接解析当前生产夹具校对；原 `quitDesktop` 未改。

旧用例不启用新选项，其退出/兜底/清理顺序保持。纯端口另核默认false路径在退出失败时仍沿原清库及兜底流程；这是兼容性证明，不代表本轮重新验证旧335项实跑行为。

## 验证范围

仅以RAM端口运行真实夹具函数、原quitDesktop控制流和自动桌面fixture，覆盖实际close成功、仅关闭响应未确认、close后进程未消失、旧实例close、原异常保留、原异常但清理成功、apply未终态不清库、默认路径，以及固定默认片段。另复用12项TRUNCATE列表四组合纯守卫。本轮2文件22项纯验证通过，类型检查退出0。没有导入实际Electron/MySQL/live模块，未运行正式实跑或Playwright收集CLI、GUI、200、系统剪贴板、Docker或CI；不重跑71/521，不构建。

## 留给ROOT的runtime前置，不在此片实现

- 原只读残留脚本的schemaPattern仍需最窄增加 `|^dbark_truncate_[a-f0-9]{12}$`；UI仍为 `dbark_e2e_`，只认领本轮精确库名。
- DB=NULL的结构/控制/observer线程须以本例真实数字线程ID、实例身份和生命周期核对，不能只依赖库/用户名正则；UI全部产品线程的归属证据仍需ROOT补足。本片“native close已确认”不替代服务器逐ID残留证明。
- 13484的已有CA、严格TLS/主机身份校验，以及创建随机库之前的预期server UUID与实际保存profile核对，仍由ROOT安排。现有物理InnoDB目录需要的既有权限不因本片扩大；MDL继续用本实例SHOW FULL PROCESSLIST和既有精确id/state/SQL helper，不改P_S或新增PROCESS。
- 核心3例的pending/锁回滚与服务器终态证据沿原定义及静态计划继续审查，本片不改变核心执行或其期望。最终运行source和产物仍待ROOT冻结，不绑定旧候选或提供实跑命令。
