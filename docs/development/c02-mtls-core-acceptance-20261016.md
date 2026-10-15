# C02 真实 mTLS 核心验收准备

本片保留产品提交 `4a529a9b3bad707a6b009cfc73ddc18b29a9e236`，在同一独立普通克隆及分支 `task/parallel-c02-tls-passphrase-20261016` 追加测试准备。没有修改产品源码、依赖、中央配置或发行包。本轮只编写与纯检查，没有连接 200、启动 GUI/Docker、生成证书或创建远端资源。

## 最小可验范围

入口为 `tests/integration/c02-mtls.integration.test.ts`，只有通用集成与本片两个开关同时为 `1` 才动态导入实库夹具。模块导入和默认跳过均不读取材料文件，不加载 `.env`，不寻找 ROOT 的凭据。用例直接调用产品 `src/engine/connection.ts` 的真实 `connect/execute`，没有替换驱动、TLS 或数据库认证结果。

ROOT 后续显式运行时，固定验证以下完整流程：

1. 仅允许 `192.168.31.200:13484`，要求精确 ROOT 确认标记及预先核对的 MySQL `server_uuid`。真实连接必须为 MySQL 8.4；服务器有强制角色时拒绝创建对象。
2. CA、CA 私钥、OpenSSL 必须是显式普通文件绝对路径。只在运行期开启后读取。默认 Windows 工具为本机已有 `C:\Program Files\Git\usr\bin\openssl.exe`；允许 ROOT 显式覆盖为已有工具，不能自动搜索、下载或安装。
3. 运行期在独占临时目录生成随机 RSA 2048 位、AES-256-CBC 加密 PKCS8 客户端私钥、CSR、一天期 `clientAuth` 证书。签发只引用显式 CA/key，固定随机序号，不使用 `CAcreateserial`，不改 CA 目录。私钥口令随机生成，仅在本进程内存及 OpenSSL stdin 传递；CA key 口令同样只经 stdin，均不进 argv、日志、证据或配置文件。OpenSSL 不继承 ROOT 的秘密环境项。
4. 管理连接先完成真实 CA/IP SAN/cipher 校验和服务器 UUID 核对，再检查随机库及用户名不存在。仅创建十二位随机小写十六进制的 `cp_<12hex>`@`%`、`dbark_colperm_<12hex>` 库及其中 `subject` 表。账号仅 `GRANT SELECT ON` 精确表，`REQUIRE X509`；用户元数据与表注释分别携带本轮所有权令牌。不创建其它表/账号/角色、不执行其它授权、不修改 GLOBAL 配置。
5. 同一账号真实无客户端证书时必须收到服务器 1045 认证拒绝。对同一加密 key，原生 TLS 解析先独立证明缺/错口令无法解密，随后缺/错口令仍分别经产品真实 `connect` 拒绝。最后正确口令真实握手、读取本轮 `subject`，核对 `CURRENT_USER/DATABASE/CONNECTION_ID/CURRENT_ROLE` 及非空会话 `Ssl_cipher`。真实 TLSSocket 必须 `authorized=true`，并显式检查目标 IP SAN；不能关闭 CA 或身份校验。
6. 权限目录确认只有精确表的 SELECT、无额外库/列/全局权限或角色，且 `ssl_type=X509`。不执行可能带认证信息的 `SHOW GRANTS`，不输出配置或完整驱动对象。

该用例验证核心真实连接路径，不代表 Electron utility、ConnectionDialog、原生 safeStorage、重启、清除或安装包验收；这些 GUI 项留待下一片由 ROOT 串行执行。

## ROOT 运行参数

ROOT 必须自行核对目标并从其受控执行器向子进程注入下列环境项。本片不提供加载既有秘密文件的代码；不要把口令放入命令行、终端历史、配置 JSON 或提交文件。

| 环境项 | 约束 |
| --- | --- |
| `DBARK_INTEGRATION_ENABLED` | 必须 `1` |
| `DBARK_C02_MTLS_ENABLED` | 必须 `1`，本片专用默认关闭 |
| `DBARK_C02_ROOT_CONFIRM` | 必须 `192.168.31.200:13484/c02-mtls` |
| `DBARK_C02_HOST` / `DBARK_C02_PORT` | 必须 `192.168.31.200` / `13484`，不使用通用实库环境备用值 |
| `DBARK_C02_SERVER_UUID` | ROOT 已核对的该实例 UUID；真实查询不匹配时不创建资源 |
| `DBARK_C02_ADMIN_USER` / `DBARK_C02_ADMIN_PASSWORD` | ROOT 显式提供；具备本片精确对象管理、权限目录及 PROCESSLIST 观察权限 |
| `DBARK_C02_CA_PATH` | 服务器信任 CA，同时用于签发本轮客户端证书的 CA 绝对路径 |
| `DBARK_C02_CA_KEY_PATH` | 上述 CA 对应现有私钥绝对路径，只引用，不复制、不改写 |
| `DBARK_C02_CA_KEY_PASSPHRASE` | CA 私钥如已加密则显式提供；缺省为空；不接受换行/空字符 |
| `DBARK_C02_OPENSSL_PATH` | 可选，已有工具的绝对路径；非 Windows 必须提供 |
| `DBARK_C02_TEMP_PARENT` | 可选，ROOT 指定的已有普通目录绝对路径；缺省系统临时目录 |

环境由 ROOT 准备后，仅执行此专用文件，不能误跑全部实库套件：

```powershell
node node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts tests/integration/c02-mtls.integration.test.ts --maxWorkers=1 --minWorkers=1
```

## 失败、所有权及收尾

每条 SQL 只发送一次，十秒超时即销毁该连接并保留“结果未知”，不重放写操作。OpenSSL 三十秒超时会终止子进程，并等待关闭后才清理材料。管理观察者在创建对象前必须证明其直接拥有 PROCESS 权限；成功用例还实际核对它能看见临时用户当前线程，防止无权限返回空目录被误当清零。测试真实成功连接全部进入严格关闭集合，负例如意外认证成功也会入集合；产品失败建连负责销毁流，随后管理观察连接按随机用户及全部已返回线程 ID 查证清零。管理观察连接最后严格关闭。COM_QUIT 没有服务器 ACK；最后观察连接采用产品严格传输关闭，不能据此称已有外部观察者逐 ID 核对最后一条管理线程。

CREATE 前先标记未知，只有成功响应才能确认为本次创建。任一 CREATE 结果未知，对应对象不发 DROP、不重试，保留精确名称由 ROOT 核对；没有创建或发现碰撞也不删除。只在线程清零后对已确认对象分别核对用户令牌/表令牌、库内无其它表/视图/例程/事件/触发器，再精确 DROP 用户/库，并读目录确认不存在。一次 DROP 失败不会重试，也不会阻止其它独立收尾。原始失败和收尾失败按顺序保留，首因进入 AggregateError cause，最外层携带精确用户/库/临时目录及 CREATE 确认状态并保留清理原异常；外部错误只保留安全错误编号/类别和因果结构，不携带原 SQL、原消息或秘密属性，夹具自身受控阶段说明保留。

临时目录保存设备/文件身份，删除前核对路径及身份。只 unlink 本例四个固定文件再 rmdir，不递归删除；目录被替换或多出文件时保留现场并报精确目录。所有连接收尾尝试之后才删除临时文件，且失败也独立尝试。测试只输出清理完成后的无秘密证据；失败保留随机用户/库名。没有可复用新密钥要保留，不触发 E 盘材料备份。

账号所有权元数据使用 MySQL 官方支持的 [CREATE USER ATTRIBUTE 与 REQUIRE X509](https://dev.mysql.com/doc/refman/8.4/en/create-user.html)。它不增加账号权限。

## 本轮纯检查

- 本机已有 Git usr/mingw OpenSSL 均为 3.5.7；usr 工具在普通沙箱内受 MSYS 命名对象权限限制，仅提升执行 `version` 和 `-help` 核对，未生成材料或读取密钥。
- `node node_modules/typescript/bin/tsc --noEmit`：通过。
- `node node_modules/vitest/vitest.mjs run tests/unit/c02-mtls-fixture-policy.test.ts --maxWorkers=1 --minWorkers=1`：27 项纯策略/清理测试通过；未调用真实 OpenSSL 或数据库。
- 上述专用实库命令在两个开关均为 `0` 时：1 项明确跳过，没有实库认证通过记录。

这些结果只证明验收准备的门禁、参数与控制流通过本地检查。真实 13484 mTLS 正负例及服务端/临时文件清理仍须 ROOT 显式运行验证，不能计作实库通过。
