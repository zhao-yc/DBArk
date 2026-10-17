# MariaDB 10.11.19 普通新建表：身份与能力前置研究

研究日期：2026-10-17。固定源码起点：`9d2fd9ce8ae09c5a0ad75df884381d0628bc00f1`。员工3在普通独立克隆、分支 `codex/employee3-mariadb-table-create-research-20261017` 编写；未使用工作树。本文只交付源码事实、MariaDB 官方依据和设计契约，不修改运行代码、共享接口、能力开关或现有产品行为。

## 结论与证据边界

**现有普通新建表已经有 MariaDB 路径；本轮没有完成该路径的真实数据库验收。** 不能写成 MariaDB 创建完全未实现，也不能把准确版本研究合同默认关闭解释为现有通用入口禁写。本文建议新增的准确版本合同保持研究态，不能扩大现有能力。

`server_uid` 可以提供网络配置指纹，但官方描述不足以证明它是持久数据目录身份，更不足以作为任意部署的全局唯一标识。把它加入摘要不能弥补跨连接实例身份的证据缺口。若后续验收要求跨 get/preview/apply 可靠区分实例，**本轮尚无足够事实支持直接激活增强后的 MariaDB 合同**。

核证只使用 MariaDB 官方文档。没有连接200或其他数据库，没有访问私料、GUI、SSH、Docker、CI、安装程序或系统剪贴板；没有生成凭据、证书或密钥。官方文档不等于目标服务器、驱动或资源终态实测。

## 固定基线的源码事实

以下位置均相对于固定起点，不是对其他员工分支或未来主线的结论。

| 范围 | 当前实现 | 本研究发现的边界 |
| --- | --- | --- |
| `src/engine/tableCreateTasks.ts` 的 `read` | 读取 hostname、port、server_id、CURRENT_USER、SQL mode、名称大小写、连接编码及准确库目录；**只有 MySQL 分支查询 server_uuid**。身份摘要绑定读取结果、方言、版本及库属性 | MariaDB 不查询 server_uuid 是已有行为；hostname/port/server_id 的组合摘要不自动获得全局唯一保证。哈希不会提高输入事实的身份强度 |
| 同文件 `get/preview/apply` | 各自通过独立任务连接；修订、过期、设计、身份、目标不存在性及可选编码目录重核；不使用替换、自动改名或 IF NOT EXISTS | 没有准确 MariaDB 10.11.19 生产放行 profile；不同阶段不是同一条长期连接，不能用一次 CONNECTION_ID 证明跨阶段实例不变 |
| 同文件 `verify` | 同时核 SHOW CREATE、COLUMNS、表属性与 STATISTICS；MariaDB 默认值走 `mariaDefault`，索引按名字和部件匹配；有外键时另核两套目录 | 普通创建流程没有原生 TABLE_ID 的前后绑定，也未在表属性查询中读取 TABLE_TYPE；定义相同不能证明没有被并发同名重建。成功 ACK 与完整定义已核验是独立事实 |
| `src/engine/metadata.ts` 的 `tableInfo` | MariaDB 从实际会话读模式并解码默认值；读取 TABLE_TYPE、生成列等；部分不透明属性使普通整表设计不可安全重述 | 通用元数据是展示和编辑依据，不是新建表执行授权或物理身份合同，不能将其较宽的映射直接用作准确 P0 放行门 |
| `src/engine/tableCommentRead.ts` | MariaDB 10.11/11.4 选择 INNODB_SYS_TABLES；限制 ASCII 名、Linux、lower_case_table_names=0、单个无分区 InnoDB 基本表；CAST TABLE_ID AS CHAR，逐名核对，多行/错误写入只读原因 | 可作为后续读取设计参考；它属于已有表用途，不能直接假装新表在创建前已有 TABLE_ID。已有正则长度检查也不等于完整 unsigned bigint 上界校验 |
| `src/engine/structureDefinition.ts` | 独立结构会话可去掉隐藏定义模式并设置 quote/编码后复读；MariaDB 同样不读 MySQL UUID | 此规范化不是普通新建表 `read` 的实际流程。不得在设计文档里把二者混写成已经统一准备 |
| `src/shared/tableColumnPatches.ts`、创建 `verify` | 已列出 NO_*_OPTIONS 与 ANSI/DB2/MAXDB/MSSQL/ORACLE/POSTGRESQL/MYSQL323/MYSQL40 等隐藏定义模式；创建流程在后核拒绝这些模式 | 后核拒绝与发送前停链不同。准确 P0 应在发 DDL 前形成明确模式合同，不能等 ACK 后才发现无法完整核验 |
| `src/engine/tableCopyStructureSql.ts` | 另一个用途按其 profile 读取 UUID、GIPK、autocommit、partial_revokes 及授权 | 不能直接复制到 Maria 新建表，把 MySQL 专属变量查询失败转换为安全默认值 |
| `src/shared/tableCreateProfiles.ts` | 仅有准确 MySQL 8.0.46 的追加准备合同，canWrite=false；不接管通用创建 | 本研究不往该共享接口追加 Maria 放行；共享接口由 Root 统筹 |
| `src/engine/index.ts`、创建 `apply` | 独立连接严格收尾；预览一次消费；DDL 发送/完成与资源释放独立；DDL 或关闭未知保留用途锁 | 后续设计必须保留这些边界，取消 ACK、finally 或 UI 超时都不能代替服务器命令终态 |

## MariaDB 官方事实与适用范围

### 版本与实例标识

1. 直接打开的 [10.11.19 发布说明](https://mariadb.com/docs/release-notes/community-server/10.11/10.11.19) 将其列为 2026-08-24 发布的 Stable (GA)。检索摘要仍可能停留在10.11.16，本文以该直接页面为准；未查询任何实际服务器版本。
2. [系统变量文档的 server_uid](https://mariadb.com/docs/server/server-management/variables-and-modes/server-system-variables#server_uid) 记录它在10.11.9引入，为全局、非动态字符串，按某个网络接口的 MAC 地址和监听 TCP 端口计算 Base64 编码 SHA1，用于辨认错误日志来源。因此标准10.11.19按文档应具备该变量；发行变体和实际返回形状仍未测。
3. **推论**：相同 MAC 与监听端口可得到相同输入；更换接口或端口可能改变输入。该值不能证明数据目录未被复制、替换或恢复，也不能证明代理后端没切换。这里是依据算法作出的限制推论，不把具体容器场景当已复现实验。
4. [复制变量的 server_id](https://mariadb.com/docs/server/ha-and-performance/standard-replication/replication-and-binary-log-system-variables#server_id) 是复制拓扑和 binlog 来源标识，由配置管理，默认1、可动态更改；拓扑内要求唯一不是任意部署的全局唯一保证。hostname、端口、客户端连接配置ID同样不能单独或仅经哈希就提升为实例身份证明。
5. [10.11 与 MySQL 8.0 变量差异表](https://mariadb.com/docs/release-notes/community-server/about/compatibility-and-differences/system-variable-differences-between-mariadb-and-mysql/system-variable-differences-between-mariadb-10-11-and-mysql-8-0) 明确把 server_uuid 列为 MySQL 专属；但该表注明比较基于 MariaDB 10.11.2 与 MySQL 8.0.34，不能冒称逐变量实测过10.11.19。
6. [UUID() 文档](https://mariadb.com/docs/server/reference/sql-functions/secondary-functions/miscellaneous-functions/uuid) 描述每次调用产生新的值。因此 SELECT UUID() 不能拿来重读持久实例ID；客户端临时随机ID也只能标识一次任务，不能补服务器身份。UUID_v4/v7 的更高版本支持也不是10.11的前提。

### 原生表身份与权限

[INNODB_SYS_TABLES 文档](https://mariadb.com/docs/server/reference/system-tables/information-schema/information-schema-tables/information-schema-innodb-tables/information-schema-innodb_sys_tables-table) 规定读取需要 PROCESS 权限；TABLE_ID 是 unsigned bigint 的 InnoDB 表标识，NAME 表示库/表名或内部系统表名。它证明的是某个 InnoDB 字典中的表编号，**不是跨服务器全局表UUID**。该页没有为所有重启、备份恢复、表重建和 ALTER 算法承诺编号生命周期，本轮不补造这些保证。

未来读取沿用准确方言目录选择与 CAST AS CHAR，拒绝转换为 JavaScript Number。纯契约要求十进制规范字符串、`1 <= BigInt(id) <= 18446744073709551615n`、恰好一行、NAME逐字一致；分区、临时对象、非普通基本表及未知名称编码一律不进入首片。普通ASCII/Linux/lower_case_table_names=0只是候选约束，仍须实际验证。

PROCESS 的需求不能变成自动 GRANT、默认使用管理员或读不到就降级按名称匹配。若必要目录无权读取，准确增强合同停链。新建前应证明名字未占用；新建后才能取得新表ID。后核前后读到同一ID可缩小窗口，仍不能消灭“ACK后、首次读取ID前已被同定义替换”的窗口；禁止据此宣称对象归属绝对已证明或自动 DROP 补救。

### 主键、GIPK 与 MySQL 专属变量

[主键文档](https://mariadb.com/docs/server/architecture/server-constraints/primary-key-constraints) 描述：没有显式主键或合适 NOT NULL UNIQUE 时，InnoDB 使用内部 GEN_CLUST_INDEX 与48位 DB_ROW_ID。[innodb_force_primary_key](https://mariadb.com/docs/server/server-usage/storage-engines/innodb/innodb-system-variables#innodb_force_primary_key) 则是拒绝缺少合适主键/唯一键的全局动态布尔约束，默认关闭。二者均不能作为 MySQL GIPK 的可见生成列或开关语义。

本轮官方变量目录和差异表没有提供可直接采用的10.11.19 `sql_generate_invisible_primary_key`、`show_gipk_in_create_table_and_information_schema`、`partial_revokes` 合同。**搜索无结果不证明所有版本绝不存在。** 最小候选不向 Maria 发送这些 MySQL 用途探测；记录“本研究不适用该 MySQL 合同”，不伪造 gipk=0、partialRevokes=0 或 showGipk=1。若未来代码误发并收到未知变量错误，必须停止，不能吞错后继续。

首片建议要求用户设计已含显式普通主键；不自动添加隐藏主键，不修改 innodb_force_primary_key，不把内部行ID当可编辑列或跨表身份。[INVISIBLE 列](https://mariadb.com/docs/server/reference/sql-statements/data-definition/create/invisible-columns) 的存在也不能推导出 GIPK 支持；生成列、隐藏列和自动补列均不纳入该最小候选。

### SQL mode 与创建后定义

[SHOW CREATE TABLE](https://mariadb.com/docs/server/reference/sql-statements/administrative-sql-statements/show/show-create-table) 明确说明 NO_TABLE_OPTIONS/NO_FIELD_OPTIONS/NO_KEY_OPTIONS 及部分模拟模式会省略 MariaDB 属性，索引显示顺序也可不同于输入。[SQL_MODE](https://mariadb.com/docs/server/server-management/variables-and-modes/sql_mode) 具有会话与全局范围；[CREATE TABLE](https://mariadb.com/docs/server/server-usage/tables/create-table) 说明引擎替换、警告和 OR REPLACE 等行为。不能把 SHOW 文本与原SQL逐字相等作为唯一证据，也不能为了核验擅自 SET GLOBAL 或替换已有对象。

准确 P0 候选采用以下有意收窄的研究策略，不修改当前通用路径：

- 在独立结构会话读取并绑定实际模式、autocommit、编码、quoteShowCreate、lower_case_table_names。模式使用显式白名单；空、未知、隐藏属性或模拟模式发送前拒绝。初始候选只审默认四项 `STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION` 的集合，不扩到任意词法组合。NO_BACKSLASH_ESCAPES、ANSI_QUOTES 即便通用词法已支持，也待独立样本后再追加。
- 不删除原模式再假称保持原语义。若未来确需调整独立会话，必须另列准备语句、前后完整事实及严格关闭证据；不得影响已有查询标签。SQL mode、编码或相关能力变化令旧预览失效。
- 普通 InnoDB、无分区、明确字符集/排序规则、普通显式主键，先用 INT 与受限 VARCHAR 的可控文字默认值；外键、生成/隐藏列、表达式/前缀/特殊索引、系统版本表、序列、CREATE SELECT/LIKE/OR REPLACE 暂不进入首片。AUTO_INCREMENT 与其他类型分开取样，不能宣称通用设计器因此缩限。
- 后核必须组合实际 BASE TABLE/InnoDB 属性、SHOW、COLUMNS、STATISTICS及原生ID，核引用/NULL/文字默认、列顺序、索引部件、注释和编码；未知属性、额外列或索引、预算截断、警告未解释均不能发布完整核验成功。Maria默认值解码和索引规范化沿用现有能力并取准确样本验证，不把字符串默认值 `NULL` 混同 SQL NULL。

## 最小纯契约（设计，未接线）

本节是供 Root 审查的类型和状态约束，**不是实现文件或可执行适配器**。不提供数据库连接、凭据输入或真实回调，避免新增另一路执行入口。

```ts
/** 必要事实不接受“不适用”，错误不得补成默认值。 */
type RequiredFact<T> =
  | { kind: 'known'; value: T }
  | { kind: 'unknown'; reason: 'version' | 'shape' | 'permission' | 'variable' | 'transport' | 'identity' };

/** 只表示静态决定不采用MySQL合同，不描述任何Maria变量的实测值。 */
type MysqlContractNotUsed = { kind: 'not-applicable'; contract: 'mysql-only-contract-not-used' };

/** 网络指纹不冒充持久实例身份；本轮无法构造跨连接可靠的实例证明。 */
type MariaIdentityResearch = {
  networkFingerprint: RequiredFact<string>;
  mysqlGipkContract: MysqlContractNotUsed;
  persistentInstanceIdentity: { kind: 'unproven' };
  state: 'research-only';
  canWrite: false;
};
```

类型中的 not-applicable 只能由审定的准确方言合同静态决定，且仅用于明确不采用的 MySQL 合同；不能用于 server_uid、权限、模式、库目录、实例身份、TABLE_ID 等必要事实。用户输入、端口、环境开关、异常代码或缺行均不能构造该分支；它不等于 capability=false，也不能令总体可写。

| 输入或阶段 | 必须得到的判断 | 禁止的后续行为 |
| --- | --- | --- |
| 标准10.11.19且读到非空 server_uid | 网络指纹已知，持久实例身份仍未证明 | 仅加哈希便签发跨连接写权限 |
| hostname/server_id/port 全相同，甚至 TABLE_ID 相同 | 仍无法排除克隆或其他实例 | 以相同摘要认定同一全局实例 |
| 精确版本以外、发行版本来源不明 | 研究合同不匹配，停链 | 用泛10.11或端口推断准确能力 |
| 必要变量未知、权限不足、空/多行、返回形状不符 | unknown，保留有界原因 | catch后填空、0、false或默认安全状态 |
| MySQL合同静态不适用 | 不发送对应变量SQL，保留不适用标记 | 使用不适用标记绕过实例/模式/目录门 |
| get/preview/apply 之间断连、重连或配置修订 | 原预览不能延续所缺失的身份保证 | 自动换连接、重试旧DDL或延用旧token |
| 目标不存在的预查通过 | 仅为预查事实，CREATE仍裁决并发占用 | IF NOT EXISTS 或将已有同名对象当本次成果 |
| DDL已发送、ACK未知 | 已发送且结果未知，保留锁和现场 | 自动重放、自动改名、自动删除 |
| ACK成功，模式/定义/ID后核失败 | 完成事实保留，definitionVerified=false | 报未发送、报完整成功或重放 |
| 命令或strict close未终态 | 资源未知，停后链 | 用取消ACK、finally或本地句柄消失证明远端结束 |

## 可实施建议及暂缓项

有足够稳定依据的最小建议是：**先完善准确版本的只读事实说明与纯失败矩阵，继续不接写回调。** 不改 Root 的共享接口；若后续获授权实施，可在准确合同中区分 networkFingerprint、实例证明、表ID与会话事实，不再用一个 identity 字符串混淆强度。必要探测失败保守退出，现有通用功能是否调整由 Root 单独决定。

持续持有同一条不可自动重连的实际连接，可为一次任务提供有界会话连续性，但当前 get/preview/apply 关闭后另连的结构不满足此前提；CONNECTION_ID 本身也不是全局持久实例ID。改成跨用户确认长期占用连接涉及取消、超时、锁与资源预算，是另一个设计决策，本轮不实现、不宣称它解决全局身份问题。

管理员登记的实例ID或证书绑定也不能无条件补洞：DB内登记值可能随备份复制，TLS证书可能被复制或终止于代理。若产品决定接受受管部署的登记、轮换、克隆作废和后端绑定假设，应另写威胁边界及证据，由 Root 审定；不默认建标记表、不生成证书、不要求扩权，不为本任务搭建通用身份框架。

因此，“直接把 server_uuid 换成 server_uid”“无GIPK就当关闭”“nativeID相同就认同一实例”“变量查询报错就回退旧路径”均不是本轮推荐的实现。

## 后续验收必须补齐（本轮未执行）

1. 单独授权真实环境后，在任何隔离DDL之前，核目标、原始账号输入、TLS/代理边界、实际方言、准确版本/发行后缀、OS和名称映射。不能从10.11.19官方发布页推导目标安装事实。
2. 只读取得实际 server_uid 形状、相关系统变量、CREATE/SELECT/PROCESS可见性、目录字段及驱动返回类型；拒绝未知，不访问账号表或自动 GRANT。身份缺口尚未接受或补证前，不启动DDL验收。
3. 受控样本覆盖模式隐藏/未知/变化、引号与文字NULL、默认值、字符编码、额外索引、警告、无权限、超预算、多行及unsigned bigint边界。记录来源，不把手写fixture当真实快照。
4. 单独证明重连、同配置不同实例、MAC/端口变化、克隆/恢复及代理后端变化的处理策略；证据不足则保留研究态。表ID在同名重建、TRUNCATE、不同ALTER算法及重启后的实测不能合并成一句“永远稳定”。
5. 正式验收只在归属清楚的隔离资源内核一次CREATE、并发占用、ACK未知、后核失败、取消与strict close未知；未知不得继续后链或以清理冒险补救，不读取系统剪贴板。GUI、真实连接和生产部署都需要独立授权和证据。

## 本轮交付检查

本轮仅增加本文。检查固定起点、普通克隆分支、工作区与远端；核源码引用和官方链接，执行 `git diff --check` 并核对差异只有本文件。没有运行产品、测试驱动、GUI、数据库、Docker或CI；文档设计尚未接线，因而不声称测试通过或兼容性已验收。
