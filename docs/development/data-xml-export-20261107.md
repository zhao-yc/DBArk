# XML 数据导出

「XML 文档」适用于已返回和勾选结果、SQLite／PostgreSQL 的完整查询、MySQL／MariaDB 的新执行流式导出，以及四种数据库的表和视图全量导出。表页使用已应用的筛选、排序及所选字段。MySQL 和 MariaDB 的完整查询将多组结果和语句回执依次写入同一文档。

## 文档结构

文件为 UTF-8 XML 1.0，根元素是 `tabrelio-data`，带版本和数据范围。每个 `result` 先列出 `columns`，再按顺序写入 `records`。每个 `record` 中的 `cell` 与列位置一一对应。列名作为文本保存，重名、空名和特殊符号均可保留。空结果仍有列描述。源快照截断时，根元素带 `truncated="true"`。完整脚本中，`receipt` 保存语句序号、影响行数、插入 ID 和警告数量。

`cell` 的 `kind` 表示客户端接收的值类型。精确整数和小数在驱动以字符串返回时仍按原文本保存。空文本使用空的 `kind="text"` 元素，NULL 使用 `kind="null"`，二进制使用 `kind="binary" encoding="base64"`。含 NUL 或孤立代理项等 XML 1.0 禁用码元的列名及文本，使用 `encoding="utf16le-base64"` 保存完整原字符串。XML 特殊字符和回车使用实体引用保留。[XML 1.0 规范](https://www.w3.org/TR/xml/#charsets)

单字段按编码后的 8 MiB 限额处理，单行及列头分别以 16 MiB 为限。文件沿用原任务的流式写入、取消和原子发布。当前采用 tabrelio 的位置映射文档。Navicat 的列名标签及记录属性两种布局列入后续覆盖。[Navicat 导出向导](https://www.navicat.com/manual/online_manual/en/navicat_18/win_manual/export_wizard.html#additional-options)

## 验收

- macOS arm64 使用 Node.js 24.17.0。运行时、严格类型检查、源码构建及 439 项相关单元测试通过。用独立 XML 解析器验证列顺序、控制字符往返及 DTD 样本文本的转义。超限和取消用例核对了原文件。
- SQLite 两个原生用例通过。逐格核对 1,353 条表页匹配记录，验证 1,205 行完整查询、XML 方案应用、勾选结果的 NUL 原值及历史不重复执行。
- PostgreSQL 18.6 三个原生用例和一个引擎实库回归通过。解析 4,099 行完整查询，核对两个同名列以及表和视图各 9 条匹配记录。HTML、CSV、JSON、Excel 和 INSERT 等原路径随相关测试复验。
- MySQL 8.4.11 和 MariaDB 11.4.13 各通过三个原生用例。两种数据库均核对同次执行的多组结果与回执、表与视图各 40 条匹配记录及原有 HTML 文件。Server-200 的隔离容器、测试库、会话与回环转发已核对清理。
- Windows、macOS x64 和安装包待验。覆盖矩阵 Q05、F01、R01、R02 维持部分覆盖。
