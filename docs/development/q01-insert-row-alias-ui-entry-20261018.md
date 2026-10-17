# UPSERT 新行别名专属 UI 入口准备

基线为 `f566dbb8f66a0cde2541a5aadf82a22a1f585dd6`，本次只新增测试入口、参数门和说明，没有产品修改。未执行实际环境。

## Root 与 spec 的边界

Root 的实际控制器独占 fixture：先核宿主/实例为200的明文13384、实际 MySQL 8.4.11及服务器UUID；确认随机 `dbark_upsert_<32位小写hex>` 库原本不存在，创建该库及 `subject(id,note,created_at)`，不插行，表注释含 Root 本轮随机 marker。Root 保留创建归属、marker和原服务器线程记录。

spec 不导入 `live-helpers`、数据库驱动、剪贴板或 `positionMonacoCaret`；不创建、插入、修改或删除数据库对象，不执行编辑器 SQL，不管理 Root 的观察连接。UUID只验证显式参数格式，其实际服务器绑定由 Root 前置核对；不能把参数格式检查当作本 spec 重新验证实际UUID。

双门为 `DBARK_INTEGRATION_ENABLED=1` 和 `DBARK_INSERT_ROW_ALIAS_UI=1`。只接受显式 RAM 参数 `DBARK_TEST_HOST=192.168.31.200`、`DBARK_TEST_PORT=13384`、`DBARK_TEST_DATABASE`、`DBARK_TEST_EXPECTED_SERVER_UUID`、`DBARK_TEST_USER`、`DBARK_TEST_PASSWORD`；TLS仅允许未设置或`0`，不读取任何 `.env`，不创建账号。所需密码由Root临时注入，文档和产物不保存值。

使用 `desktop-fixture` 的 `preserveOnUnconfirmedExit:true`；捕获同一 application/page，跨 await 核对 owner。任一 UI、配置或退出失败粘性 `retainOwnedDesktopResources`，不自动重复退出、强停或删除所属现场。成功只通过 `confirmOwnedDesktopExit` 确认正常退出及本例已记录PID不存在；共享严格夹具再按已有规则处理本例本地临时目录。本 spec 没有数据库清理的 finally。

trace/screenshot/video均关闭；实际覆盖参数若开启采集，在填写账号前拒绝。禁止原生片段诊断。连接表单取消“安全保存密码”，并从公开概要检查 `rememberPassword=false` 且没有密码字段，密码仅由产品原会话秘密机制在 RAM 使用。

## 正式用例

通过真实连接表单核 MySQL 8.4.11 成功提示，保存不含密码的概要；通过真实“新建查询”对话框选择准确连接和 Root 的默认库。下拉使用 role、标签前缀、count=1及实际 value，兼容 Field 把选项拼进 accessible name 的情况。

正文为同一条真实 INSERT VALUES UPSERT：只写入 `id,note` 列，更新右侧为 `incoming.`。完整前缀使用键盘 `insertText`，随后实际键盘点号触发产品 provider；不操作模型/光标API，不调用系统剪贴板。检查可见建议恰含 `id,note,created_at`，使用方向键选中 `note` 并 Enter 接受；通过公开草稿读取核对准确完整 SQL 和同一连接/库上下文。

本片未添加通用请求旁观器。可见建议和完整正文只证明产品 UI Promise 已交付并插入，**不证明全部补全请求或服务器线程终态**，不使用 `tasks.list` 冒充这些终态。Root 必须在 strict owner 正常退出后，另核本轮原服务器线程全部不存在、marker仍匹配及表仍无行，才可删除本轮专属库。失败或线程未知时保留，不能借 spec 成功或 PID 消失省略服务器核对。

## 本轮验证与 Root 执行

本轮仅准备/列表/类型，不实际连接200、读取凭据、启动桌面、构建或跑完整套件：

```powershell
node D:/svn/DBArk/node_modules/@playwright/test/cli.js test tests/e2e/sql-completion-insert-row-alias.spec.ts --list
node D:/svn/DBArk/node_modules/typescript/bin/tsc --noEmit
```

默认关闭及双门打开但 `--list` 的两种收集均先短路为一个关闭项，不加载 live 模块或校验目标参数。类型检查结果以本轮交接报告为准，不是原生验收结论。

Root 完成上述 fixture和RAM参数准备、确认运行产物含 `f566` 产品修复后，单独执行：

```powershell
node D:/svn/DBArk/node_modules/@playwright/test/cli.js test tests/e2e/sql-completion-insert-row-alias.spec.ts --workers=1 --retries=0 --trace=off
```

运行路径须为 Root 对应源码/产物工作目录；本分支不提供构建产物。Root 的端点/UUID/fixture与原服务器线程前后核对证据须随实际结果另行交付。
