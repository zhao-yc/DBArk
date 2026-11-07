# SQLite 完整查询导出 INSERT SQL

从查询页的「执行并导出完整结果」或「导出当前语句的完整结果」进入，选择「SQLite INSERT SQL」。填入目标数据库和表名。字段映射留空时采用查询列名。重名、空名或需要改名时，按结果列顺序每行填写一个目标字段。含 `:name` 的查询可先在弹窗填写参数。

确认文件后，应用在独立 SQLite 只读连接执行单条 SELECT 或 WITH，读取已提交的数据。结果按批次写入 UTF-8 文件，行数以原查询的完整回执为准。SQLite 原生存储类型决定 INSERT 字面量，目标字段的亲和性和约束在回放时生效。字段数不符、无效名称或重名在打开暂存文件前拒绝。取消会清理本次暂存并保留已有目标。

## 验收范围

- Node.js 24.17.0 运行时检查、严格类型检查、源码构建和 221 项相关测试通过。原生测试覆盖重名改映射、保留精确存储类型、字段不匹配及读取期间取消。
- macOS arm64 Electron 源码从光标语句绑定参数，流式导出并独立回放 1,205 行。核对结果末行的精确整数、Unicode 和 BLOB，以及 SQLite 源文件 SHA-256。原生链确认只发送目标查询，导出未写入执行历史。
- 共享导出窗口的两项 PostgreSQL 18.6 实库回归在 Server-200 隔离容器通过。容器、隧道和测试会话已清理。
- Windows 测试会话不可达，本轮使用 macOS arm64。Windows、macOS x86_64 及安装包待验。增量暂未正式发布。

Navicat 参考入口见 [导出向导手册](https://www.navicat.com/manual/online_manual/en/navicat_18/win_manual/export_wizard.html)。
