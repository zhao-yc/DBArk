# Q07 真实保存与计划状态验收准备

本任务只新增 `tests/e2e/explain-plan-state-live.spec.ts` 和本说明，不修改产品代码或原组件验收用例。分支为 `task/parallel-q07-plan-state-live-20261016`，精确父提交为 `823a770210b95b7d9c37abec9ec08df837b8c591`。

## 用例范围

- 复用正式桌面夹具和 `live-helpers`，在帮助器生成的随机 `dbark_e2e_*` 库建立三行小表；建表后通过真实数据库查询标签及执行计划按钮获取 JSON 计划，不能回退文本后继续宣称通过。
- 选择非默认查询块节点并收起，经真实保存表单创建来源、更新原来源。忙碌期间及成功后均断言模式、选中与展开状态。
- 切换到原始输出，经真实另存表单创建独立副本，忙碌期间及成功后核对模式和原文，再返回树形核对此前状态。
- 从真实保存查询分页列表打开同源第二标签，经该标签的真实保存表单更新正文；原标签持陈旧摘要再次保存，要求正式 CAS 返回“原查询已修改”，保留计划状态和草稿，并验证第二标签正文未被覆盖。
- 从主进程原 IPC 入口只旁观 `query.execute`、`query.explain` 次数。创建、更新、另存和冲突全程应保持 `0/1`；最后明确执行新查询后应为 `1/1`，普通网格替换旧计划。

测试只对 `queries.create` 和 `queries.updateSource` 的真实 handler 响应做单次受控等待。原 handler 先完整执行，真实成功或 CAS 失败结果随后原样交付；不替换返回、不修改来源摘要、不直接改组件状态。等待期间仅暴露命令计数与响应是否成功，不记录 SQL、计划或凭据。失败路径释放等待并恢复原 handler，然后复用现有退出及随机库清理逻辑。

## 开关及凭据边界

必须同时设置 `DBARK_INTEGRATION_ENABLED=1` 和 `DBARK_PLAN_STATE_LIVE=1` 才会运行。两者有任一个未启用时，在自动桌面夹具启动前跳过；实库帮助器在测试体内动态加载，默认跳过不读取本地凭据文件。`trace` 明确关闭。

仅由统筹在核对开发服务器实际连接、准备独立测试凭据并取得 GUI 独占时段后启用。用例不读取根克隆的凭据；帮助器只沿用执行目录原有环境和本目录的 `.cache/dbark-test.env` 规则。没有新增凭据文件、远端地址或端口硬编码。

本轮禁止访问 200 或 GUI；因此只报告静态检查和默认跳过结果，未完成上述动态实库断言。标准离线组件验收由统筹运行，本任务不复制其实现或重复运行。

## 本轮检查结果

- `node node_modules/typescript/bin/tsc --noEmit`：通过。
- 使用 Playwright 运行本文件，两个开关为 `0/0`、`1/0`、`0/1` 时均为 1 项跳过，没有启动桌面夹具或加载实库帮助器。
- 提取本文件实际主进程观察器及等待门回调，在 Node 隔离上下文中验证成功/失败响应均按原对象交付、等待期间其他命令继续处理、计数准确、恢复时释放在途等待并还原原 handler。此项只验证测试基础逻辑，使用本地内存 handler，不能充当正式保存、CAS、GUI 或数据库验收。
- 未设置双开关 `1/1`，未运行真实用例；源码中的完整场景均待统筹动态确认。

统筹在已构建、具备已核对测试环境的独立目录中使用：

```powershell
$env:DBARK_INTEGRATION_ENABLED='1'
$env:DBARK_PLAN_STATE_LIVE='1'
node node_modules/@playwright/test/cli.js test tests/e2e/explain-plan-state-live.spec.ts
Remove-Item Env:DBARK_PLAN_STATE_LIVE
Remove-Item Env:DBARK_INTEGRATION_ENABLED
```

上述执行会启动真实 Electron 并连接测试数据库。本用例不使用系统剪贴板。
