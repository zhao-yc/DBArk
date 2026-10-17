# B01 整库备份准备首片

## 本次交付与边界

基线 `8c6240abc5bf4c30af4846c5bbbdb06ae2e0cdf3`，普通独立克隆分支 `codex/employee3-database-backup-first-stage-20261017`。M02 的固定提交及证据留在原分支，本分支没有混入。

本次新增独立契约、有界准备计划器和真实 React 准备向导。用户可以选择连接/数据库/管理员配置的工具，检查完整对象及阻断项，确认整个实例的写入影响，选择文件令牌，生成有期限的计划。界面明确显示“尚未执行备份”，没有伪执行按钮。App、main、engine/index.ts、connection.ts、共享 CommandMap、已有导出协议、依赖及版本均不修改，正式入口及端口由 Root 接线。

**本次没有实现或验收真实 dump、归档写入、归档读取、恢复或生产可用备份。** 后续执行器、流式归档检查与恢复预检继续独立实现，不能将准备页、测试套件摘要或一份表导出计作 B01 完成。

## Root 已定案的路线

单个 `.dbark-backup.zip`，ZIP STORE，只准两个固定条目 `dump.sql` 和 `manifest.json`。原生 SQL 字节不经过文本重编码、数字解析或 SQL 改写；manifest 可在 dump 后写入，记录原始 dump 的字节数/SHA256、精确源版本、工具可信套件身份、完整对象范围及一致性事实。整个容器通过既有 AtomicFile 的单一提交界线发布，不做 SQL 与 sidecar 两文件提交。`run` 返回的 `bytes/sha256` 指整个已提交归档；manifest 的 `dump.bytes/dump.sha256` 指原始 SQL。直到实际恢复验证，统一 `restoreVerified=false`。

第一准确组合为 MySQL 8.4.11；MariaDB 11.4.13 保留为同一首阶段的独立待验证组合。计划器默认关闭 `maria11413Validated`；测试中打开只代表合成证据策略，不代表实际 MariaDB 已验证。MySQL 5.7/8.0、MariaDB 10.11 是后续组合，未验证不能标支持。

数据库对象范围包括数据库定义、全部表及全部数据、视图、触发器、过程、函数、事件；表内索引/约束随完整定义一起保留。缺定义、任一类别可见性未知、权限未知、未验证引擎及外部依赖都会指出并阻断，不用枚举到的可见表数证明整库完整性。源对象上的额外原定义/路径字段不透传到 renderer。

## 一致性与权限

官方原生 `--lock-all-tables` 路线在整个 dump 期间持全局读锁，并与 single-transaction 路线区分；MySQL 的 `--single-transaction` 不能覆盖非 InnoDB 数据和并发 DDL。对象类别须显式包含 routines/events/triggers，相关定义可见性及权限另证。[MySQL 8.4 mysqldump](https://dev.mysql.com/doc/refman/8.4/en/mysqldump.html)、[MariaDB mariadb-dump](https://mariadb.com/docs/server/clients-and-utilities/backup-restore-and-import-clients/mariadb-dump)

MySQL FTWRL 需要 `FLUSH_TABLES` 或 `RELOAD`，影响所有数据库；MariaDB FLUSH 文档列出 `RELOAD`。锁等待和持锁都会影响业务，不能将所选单库误说成只影响该库。[MySQL FLUSH](https://dev.mysql.com/doc/refman/8.4/en/flush.html)、[MariaDB FLUSH](https://mariadb.com/docs/server/reference/sql-statements/administrative-sql-statements/flush-commands/flush)

准备阶段只接收准确版本的锁能力声明与当前权限证据，`phase=capability-only`、`actualLockHeld=false`；不会要求预先加锁，也不会把能力声明当作 run 已持锁。DDL 覆盖逐类别记录，未知即阻断。执行器必须用实际同 owner 的锁/子进程生命周期证明持锁窗口，并在该窗口内重新确认实例、权限和全对象清单。锁能力声明不能用前后清单相同代替，也不能把清单前检当作已处于原生工具的锁会话。

初始等待预算 30 秒、持锁预算 120 秒；这些是必须停止并核释放的预算，**不是承诺业务只会等待这么久**。实际有界加锁、取消和未知状态由 Root 私有资源 owner 接线；任何不满足条件均须在发布文件之前失败或保留未知。

## 私有端口与令牌

`src/shared/databaseBackup.ts` 定义私有请求和准备服务，未加入共享 IPC：

```text
inspect({connectionId,database,toolId,taskId}) -> inspectionToken、准确组合、完整预检清单、阻断项
prepare({inspectionToken,fileToken,acknowledgeGlobalWriteBlock:true,taskId}) -> planToken、期限、范围、输出摘要
run({planToken,taskId}) -> 单一提交事实、归档字节SHA、资源终态，restoreVerified=false
inspectArchive({fileToken,taskId}) -> 完整性、兼容性、manifest，restoreVerified=false
prepareRestore/runRestore -> 独立恢复计划及结果，不复用备份准备按钮执行任意 SQL
```

Root 为每个窗口/调用者创建所属的 `DatabaseBackupPlanner`，不能将其令牌映射跨窗口共享。私有 `DatabaseBackupPlanPorts` 负责源检查、可信工具解析、文件令牌检查、取消事实、时钟和随机令牌。证据字段不能从 renderer 请求直接填写；Root 必须限制采集本身的行数/字节/耗时，并提供已脱敏的错误，不能先无界加载再依赖本计划器拒绝。

工具端口必须从 Root 受控注册返回工具 ID、家族、准确版本、完整套件期望/实际 SHA256、注册修订及私有租约。版本输出、任意 exe 路径或“注册成功”布尔值不能自行成为可信来源；renderer 只拿工具摘要，不能提交路径/凭据/任意 argv。后续 runner 固定 `shell=false`；argv、env、日志均不得含明文密码，原始 SQL 不记录日志。凭据传递和清理方式由 Root 的原生适配器落实，不能用环境变量密码凑通。

输出端口检查本窗口、本用途、`.dbark-backup.zip` 格式、可写授权和修订，只向计划器返回不透明租约与显示名称。准备阶段不创建文件，也不提前保留数据库锁。`bindings()` 只供私有执行器读绑定信息，**不是领取执行权**；run 下一片仍须增加计划单次领取、任务归属、源/工具/目标修订再检查与目标互斥，未知任务不自动重放。

容量边界：2 个同时准备任务、8 份有效检查、8 份有效计划；清单 10000 个对象/2 MiB 元数据，准备报告 4 MiB；检查/计划最长 120 秒；归档计划预算 10 GiB。超量整批拒绝，不能截断后叫完整备份。输出授权等待跨越检查过期时拒绝，不登记迟到计划。所有返回对象均与私有记录隔离。

向导在首次 await 前登记 owner；表单接纳同步撤销旧检查、文件及计划。取消确认与操作结算分别跟踪：取消未知时即使检查晚到也保留占用，明确再次确认后才允许继续，关闭不提前卸载。卸载只请求取消，不能宣称资源已释放；Root 私有 owner 必须保留实际未知资源。

## 后续执行/归档/恢复必须验收

1. run 在已领取计划的同一 owner 下固定原生套件身份、源实例、权限、全对象范围及输出目标；完整 dump 逐块传递到 ZIP/AtomicFile，按背压计算 CRC 与 SHA，不加载完整 SQL 或 manifest，不改写 SQL。提交前核完整退出及所属资源终态，取消后不发布半成品、不覆盖旧文件；未知保留诊断和归属，不自动再跑。
2. inspectArchive 流式检查两个固定条目，拒绝重复/额外条目、路径穿越、链接、压缩炸弹、截断、错误版本/计数/摘要、缺对象、未确认一致性证据。manifest 使用有界流式解析；包 SHA 正确只说明文件完整，不证明可恢复。
3. 恢复预检限定同家族同版本的隔离实例和同名空/不存在库，核完整对象权限、DEFINER/账号、跨库依赖、事件状态及客户端兼容性。不能正则替换库名、删 dump 头、自动覆盖原库或自动补 DROP。恢复失败标部分，不自动重试；恢复后核对象清单/定义、行数与精度/BLOB/NULL 等数据完整性，并记录实际证据后才允许 `restoreVerified=true`。

## 本次验证

```powershell
node node_modules/vitest/vitest.mjs run tests/unit/databaseBackupPlan.test.ts tests/unit/databaseBackupDialog.test.tsx
node node_modules/typescript/bin/tsc --noEmit
```

纯逻辑 16 项、真实 ReactDOM 6 项通过，共 22 项；类型检查退出码 0。首轮 React 失败来自内存 DOM 没有原生文本输入的默认 `type=text`；只修本测试端口属性后重跑，未降低产品断言。原生布局、键盘、屏幕阅读器及实际数据库均未验。本任务没有重跑 M02、完整套或构建，没有实际 200、产品进程、GUI、原生工具探测/安装、凭据读取、剪贴板或 Docker 操作。CI 以推送后的固定提交查询为准，不继承其它分支的绿色结果。
