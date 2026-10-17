# S02首个默认关闭正式UI验收任务卡

基线为Root固定 `2aa8d153bb9da59706b5caf7c8b9a7a7cd23d6b2`。本片只新增S02专用wrapper、live、纯helper、guard测试和本文，不修改产品、main/engine或共享desktop fixture。

| 层级 | 本片证据 | 尚未完成 |
| --- | --- | --- |
| 源码准备 | 19项纯准备检查、四种双门真正Playwright列表、类型检查 | Root独立审查及准确资源排队 |
| 原生窗口/200 | 正式场景默认关闭，执行0次 | Root统一调度准确13384的真实工具栏、两个监控任务、原窗口及原观察流收尾 |
| 安装/发布 | 本片不构建或安装，不增加安装计数 | 独立安装包及跨平台验收 |

## 精确授权范围与默认门

`tests/e2e/server-monitor.spec.ts` 在真正 `--list`/`--list=...` 时先短路，连双门都不读取；默认只注册一个关闭态占位身份，不加载live、桌面fixture、驱动或认证。正式分支同时要求 `DBARK_INTEGRATION_ENABLED=1` 和 `DBARK_S02_SERVER_MONITOR_UI_TEST=1`，并在live加载前核本轮raw/helper全部自有属性和值一致。

本片仅接受 `192.168.31.200:13384`、MySQL `8.4.11`、Linux、`lower_case_table_names=0`、准确显式UUID、明文TLS=0、无SSH及默认数据库。账号、密码（可显式空串）与UUID只能由Root本轮RAM显式提供；不读取 `.env`、私有session、证书或密钥，不从旧环境文件补取。可选属性的存在性也固定，任何改变及恢复均永久停链。不存在宽端口矩阵、TLS降级或隐式root认证。

不会执行200 shell/Docker命令，不准备账号或授权，不输入SQL，不创建查询标签，不执行DDL/DROP或通过kill按钮管理会话，不调用clipboard，不截图、不录视频或trace，不安装。只读预检观察连接只发固定服务器身份SELECT；产品监控自身的固定只读查询由正式UI触发。

## 唯一正式场景

1. 捕获本例TestInfo、页面、应用与原框架起点；原120秒预算包含夹具启动已用时间。媒体实际解析值必须全为off，否则认证及网络前停链。
2. 分配并强引用本例只读观察连接的Promise/native/stream，核准确服务器身份。迟到连接也先保存原句柄，再拒绝后续动作。
3. 真实App“新建连接”表单录入临时profile，保存密码取消勾选、默认数据库清空，确认保存结果无持久密码、无SSH/TLS。不点“测试连接”，不额外调用 `connections.open`。
4. 从真实工具栏“服务器监控”进入，明确选择本例profile。核概要、全局状态和会话各节、准确8.4.11，以及账号可见范围始终未确认；自动刷新保持不勾选。
5. 只手动刷新一次。以真实 `tasks.list` 的完成事实等待，核恰好两个不同taskId的 `serverMonitor.read` 全部completed，并核两次显示的监控连接ID不同。禁止查询、文件或其它任务混入；不以UI按钮可用、cancel ACK或空processlist代替资源证明。
6. 关闭监控，核SQL标签和查询历史与打开前相同。再核两个任务完成，确认本例原窗口正常退出，最后用实际 `closeMysqlConnection(strict=true)` 关闭捕获的同一观察native/stream并要求真实closed终态。

## 未知、退出与现场边界

本地sticky在共享保留通知前落定。每个异步动作前后核原owner、配置、active、框架状态、原期限和时钟单调；read/cancel/退出/关闭任意未知都保留原失败和句柄，不自动重试或转交新例。afterEach对仍活动/pending或不完整证明先停链，不补发退出/关闭；finally只结束活动门。成功afterEach只核此前在原期限内已完成事实，不重新开放动作。

共享正常退出助手当前预置自动答案 `[1,1]`。为避免第二选项变成“强制退出客户端”时错误放行，本例在自己捕获的Electron窗口内安装私有答案保护：后续退出对话框自动答案均为0，保留原对话框记录，异常返回工作台，不自动丢弃配置或强制退出。未知时该保护与原owner一并保留；不改共享fixture或其它窗口。原始收尾失败不能因执行进程被终止而被算为正常退出。

本片不检查、退出或恢复Root旧Maria五个原生进程/现场，不预设全机native=0。正常退出仅核共享fixture记录的本例PID；观察流关闭仅核本例捕获身份。未知资源的恢复和旧现场由Root另行调度。

## 本轮实际验证

19项纯测试通过，包含原期限/缺起点/改预算/时钟倒退、afterEach活动迟到、通知throw/noop、原失败保留、准确任务集、身份与参数门、真实严格关闭内存流、共享自动退出答案保护、wrapper默认/列表隔离，以及真实live的媒体覆盖拒绝与唯一注册。

四种合成双门的真正Playwright `--list` 均退出0、一个关闭态身份、场景执行0；认证及专项环境直接读取、live/helper/桌面/驱动导入被守卫禁止。列表守卫隐藏框架启动时枚举复制的合成DBARK字段，直接访问仍抛错，区分框架环境复制与用例读取；初次守卫因此失败的stderr原件保留在ignored证据目录。

```powershell
node D:/svn/DBArk/node_modules/vitest/vitest.mjs run tests/unit/server-monitor-ui-preparation.test.ts --maxWorkers=1 --minWorkers=1
node D:/svn/DBArk/node_modules/typescript/bin/tsc --noEmit
```

类型检查通过。没有执行正式UI场景、实库、SSH、200命令、GUI、clipboard、安装或本地完整大套/构建。分支push后的Linux源码CI与实际原生/安装验收分列，不能用CI成功替代本场景的正式通过。
