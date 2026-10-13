# 桌面回归

默认运行实际 Electron 主进程、沙箱渲染进程及数据库 utility process。每个用例创建独立的临时 `userData`，通过 `app.quit()` 或 `BrowserWindow.close()` 退出，并等待启动期间的进程全部释放。原生退出确认框由测试自动回答，状态保存和失败恢复均执行应用真实代码。

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

当前七个用例覆盖：

1. 启动、SQLite、隔离接口、参数校验与 utility process 请求。
2. 渲染层无法直接访问 Node/IPC，Windows/macOS 的真实渲染进程沙箱标志。
3. 待提交标记下取消退出，再确认退出并释放进程。
4. 真实 SQLite 写入失败时返回工作台，解除失败原因后保存并重启恢复。
5. 界面保存连接、Monaco 输入与格式化、保存查询、主题及最后 SQL 重启恢复。
6. 写入失败后明确放弃配置退出，重启保留上次成功保存的状态。
7. 系统加密可用时 SQLite 无明文、重启后真实 `safeStorage` 解密、连接测试经过主进程凭据解析；不可用时断言仅会话保存。

第 3 项通过正常 IPC 设置待提交标记，未宣称真实数据库编辑或事务成功；连接测试使用本机端口 1 的拒绝连接，未启动本地数据库。真实数据库兼容性、事务回滚、长查询取消和导入导出由独立集成测试承担。系统加密用例会输出实际进入的验证分支。

## 远程实库界面回归

`live-database.spec.ts` 提供两条真实数据库工作流，默认跳过。显式设置 `DBARK_INTEGRATION_ENABLED=1` 后，使用 `DBARK_TEST_HOST`、`DBARK_TEST_PORT`、`DBARK_TEST_USER`、`DBARK_TEST_PASSWORD`；缺省项可从被忽略的 `.cache/dbark-test.env` 读取。文件本身存在不会自动启用测试。只使用事先核对身份的开发服务器，不运行本机 Docker。

```powershell
$env:DBARK_INTEGRATION_ENABLED = '1'
pnpm exec playwright test tests/e2e/live-database.spec.ts --output .cache/live-e2e
Remove-Item Env:DBARK_INTEGRATION_ENABLED
```

同时设置 `DBARK_EXECUTABLE_PATH` 可针对实际安装程序运行。修改源代码后先执行 `pnpm build`；此命令本身不会构建应用。

- 连接表单测试并保存真实凭据，直接从尚未展开的连接创建独立数据库；从对象树进入查询，验证选中 SQL、多结果集、事务提交/回滚、取消后继续查询及重启后密码恢复。真实查询会话打开时，UI 和直接 IPC 均拒绝修改主机/端口且原连接继续可用，纯展示改名仍可保存。
- 真实表格编辑在预览前不改变数据库，确认提交后由独立观察连接核验；覆盖单元格复制、类型化粘贴、多行 TSV，以及 CSV 字段映射、JSON 和 SQL 导入导出。导出的 SQL 会实际恢复到隔离库中的新表，对比中文文本与 DECIMAL 精度。

每例只创建并删除随机 `dbark_e2e_*` 数据库，不操作引擎套件的 `dbark_test_*` 库。清理前退出 Electron 以释放事务；结束后核对数据库已移除。原生确认框和文件选择框自动回答，执行链路与文件 IO 使用真实代码。导入导出的人工测试数据保留在被忽略的 `.cache/e2e-files`，便于失败排查。

实库测试关闭 Playwright trace，避免记录表单输入参数中的临时口令。截图仅用于本机验收，不应连同 `.cache`、临时凭据或数据库测试数据发布。
