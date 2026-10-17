# B01 原生参数与受控客户端选项文本

本模块只生成参数及敏感文本，不启动工具、不探测版本、不连接数据库、不读取或写入认证文件。它不证明备份、全局锁、归档提交或恢复已经成功。Root 负责实际进程、句柄、ACL、文件令牌、工具注册和套件核验；renderer 不能传入本模块的私有输入。

## 当前支持边界

只固化目录中已注册的 `mysql-8.4.11-win32-x64`、准确版本 `8.4.11`，派生 `bin/mysqldump.exe`、`bin/mysql.exe` 和 `lib/plugin`。Root 应从已验证套件结果取得目录，而不是接受用户输入目录。模块校验 ID/版本/路径格式，不重复或替代工具文件散列及目录身份核验。

当前参数策略只接受已固定的 IP TCP 端点、端口 1—65535、显式 `tls: 'disabled'`、`ssh: false`、已核 `caching_sha2_password` 认证以及同名库恢复。Root 必须确认服务器真实 family/version/身份和账号认证方式；`--default-auth` 是首选插件，不是服务端请求插件的强制白名单。插件目录显式绑定受核套件，不能依赖系统搜索位置。需要其他插件、未缓存认证所需的 RSA 可信材料、TLS、SSH、DNS、跨库重映射、其他工具版本或平台时，本片明确阻断，由后续准确策略扩展，不自动降级。

MariaDB 11.4.13 保留为待核扩展。官方资料确认其配置语法及 `--defaults-file` 首参数要求，但不能据此推定 MySQL 的 `--no-login-paths`、GTID 或其他参数可以直接共用。本片拒绝生成 Maria argv，并未宣布永久不支持 MariaDB。

## 接口与执行端责任

`databaseBackupNativeDumpOptions(input)` 接收 `tool: { id, family, version, directory }`、`target: { host, port, user, password, database, transport: 'tcp', tls: 'disabled', ssh: false, authPlugin: 'caching_sha2_password' }`、`defaultsFile: { token, path }`，以及 `lockStrategy: 'root-held-global-read-lock'`。

`databaseBackupNativeRestoreOptions(input)` 使用相同三组私有输入，以 `sourceDatabase` 替代 `lockStrategy`；源库名须与目标名精确一致。参数中的库名都是一个完整值，不经 shell 拼接；dump 还使用 `--` 终止参数解释。禁止系统库、控制字符、前导减号及不合法或过长标识。没有任意 flags、环境、SQL、初始化命令或源文件参数入口，额外字段与 getter 都拒绝。

输出 `{ policy, toolId, defaultsFileToken, launch, clientOptions }`。`launch` 包含绝对 `executable`、冻结的 `argv`、`shell: false`、`windowsVerbatimArguments: false`、空 `env` 及 stdin/stdout 用途。Root 必须把数组直接传给 spawn，不能经 PowerShell、cmd 或字符串拼接，也不能开启 verbatim arguments。必须显式使用生成的空环境，不得合并父进程环境；若原生宿主确需操作系统变量，只能由 Root 精确加入已核的必要 OS 项，不得引入 MySQL、插件预载、调试、配置或动态加载环境。

Root 将 `clientOptions.takeText()` 显式取出一次，以 UTF-8 无 BOM 原样写入 token 绑定的私有临时文件。文本只有 `[client]`、`user`、`password` 三行；password 不在 argv 或环境。常规 JSON、字符串化和 Node inspect 都隐藏文本，方法再次调用会拒绝。取出后的字符串仍是敏感数据，Root 不得记录、进入任务事件/IPC、包含在错误或转发工具原始 stderr 中。JavaScript 字符串不能保证内存擦除。

路径只接受不超过 240 字符的规范 ASCII Windows 本地绝对路径：拒绝 UNC、设备路径、ADS、相对/含归一化变化路径、保留设备名及不可证明的 Unicode 路径。defaults 文件须在套件目录之外。Root 持有路径及 token 的绑定、私有 ACL、同句柄身份、创建和清理权，本模块不操作文件。

凭据保留合法 UTF-8，拒绝 NUL、孤立代理项、Ctrl-Z、未支持 C0/DEL 和超预算输入，不截断。引号、反斜线、空格、backspace、tab、CR、LF 按官方解析器编码为单行转义，`#` 始终位于引号内；不能借换行加入新段落、选项或 `!include`。空密码显式写入，不回退至 `MYSQL_PWD`。

## 固定参数策略

公共前缀依次是 `--defaults-file=<绑定路径>`、`--no-login-paths`，随后为 TCP/IP/端口、utf8mb4、显式 TLS 关闭、认证首选及受核插件目录。只读该受控文件并另行关闭登录路径，不使用 `--defaults-extra-file`；也不错误地将 `--no-defaults` 与凭据文件并用。

dump 固定 `--opt --quick --hex-blob --routines --events --triggers --quote-names --set-gtid-purged=OFF --column-statistics=0 --databases --skip-lock-tables -- <库名>`。GTID 不带入目标实例，直方图统计不随包恢复；这些是明确的首片策略。Root 已持有并持续证明全局读锁时，末尾的 `--skip-lock-tables` 才关闭默认 `--opt` 打开的表锁。本模块不使用 `--single-transaction`、不自行加锁、不断言一致性；锁丢失、工具失败、警告和对象范围变化须由执行器阻断。

restore 固定非交互 `--batch --binary-mode --skip-reconnect --skip-auto-rehash --local-infile=0 --skip-system-command --commands=OFF --database=<同名库>`，输入只来自已检查归档 dump 的原始 Buffer 流。`--binary-mode` 保留换行及 NUL，并在非交互模式禁用除字符集和 delimiter 外的本地命令；在 8.4.11 中它会覆盖 commands 设置，因此不能声称叠加两个选项就禁用了 delimiter/charset。Windows构建没有 `USE_POPEN` 下的 pager 选项，不能添加 Unix 的 `--skip-pager`。选项不构成 SQL 沙箱：归档来源、SQL 内 USE/显式跨库引用、DEFINER、外部依赖、目标已有对象及恢复后核验仍由 Root/恢复预检负责。任何原始 SQL 都不在本模块改写。

## 官方依据（2026-10-17 核对）

- [MySQL 8.4 默认文件参数](https://dev.mysql.com/doc/refman/8.4/en/option-file-options.html)：参数位置与登录文件例外。
- [MySQL 8.4 选项文件语法](https://dev.mysql.com/doc/refman/8.4/en/option-files.html)：分组、注释及空白规则。
- [MySQL 8.4.11 my_default.cc](https://github.com/mysql/mysql-server/blob/mysql-8.4.11/mysys/my_default.cc#L1043)：准确 tag 的引号、转义和行尾注释解析；同文件 `get_defaults_options` 证明默认文件和登录路径开关的加载顺序。
- [MySQL 8.4.11 my_getopt.cc](https://github.com/mysql/mysql-server/blob/mysql-8.4.11/mysys/my_getopt.cc#L331)：`--` 终止参数解析。
- [mysqldump 官方选项](https://dev.mysql.com/doc/refman/8.4/en/mysqldump.html)：对象范围、流式读取及最后关闭表锁的语义。
- [mysql 客户端官方选项](https://dev.mysql.com/doc/refman/8.4/en/mysql-command-options.html)：非交互、二进制模式、本地命令和重连策略。
- [MySQL 8.4.11 mysql.cc](https://github.com/mysql/mysql-server/blob/mysql-8.4.11/client/mysql.cc#L1838)：按准确 tag 核对客户端选项及Windows编译条件。
- [MySQL 环境变量](https://dev.mysql.com/doc/refman/8.4/en/environment-variables.html)：密码、配置、登录文件、插件和调试环境均不能继承。
- [MariaDB 选项文件](https://mariadb.com/docs/server/server-management/install-and-upgrade-mariadb/configuring-mariadb/configuring-mariadb-with-option-files)、[mariadb-dump](https://mariadb.com/docs/server/clients-and-utilities/backup-restore-and-import-clients/mariadb-dump)：独立待核规则。

本片仅通过纯生成 RAM 测试和类型检查，未使用真实凭据文件、工具版本 probe、数据库、GUI、SSH、Docker、clipboard、full/build。参数存在不等于实际工具或恢复已验收。
