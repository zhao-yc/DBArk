# 单表清空专用入口首片

本片从 `97a0ed085512c42e62d0e487644e9e3e873dd274` 开发。原代码只有 SQL 与解析器的 TRUNCATE 词项，没有专用的单表预览、确认和单次投递入口。本片增加 TableTab「清空表数据」按钮及独立对话框；没有执行实际清空，也没有构建、替换或重新包装冻结候选版本。

## 产品边界

- 首片只开放可证明物理身份的 MySQL 8.4.11（允许版本后缀）、Linux、`lower_case_table_names=0`、ASCII 命名的非系统库持久普通 InnoDB 表。其它版本没有开放写能力，不宣称六组合支持。
- 无主键、无唯一键本身不阻止清空。专用 DDL 能力与网格可靠行键分开；普通表身份或依赖无法证明仍拒绝。
- 同目标全部隐藏表页的数据草稿、布局草稿、活动任务，以及尚未结束的格输入均先阻止。不会顺带提交或丢弃草稿；提交前再次核对连接版本与这些保护条件。
- 视图、临时/未知对象、分区表、生成或未知字段定义、CHECK、双向或自引用外键、触发器、被视图引用的表暂不开放。入向外键及无法完整读取依赖目录时必须拒绝，不能关闭 `foreign_key_checks` 绕过。
- 复用现有表属性/重命名读取的保守可见性证明：全局 SELECT、SHOW VIEW、TRIGGER，来源 ALTER/DROP。TRUNCATE 本身需要 DROP；首片额外要求 ALTER 是复用现有更严权限门的明确边界。不会授予权限或展开未知角色、部分撤销。

## 预览与执行

1. 打开只读取能力与快照；预览只重核原定义、原生 TABLE_ID、服务器身份、连接修订、会话模式、目录计数与完整依赖。自增目录沿已有 MySQL8 方式设置本次结构会话 `information_schema_stats_expiry=0` 并读回；失败只读。唯一/FK 检查保持开启。
2. SQL 仅由可信快照生成一条 `TRUNCATE TABLE 库.表;`，编辑器只读。客户端不能传任意 SQL、改目标或自行提供连接修订。
3. 预览后输入准确的 `库名.表名`，不 trim、不忽略大小写、不解析输入为目标。必须确认全部数据不可回滚、自增重置与维护窗口三项风险；重复、额外或未知项目不授权。
4. apply 的第一个 await 之前消费 token，并使同一快照的其它预览全部失效。即使确认错误、取消、权限撤销、定义变化、断线或结果未知，也不能重放本批预览或重新包装旧快照，必须重新读取。
5. 沿原独立结构会话、编号进度、目标结构写锁、真实取消与严格连接关闭生命周期执行一次。确认过期、依赖变化、计数变化或同名物理表替换时，零 DDL。
6. OK 响应之后只豁免物理 TABLE_ID 重建和顶层自增计数重置。完整其它定义、列目录、编码、行格式、注释和服务器/模式必须一致；有自增列时步长/偏移须为1，计数应为1，无自增列应保持 null。`SELECT 1 ... LIMIT 1` 只观察是否空，不扫描 COUNT/MAX，也不返回业务行值。
7. 警告计数不为明确的0、空表/计数/定义不能完整证明、取消、断线或后核失败时，不报告完整成功；保留已提交/已完成事实。完成或未知回调仅标记固定目标，沿原结构失效机制刷新干净页或置过期，旧行与旧预览不能继续提交。未知结果不自动重试。

TRUNCATE 是隐式提交且不可事务回滚的 DDL，自增计数重置，不触发 ON DELETE 触发器。OK 包的 affectedRows=0 不代表删除0条；本窗口不报告删除行数，也不承诺空表状态持续不变。重核不能消除外部 DDL/DML 并发窗口，实际执行仍须确认备份并在维护窗口暂停写入。语义依据：[MySQL 8.4 TRUNCATE TABLE 官方文档](https://dev.mysql.com/doc/refman/8.4/en/truncate-table.html)。

## 共享变更清单

| 文件/接点 | 增补 |
| --- | --- |
| `src/shared/tableTruncate.ts` | 专用输入、输出、进度别名、固定风险项与准确确认 |
| `src/shared/contracts.ts`、`commands.ts`、`validation.ts` | `schema.tableTruncate.get/preview/apply/release` 四个严格类型化公开命令；`TaskEvent.tableTruncate` |
| `src/main/index.ts`、`taskPrivacy.ts` | 原结构用途链增加 tableTruncate，沿可信连接修订、用途隔离、单次投递、退出事实与概要隐私规则 |
| `src/engine/index.ts` | 四命令分发、任务宿主及独立进度映射 |
| `src/engine/structureDefinition.ts`、`structurePatchCache.ts` | 用途联合增加 tableTruncate，共享原32快照/32预览、16MiB、120秒预算，不新建生命周期框架 |
| `src/renderer/App.tsx` | 独立目标/版本/退出保护，入口与提交前同表保护，准确目标完成/未知失效回调 |
| `src/renderer/components/TableTab.tsx` | 可选回调与最小按钮，不与网格 editable/主键门绑定 |

专用实现集中在 `tableTruncateSql.ts`、`tableTruncateTasks.ts`、`TableTruncateDialog.tsx`、`tableTruncateServices.ts`、`tableTruncateUi.ts` 和中文 locale。没有改 Sidebar、CRUD、数据提交或共享生命周期算法。

## 本片验证与未完成边界

- 相关纯回归31文件、521项通过，0失败、0跳过；其中新增清空测试5文件59项，包含真实 Engine（仅替换驱动）、生产主进程函数、真实 ReactDOM 内存对话框、实际 App/TableTab 表达式及专用规划/IPC反例。无键表、同表隐藏草稿、输入中、准确确认、双击、迟到响应、StrictMode、取消未终态、定义/依赖/计数/物理身份改变、token用途隔离、未知及后核失败均覆盖。
- 另对记录草稿/预览既有模块完成48项纯回归，覆盖stale或代次改变时旧预览不能提交；0失败。主进程合法确认参数的最终定向3项通过。
- `node node_modules/typescript/bin/tsc --noEmit` 通过。没有执行产品构建。旧 dist 108文件与本任务开始时摘要一致；它们来自旧任务，不能当作本片产物。
- 初次扩展回归误选旧侧栏夹具的9项，它们需要启动 esbuild 子进程，被纯验证守卫阻止，实际未启动。保留初次报告与拦截记录；随后排除该未改动、与本片入口无关的侧栏文件，以上31文件均通过。没有放宽守卫或修改原断言。
- 最终纯回归与默认关闭检查中，网络/TLS、实际子进程、私有文件读取、密钥生成的守卫拦截均为0。正式核心定义默认3项跳过；Playwright 仅列出1个默认关闭项。另有默认关闭模块守卫，禁止导入实际引擎或原生/观察模块，未触发。
- 正式定义：`tests/integration/engine-table-truncate.integration.test.ts`、`tests/e2e/table-truncate.spec.ts`，仅 `DBARK_INTEGRATION_ENABLED=1` 与 `DBARK_TABLE_TRUNCATE_TEST=1` 同时打开后加载实际能力；准备门仅允许已核对200的13384/13484，13484须显式严格TLS与同一CA。不读取凭据文件的默认关闭路径已检查。所有实际执行须由ROOT另外安排本例唯一隔离库，并继续使用其正式退出、资源与清理证据要求。
- **员工3实际数据库/服务器/原生UI操作均为0。** 正式定义尚未执行，不能声称真实数据清空、自增重置、MDL取消、跨平台原生或发行包验收通过。本片不改冻结0.20候选及旧控制资产；ROOT需独立窄审、整合及安排隔离破坏性验收。

本地详细报告、守卫记录和旧 dist 摘要位于本工作副本 `.cache/truncate/`，不提交缓存、环境、日志或构建产物。
