# 恢复 PostgreSQL 原生纯文本备份

在「工具 → 执行 PostgreSQL SQL 文件」选择目标连接、目标数据库和 UTF-8 的 `.sql` 文件，再点「确认并执行文件」。可直接选择同版本 `pg_dump` 生成的纯文本 SQL。目标库需提前准备好未包含在备份内的依赖及所需角色。若目标库使用不同角色，可在导出时用 `--no-owner --no-privileges` 省去源库的所有者及授权语句。

整库迁移可在同一窗口[创建新数据库并恢复](postgres-restore-new-database-20261107.md)。

- 支持 `COPY 表 [(列, …)] FROM STDIN` 的文本和 CSV 模式，支持常见 `WITH (...)` 选项，包括格式、标题、分隔符、引号、转义、NULL、默认值和 UTF-8。每段数据从下一行开始，以独占一行的 `\.` 加 LF 或 CRLF 结束。客户端按块传送数据，服务器负责解释字段、约束及类型。
- 支持新版 `pg_dump` 的成对 `\restrict` 和 `\unrestrict` 标记。标记须包住整个脚本，且两端使用同一密钥。外部文件、程序、二进制 COPY、换库、其他 psql 元命令，以及自定义、目录和 tar 格式归档，使用 PostgreSQL 原生工具。
- 同一文件中的 DDL、数据和后续 SQL 共用独立事务。缺失结束标记、服务器拒绝数据或中途取消都会停止文件任务，并按服务器回执显示结果。COPY 错误显示语句位置及可取得的 SQLSTATE，避免错误正文回显输入字段。
- 文件最多 10 GiB，单条 SQL 最多 64 MiB。结果未知时先核对目标库。执行可信备份，并单独核对已有序列或函数产生的事务外副作用。

参考 [PostgreSQL COPY](https://www.postgresql.org/docs/18/sql-copy.html)及 [pg_dump](https://www.postgresql.org/docs/18/app-pgdump.html)。

## 2026-11-07 验收

- Windows 测试会话不可达，改用 macOS arm64 源码 Electron。PostgreSQL 18.6 运行在 `server-200` 的独立容器，普通账号只用于隔离的源库和目标库。三项原生用例串行通过，结束后该账号残留会话为零，容器与 SSH 转发均已清理。
- PostgreSQL 18.6 原生 `pg_dump --no-owner --no-privileges --table=public.native_copy` 生成 5,658,044 字节的文件，保留工具生成的成对限制标记。通过真实工具菜单恢复到另一个库。核对 84 行的顺序摘要、文本字节、NULL、空字符串、二进制、标识序列及约束定义。文件 SHA-256 为 `8f41b613aad8d45754057a19396604e184ef789b9b7d66b2a28bcb0c470d0f9c`。
- 内联 CSV 使用 CRLF 和自定义分隔符。实库回读核对多行引号字段、空字符串、NULL、带引号的结束标记字样，以及 COPY 后执行的表注释。缺少结束标记和整数类型拒绝分别确认回滚。后者显示 SQLSTATE 22P02，且窗口和任务历史均未回显输入值。在服务端已进入 COPY 的行检查后，通过窗口取消并确认新表回滚。
- 类型检查及构建通过。首轮原生夹具的进程输出编码配置错误，在启动桌面前退出。随后两轮分别修正 PostgreSQL 18 约束断言和活动 SQL 带换行的观测条件，最后完整通过。
- 首轮单元回归的既有 TLS 用例因沙箱禁止监听 127.0.0.1 失败，原记录保留。取得回环权限后全量复跑，1,354 个测试文件通过，27,611 项通过，10 项按环境条件跳过。
- Windows、安装包、其他 PostgreSQL 主版本和 10 GiB 边界仍待验证。
