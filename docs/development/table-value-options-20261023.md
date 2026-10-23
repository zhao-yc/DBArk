# 表数据页：从服务器不同值筛选

表／视图工具栏的“从服务器不同值筛选”按当前**已应用**筛选读取服务器全部匹配行，展示候选值及精确行数。打开、选列、输入搜索或勾选均不查询；必须明确点击“读取不同值”。独立只读会话不包含当前表页草稿或用户会话尚未提交的数据。

## 使用

1. 打开表或视图，点击工具栏入口。默认使用活动单元格列，未选择或类型不支持时使用首个支持列。
2. 选择字段并读取。每次最多返回 500 组，界面每页 50 组；计数采用服务器十进制字符串。
3. 需要更多候选时输入服务器 `LIKE` 模式并重新读取。例如 `g_053%`；不会自动补 `%` 或修剪空白，`%`、`_` 是通配符。非空模式不匹配 NULL，清空并重新读取可查看 NULL 组。
4. 勾选 1～200 种值，选择包含或排除，再“应用到表页筛选”。新条件与原 OR／嵌套筛选整体 AND，保留停用状态和多列排序，从第一页读取。拒绝丢弃父草稿会保留原条件及勾选。

原值直接构造集合条件，不经过换行文本编辑器；空字符串、字面 `NULL`、真实 NULL、多行文本相互独立。排除不含 NULL 的集合时保留 NULL；同时排除 NULL 时明确加 `IS NOT NULL`。重读／关闭有勾选时先确认。

## 数据与执行边界

`table.valueOptions` 经严格校验的 IPC、可信连接配置和原主文档发布门进入 utility process。任务使用独立 REPEATABLE READ 只读事务、原列 `GROUP BY`／排序及二进制协议。BIGINT、DECIMAL、时间和计数保留字符串，FLOAT／DOUBLE 保留有限二进制数值并明确近似语义。JSON、二进制、BIT、空间和未知类型暂不提供入口。

候选遵循原列服务器排序规则；大小写、重音或尾空格不同的文本可能同组。独立会话将 `max_sort_length` 固定为 262144、`sort_buffer_size` 固定为 8388608 并读回核验，防止长 TEXT 按默认前缀误分组；组内最大字节数单独计量。相关分组限制见 [MySQL 官方说明](https://dev.mysql.com/doc/refman/8.4/en/server-system-variables.html#sysvar_max_sort_length)。候选单值限 256 KiB、完整回包限 8 MiB；实际筛选另须满足既有单值 4096 字符及全集预算，超限整份拒绝，不截断、不伪造 NULL。

前后定义、服务器及会话身份不符、原查询警告、断线或取消均不发布候选；不自动重放。原读取及取消请求都结算后才释放界面占用。页面／连接／条件发生过变化即永久撤销原意图，恢复旧值不复活。任务概要不保存筛选值、搜索、候选或驱动错误原文。

## 验证入口

- `pnpm typecheck`、`pnpm test`、`pnpm build`。
- `tests/integration/table-value-options.test.ts`：默认关闭，须同时显式设置 `DBARK_INTEGRATION_ENABLED=1`、`DBARK_TABLE_VALUE_OPTIONS_TEST=1` 和对应隔离实例身份；仅使用本例随机资源。
- `tests/e2e/table-value-options.spec.ts`：默认／`--list` 不加载桌面或凭据。正式 Windows 源码专项另需 `DBARK_TABLE_VALUE_OPTIONS_UI=1`、Root 预置随机资源 owner 和完整运行文件清单及 SHA256。禁止将源码窗口结果称为安装版或 macOS 验收。

准确源码 `a37b16aa` 的[完整验收记录](../../tests/integration/acceptance-table-value-options-20261023.md)：15978 项通过／1 项跳过、六实例 360 个原非观察连接收尾，以及 Windows 正式源码窗口；确认回答适配器和系统按钮输入边界分开记录。安装版、macOS 等继续另验，暂不发布。
