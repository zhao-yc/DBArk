# M02 两表结构比较接线与 SQL 预览

日期：2026-10-15。基线：`712e511b86e768eb2fd81cc963e783978dfb8ef5`。复用只读模块提交：`267ffa89d58250ac0364b72ae12b82dbf1fd716d`。本切片可以通过真实工具栏使用，但仍是部分 M02，未发布，不能视为实际同步已完成。

## 实际入口与方向

工作区工具栏点击“结构比较”，明确选择源、目标连接，填写两侧数据库和基本表名，再点“比较结构”。支持同一连接或不同连接的两张已有基本表。源 → 目标；“新增”表示目标缺少，“删除”表示目标多出。交换方向或编辑任意目标输入立即撤销旧结果和预览。

字段、主键/索引和出向外键按名称精确配对，不推断重命名；名称大小写不确定、目录缺失、权限不足、未知定义均不能视为相同。原始片段、表尾和未覆盖范围可以展开查看。未覆盖表选项语义、分区、CHECK、触发器、入向外键、表创建/删除及多表批量匹配。

勾选差异后点击“生成 SQL 预览”，在窗口核对 SQL、阻止原因和风险说明。“保存 SQL 预览”通过原生保存对话框保存 UTF-8 `.sql` 文件，复用已有原子文件写入与路径令牌；不会执行 SQL。导出内容含明确双方身份、快照有效时间、方向和人工核验说明。

## 任务与资源边界

- 正式公开命令为 `schema.compare`、`schema.comparePreview`、`schema.compareRelease`；取消复用 `query.cancel`。共享严格校验拒绝客户端凭据、SQL、配置修订和未知字段。
- 主进程分别从存储解析两侧可信配置，在投递前检查两侧配置锁并注入修订。引擎同时登记两侧配置使用期，源侧正在读取时也不能替换目标的地址或认证配置。
- 一个公共比较任务串行读取并关闭源、目标独立短会话，不借用查询标签的事务、临时表或 SQL 模式。每侧 SHOW CREATE/目录双读并核对完整定义；两侧不构成跨服务器事务快照。
- 最多 2 个活动比较，8 个短期快照，缓存合计 32 MiB。每侧原定义最多 2 MiB、结构项最多 4608，报告最多 12 MiB，单次预览最多选择 100 项。读取并发每个比较为 1，全局最多 2。
- 快照有效期 2 分钟。配置修订变化、断连、主动释放或退出后，旧快照不能生成新预览。预览仍仅代表读取时的定义，执行前目标及父表再次检查和可靠失败状态属于后续同步前提。
- 任意一侧关闭会取消整个公共任务。取消必须等待 KILL 后原命令真实终态和严格关闭，取消控制失败保持失败事实；不会把 KILL ACK 当成任务结束。任务记录只保存固定只读概要，不落盘默认值、注释、定义、SQL 或原始错误。

## SQL 预览支持范围

在同方言、同主次版本、相同 SQL 模式、相同实际字符集，且除运行时自增计数外原表尾一致、没有未知投影时，支持普通字段新增、仅默认值/注释的字段修改、普通/唯一/主键新增和明确删除出向外键。当前外键新增因未核验目标库完整名称可用性而阻止生成，不能以不同连接或服务器代替名称可用性证明。默认值与微秒值直接保留服务器原定义，不经 JavaScript 数值或日期转换。

新增字段必须有已存在或已确认生成的前置字段，索引必须引用最终可用字段，外键必须有明确支撑索引。当前可生成项按删除旧外键、字段、索引的依赖顺序排列。任一所选项存在冲突、不支持或未确认时，整批 SQL 全部撤回；不会保留排在前面的删除语句。被阻止的新增项不能成为后续 SQL 的依赖；不会自动映射父库/父表或依赖服务器隐式创建外键支撑索引。

字段删除、类型/可空性/顺序变更、自增或生成等特殊字段、索引删除/重建、外键变化、跨库父引用搬运、跨方言/主次版本，以及未知表选项等明确列入未生成项。删除外键标为破坏性操作。预览提醒 ALTER 的隐式提交、锁表/重建表和多语句无法整体回滚；不声称已验证父表权限、已有数据、入向外键或全量同步依赖。

## 首切片验证（2026-10-15）

全部命令只在指定普通克隆执行，使用其独立锁文件依赖与 Electron 运行时。没有本机 Docker、业务库读取或生产部署。

```powershell
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vitest/vitest.mjs run schema-compare main-column-patches validation engine-structure-late-cancel
node scripts/build.mjs
node node_modules/@playwright/test/cli.js test tests/e2e/schema-compare.spec.ts
```

专项及关联回归：12 文件、95 项通过；完整单元回归：120 文件、2274 项通过；类型检查通过；源码构建通过（现有依赖纯注释和大包体积警告）。离线 Electron 3 项通过，使用回环临时端口的 MySQL 文本协议夹具，生产 preload、主进程校验、引擎路由、mysql2 驱动、比较、SQL 预览和原子保存均实际运行；只替换协议服务端与原生保存路径回答。另验读取中关闭、真实驱动连接释放及取消权限不足保持失败状态，截图在本克隆 `test-results`，未提交。

首次全量回归的临时目录原子重命名受 Windows 沙箱 EPERM 限制；沙箱外重新运行完整回归后 2274/2274 通过。离线协议夹具不验证服务器 DDL 语义。原模块历史实库记录也不算本轮接线版本已验。

## 由统筹安排的实库验收

需要 200 服务器上的授权隔离 MySQL 5.7、8.0、8.4，MariaDB 10.11、11.4 实例；另建议 MySQL 8.4 严格 TLS。每轮仅需一对随机隔离数据库、两张子表、一张父表与受限测试用户，不需要业务库权限。已有集成测试负责清理随机库。连接配置、密码及 TLS 文件仅由统筹注入，不复制主目录秘密。

```powershell
$env:DBARK_INTEGRATION_ENABLED = '1'
# 由统筹从授权测试配置设置本轮实例环境；不把凭据写到命令或日志。
node node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts tests/integration/schema-compare-read.integration.test.ts
```

该命令只覆盖历史读取矩阵。新接线的实库界面还需逐项核对：两连接同表配对、大小写、权限不足、读取中 DDL、元数据锁取消、任意一侧断连/配置保存、目标原定义不变和旧查询事务不受干扰。SQL 审查稿需在每个对应隔离内核中人工复核并单独执行验证；本轮不提供执行接口。最终安装包由统筹统一验收。

## 公共文件改动

`src/shared/contracts.ts`、`commands.ts`、`validation.ts` 增加三条公开命令；`src/main/index.ts` 增加两侧可信配置/修订接线；`src/main/taskPrivacy.ts` 增加固定任务概要；`src/engine/index.ts` 增加路由、复合任务取消和关闭接线，内部独立读取支持静默子任务事件；`src/renderer/App.tsx` 仅增加工具栏按钮和对话框挂载。未改覆盖表、全局版本、发行说明、CI 或依赖锁。

## 方言依据

- [MySQL 8.4 外键约束](https://dev.mysql.com/doc/refman/8.4/en/create-table-foreign-keys.html)：外键的有序映射及索引依赖。
- [MySQL 隐式提交语句](https://dev.mysql.com/doc/refman/8.4/en/implicit-commit.html)：ALTER TABLE 的事务边界。
- [MariaDB ALTER TABLE](https://mariadb.com/docs/server/reference/sql-statements/data-definition/alter/alter-table)：字段、索引与外键相关语法。涉及版本差异仍需本轮对应内核验收，不能仅凭文档当作执行通过。

## 2026-10-16：命名空间复审修复

复现旧提交 2fceb2b 的三组 SQL：同连接同库跨表复制外键名称、字段 ID/id、索引 I/i；其中混合选择会出现先 DROP FOREIGN KEY 再执行确定冲突的 ADD。本次保留原始差异配对、名称及 unknown 展示，只在 SQL 生成层拒绝冲突，并在任一所选项未能生成时撤回整批脚本，逐项保留原因。窗口不会允许保存空语句批次。

字段、索引及 InnoDB 外键名按不区分大小写的命名空间检查，不受 lower_case_table_names=0/1/2 对库名/表名的规则替代。本轮支持的 MySQL 5.7/8.0/8.4、MariaDB 10.11/11.4 外键名都是库级唯一；MariaDB 12.1 起改为表级，但不在本轮支持范围。不会自动映射或重命名冲突对象。

每侧双读结束后通过同一可取消短会话执行一条固定 SELECT，校验连接编号并采集实际表名大小写规则。私有服务器摘要使用 MySQL UUID，或 MariaDB 的 hostname/port/server_id，排除账号及保存连接编号；摘要和原始服务器信息不进入公开报告。因此不同保存连接、不同账号指向同一实例时不能绕过已知源外键占名检查。MariaDB 元数据摘要采用保守识别，非全局唯一名称证明；旧快照无法证明身份时保留未确认项。

两张表的原定义无法排除目标库其它表占用某个外键名：即使服务器摘要不同，也不把跨连接当作“名称已可用”。相关外键新增明确保留“目标库完整命名空间未核验”，并阻止整批 SQL；未来需要显式名称映射及完整、有界的目录可用性核验才能放行。独立选择的无冲突字段/索引新增和外键删除仍可预览。

本次只修改 M02 读取器、独立命名空间模块、预览生成器及其测试、说明，没有修改共享契约或主进程/引擎生命周期，没有合入统筹分支。

验证命令：

```powershell
node node_modules/vitest/vitest.mjs run schema-compare --reporter=dot
node node_modules/typescript/bin/tsc --noEmit
node scripts/build.mjs
node node_modules/vitest/vitest.mjs run --reporter=dot
node node_modules/@playwright/test/cli.js test tests/e2e/schema-compare.spec.ts
```

专项 8 文件、97 项通过；完整单元 121 文件、2307 项通过；类型检查和源码构建通过；离线 Electron 6 项通过。新增窗口流程实际选择冲突新增项与目标外键删除，确认原始差异仍在、整批无 ALTER 语句且保存禁用。单元覆盖五类目标版本、仅选新增/混合删除、同库不同表、跨库、双连接别名及不同账号、未知身份、三种表名大小写模式、字段/索引大小写和无冲突独立操作。

仍未在 200 隔离实库执行本次新增查询或 DDL，未验证真实内核命名冲突、不同操作系统/Unicode 名称比较、SSH/TLS 与最终安装包；不以离线版本参数化用例声称实库矩阵通过。

规则依据：[MySQL 外键名称](https://dev.mysql.com/doc/refman/8.4/en/create-table-foreign-keys.html)、[MySQL 标识符大小写](https://dev.mysql.com/doc/refman/8.4/en/identifier-case-sensitivity.html)、[MariaDB 外键名称范围](https://mariadb.com/docs/server/ha-and-performance/optimization-and-tuning/optimization-and-indexes/foreign-keys)、[MariaDB 标识符大小写](https://mariadb.com/docs/server/reference/sql-structure/sql-language-structure/identifier-case-sensitivity)。
