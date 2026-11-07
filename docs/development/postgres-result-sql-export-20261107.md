# PostgreSQL 查询结果 SQL 导出

在 PostgreSQL 查询结果区点击「导出已返回结果」，或勾选记录后点击「导出勾选结果行」。格式选择「PostgreSQL INSERT SQL」，填写目标 schema、表名和每个结果列对应的目标字段。重名别名仍按列位置区分。点击「生成 INSERT SQL 预览」，核对后选择保存位置、填写准确的 `schema.表名` 并勾选确认，最后导出。

文件固定 UTF-8。只包含打开窗口时捕获的已返回或勾选快照，原结果已截断时会显示提示。原 SQL 不重跑，导出本身不连接或写入目标数据库。修改映射后，旧预览和文件选择失效，需要重新预览。

目标名称按 PostgreSQL 双引号规则生成，最多 63 个 UTF-8 字节。文本使用显式 E 字符串，字节使用 BYTEA 十六进制输入，NULL 和空字符串分别保留。目标字段决定原始文本到类型的转换，日期、时区及其它设置需在回放前核对。目标约束、生成列及标识列也需由用户核对。[PostgreSQL 词法规则](https://www.postgresql.org/docs/18/sql-syntax-lexical.html)、[BYTEA 输入](https://www.postgresql.org/docs/18/datatype-binary.html)

## 2026-11-07 验收

- macOS arm64 源码 Electron 在 Server-200 回环隔离 PostgreSQL 18.6 上通过完整界面流程。源表三行、返回上限两行，已返回文件准确包含前两行，勾选文件准确包含第二行。原查询历史在导出前后保持一致，来源仍有三行。
- 两份实际文件分别在 `standard_conforming_strings=on/off` 下回放，逐项核对大整数、20 位小数、引号、反斜线、换行、补充平面字符、NULL、空字符串、空字节、非空 BYTEA 和六位微秒时间。重复结果别名按位置映射到大小写不同的目标字段。
- 67 项相关单元测试通过，包含旧结果格式及 SQL 生成、原子文件、一次性预览与路径授权、目标方言变化、UTF-8 和 NUL 拒绝。运行时检查、严格类型检查和构建通过。旧版无 SQL 选项的实库复现日志保留，测试会话、转发和容器均已清理。
- Windows 虚拟机不可达，Windows 和安装包未验收。本批未另跑 MySQL／MariaDB 的桌面实库结果导出。
