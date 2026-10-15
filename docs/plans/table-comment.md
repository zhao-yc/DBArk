# 表注释单属性受控修改

本切片从统筹 `82e07a0788c78ea3e68df397fabb4820deb82587` 开发，不等于全部数据库／表选项完成。对象树普通表操作和表页工具栏均有“表注释”入口；已有整表设计器保持原路径。

## 已实现范围

独立 `schema.tableComment.get / preview / apply / release` 命令。读取接收 connectionId/database/table/taskId；预览只收 snapshotId/comment/taskId；执行只收 previewToken/acknowledgements/taskId。公开严格校验拒绝客户端SQL、目标覆盖和连接修订。修订由主进程注入。

SQL固定一条 `ALTER TABLE ... COMMENT = ...`，不重述列、生成表达式、索引、外键、默认值、字符集或其他表选项。普通复杂表不因旧设计器不能重述其字段或索引而禁用。本批属性卡只读展示引擎、默认字符集／排序规则、行格式及精确自增计数，只有普通表注释可编辑。

快照／预览使用独立 tableComment 用途，与其他结构用途共用总缓存预算、120秒期限和同表执行租约。预览不执行DDL；执行在任何等待之前消费令牌，精确确认两项风险，独立短会话重核原定义、服务器身份、原生TABLE_ID、模式和目录。双击／失败／取消／断线均不重放。关闭释放关联令牌，连接重配／关闭和进程退出统一失效。

执行事实由独立 TaskEvent.tableComment 记录。OK后先取警告，再读完整定义与实际目录；只豁免顶层COMMENT的语义变化，其他列／约束／表选项、编码、物理身份和计数均核对。任何服务器警告、读取失败、物理身份改变或其他定义不符，显示“DDL已完成但未完整核验”，不能当作未执行重试。取消等待真实终态和关闭，查询标签的事务、临时表和检查开关不被改动。任务持久化不保存注释和驱动错误原文。

前端保护精确目标的全部表页，包括隐藏页的数据草稿与活动任务；目标／连接版本改变不能套用迟到响应。预览只读，返回编辑释放旧令牌；输入不直接执行SQL；未知结果独立提示并参与退出草稿保护。

## 明确的只读／拒绝边界

- 原生身份门槛沿用现有记录定位范围：Linux或debian-linux-gnu、lower_case_table_names=0、ASCII库表名、非分区InnoDB、MySQL 5.7/8.0/8.4或MariaDB 10.11/11.4。版本族不代表每个补丁版本已实测；未知／其他引擎／名称映射／目录权限不足只读。这里未扩大现有身份能力。
- 生成列、前缀／全文／空间／不可见／表达式索引本身不要求客户端重建，允许保持其完整原定义；但未知／重复／可执行表尾选项或分区无法唯一解析顶层COMMENT时只读。
- 原注释或新输入包含 MERGE_THRESHOLD、NDB_TABLE 等引擎指令时只读／拒绝，不能用普通说明覆盖删除物理配置。仅首批InnoDB普通说明，不声称支持NDB／Spider等引擎参数。
- MariaDB整表风险默认值保护继续生效，包括不受控表达式和字符集引导值；原始二进制默认字节无法完整核验时只读。单条COMMENT也不代表服务器内部绝不会重述风险定义。
- NUL、孤立代理项、超字符或UTF-8字节预算明确拒绝；不trim、截断、规范化换行或替换文字。首批客户端预算最多2048码点且2048 UTF-8字节，并取真实注释目录字符／字节容量的更小值。**2048字节是客户端保守限制，不是服务器2048字符规则的换名。**
- 根据服务器 information_schema.COLUMNS/CHARACTER_SETS 读取 TABLES.TABLE_COMMENT 的编码与长度。utf8/utf8mb3不接受补充平面字符；仅目录明确utf8mb4/MAXLEN=4才允许提交此类文字，仍以实际往返后核验为准，不能靠连接charset=utf8mb4就宣称元数据支持emoji。
- 严格比较完整原DDL：业务插入使AUTO_INCREMENT变化也会使旧预览失效；不擅自忽略计数。后核验中其他合法并发变化也保守报告未完整核验。
- 进程内租约不阻止外部DDL。重核到ALTER之间仍有并发窗口，必须在维护时段暂停并行结构修改；未声称原子比较交换。未承诺COMMENT一定无锁、元数据修改或不重建。若服务器内部重建改变TABLE_ID，本版也保守报告已完成但未完整核验。

## 主源依据

表COMMENT最大2048字符，可承载InnoDB MERGE_THRESHOLD；NDB还使用COMMENT参数：[MySQL 8.4 CREATE TABLE](https://dev.mysql.com/doc/refman/8.4/en/create-table.html)。MariaDB也规定2048字符，并在Spider表中使用COMMENT参数：[MariaDB CREATE TABLE](https://mariadb.com/docs/server/server-usage/tables/create-table)。

utf8mb3只覆盖基本多文种平面；目录的字符容量、字节容量和字符集是不同属性：[MySQL utf8mb3](https://dev.mysql.com/doc/refman/8.4/en/charset-unicode-utf8mb3.html)、[MySQL COLUMNS目录](https://dev.mysql.com/doc/refman/8.4/en/information-schema-columns-table.html)。版本差异仍需实库证明。MySQL旧版5.7在线手册链接当前会重定向到新版，不能拿重定向结果冒充5.7依据。

## 验证与ROOT验收准备

初版开发阶段只做本机类型检查、驱动替身单元、源码构建和默认关闭用例的收集／跳过检查，当时未启动GUI、操作剪贴板、连接200或运行Docker，也未创建凭据。以下本地结果保留该阶段边界，不可将单元或构建称为实库通过。

2026-10-16后续实证：ROOT在固定源码 `8d2ac07164d8979c638cb16657bba8624beec1b5`、清洁窗口真实串行执行六组合核心，run599各4/4，共24通过、0失败、0跳过；run600后置六实例相关临时资源全零。run583、run593各21通过3失败原样保留、不累加。详细修复过程、独立同DDL不同ID观测和未验边界见[表注释真实核心验收](../../tests/integration/acceptance-o01-table-comment-20261016.md)。GUI、安装产物、真实非默认SQL模式及断网等仍待验收，产品未纳入已发布0.17.0。

- 核心：`tests/integration/engine-table-comment.integration.test.ts`，双开关 `DBARK_INTEGRATION_ENABLED=1` 和 `DBARK_TABLE_COMMENT_TEST=1` 才执行。每轮显式选择一个已核对实例；五版本族和独立严格TLS共六轮。使用已有环境变量和CA，不创建用户。真实connect只包一层记录所有实际线程编号，包括数据库为空的短会话与取消控制连接，实际网络／驱动实现不替换；清理按真实编号及隔离目标复核。
- 正式UI：`tests/e2e/table-comment.spec.ts`，相同双开关；实际Electron、对象树／表页、中文输入、只读Monaco预览、确认项、双击单次执行、引擎参数只读、返回编辑释放预览。复用现有原生确认／严格TLS夹具。`--list`只收集，不启动GUI。
- 核心前后原定义、生成列／单列编码／前缀与全文键、数据；清除／同值；字节／补充字符；外部定义、同DDL重建和配置修订失效；真实MDL取消、已发送未知事实、不重放和线程归零。超出这些的权限账户矩阵、更多SQL模式、真实断网／进程退出及最终安装包验收由ROOT补齐，不在本轮虚报。

离线命令（已有node_modules，不下载依赖）：

```powershell
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vitest/vitest.mjs run
node scripts/build.mjs
# 明确关闭双开关后，仅核对集成默认跳过；不启动桌面。
$env:DBARK_INTEGRATION_ENABLED='0'; $env:DBARK_TABLE_COMMENT_TEST='0'
node node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts tests/integration/engine-table-comment.integration.test.ts
node node_modules/@playwright/test/cli.js test tests/e2e/table-comment.spec.ts --list
```

初版本地结果（2026-10-16，后续实证另列）：类型检查通过；164个单元文件、3060项用例全部通过，其中新增表注释35项；源码构建通过，产物位于 `dist/main/index.cjs`、`dist/main/worker.cjs`、`dist/main/preload.cjs` 和 `dist/renderer/`。集成4项明确跳过；正式UI只收集到2项，未执行。构建保留既有依赖注释和大分块警告。

第一次全量单元在沙箱系统临时目录出现136项EPERM重命名失败。没有改产品存储实现，将该次进程的TEMP/TMP设为已核对的本克隆 `.cache/table-comment-tmp` 后，完整重跑3060项全通过；两个日志分别留在个人 `.cache/table-comment-unit.log` 和 `.cache/table-comment-unit-workspace-tmp.log`，不提交。该过程没有修改用户全局环境变量。

后续范围：表默认charset/collation成对受控修改另立切片，先补真实候选目录和现有列编码保真；engine、row_format和AUTO_INCREMENT计数另立切片，本次未开放。
