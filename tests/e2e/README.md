# 桌面回归

默认运行实际 Electron 主进程、沙箱渲染进程及数据库 utility process。每个用例创建独立的临时 `userData`，通过 `app.quit()` 或 `BrowserWindow.close()` 退出，并等待启动期间的进程全部释放。原生退出确认框由测试自动回答，状态保存和失败恢复均执行应用真实代码。

原生 CI 冷启动安装产物时，工作台状态栏的就绪等待上限为 15 秒；仍要求状态栏真实可见，不跳过页面错误、隔离接口或沙箱检查，也不自动重试失败用例。

桌面生命周期由 Playwright 自动夹具注册，跨多个测试文件运行时仍逐例启动和退出 Electron，不依赖模块首次导入时的副作用钩子。

```sh
pnpm test:e2e
```

验证已经构建的 Windows 应用：

```powershell
$env:DBARK_EXECUTABLE_PATH = (Resolve-Path '.\release\win-unpacked\DBArk.exe').Path
pnpm exec playwright test tests/e2e/desktop.spec.ts
Remove-Item Env:DBARK_EXECUTABLE_PATH
```

`DBARK_EXECUTABLE_PATH` 支持其他平台的实际可执行文件路径；设置后不会传递开发入口 `.`，也不会替代构建。运行测试的环境需要允许 Electron 创建进程，应用自己的渲染沙箱一直启用。

CI 在当前原生架构完成构建后运行 `pnpm test:packaged`。该命令读取当前版本的 `release/DBArk-版本-平台-架构-unsigned.exe/dmg`，验收实际分发文件：

- Windows 在独立临时目录静默安装 NSIS，执行下述七项测试，再从临时目录外运行该安装的卸载器；发现已有 DBArk 安装时直接拒绝，避免触发静默升级覆盖现有程序。
- macOS 以只读方式将 DMG 挂载到独立临时挂载点，通过 `ditto` 将应用复制到本次临时 `Applications` 目录再运行；结束时分离这一个 DMG，并清理复制的应用。

命令不使用 shell 拼接，也不会回退到 `win-unpacked`、`mac` 或源码入口。成功和失败均会尝试清理本次安装；清理范围仅限本次创建的 `dbark-package-e2e-*` 目录，卸载或分离无法确认时保留目录并返回失败。测试持续使用独立 `userData`，不会删除用户已有配置；此命令固定运行离线七项，不连接私有数据库。macOS 内容验收由对应原生 CI runner 执行，本机 Windows 不代替 macOS 的实测。

`desktop.spec.ts` 的七个用例覆盖：

1. 启动、SQLite、隔离接口、参数校验与 utility process 请求。
2. 渲染层无法直接访问 Node/IPC，Windows/macOS 的真实渲染进程沙箱标志。
3. 待提交标记下取消退出，再确认退出并释放进程。
4. 真实 SQLite 写入失败时返回工作台，解除失败原因后保存并重启恢复。
5. 界面保存连接、Monaco 输入与格式化、保存查询、主题及最后 SQL 重启恢复。
6. 写入失败后明确放弃配置退出，重启保留上次成功保存的状态。
7. 系统加密可用时 SQLite 无明文、重启后真实 `safeStorage` 解密、连接测试经过主进程凭据解析；不可用时断言仅会话保存。

第 3 项通过正常 IPC 设置待提交标记，未宣称真实数据库编辑或事务成功；连接测试使用本机端口 1 的拒绝连接，未启动本地数据库。真实数据库兼容性、事务回滚、长查询取消和导入导出由独立集成测试承担。系统加密用例会输出实际进入的验证分支。

主分支新增 `query-files.spec.ts` 的四项离线验收：SQL 文件三编码和 BOM 独立标签、另存及选择取消、错误编码/大小限制、令牌授权与失败时原文件保护。仅替换原生文件对话框的路径返回，UI、preload、IPC、编解码及磁盘 IO 均运行真实代码。该路径替换不能证明操作系统覆盖确认交互。安装脚本现在同时运行上述 11 项离线检查，不运行内网实库。

## 远程实库界面回归

`live-database.spec.ts` 提供两条真实数据库工作流，默认跳过。显式设置 `DBARK_INTEGRATION_ENABLED=1` 后，使用 `DBARK_TEST_HOST`、`DBARK_TEST_PORT`、`DBARK_TEST_USER`、`DBARK_TEST_PASSWORD`；缺省项可从被忽略的 `.cache/dbark-test.env` 读取。文件本身存在不会自动启用测试。只使用事先核对身份的开发服务器，不运行本机 Docker。

```powershell
$env:DBARK_INTEGRATION_ENABLED = '1'
pnpm exec playwright test tests/e2e/live-database.spec.ts --output .cache/live-e2e
Remove-Item Env:DBARK_INTEGRATION_ENABLED
```

同时设置 `DBARK_EXECUTABLE_PATH` 可针对实际安装程序运行。修改源代码后先执行 `pnpm build`；此命令本身不会构建应用。

- 连接表单测试并保存真实凭据，直接从尚未展开的连接创建独立数据库；从对象树进入查询，验证选中 SQL、多结果集、事务提交/回滚、取消后继续查询及重启后密码恢复。真实查询会话打开时，UI 和直接 IPC 均拒绝修改主机/端口且原连接继续可用，纯展示改名仍可保存。
- v0.1.1 起，同一流程还通过 Ctrl/⌘+Enter 插入隔离计数表，由独立连接核对仅写入一行；覆盖关闭原连接标签后修改默认库：仅原连接的对象树折叠、数据库选择清空，另一连接对象树与活动查询保留；通过新查询表单和实际 `SELECT DATABASE()` 确认不会继承另一连接的库名。
- 真实表格编辑在预览前不改变数据库，确认提交后由独立观察连接核验；覆盖单元格复制、类型化粘贴、多行 TSV，以及 CSV 字段映射、JSON 和 SQL 导入导出。导出的 SQL 会实际恢复到隔离库中的新表，对比中文文本与 DECIMAL 精度。
- JSON 导入会先切换到不匹配编码，要求实际解析错误时旧映射消失、执行按钮禁用且没有创建写任务；恢复 UTF-8 并确认新映射就绪后仅点击一次导入。不用重试写入来掩盖预览与元数据的竞态。
- 固定查询结果后执行新 SQL，再切回旧快照核对 BIGINT、DECIMAL、二进制、NULL 和中文；读取原 SQL、释放快照均走实际 UI。只读快照对话框内的执行快捷键不能向后台查询写入，取消任务留下的部分结果不能固定。

`live-objects.spec.ts` 验证表设计器的字段、主键、唯一索引、外键组合及已有表修改，随后逐一创建、读取实际定义、编辑视图、存储过程、函数、触发器和事件。独立观察连接验证约束拒绝、级联删除、函数返回值、触发器和事件实际生效。

主分支新增 `query-results-export.spec.ts` 的三项实库验收：成功多结果及断线旧快照导出，精确值/NULL/BLOB/Unicode/重复列名无损；截断仅导出已返回行、取消片段禁导出、真实进度处取消文件任务保留原目标；SQL 文件打开与另存保持原连接编号、未提交事务和观察连接的零可见写入，最终回滚核验。原脚本含主键 INSERT，由独立连接确认导出后仍只有一条，不重放 SQL。压力用例服务端生成 50000 行，工作台字节预算可能先截断，实际已返回数以当前结果为准。

`live-table-scale.spec.ts` 验证全部/任一组合、集合与区间筛选、条件编辑删除、直接跳页，以及 Unicode、NULL、空字符串、含逗号/空格的集合值。非法整数筛选后要求旧行清空，清除条件后可恢复。百万行用例另需显式设置 `DBARK_TEST_MILLION=1`，默认不会造数；数据在远程服务器内生成，测试客户端不持有百万行数组。实际网格每页 1000 行，滚到底后直接跳至第 1000 页核对末行，DOM 行数必须少于 100。

```powershell
$env:DBARK_INTEGRATION_ENABLED = '1'
$env:DBARK_TEST_MILLION = '1'
pnpm exec playwright test tests/e2e/live-table-scale.spec.ts tests/e2e/live-objects.spec.ts --output .cache/live-extended-e2e
Remove-Item Env:DBARK_TEST_MILLION
Remove-Item Env:DBARK_INTEGRATION_ENABLED
```

每例只创建并删除随机 `dbark_e2e_*` 数据库，不操作引擎套件的 `dbark_test_*` 库。清理前退出 Electron 以释放事务；结束后核对数据库已移除。原生确认框和文件选择框自动回答，执行链路与文件 IO 使用真实代码。导入导出的人工测试数据保留在被忽略的 `.cache/e2e-files`，便于失败排查。

实库测试关闭 Playwright trace，避免记录表单输入参数中的临时口令。截图仅用于本机验收，不应连同 `.cache`、临时凭据或数据库测试数据发布。
