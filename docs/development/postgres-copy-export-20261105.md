# PostgreSQL 表页原生 COPY 导出

在 PostgreSQL 表页应用筛选和排序，点击「导出数据」，选择「COPY CSV（PostgreSQL 原生）」。选定输出列和分隔符后，选择保存位置并开始导出。文件包含当前筛选的全部匹配记录，首行是列名。筛选无匹配记录时仍生成列名。

- 逗号、分号和 Tab 可选。文件使用 PostgreSQL 原生 CSV 的引用规则、UTF-8 编码和 LF 换行。NULL 表示为空字段，空字符串写为 `""`。字段可包含分隔符、引号及换行。[PostgreSQL COPY](https://www.postgresql.org/docs/18/sql-copy.html)
- 用 psql 回读时，先准备兼容的目标表，按文件列顺序指定目标列及同一分隔符。例如逗号文件可使用 `\copy schema_name.table_name (col_a, col_b) FROM 'data.csv' WITH (FORMAT CSV, HEADER true, ENCODING 'UTF8')`。日期、时间和间隔等值使用源会话的文本表示，回读会话应匹配相关设置。
- 导出使用独占只读连接，先锁住并复核关系结构，再按原筛选、排序和所选列执行 `COPY (SELECT ...) TO STDOUT`。应用按文件写入速度消费数据，行数使用 PostgreSQL 的 `COPY n` 回执。文件同步、读事务和连接都成功结束后，才替换目标文件。可取消，单文件上限为 10 GiB。

## 验证

- macOS 类型检查、源码构建及完整单元回归通过。单元回归执行 1,325 个测试文件，27,424 项通过，10 项 Windows 系统 `tar` 用例按平台跳过。
- Server-200 独占 PostgreSQL 18 实库 5 项通过。以普通角色运行，130 条筛选记录按数值主键排序，并以重新排列的列顺序导出。独立连接执行 `COPY FROM STDIN`，逐值核对大整数、精确小数、NULL、空字符串、分号、引号、含 CR/LF 和 Unicode 的跨块字段及 BYTEA。筛选值包含引号、反斜线和分号。零行 Tab 文件只包含列名。COPY 运行中取消及服务端送出部分数据后报错，均保留原目标并清理暂存文件。
- macOS Electron 源码窗口 1 项通过，21 个观察点。筛选第二页通过实际主进程和数据库进程生成仅含选中列的 CSV，文件含两条匹配记录。测试替换系统保存对话框以提供专用目标路径。两个专用数据库及容器均已清理，清理前各自核对原表数据和零连接。
- WIN11-TEST 测试会话不可达，按约定在本机 macOS 验证。Windows 原生窗口、安装包及 COPY 经 SSH 和 TLS 的组合待验收。
