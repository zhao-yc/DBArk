# PostgreSQL 到 SQLite 的记录复制

在 PostgreSQL 当前查询结果勾选记录，点「暂存勾选结果以跨库复制」。打开可写 SQLite 表，在「更多」的数据传输菜单点「从 PostgreSQL 查询结果复制记录」。窗口列出来源连接、数据库、结果集、目标文件连接及表名。支持当前显示顺序和可见字段，最多 100 行，沿用源快照和 SQLite 草稿预算。

同名、唯一且可无损保存的字段自动配对。整数保存为 INTEGER，BYTEA 保存为 BLOB，SQL NULL 保持 NULL。精确小数、日期及其他值的原文按 TEXT 处理。映射窗口只列出能保留所需存储类型的目标，例如 TEXT 或 STRICT 表的 ANY 可保留精确小数原文。普通 NUMERIC、INTEGER 或 REAL 亲和性可能把小数文本改成数值，因此不提供这种映射。 [SQLite 类型亲和性](https://www.sqlite.org/datatype3.html#type_affinity) · [STRICT 表与 ANY](https://www.sqlite.org/stricttables.html)

重复别名按序号选择。未映射字段由目标库处理默认值，目标主键不能接收源 NULL。暂存只新增 SQLite 草稿。需要核对完整 SQL 并明确提交后才写入目标文件，源查询不会重跑。

## 验收范围

- Windows 测试虚拟机不可用，本轮在 macOS arm64 和 Node.js 24.17.0 验收源码及 Electron 窗口。Windows、安装包和旧版 PostgreSQL 留待验证。
- 原生运行时预检、严格类型检查和构建通过。SQLite 定向单测 4 个文件、145 项通过。全量单测覆盖 1,347 个文件，27,543 项通过，10 项按 Windows 条件跳过。
- PostgreSQL 18 实库回归 5 个文件、7 项通过。原生 Electron 专项 1 个用例，7 项观察均通过。成功轮次确认窗口和数据库连接退出后，清理了隔离资源。
- 实库使用 Server-200 上隔离的 PostgreSQL 18 和测试窗口创建的临时 SQLite 文件。原生用例先回归既有的 PostgreSQL 跨库、查询结果和 SQLite 到 PostgreSQL 路径，再验证 PostgreSQL 查询结果到 SQLite STRICT 表。
- 在字段映射暂存后、SQL 预览后分别独立读取 SQLite，目标表仍为空。确认提交后读回有符号 64 位整数两端的原值，精确小数 `9007199254740993.000000000000000001` 和 `0.000000000000000001` 仍为 TEXT，`00FF` 和空字节仍为 BLOB，NULL 与空字符串也能区分。
- 首次原生用例在编辑快照加载完成前查找操作菜单。测试随后等待可编辑网格出现。全量单测发现新主键标记影响草稿保存和恢复。修复后，标记仅随编辑页响应返回，保存和恢复核对均使用原格式。全量复跑允许现有 TLS 用例监听本机回环端口。失败日志保留于项目验收缓存，首次原生失败的隔离容器保留用于复查。
