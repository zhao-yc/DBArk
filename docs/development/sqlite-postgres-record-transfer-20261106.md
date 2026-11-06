# SQLite 到 PostgreSQL 的记录复制

运行 SQLite 查询，在当前结果集勾选记录，从结果菜单选「暂存勾选结果到 PostgreSQL」。可从只读 SQLite 文件暂存。范围取当前显示的勾选行与可见字段，单批最多 100 行、200 个可见字段和 1 MiB。只使用已返回的结果，不重跑 SQLite 查询。

打开目标 PostgreSQL 表，点「从查询结果复制记录」。映射区显示勾选记录的实际 SQLite 存储类。唯一同名、非 NULL 值只有一种存储类且目标类型匹配时，可自动配对。INTEGER 对应 bigint，REAL 对应 double precision，TEXT 对应 text，BLOB 对应 bytea。全 NULL 列可手动映射到允许 NULL 的目标列。同列混合 BLOB 和标量时，请跳过该列，或先筛选成单一存储类再暂存。 [SQLite 存储类](https://www.sqlite.org/datatype3.html#storage_classes_and_datatypes) · [PostgreSQL 数值类型](https://www.postgresql.org/docs/18/datatype-numeric.html)

文本原样传给目标字段，手动映射到不同类型时由 PostgreSQL 校验及转换。加入草稿时不写数据库，仍需核对目标表的写入预览并确认提交。源值只保留于当前窗口内存，未使用系统剪贴板。

新增或编辑连接后，如果目标表仍停留在旧页，复制入口会提示先刷新目标表。暂存批次保留，可以在刷新后重新打开映射。

## 验证记录

- macOS arm64、Node.js 24.17.0 的运行时检查、严格类型检查和源码构建通过。10 项定向单测覆盖可见列与存储类型同步投影、存储类变化拒绝、整数原文、BLOB、混合列及全 NULL。
- 完整单测覆盖 1,346 个文件，27,539 项通过，10 项 Windows 条件测试跳过。首轮启动后源码仍在更新，随后从完整版本重跑通过。
- Server-200 的 PostgreSQL 18 隔离回归覆盖 5 个文件、7 项测试，全部通过。macOS Electron 专项通过 6 项观察，涵盖原表页和查询结果的复制回归，以及真实只读 SQLite 文件向 PostgreSQL 复制。旧目标表先提示刷新，刷新后暂存保持。预览时 PostgreSQL 仍保留原四行，确认后只增加勾选的两行。
- 独立连接读回确认了有符号 64 位整数上下界、高精度小数、非空及零字节 BLOB、NULL 和空字符串。SQLite 文件以只读方式打开，独立读回源表仍有三行。窗口正常退出，PostgreSQL 两库零连接后清理。
- 首轮因菜单在表页刷新时收起而停止。第二轮复现新建源连接后旧目标页不能提交，补齐目标刷新提示并复验通过。前两轮失败现场保留。
- WIN11-TEST 连接不可用，本轮回退 macOS。Windows、安装包、其他 PostgreSQL 版本及其余跨引擎方向待验。
