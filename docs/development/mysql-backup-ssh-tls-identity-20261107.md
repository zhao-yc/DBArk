# MySQL／MariaDB 备份的 SSH 严格 TLS

在连接设置填入 SSH 跳板可访问的数据库域名或 IP，开启 TLS 并保留证书身份校验。使用私有 CA 时选择对应证书。服务端要求双向 TLS 时，沿用连接里的客户端证书、私钥和口令。设置完成后，可在「工具 → MySQL／MariaDB 整库备份」选择该连接，生成 SQL 或 tabrelio ZIP。

原生工具会用本机回环地址校验证书。遇到非回环数据库地址时，引擎为本次任务生成只供原生工具使用的短期回环证书，私钥保留在进程内存。引擎在原 SSH 通道内用配置的数据库地址和信任链建立独立上游 TLS 会话。两段握手均完成才转发数据库认证字节。回环证书与上游信任链分开，客户端证书和私钥只提供给实际数据库。身份不符或握手失败时，备份文件不会发布。[MySQL 连接 TLS 选项](https://dev.mysql.com/doc/refman/8.0/en/connection-options.html) · [MariaDB 证书验证](https://mariadb.com/docs/server/security/encryption/data-in-transit-encryption/secure-connections-overview)

原生工具、InnoDB 快照、目录复核和取消收尾沿用原备份入口。[SSH 备份与恢复流程](mysql-ssh-database-backup-20261107.md)

## 2026-11-07 验收

- Windows 测试虚拟机不可达。本轮用 macOS arm64 源码 Electron，连接 Server-200 上的一次性 MySQL 8.4.11 和 MariaDB 11.4.13。
- MySQL 使用仅由隔离 SSH 跳板解析的数据库域名，MariaDB 使用非回环 IP。测试证书的 SAN 对应该域名和 IP。两者通过正式界面生成 ZIP 并直接恢复。另以强制客户端证书的账号及带口令私钥生成整库 SQL，并通过 SQL 文件入口恢复。原回环严格 TLS 的 ZIP 流程同轮回归通过。
- 独立管理会话核对恢复前后的表、视图、过程、函数、触发器、事件及数据。等锁取消后原有文件保持，原转储线程退出。隔离容器、转发、临时证书和备份凭据目录均已清理。
- 双段 TLS 测试确认，可信证书名称不匹配时不会转发数据库认证字节，明文请求也被拒绝。类型检查、源码构建和锁文件检查通过。Vitest 共 27,643 项通过、10 项按环境门槛跳过。Windows 原生、安装包和 IPv6 实机待验。
