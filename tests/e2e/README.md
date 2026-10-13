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

当前七个用例覆盖：

1. 启动、SQLite、隔离接口、参数校验与 utility process 请求。
2. 渲染层无法直接访问 Node/IPC，Windows/macOS 的真实渲染进程沙箱标志。
3. 待提交标记下取消退出，再确认退出并释放进程。
4. 真实 SQLite 写入失败时返回工作台，解除失败原因后保存并重启恢复。
5. 界面保存连接、Monaco 输入与格式化、保存查询、主题及最后 SQL 重启恢复。
6. 写入失败后明确放弃配置退出，重启保留上次成功保存的状态。
7. 系统加密可用时 SQLite 无明文、重启后真实 `safeStorage` 解密、连接测试经过主进程凭据解析；不可用时断言仅会话保存。

第 3 项通过正常 IPC 设置待提交标记，未宣称真实数据库编辑或事务成功；连接测试使用本机端口 1 的拒绝连接，未启动本地数据库。真实数据库兼容性、事务回滚、长查询取消和导入导出由独立集成测试承担。系统加密用例会输出实际进入的验证分支。
