# TRUNCATE正式UI退出未确认时保留所属资源

默认保留模式基于 `968628d22ea55faed705710e440ce859f4a22996`，首版提交为 `8b99f48ace70b0ac248215960013a9bf5aaeec17`；随后在独立普通克隆和 `codex/employee4-truncate-exit-ownership-20261017` 分支补齐实例归属及严格PID证明。仅改后续正式验收夹具，不改应用产品、ROOT的0.20候选、实库期望或原用例期限；实际原生操作为0。

## 最窄显式选项

桌面夹具增加默认false的 `preserveOnUnconfirmedExit`；只有 `table-truncate-live.ts` 用 `test.use` 启用。`isolatedDatabase` 与自动桌面夹具通过本次同一TestInfo的WeakMap状态识别该选项，不通过全局环境变量影响其他用例，不另建执行器或factory。

- 本例清库前先读取该独立应用的TRUNCATE apply任务；尚未终态或无法读到状态，立即停链，保留库、observer和原生现场，不借退出请求取消未终态apply。
- 显式模式在launch返回后即捕获本TestInfo所属application、page、will-quit承诺及主进程/应用指标PID；退出前补记PID，只增不减。私有退出函数用捕获实例执行同样的正常对话框及will-quit/close握手，每次await后复核所属状态；不调用全局旧 `quitDesktop` 或 `answerDialogs` 来操作下一例。
- 实际close与已记录PID严格消失须同时成立：0信号成功表示仍存在；只有 `ESRCH` 证明相应PID不存在。`EPERM`、`EACCES`、缺失PID或其他未知立即停链，不能被poll重试吞掉后放行。原12000毫秒close/5000毫秒PID预算不扩大，不增加强杀或退出重试。
- 退出完整确认后才允许删除本轮精确UI随机库、证明目录缺失、关闭observer；自动夹具只在上述流程成功后删除自己的临时目录。
- 任一确认或清理失败都会记录不可自动复活的停链状态。随后自动夹具不再重试退出、不调用原强制结束兜底、不删临时目录。原异常不被吞掉；若原用例异常与清理异常同时存在，用AggregateError保留原对象为cause和首项。
- 活动用例内重复收尾共用一次确认承诺。外层收尾结束后保留WeakMap失效标记并释放close监听：旧TestInfo不能退出下一实例，也不能因状态删除而退回默认清理分支。临时目录、观察连接和随机库均捕获本例值，清库每个await后继续核归属。

仅显式模式增加上述owner确认；没有新增forceExit、KILL、超时扩展、自动重试、权限授予、数据库残留清理器或产品IPC。未确认时保留资源是有意行为，后续只能由ROOT按本轮归属证据决定处理。

## 默认路径未变的证明

原 `isolatedDatabase` 的finally完整片段放在默认else分支，Git规范化字节SHA256仍为 `f19c4b4b1be278aff98a0081fb052bf415bd877350d279745805dc62c2303dc9`。原桌面自动夹具默认主体在显式分支return后逐字保留，SHA256仍为 `b8284b726f3cf8cf347b0e483ad162115ea1b57369eb492f99410b7f5ed37cd4`。两个摘要来自固定基线，纯测试直接解析当前生产夹具校对；原 `quitDesktop` 未改。

旧用例不启用新选项，其退出/兜底/清理顺序保持，原quitDesktop规范化原文SHA256仍为 `70ef0597565cd839b2b6c65db33fee9e26c25f8e8260851f860dbed909e75920`。纯端口另核默认false路径在退出失败时仍沿原清库及兜底流程；这是兼容性证明，不代表重新验证旧335项实跑行为。

## 验证范围

8b99原片的22项纯验证证据保持；owner追加仅定向运行本夹具测试文件20项，覆盖旧TestInfo串台/EPERM两项原红转绿、EACCES及无错误码未知、PID读取/对话框/退出请求跨await换实例、并发收尾、迟到close、空PID记录、任务未知与首因保留，以及默认片段/原quitDesktop摘要。只使用RAM VM内真实夹具函数及Electron/MySQL/文件删除/PID端口，不记作真实停链。

追加类型检查退出0；默认关闭的Playwright `--list`仅收集1项skip定义、结果数组为空，没有加载实跑模块或运行用例。网络/子进程/私料读取/密钥生成守卫用于纯测及收集；GUI、200、系统剪贴板、真实数据库、Docker、手动CI和真实停链全部0，不重跑22/71/521或大套、不构建。

Windows/macOS本机的真实close、记录PID退出及服务器逐线程终态仍需ROOT安排；PID快照不能声称覆盖未被记录的后来派生进程，纯端口也不能替代本机权限语义和实际进程树验收。旧失败原件留在员工3固定克隆的 `.cache/employee4-review-8b99`，新分支仅复制其副本到ignored证据目录，没有覆盖旧红。

## 留给ROOT的runtime前置，不在此片实现

- 原只读残留脚本的schemaPattern仍需最窄增加 `|^dbark_truncate_[a-f0-9]{12}$`；UI仍为 `dbark_e2e_`，只认领本轮精确库名。
- DB=NULL的结构/控制/observer线程须以本例真实数字线程ID、实例身份和生命周期核对，不能只依赖库/用户名正则；UI全部产品线程的归属证据仍需ROOT补足。本片“native close已确认”不替代服务器逐ID残留证明。
- 13484的已有CA、严格TLS/主机身份校验，以及创建随机库之前的预期server UUID与实际保存profile核对，仍由ROOT安排。现有物理InnoDB目录需要的既有权限不因本片扩大；MDL继续用本实例SHOW FULL PROCESSLIST和既有精确id/state/SQL helper，不改P_S或新增PROCESS。
- 核心3例的pending/锁回滚与服务器终态证据沿原定义及静态计划继续审查，本片不改变核心执行或其期望。最终运行source和产物仍待ROOT冻结，不绑定旧候选或提供实跑命令。
