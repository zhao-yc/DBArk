# 当前语句完整导出

在 SQLite 或 PostgreSQL 查询编辑器内，将光标放在多语句脚本中的一条 SELECT 或 WITH 查询。点击「导出当前语句的完整结果」。SQLite 的入口在「更多查询操作 → 执行与分析」，PostgreSQL 的入口在查询工具栏。

弹窗预览实际查询，按需填写参数，选择 CSV、JSON 或 Excel 及目标文件，再点击「执行查询并保存」。SQLite 继续使用 `:name`，PostgreSQL 使用连续的 `$1`、`$2` 等位置参数。导出从独立只读连接读取已提交数据，按批落盘，沿原流程在完整成功后发布文件。

原查询范围由光标和方言词法确定。PostgreSQL 要求两种标准字符串模式对当前范围和位置参数达成一致。源草稿、模型或连接变化后需要重新打开导出。选区或全文的原入口继续保留。Navicat 参考入口见 [查询结果手册](https://www.navicat.com/manual/online_manual/en/navicat_18/win_manual/query_results.html)。

## 验收范围

- Node.js 24.17.0 原生运行时检查、严格类型检查、源码构建及 266 项相关测试通过。扩大回归的 95 项通过和 72 项失败与变更前基线逐项一致。
- macOS arm64 Electron 实测 SQLite 先从选区导出 JSON，再从光标语句绑定参数导出 Excel。独立读回 1,205 行及精确整数、Unicode 与二进制，源 SQLite 文件 SHA-256 保持一致。编辑草稿后旧弹窗停用选文件。
- macOS arm64 Electron 连接 Server-200 隔离 PostgreSQL 18.6，两项实库测试通过。光标语句导出 4,099 行 JSON 和 Excel，并核对精确值、NULL、二进制、重名列、前后序列哨兵零写入和原会话事务及结果。CSV、参数绑定、取消时保护原目标分别沿原入口回归。容器、隧道和测试会话已清理。
- Windows 测试会话不可达，本轮使用 macOS arm64。Windows、macOS x86_64 和安装包待验。增量暂未正式发布。
