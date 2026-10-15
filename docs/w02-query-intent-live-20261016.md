# W02 查询意图的真实处理路径验收准备

本任务继续使用 `task/parallel-w02-query-intent-20261016`，精确父提交为 `ccaadcdbd1c1634abe5262dcd4b3df94253a2def`。只新增 `tests/e2e/workbench-query-intent-live.spec.ts` 和本说明，产品源文件保持该父提交不变。

## 真实路径与资源范围

一个完整用例嵌套复用两次 `isolatedDatabase`，创建两个真实连接及两个独立随机 `dbark_e2e_*` 库：旧目标连接拥有一张单行 `intent_subject` 表及一个只读导航用过程；当前连接拥有一张单行 `intent_current` 表。第二个连接与库同样由现有连接表单、TLS 配置和隔离库帮助器创建，不复制凭据或证书处理逻辑。

所有资源只属于本例随机库。没有创建账号、执行 GRANT 或修改业务库。内层帮助器先退出应用并清理当前库，外层帮助器随后清理旧目标库；既有帮助器负责限定库名前缀及确认删除。

表、过程和不存在对象的收藏通过正式本地配置 IPC 准备。对象打开由正式侧栏按钮提交至原 `workbench.resolve` handler，连接打开、数据库列表、对象列表和连接修订检查均调用原实现。

唯一的时序包装只匹配下一次精确目标的 `workbench.resolve`。原 handler 先完成真实成功或失败核验，然后等待测试释放；原回包按原对象交付，不生成或替换成功、错误、连接版本、建连结果和列库数据。其他导航及新查询请求继续交给原 handler。

## 准备覆盖的场景

同一个用例顺序检查以下五段迟到回包：

1. 真实表核验成功后暂缓交付，用户打开新查询表单，旧回包不能改变连接、标签或表单。
2. 真实过程核验成功后暂缓交付，用户打开新查询表单，旧回包不能叠加定义模态。
3. 真实表核验成功后暂缓交付，用户提交并实际执行另一连接的新查询，旧回包不能切换当前连接、标签或结果。
4. 真实过程核验成功后暂缓交付，用户已实际执行新查询，旧回包不能叠加定义模态或改变当前结果。
5. 正式 handler 核验实际不存在对象并返回真实失败，用户已实际执行新查询，迟到错误不能弹出旧通知或打断当前结果。

当前查询经真实编辑器和 SQL 链路读取本例表、`DATABASE()`、`CONNECTION_ID()` 及场景标记。用例核对新查询的连接、标签身份、数据库选择和结果仍保持原样。等待正式收藏入口的 `finally` 释放按钮后才做断言，避免只观察主进程已释放却尚未处理的 UI 帧。

最后再执行未延迟的最新真实表导航，要求显示服务器中的原值并保留原有查询标签；另通过正式对象链接读取最新真实过程定义，要求显示原定义且没有执行 SQL 按钮。全程预期 7 次正式 resolve。

这些场景目前只有脚本准备，没有动态通过证据。连接修订过程中发生外部变更、五个入口各自的实库排列、跨设备和打包安装验收不属于本文件本轮验证。

## 与已有入口证据分列

`ccaadcdb` 的 34 项单元检查包含正式 App 回调/导航协调器组合与后端解析逻辑检查，均属于非GUI证据。原 `workbench-query-intent.spec.ts` 的 6 项受控 App 用例覆盖五个入口及链接取消，使用受控 resolve、建连及列库回复，属于协议和界面入口证据，不能视为实库验证。

新实库文件集中覆盖公共真实处理路径，不复制上述五入口矩阵，也不改变既有产品或受控用例。

## 开关与本轮检查

同时设置 `DBARK_INTEGRATION_ENABLED=1` 和 `DBARK_QUERY_INTENT_LIVE=1` 才会运行。任一未启用时，在自动桌面夹具前跳过；实库帮助器只在测试体内动态加载，默认不读取任何凭据文件。追踪明确设置为 `off`。

本轮检查结果：

- `node node_modules/typescript/bin/tsc --noEmit`：通过。
- 两开关为 `0/0`、`1/0`、`0/1` 时，运行新文件均为 1 项跳过，未启动桌面夹具。
- 编译后模块加载边界检查通过：没有实库帮助器的模块级运行时导入。
- 在 Node 隔离上下文执行从新文件提取的真实等待门回调，验证成功/失败对象均原样交付、其他对象导航和列库不被延迟、恢复会释放在途回包并还原 handler。这里使用本地内存 handler，只验证测试包装，不能替代正式 handler 或数据库验收。

本轮未开启双开关 `1/1`，未访问 200、启动 GUI、操作剪贴板、读取根凭据或新增凭据/证书文件；未重复运行已有受控 App 用例，也未修改产品源代码或重新打包。

只有 ROOT 核对实际测试服务器、准备执行目录独立测试配置、确认已有构建产物并取得 GUI 独占时段后运行：

```powershell
$env:DBARK_INTEGRATION_ENABLED='1'
$env:DBARK_QUERY_INTENT_LIVE='1'
node node_modules/@playwright/test/cli.js test tests/e2e/workbench-query-intent-live.spec.ts
Remove-Item Env:DBARK_QUERY_INTENT_LIVE
Remove-Item Env:DBARK_INTEGRATION_ENABLED
```

上述命令会启动真实 Electron 并连接已配置的测试服务器。本文件只沿用执行目录的测试环境及现有帮助器规则，不读取根克隆的凭据。

## run543 快照时序定位与修正

ROOT 的 run543 已到达最新有效表导航后的旧标签比较：同一个查询标签的 ID、连接和类型未变，磁盘快照中的 `database` 从 `undefined` 变为本例当前连接的预期隔离库。原始失败记录保留在 ROOT 的 `run543-fourth-ui-observation-fixed` 目录，本轮没有更改这些证据。

只读追踪正式代码后，变化与执行后的恢复上下文落盘时序一致，并非连接 profile 默认库初始化。`QueryTab.runQuery` 在发送 SQL 前调用 `prepareExecutionContext`，经 `rememberDatabase({state:'unknown'})` 清空旧展示库，再用 `flushSettings` 强制落盘。执行完成后，`busy=false` 触发 effect 读取 `query.completionState` 协议缓存；`rememberDatabase` 把真实默认库及 `databaseContext: known` 回填当前标签，随后由工作区的 400ms 防抖写入 SQLite。

原 `savedTabs` 只等标签总数，因而可能在 SQL 结果已经可见、真实库尚未重新持久化时，接收执行前的未知库快照。此前一轮的前后比较都可能读到同一份未知快照；最新表页创建后等待新标签落盘，才暴露旧查询的正常回填。正式导航协调器只设置当前选择并打开目标表页，`store.openTab` 只追加/复用表标签，没有修改旧查询标签数据库的路径；此次差异也没有变成旧目标连接的库。

夹具修正为：执行后先核对真实会话面包屑等于 `current.database`，每次标签快照再明确等待所有预期查询的 `connectionId`、`database` 和 `databaseContext: {state:'known',database:current.database}` 均持久化。查询数量也明确核对，不能接收任意稳定值或从变化后的字段学习期望值。新表页出现后仍要求全部旧查询绑定上述明确库；原有旧标签完整相等断言保留，并额外纳入 `databaseContext` 比较。没有修改产品源码、请求或回包，也没有增加超时。

这一判断来自已有实库失败差异及正式调用链分析；修正后的动态实库结果仍由 ROOT 重验。本轮类型检查通过，`ui-query-context-preparation.test.ts` 与 `query-context.test.ts` 共 11 项单元检查通过，新实库文件为 1 项默认跳过。另提取实际快照函数做内存纯验证：未知库、错误库、错误连接和未知上下文均拒绝，仅明确预期的 known 绑定可以形成快照。没有启动 GUI 或访问 200。
