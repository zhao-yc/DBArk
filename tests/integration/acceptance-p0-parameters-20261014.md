# 2026-10-14 Q06 SQL 片段与类型参数验收

## 当前状态

本批次实现 SQL 片段 schema 2 迁移、九类型值参数及协议会话状态修复。最终冻结核心已通过 23 文件、273 项单元测试与类型检查；参数/协议独立集成在下述五个实际版本各通过 17 项，共 85/85。SQL 片段真实 Windows Electron 离线完整流程 1/1 通过。完整桌面、原生安装与公开版本验收仍按后续实际结果追加，不能由核心测试代替。

本记录与此前已清理的 v0.2.0、P0 SQL 文件批次相互独立，不修改旧验收记录。

## 核心与片段实际验收

五库参数测试实际覆盖九种类型的 Unicode/NUL、BIGINT/DECIMAL、日期微秒、BLOB、NULL 往返，重复名、LIMIT、客户端分隔符和可执行版本注释；静态与动态模式、缺参/多余/预算在写入前校验及动态前缀保留；独立会话事务、取消和错误保护。`ROW_COUNT()`、`FOUND_ROWS()` 和 `SHOW WARNINGS` 在同一脚本及跨任务实际断言，未加入状态探测 SQL。

直接 SET、prepared EXECUTE 和 CALL 关闭 `session_track_system_variables` 时，五个版本都没有报告跟踪配置自身变化。客户端因此不能以未收到变化当作模式未变：只放行所有候选模式下语句及参数位置一致的 SQL，实际歧义明确拒绝。正常 CALL、CALL 内改模式并关闭跟踪后 SIGNAL、服务器错误后的四候选解析均已实测。

ERR 包不带当前事务状态。重复键错误和失败 DDL 隐式提交后，缓存明确标记 `transactionKnown=false`，保留未提交数据供用户核对，不自动回滚、关闭会话或重放写入。明确事务操作或后续成功协议包恢复状态；不能把之前事务位视为错误后的当前真值。

最终参数/协议日志为忽略路径 `.cache/p0-parameters-protocol-{13357,13380,13384,13310,13311}.log`。先前 8.0/8.4 一次测试别名撞窗口函数保留字，改测试别名后完整 17 项重新通过；没有删减断言或改变数据库运行行为。

片段实际流程包含分组全文搜索、复制编辑删除、取消删除、重启持久化、未保存保护、选区/光标纯文本插入与单次撤销。任务、历史和保存查询始终为零，查询会话没有建立。首次沙箱内启动调试通道超时；授权桌面执行后发现 Playwright 精确 label 查找把 textarea 正文计入，改为匹配真实可访问名称的 textbox，全部原断言保留，最终 1/1 通过（10.6 秒）。DOM 证据、原失败日志和最终截图均保留于 `.cache/snippets-*`；截图已查看，布局正常。

## Windows 源码桌面与既有回归

最终冻结构建上的完整桌面首轮 24 项中，21 项通过、2 项参数测试失败，百万行旧用例 1 项明确跳过（166.792 秒）。原始日志为 `.cache/p0-parameters-regression/desktop.log`，没有删去失败记录。首个失败在重复参数 SELECT 的 `FIRST_VALUE` 测试别名；九种类型写入和独立观察连接精度检查此前已经通过。别名修正后参数定向 run01 为 3 过、1 失败；新增逐字 SQL 断言证实 Monaco 的模拟 `insertText` 在反斜线模式模板末尾补了一个单引号，失败发生在执行前。

参数模板输入改为真实 Ctrl/Meta+V 粘贴，保存并恢复剪贴板文本，仍逐字核对原 SQL（只规范 Windows CRLF）。run02 全部 4/4 通过，Playwright 25640.821 毫秒；保留动态 NBE、全部非法类型、部分提交和事务语义断言，不通过 model/IPC 替换编辑器输入。运行时代码未为修复这些测试改变。正向和负向表单、选区优先、重复值、模态快捷键、真实写入和参数隐私均实际验收。

事务错误后的状态截图与观察连接共同确认：服务器重复键错误后显示“事务状态需核对”，提交/回滚可用；同会话能看到一条未提交行，独立观察连接仍为零。成功 SELECT 后实际协议恢复“事务进行中”，最终明确回滚后两边均为零。任务、历史、设置、保存查询、SQLite 原始字节及快照 SQL 检查没有填写的随机假秘密或其展开 Hex。参数表单及事务截图已经查看。

五基线既有集成回归全部完成：MySQL 各 30 通过、5 跳过；MariaDB 各 31 通过、4 跳过，总计 **152 通过、23 明确跳过**。跳过项包含按显式配置隔离的 TLS/SSH、百万行容量及 MySQL 不适用的 MariaDB 38 位小数场景。日志和逐批退出码位于 `.cache/p0-parameters-regression/`，此数字不包含上文 85 项参数测试或后文独立 SSH/TLS 测试。

最终源码验证、失败诊断、截图与清理摘要为 `.cache/p0-parameters-corrected/validation.json`、`run02-paste-input/` 和 `cleanup.json`。13384 的随机 E2E 库、项目进程、本轮临时目录均为零；13 个更早的临时目录保留，不能把本轮清理说成整个电脑没有旧目录。六个远程专用实例及网络保留供安装验收，本轮没有清理它们。

## 本机 Windows 真实安装验收

提交 `e05330986274e42f35229348cdbf8f94378d0c13` 的 0.3.0 NSIS 已构建并真实安装到独立临时目录，全部 **24/24** 桌面用例通过（154.590 秒），没有跳过或重跑。包含 12 项离线及 12 项实库、新参数四项、文件及结果导出、对象设计、凭据重启解密和百万行分页。系统加密分支实际执行；百万行仅呈现当前页并核对第 1000 页末行，未将全表一次性载入网格。

本机安装包为 `DBArk-0.3.0-win-x64-unsigned.exe`，137431946 字节，SHA256 `b61edde2c22651c9708ce9ff39ae5c8cfa881f72308733fffa537e279078c92e`。测试前锁定摘要并拒绝已有安装，使用本次目录的真实卸载器完成卸载，安装注册及测试安装临时目录残留为零。测试证据 `.cache/local-v0.3.0-install-validation{.log,.json,-results.json}` 和同名截图目录。

这是本机产物，不能以它替代公开附件。对应提交的 [main 原生 CI 38448619652](https://github.com/zhao-yc/DBArk/actions/runs/38448619652) 已全部成功：三个平台各 12 项离线源码及 12 项真实 NSIS/DMG 安装测试通过，实际进入系统加密分支。源码另外 12 项内网实库明确跳过；不能据此认定 macOS 的参数实库 UI 已验。Windows 源码/安装分别 42.5/46.5 秒，arm64 为 1.0 分钟/59.7 秒，Intel 为 1.5/1.2 分钟；Mac 对应 disk7/disk4 实际弹出，安装测试日志确认临时目录清理。只读日志摘要 `.cache/p0-parameters-ci-e053309-summary.json`，没有额外登录托管 runner 检查。

公开标签的发布工作流、附件独立下载校验及公开 Windows 包安装验收仍须实际完成后追加。main 构建产物与之后公开附件分别记录，不能互相替代。

## 服务器与资源范围

所有 Docker 命令执行前均确认 `server-200` 实际主机名为 `Server-200`、地址包含 `192.168.31.200`、`/var/run/docker.sock` 为真实 Unix socket，并显式使用 `docker --host unix:///var/run/docker.sock`。没有在本机运行 Docker，也没有修改业务容器或共享缓存镜像标签。

创建前核对五个目标端口无监听、五个精确容器名及目标网络不存在。新建网络为 `dbark-p0-parameters-01a13412`，ID 为 `6b82e79ed841a73099ceb5014b154bda91e56b0f888bbd49c94af362a1e702a0`，已核对成员数为 5。网络和每个容器均设置双标签：

- `com.dbark.development=01a13412`
- `com.dbark.batch=p0-parameters-20261014`

所有连接地址均为 `192.168.31.200`；以下版本来自实际 mysql2 只读连接的 `VERSION()`。

| 精确容器名 | 端口 | 实际版本 | 镜像标签 |
| --- | ---: | --- | --- |
| `dbark-p0-parameters-mysql57-01a13412` | 13357 | `5.7.44` | `dbark-p0-parameters-mysql57:01a13412` |
| `dbark-p0-parameters-mysql80-01a13412` | 13380 | `8.0.46` | `dbark-p0-parameters-mysql80:01a13412` |
| `dbark-p0-parameters-mysql84-01a13412` | 13384 | `8.4.11` | `mysql:8.4` |
| `dbark-p0-parameters-maria1011-01a13412` | 13310 | `10.11.19-MariaDB-ubu2204` | `dbark-p0-parameters-maria1011:01a13412` |
| `dbark-p0-parameters-maria114-01a13412` | 13311 | `11.4.13-MariaDB-ubu2404` | `mariadb:11.4` |

每个容器的 Docker 实际限制均为 768 MiB 内存（805306368 字节）和 1.5 CPU（1500000000 NanoCPUs）。五个服务端均实际读取到：`innodb_buffer_pool_size=134217728`、`performance_schema=0`、`log_bin_trust_function_creators=1`、`event_scheduler=ON`、`max_connections=40`。函数和事件开关仅用于本批次专用实例，没有调整业务数据库。

## 匿名卷与后续定向清理依据

以下卷均由本批次容器自动建立，挂载到 `/var/lib/mysql`。销毁前仍须重新 inspect 并确认不存在其他引用，不能仅凭本记录直接删除。

| 实例 | 容器 ID | 匿名卷名称 |
| --- | --- | --- |
| MySQL 5.7 | `4718e6a259bf4bf6f29d05fb25475c923fc4ec0b6a87eca5ea8a726807dacbea` | `869c7d3f2561e004ad35446bb05736ae77921b64750f3f04911d993f54cc8e98` |
| MySQL 8.0 | `ee94177b2f09ff4f5b48551e69b32d9bf2a89f118f94a060f9c0569ba38d981a` | `7fce18b4d0f291b8056e3834f356b25fa1299ae63c429ed49039678478085533` |
| MySQL 8.4 | `b07ab0cfa832f45b14b32a4befa4251b3bbb3aa6277261b3c8e779463f0b7052` | `562de7fc2978429f1c6416df4bc5b981a01a2f09637e8d065da7ffe657c506a6` |
| MariaDB 10.11 | `3e3cd19a73e065f15437b70de99b7f0f13c93e7d7ddb815b25776b9830873a49` | `ec5b5f70ab4f770f32347d2acf8753fb979fb5af1dc93626b701eba3adc94e02` |
| MariaDB 11.4 | `77df3519cfc99c6d9ba369f43605c7ae33876f5a45d10ed52b895d9cf4a61b31` | `b03c30decc3c6d297e884af0f01f735e86ae8ce72b56461665e228e88f26a695` |

## 镜像与凭据核验

MySQL 8.4 和 MariaDB 11.4 复用缓存，镜像 ID 分别为 `sha256:b3b90af2a6552ae30c266fdb7d5dd55f3afb72404bb78d37fe8a23eb857fd3fb`、`sha256:1292844148b311e4ed4300022a996d39083f415a963e970cf47cad1b3b18e3a6`。没有拉取覆盖或重新标记这些共享缓存。

另外三个实例复用上轮已经校验来源的官方 linux/amd64 归档。重新核对本机及服务器 tar SHA256，仅改写 RepoTags 为本批次项目标签；config 和所有镜像层逐个核对改写前后字节摘要相同。导入后通过 `docker image save` 再次核对实际 config 字节摘要。

| 归档 | tar SHA256 | 官方 config SHA256 | 镜像层数 |
| --- | --- | --- | ---: |
| MySQL 5.7 | `e2542be5442243185ff8d0316a6bcf27d888ed20f36f70aa8e919171c4a7f410` | `5107333e08a87b836d48ff7528b1e84b9c86781cc9f1748bbc1b8c42a870d933` | 11 |
| MySQL 8.0 | `4f84b0a464135b6e4d389b1de05b536f6cea7c0f097baa9206a039e2682a8433` | `6cd09145362dfe6831b14545de3d5fd6cc75c37cfd6ef8561429c1fc73518b39` | 11 |
| MariaDB 10.11 | `a2775624cb7b77b091f34f87a9736b87e57b30e2a858602e9f4d89eb726bb2e7` | `41096ae9913468679bb5e05bbc19f44edcaf0eae45d67fcde224ffdeda9d3a1f` | 8 |

复用 `.cache/dbark-test.env`、`.cache/dbark-container.env` 中已有并已在 E 盘备份的隔离凭据；不在日志或仓库输出秘密，本轮没有生成需保留的新密钥或证书。服务器临时目录 `/tmp/dbark-p0-parameters-01a13412` 及其中的 env、上传/改写 tar、启动及验证脚本均已删除。本机被忽略的凭据、TLS 材料和官方归档继续保留。

## 只读就绪证据与限制

五个实例连接成功。创建时通过普通 mysql2 连接读取的会话初值为：`session_track_schema=ON`、`session_track_state_change=OFF`、`session_track_transaction_info=OFF`。各版本 `session_track_system_variables` 默认集合均不含 `sql_mode`，MariaDB 11.4 还包括 `redirect_url`。完整初始 mode/track 值保存在以下独立 Git 忽略日志中：

- `.cache/p0-parameters-environment-20261014.log`：镜像核验、创建、容器 ID、限制、卷和端口。
- `.cache/p0-parameters-readiness-20261014.log`：各实例实际版本、资源变量和会话初值。

上述初值是普通驱动连接的只读快照，不是 DBArk 引擎初始化后的行为结论，也不替代协议修复测试。后续结果必须根据实际执行追加，不复用旧批次通过数。

## 清理状态

**五个容器、五个匿名卷和本批次专用网络当前保留，等待统一测试结束通知后定向清理。** 尚未执行销毁。

清理前须核验实际服务器、socket、精确名字及双标签，检查随机测试库和临时账号；仅删除本批次容器、关联且无其他引用的匿名卷、空网络及无业务引用的三个本批次项目镜像标签。共享 `mysql:8.4` / `mariadb:11.4` 必须保留，其他业务容器与原已退出容器均不在操作范围。

## SSH 与严格 TLS 追加验收

2026-10-14 在现有五个实例保持运行的前提下，新增第六个独立 TLS 实例。已有五实例未重启，业务容器未作操作；以下结果独立于前述环境就绪检查。

| 连接方式 | 实际数据库 | 核心套件 | 类型参数套件 | 合计 |
| --- | --- | ---: | ---: | --- |
| SSH 私钥隧道，目标 13384 | MySQL 8.4.11 | 14 通过、2 个 TLS 专属项跳过 | 17 通过 | 31 通过、2 跳过 |
| 严格 TLS，目标 13484 | MySQL 8.4.11 | 15 通过、1 个 SSH 专属项跳过 | 17 通过 | 32 通过、1 跳过 |

实际运行 `engine.integration.test.ts` 和 `engine-parameters.integration.test.ts`，两种连接方式的全部类型参数用例通过，覆盖动态模式/跟踪变更、ROW_COUNT/FOUND_ROWS/警告不被内部状态读取覆盖、参数写入失败不重放、事务及取消后停止后续语句等边界。没有为这次验收修改运行时代码或重新构建。

SSH 配置来自 `ssh -G server-200` 的实际解析结果：目标 `192.168.31.200:22`、用户 root、既有专用 Ed25519 私钥。主机指纹通过已经认证的 SSH 会话读取服务器公开 Ed25519 主机密钥后核对，再交给 DBArk 严格验证；没有打印私钥或密码。错误主机指纹负例实际通过。本次未新增密码 SSH 或 mTLS 验收。

TLS 正向使用 IP `192.168.31.200` 和已有 CA，同时开启 `rejectUnauthorized`、`verifyIdentity`。服务端启用 `require_secure_transport=ON`，实际连接读取到 TLSv1.3、`TLS_AES_256_GCM_SHA384`，没有降级为明文。两个负例均实际通过：缺少受信 CA 的连接被拒绝；解析到同一 IP、但不在证书 SAN 内的 `deve-server.yinzon.com` 被身份校验拒绝。负例通过来自证书错误断言，不是网络不可达。

复用 `.cache/dbark-test-tls` 中已在 E 盘备份的 CA、服务端证书及私钥，没有生成新密钥。重新核验 CA 签名和公私钥匹配；证书 SAN 为 `IP:192.168.31.200`、`DNS:Server-200`，有效期为 `2026-10-13 13:13:08 UTC` 至 `2026-11-12 13:13:08 UTC`，本次在有效期内。仅向服务器传送 CA 公证书、服务端证书和服务端私钥，未传送 CA 私钥。

### 第六实例及证书清理依据

| 项目 | 实际值 |
| --- | --- |
| 容器 | `dbark-p0-parameters-tls-01a13412` |
| 容器 ID | `80c3971f04150892714680dd0eaf3555f4a8e4145dfc84fb85ab1c7249ec173e` |
| 地址 | `192.168.31.200:13484`，创建前已确认无监听 |
| 镜像 | 复用共享 `mysql:8.4` |
| 网络及双标签 | 沿用本批 `dbark-p0-parameters-01a13412`；网络成员现为 6 |
| 数据匿名卷 | `b5ec87d209cf0798656e49d01aff5aa0273cd4c0f25337cc7441e841eb6d0d98` |
| 证书命名卷 | `dbark-p0-parameters-tls-certs-01a13412`，设置本批双标签 |
| 证书挂载 | `/etc/dbark-tls`，容器内只读 |

第六实例同样限制 768 MiB、1.5 CPU、128 MiB buffer pool、performance schema 关闭。证书卷目录属于镜像实际 mysql 用户 `999:999`，目录权限 700、公证书 444、服务端私钥 400。证书卷内容由已核验的精确 Docker volume 路径写入，没有使用持续保留的宿主机传输目录。

临时传输目录 `/tmp/dbark-p0-parameters-tls-01a13412` 中的 env、证书副本、私钥副本及脚本均已移除。TLS 套件完成后独立查询该实例，`dbark_*` 随机库与临时账号残留均为 0；SSH 套件的独立随机库由其清理钩子删除。没有清理或干扰同时使用 13384 的其他验收库。

**第六 TLS 容器、其数据匿名卷和证书命名卷当前也保留，等待最终统一通知清理。** 因此本批当前资源合计为六个容器、六个数据匿名卷、一个证书命名卷和一个专用网络。销毁时需重新检查第六容器和命名卷的双标签、实际挂载及无其他引用，然后一并删除服务器证书卷；本机/E 盘已有秘密备份和共享 MySQL 镜像继续保留。

独立脱敏证据均为本机 Git 忽略文件：

- `.cache/p0-parameters-ssh-tests-20261014.log`
- `.cache/p0-parameters-tls-tests-20261014.log`
- `.cache/p0-parameters-tls-certificate-20261014.log`
- `.cache/p0-parameters-tls-environment-20261014.log`
- `.cache/p0-parameters-tls-readiness-20261014.log`
