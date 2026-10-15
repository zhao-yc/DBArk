# W02 迟到导航与新建查询意图竞态

本任务在普通独立克隆中基于 `8199bf6ff914e3694206c8dfc93d5f0d43a5237e` 开发，分支为 `task/parallel-w02-query-intent-20261016`。未修改主目录或旧任务分支。

## 复现及修正

原 App 的工具栏、标签加号、欢迎页、快捷键和原生菜单只设置 `newQuery`，没有撤销收藏/链接共享的导航代次。挂起的 `workbench.resolve` 因而仍被协调器视为最新请求：迟到表页会改变连接选择及标签，迟到定义会在查询表单后叠加定义模态，迟到失败可通过收藏入口弹出旧错误通知。这里的“覆盖”包含状态切换和上层模态，并非发现了直接把 `newQuery` 设为 false 的旧响应代码。

先从正式 App 提取真实入口回调，组合生产 `createWorkbenchNavigation` 与正式 Zustand 工作区，只控制 IPC Promise 完成顺序。修改前初版 19 项检查中 16 项失败，覆盖五个入口的迟到表页、迟到定义、旧错误以及无连接的加号回退路径。

最小产品修改仅在 `App.tsx`：统一的新查询打开、关闭回调先同步调用现有 `workbenchNavigation.invalidate()`；标签加号无连接时仍进入原建连表单，并同样先撤销旧导航。五个正式入口和查询表单关闭回调均接入这些方法。没有修改协调器代次实现、后台连接修订核验、NewQueryDialog 元数据读取、QueryTab 或其它业务模块，也没有新增产品文案。

最新导航继续按原路径核验和落地；最新有效连接修订错误继续抛回所属入口。新意图后的旧成功与旧错误返回失效结果，既不切换工作区也不弹出旧错误。快捷键及原生菜单被现有模态拦截时，不会接管代次；关闭取消、来源 AbortSignal、卸载和重新激活语义沿用原实现。

## 已完成的非GUI验证

- `node node_modules/vitest/vitest.mjs run tests/unit/ui-workbench-query-intent.test.ts tests/unit/ui-workbench-navigation.test.ts tests/unit/workbench.test.ts`：3 个文件，34 项通过，其中本任务新增 20 项正式 App 入口/协调器组合检查。
- `node node_modules/typescript/bin/tsc --noEmit`：通过。
- `node scripts/build.mjs`：通过；只有依赖注解及包体积的构建警告。产物在忽略目录 `dist`，未纳入提交。
- `DBARK_QUERY_INTENT_UI=0` 下执行 `node node_modules/@playwright/test/cli.js test tests/e2e/workbench-query-intent.spec.ts`：6 项默认跳过，未启动 Electron。

单元检查执行的是从正式 App 读取的回调和正式导航协调器，未挂载完整 React 页面；它们不能代替实际 UI 验收。本轮没有启动 Electron、操作剪贴板、访问 200、读取根凭据或执行 Docker 命令。

## 默认关闭的真实App界面准备

`tests/e2e/workbench-query-intent.spec.ts` 使用正式桌面夹具中的 App 窗口，没有重新搭建导航组件 fixture，也没有在 fixture 添加产品保护。只有统筹取得 GUI 独占时段后设置 `DBARK_QUERY_INTENT_UI=1` 才运行：

```powershell
$env:DBARK_QUERY_INTENT_UI='1'
node node_modules/@playwright/test/cli.js test tests/e2e/workbench-query-intent.spec.ts
Remove-Item Env:DBARK_QUERY_INTENT_UI
```

预备用例覆盖五个查询入口，在受控对象核验迟到成功/错误后验证查询表单、用户填写的默认库、标签数及重新打开的默认上下文；最后核对最新导航仍能创建查询标签。另有正式对象链接取消后迟到响应，以及最新链接错误继续显示的用例。原生菜单路径调用真实 `MenuItem` 的已注册处理器，而非操作系统菜单的鼠标点击。

数据配置、收藏保存、App、查询表单、导航协调器及工作区均使用正式实现。为在离线场景控制次序，主进程测试包装只替换 `workbench.resolve` 回包和新查询所需的建连/列库回复，配置仅含 `127.0.0.1:1` 的无密码离线连接。它不证明真实服务器对象核验、数据库连接或连接修订发生时的跨进程行为。所有默认关闭的 UI 断言本轮均未执行，等待统筹验收。
