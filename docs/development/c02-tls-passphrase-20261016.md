# C02 TLS 加密客户端私钥口令

本片基于已推送提交 `82e07a0788c78ea3e68df397fabb4820deb82587`，独立分支 `task/parallel-c02-tls-passphrase-20261016`。只在员工 2 普通克隆开发，没有修改 ROOT 冻结源码、安装产物或其它员工分支。

## 实现范围

正式连接表单的 TLS / SSL 页增加“TLS 客户端私钥口令”，复用原秘密输入的已保存、缺省保留、明确清除及恢复操作。口令适用于现有 PEM 客户端私钥路径；不新增 PFX、其它认证模式或证书管理功能。

配置契约增加 `tls.passphrase` 和可选的 `tls.hasPassphrase`。已存标记由主进程秘密槽计算，仅作为表单提示；旧 TLS 配置无新秘密时保留原概要形状。原有未加密私钥、无 TLS、SSH 和数据库密码路径兼容，不改变存储 schema 版本。

口令上限为 **1024 个 UTF-8 字节**，原字符和前后空白不做 trim。表单 `maxLength` 先限制至多 1024 个 UTF-16 单元；提交、IPC、直接存储和 utility 入口再共用真实 UTF-8 字节校验。1024 字节 ASCII、341 个汉字及256个四字节字符属于合法边界；超界及非文本拒绝，错误不回显秘密。

## 存储与保密边界

- 继续使用现有 main safeStorage 保护器，增加独立 `tlsPassphrase` secret 槽，不与数据库密码、SSH 密码、SSH 私钥口令混用。
- `undefined` 表示保留原秘密，空字符串表示清除；沿用原“记住密码”策略。系统加密不可用或未记住时仅在当前进程内存保留，关闭后不恢复。保存失败原子回滚，删除连接清除相应槽。
- `connections` 的 profile JSON 删除口令和已存标记；公开概要不返回明文，只按需返回存在标记。主进程解密后仅向内部 utility 发送完整配置，渲染进程没有读取原口令的接口。
- 现有复制、导出白名单继续不承载口令/存在标记；导入严格拒绝这些字段。来源连接摘要继续只使用公开路由字段，不加入口令或存在标记。
- TLS 口令重填/清除被纳入原认证变更判断；旧标签、引擎在途使用及保存锁保护继续生效，不能通过只改新口令绕过。
- 加密保护器失败使用固定错误消息；连接失败删除口令原文并重新构造错误，不携带可能包含秘密的原属性、cause 或原堆栈。没有新增包含口令的日志、SQL、历史或任务记录。

文件内容仍由用户选定的现有 keyPath/certPath/caPath 读取；本片不把外部私钥文件搬入 SQLite，也不声称应用会加密原 PEM 文件。

## 实际驱动与 Node TLS 核对

本机安装的 `mysql2@3.24.5` 类型声明包含 `SslOptions.passphrase`。真实 `lib/base/connection.js` 的 `getSecureContext` 将 `ssl.passphrase` 交给 `tls.createSecureContext`，且缓存比较包含 passphrase；`startTLS` 随后把该 SecureContext 用于真实 TLSSocket。既有真实 host/SAN 补丁保持原样，未改依赖和锁文件。

正式 `connect` 读取原文件材料后，经 `connectionTlsOptions` 添加独立口令；仍由 mysql2/Node TLS 解析加密私钥。未加入用 mock 宣称握手成功的路径。

本机 Node v24.17.0 内存探针实际生成一次性 RSA 加密 PKCS8 PEM：1024 字节口令导出及 TLS 解析成功，1025 字节被 OpenSSL 拒绝。上限因此按字节约束，不只按中文字符数量限制。

## 本轮验证

1. `node node_modules/typescript/bin/tsc --noEmit`：通过。
2. 在本克隆独立原生 TEMP/TMP 中以两个 worker 执行完整默认单元：**3052 项通过，零失败、零跳过**；JSON 保留于 `.cache/c02-tls-passphrase/full-unit.json`。其中本片五个专属文件共27项，不能与全量数字重复相加。
3. `node scripts/build.mjs`：通过，31.20秒。仅有既有 Zod 注解和包体积警告；dist 忽略产物不提交，也没有构建或安装新的发行包。
4. 差异检查通过。本片没有 GUI、系统剪贴板、200、Docker、网络监听或远端资源创建。

专属检查分别覆盖：

| 文件 | 用例数 | 实际验证 |
| --- | --- | --- |
| `tls-credentials.test.ts` | 10 | 旧配置、原字符、UTF-8边界、严格字段、概要/复制/导入禁止项、摘要不含秘密、旧标签及认证变更保护 |
| `tls-credentials-storage.test.ts` | 8 | 真实 SQLite、独立槽、密文/profile分离、重启、保留/清除、记住切换/系统不可用、写盘回滚、保护器错误脱敏、删除及原保存保护 |
| `tls-credentials-engine.test.ts` | 5 | 内存生成一次性加密PEM，真实OpenSSL成功解密及错/缺口令拒绝；真实mysql2 startTLS创建TLSSocket，口令变化时缓存不能误复用；旧未加密key兼容 |
| `tls-credentials-connection.test.ts` | 2 | 正式connect的ssl口令传递、失败错误去秘密/cause、越界前置拒绝；此文件仅在失败边界替换createConnection，不声称认证成功 |
| `ui-tls-credentials.test.tsx` | 2 | 正式TLS JSX字段绑定、真实SecretInput的密码输入/上限/已存提示和清除/恢复；为SSR/回调单元，不是原生GUI验收 |

真实 TLS 检查没有 mock `tls.createSecureContext` 或 mysql2 的验证成功。使用真实 mysql2 与内存 Duplex，不监听端口、不连接数据库；一次性私钥及口令仅存在测试进程内存，未写出 PEM、证书或密钥文件。它证明解密及真实驱动初始化，不证明完整 TLS 协商、客户端证书身份或服务器认证。

存储单元采用进程内临时 AES 保护器及真实 SQLite 文件，验证的是主进程存储契约和失败回滚，不冒充 Electron 原生 safeStorage/DPAPI/钥匙串实测。

首轮原沙箱临时目录的存储测试遇到 SQLite 原子 rename 的 EPERM，未修改存储来绕过；改用独立原生临时目录后相关82项通过。新增专属套件一次23通过/2夹具失败分别为 beforeEach 误返回mock清理函数及空表SQLite结果处理；仅修正夹具后完整3052项通过，原 `.cache/c02-tls-passphrase/slice-unit.json` 保留。82项及这些早期结果不额外计入最终覆盖数。

## ROOT 后续真实认证验收

尚未执行正式 GUI、安装包、utility 到真实 mTLS 服务端、严格 CA/SAN、客户端证书链、错口令后真实线程/SSH通道释放、原生 safeStorage 重启或其它操作系统的本片专验。已有历史 TLS 或原生结果不能自动归入本新分支。

ROOT 在冻结发行检查点结束并准备授权资源后，需单列验证：真实证书/加密PEM正确口令成功；缺/错口令失败；保留/清除及记住/会话回退；修改口令时旧查询标签和事务受保护；复制导出无秘密；退出后本人线程/进程清零。不得关闭 CA/主机校验来换取成功，也不得把只开启服务器TLS的实例称为客户端证书认证。

本片没有创建账号、签发证书或修改服务器。新增 DB 用户仍只可沿用已经授权的 `cp_*` 与 `dbark_colperm_*`.`subject` 范围，不能假定获得其它账号/GRANT/服务器TLS配置权限。如后续授权生成需保留的真实材料，应按项目要求备份至 `E:\BaiduSyncdisk\codex重要文件备份\DBArk` 并附中文说明；本轮仅内存一次性材料，不存在需保留的真实密钥/证书。

以上保留作者交付时边界。ROOT随后已完成严格mTLS核心，并在主目录固定9217124通过Windows正式表单、真实utility、原生safeStorage、真实重启恢复、仅清TLS槽及不记住会话回退两项用例；原无回调核心也重新通过，临时用户/库/材料及本例进程清零、原CA不变。见[独立正式UI实证](../../tests/integration/acceptance-c02-mtls-ui-20261016.md)。这是已授权隔离资源内的后续实际执行，不改变前期纯单元的证明层；0.18未发布，安装包/macOS/专属SSH等仍待。
