# MySQL／MariaDB 通过 SSH 备份整库

在「工具 → MySQL／MariaDB 整库备份」选择已保存的 SSH 连接和数据库，指定对应的 `mysqldump` 或 `mariadb-dump` 后，按原流程保存 SQL。可以通过「执行 MySQL／MariaDB SQL 文件」恢复。

客户端先用已保存的指纹核对跳板身份，再在同一个 SSH 会话中开一条额外的转发通道。通道目标固定为连接里从跳板访问的数据库地址。原生工具使用仅接收一次连接的本机回环端口。客户端先核对原库版本和握手声明的 TLS 能力，再交付握手。备份后核对目录与文件终态，最后关闭临时转发和 SSH 会话。[MySQL 原生 TLS 选项](https://dev.mysql.com/doc/refman/8.4/en/mysqldump.html) · [MariaDB 原生 TLS 选项](https://mariadb.com/docs/server/clients-and-utilities/backup-restore-and-import-clients/mariadb-dump)

开启证书身份校验时，数据库证书需覆盖连接配置中的实际数据库地址。配置为 `127.0.0.1` 或 `::1` 时，原生工具经 SSH 直接校验数据库证书。配置为内网域名或非回环 IP 时，由引擎在原 SSH 通道上按该地址校验数据库证书。[非回环 SSH 严格 TLS](mysql-backup-ssh-tls-identity-20261107.md)

备份范围、InnoDB 快照及源权限约束见[原生整库备份说明](mysql-native-database-backup-20261107.md)。可按[整库 ZIP 归档](mysql-zip-backup-20261107.md)选择归档格式。

## 2026-11-07 验收

- Windows 测试虚拟机不可达。本轮使用 macOS arm64 源码 Electron 和 Node.js 24.17.0，在 Server-200 上运行隔离 MySQL 8.4.11 和 MariaDB 11.4.13。
- 普通 SSH 用例使用仅在隔离跳板中映射的两个来源名。客户端从正式菜单备份，再经同一配置恢复。严格 TLS 用例强制测试账号使用加密连接，并使用带 `127.0.0.1` IP SAN 的测试证书，保留界面的证书校验选项。原直连路径同时通过。
- 从独立管理会话复核表、视图、过程、函数、触发器、事件和精确数据。MySQL 等锁取消后原文件字节一致，原转储线程已退出。测试容器、应用 SSH 通道、外层转发、临时凭据目录及证书夹具均已清理。
- 单元测试覆盖握手分片、来源版本变化、TLS 能力缺失、未完成握手及第二客户端拒绝。类型检查、源码构建通过。全量 Vitest 通过 1,360 个文件，27,637 项通过，10 项按环境门槛跳过。
- IPv6 回环与 Windows 上的应用 SSH、证书和安装包待实机验收。
- PostgreSQL 18.6 的纯文本、TLS／SSH 备份、自定义归档及恢复共 4 个源码 Electron 用例通过。
