# PostgreSQL 自定义归档

在「工具 → PostgreSQL 整库备份」选择「PostgreSQL 自定义归档」，用本机安装的 `pg_dump` 保存 `.dump` 或 `.backup`。归档保留所有者和授权，压缩能力取决于本机 `pg_dump`。备份继续使用原连接的只读快照和原子文件写入。

在「工具 → PostgreSQL 自定义归档」打开 PGDMP 文件，并选择兼容版本的 `pg_restore`。macOS 选择 `pg_restore`，Windows 选择 `pg_restore.exe`。可从同一窗口[直接恢复到目标库](postgres-archive-direct-restore-20261107.md)，也可执行以下两种离线操作。

- 「读取归档目录」显示原生目录，包括归档版本、来源数据库和对象条目。目录预览最多 2 MiB。超过预览上限时仍可直接导出。
- 「导出 PostgreSQL 归档 SQL」可选择结构和数据、仅结构或仅数据。需要在另一角色环境恢复时，勾选「省略所有者和授权」。转换保留 SQL 原始字节，要求归档输出声明 UTF-8。归档及导出文件各限 10 GiB。

用「执行 PostgreSQL SQL 文件」在目标库恢复导出的 SQL。整库迁移可以[恢复到新库](postgres-restore-new-database-20261107.md)。仅数据导出需要已有相容的结构。该归档入口处理 PostgreSQL 自定义格式，目录与 tar 格式继续使用原生工具。

归档读取和转换使用已核验的只读文件句柄，源归档不会被替换。原生工具返回成功且文件身份核对通过后才发布 SQL。源文件变化、归档截断或取消时，既有目标文件保留。

参考 [PostgreSQL pg_dump](https://www.postgresql.org/docs/18/app-pgdump.html)和 [pg_restore](https://www.postgresql.org/docs/18/app-pgrestore.html)。

## 2026-11-07 验收

- Windows 测试会话不可达，使用 macOS arm64 源码 Electron，连接 `server-200` 上的隔离 PostgreSQL 18.6。测试使用从官方源码校验后编译的 `pg_dump` 和 `pg_restore` 18.6。
- 客户端生成的归档为 23,548 字节，原生目录确认是 gzip 压缩的 CUSTOM 格式，含 36 个 TOC 条目。归档 SHA-256 为 `b4c6658e7777eb9d8a1efdaf597b5634141068d30548f392f5d2e9c01a25909d`。
- 实际导出了仅结构、仅数据及完整 SQL。完整 SQL 为 5,963,993 字节，在新库确认提交 63 条语句，核对 84 行记录的摘要、序列、物化视图和大对象。三种导出均使用同一份源归档，操作后源字节一致。
- 截断归档和选中后换包都拒绝导出，两次核对原目标文件的字节保持原样。纯文本整库备份、SSH 与 TLS 联用、取消及回放在同一轮回归。四项 Electron 实库测试通过，结束后测试会话、回环转发和临时认证目录均已清理。
- 类型检查和构建通过。首轮全量测试的两个退出用例缺少新归档取消端口，保留原失败并补齐夹具。回归核对实际退出确认后先取消归档，再关闭存储。
- 定稿全量 Vitest 共 1,356 个测试文件通过，27,619 项通过，10 项按环境条件跳过。
- Windows、安装包、其他 PostgreSQL 主版本、非 UTF-8 归档和 10 GiB 边界仍待验证。
