# 既有表索引与主键差异设计

状态：2026-10-14 下一批实施建议，仅新增本文。尚未实现新索引接口、组件或五库验收，不改变当前 0.8 字段差异功能的验收结论。此次仅阅读源码与少量官方语法资料，没有构建、启动 GUI 或访问远端数据库。

## 已有能力与缺口

| 真实位置 | 当前可复用内容 | 不足与边界 |
| --- | --- | --- |
| `src/renderer/components/SchemaDialog.tsx` | 索引名称、唯一开关、逗号列列表；旧 schema.preview/apply；新建表设计 | 既有表回传完整 TableDesign，索引无稳定引用、前缀、类型、方向、注释；SQL 可编辑且 apply 接客户端 SQL，不适合作为可信索引补丁入口 |
| `src/shared/contracts.ts` | IndexInfo 为 name/unique/columns，TableInfo 有原 DDL、主键、可编辑键和外键 | 不含完整 key part、表达式、可见性、索引选项或入向外键；不能将此投影当作无损修改源 |
| `src/engine/metadata.ts` 的 tableInfo | STATISTICS 查询已读 SUB_PART/INDEX_TYPE/COLLATION，按 SEQ_IN_INDEX 排序；SHOW CREATE；复杂索引标记 unsupportedDesign | 额外属性只用作保护标记，未保留在公共 IndexInfo；只读取本表出向外键，不证明跨库入向依赖完整；可靠行键逻辑也需与新前缀/表达式能力一致 |
| `src/engine/sql.ts` 的 buildDesign | 基础 PRIMARY/UNIQUE/KEY；索引差异可 DROP+ADD | 相等性只比名称/unique/列数组；不能证明前缀、注释、类型等未改属性保持。旧多条外键流程不作为新索引执行器 |
| `src/shared/tableColumnPatches.ts`、`src/engine/tableColumnDefinition.ts` | 有界 CREATE TABLE 词法源范围、真实 columnRef、模式上下文、整表危险默认检查 | 顶层约束还须补索引结构化读取器；columnRef 只在其所属快照内有效，不能跨快照把同名字符串当旧引用 |
| `src/engine/tableColumnPatchTasks.ts`、`src/main/index.ts` | 专用短会话、原定义 SHA/实际身份/配置 revision 重核、窗口归属 token、单次消费、结构化投递进度、release | 不直接把列补丁伪装成索引补丁；新契约需注册白名单、校验及可信 token。可抽取已有读取/生命周期工具，避免复制两套取消状态机 |
| `src/renderer/columnPatchServices.ts`、App/TableTab 的字段入口 | 精确同目标全部表页草稿/忙任务保护、connectionVersions、退出草稿确认、完成刷新/未知过期、真实 IPC 适配 | 索引草稿另有行键与依赖风险；成功仍只能刷新空闲无草稿的同目标，不能打断其他表或查询事务 |

首批使用独立“索引与主键差异”入口，旧设计器功能保持独立。不能把转到 SQL 标签或只展示 SQL 算作索引编辑完成。

## 优先顺序与首批范围

1. 最高频：普通/唯一 BTREE 索引的新增、删除、重命名及复合列顺序；删除或修改旧索引以稳定 indexRef 定位。
2. 同批补齐：前缀长度、明确 BTREE 类型、索引注释；已有索引改列组、unique、前缀、注释或类型，在可保真模型内以一条 ALTER 的 DROP+ADD 完成。纯重命名可在五版探针确认后预先选择专用语法；执行失败不换语法重放。
3. 主键新增、删除和替换：首批仅已经 NOT NULL 的普通列、全列键、无未解决依赖。不能借 ADD PRIMARY KEY 自动改列可空性，不能暗中为自增列补索引。
4. ASC/DESC、其他索引方法、表达式、隐形、FULLTEXT/SPATIAL 按真实方言/版本/引擎能力分别开放。未验证项显示实际原片段和只读原因，不整表丢弃其他已知索引；整表安全门另行优先。

基线目标为已授权五实例的 MySQL 5.7、8.0、8.4、MariaDB 10.11、11.4。首批引擎限制 InnoDB，基本索引方法为 BTREE，不显示能实际选 HASH 的假能力。复合列顺序指 key part 的数组顺序；不承诺索引在 SHOW CREATE/元数据列表中的展示位次。DESC 是独立方向能力，不能把旧版本接受语法但实际忽略方向视为已支持。

前缀只能在已证明支持的字符串/二进制列上选择；单位明确显示“字符”或“字节”，TEXT/BLOB 必须符合其前缀规则。应用前按真实字符集、行格式及引擎限制检查，不写死所有 InnoDB 为同一字节上限，不默默截短。[MySQL 索引前缀与限制](https://dev.mysql.com/doc/refman/8.4/en/create-index.html)

索引 COMMENT 不一定只有说明作用，官方文档存在带引擎含义的注释选项。未改 COMMENT 原片段必须保留；修改时明确由用户替换，不把识别不了的配置注释归一化为空。最新 8.4 文档的长度与语法不得直接作为五版统一事实。[MySQL 索引选项](https://dev.mysql.com/doc/refman/8.4/en/create-index.html)

降序能力必须按引擎测试，8.4 官方说明其 InnoDB 限制；MariaDB 文档也单独定义方向与各类索引选项。因此计划只把方向作为显式能力字段，不从配置中的 dialect 或可解析 SQL 推断。旧版语法和规范化行为最终以固定实例证明。[MySQL 降序索引](https://dev.mysql.com/doc/refman/8.4/en/descending-indexes.html)、[MariaDB CREATE INDEX](https://mariadb.com/docs/server/reference/sql-statements/data-definition/create/create-index)

## 读取模型与依赖保护

完整 SHOW CREATE 和有界元数据交叉读取；保留所有列、约束和表尾源片段。索引读取器复用 CREATE TABLE 词法范围，识别 PRIMARY/UNIQUE/KEY、方法、列引用/前缀/方向、COMMENT 及只读未知选项。表达式、可执行注释或无法确认边界的索引按属性/整个索引只读，不用逗号正则拆 key part。

列数组使用同一快照服务器真实名称建立 columnRef；索引另发 indexRef。精确匹配优先，只有大小写双方无歧义时才允许规范化；库表名称大小写原样保留。Map/数组避免 `__proto__`/constructor 名称污染。预览不接 renderer SQL，也不接受脱离快照的原列名冒充 columnRef。

删除/替换必须检查本表出向外键支持索引、跨库入向引用、AUTO_INCREMENT 所需键、分区与唯一键约束、隐式/服务器生成键、未知索引选项。依赖读取限行数/字节和权限，不扫数据全库；权限不足或无法证明受保护键可删除时明确拒绝该操作。不能通过关闭 foreign_key_checks、自动删外键或自动生成替代键绕过。执行前重新确认专用会话约束检查状态与依赖；外部并发新增依赖仍由服务器检查，不承诺消除重核窗口。

唯一性按服务器字符集、排序规则、NULL 和前缀语义判定，不能在 JavaScript 中 lowerCase、Number 或去重来“验证可建唯一键”。BIGINT/DECIMAL、BIT/BINARY 原值不得转浮点或字符串展示后用于匹配。不自动执行 GROUP BY 全表排重或删重复数据；预览只说明可能失败，服务器最终建键检查具有权威性。如后续增加显式数据诊断，须独立用户启动、有界/可取消，且不能保证诊断后并发数据仍唯一。

索引 ALTER 也会触发服务器内部整表重述。现有 MariaDB 任意 ALTER 危险默认值门必须先检查并拒绝全部索引补丁；本功能没有字段默认修改权限，不能借索引计划隐式清理风险默认。应用后核验未改默认/列/约束语义，不只核验新索引名称。

## 建议最小契约（尚不存在）

目标仍 `{connectionId,database,table}`；增加 `schema.indexes.get/preview/apply/release`，执行使用独立任务与 `query.cancel`。与字段接口同样固定目标/窗口/连接配置 revision；token 在主进程窗口归属内，不能跨窗口或跨配置重用。

- get 返回 snapshotId、expiresAt、ddlHash、目标、真实版本/引擎/模式上下文、列视图（columnRef、名称、类型、实际 nullable/charset）、完整索引视图、逐操作能力与依赖摘要。索引视图含 indexRef、名称、kind(primary/unique/ordinary/只读种类)、method、按序 keyParts、comment、原片段、只读选项及原因。
- 每个可写 keyPart 为 `{columnRef,prefixLength?,direction:'asc'|'desc'}`；首批表达式不允许由用户传入。补丁为 add（clientKey+结构化索引）、drop（indexRef）、alter（indexRef+仅变化字段）。primary 不接受任意名称；一个旧索引最多一项补丁，一个最终主键，恢复原值消除补丁。
- preview 接 snapshotId/patches/taskId，返回 previewToken/expiresAt/目标/hash/只读单条 ALTER SQL/逐项差异/警告/中文可映射的 ack ID。不能合为一条或不能保真则拒绝，不暗中拆多条。首批不混字段与外键修改。
- apply 只接 previewToken/acknowledgements/taskId，无 SQL/目标/连接参数。输出 ddlSubmitted/ddlCompleted/definitionVerified、真实警告、核验后索引摘要或 verificationError；unknown 不伪装成成功或可重试。
- release 支持 snapshotId/previewToken 幂等；快照释放连预览一起销毁。get/preview 的迟到响应也释放，TTL 按返回 expiresAt。缓存有全局总预算，建议复用字段的总量管理，不为每个新类别无限倍增 32+32/16MiB 额度。

预算建议：每表最多 4096 列、256 个索引/只读条目、每次最多 100 补丁、32 key parts/索引、补丁 512KiB、原定义 2MiB、最终 DDL 4MiB，且不超过服务器较小的真实限制。所有 optional 清空删除自有键；拒 unknown 字段、显式 undefined、稀疏/循环数组、不合法引用及超预算，不为兼容放宽严格 JSON。方法和关键安全步骤用中文注释。

共用执行基础仅抽取读取模式/身份验证、任务取消、token 生命周期及结构化进度；列与索引的纯模型/计划器分离。进度沿用 connecting/reading/rechecking/executing/verifying/releasing 与 not-sent/succeeded/failed/unknown，UI 不从错误字符串猜是否执行。

## 最小界面与生命周期

表侧栏及工具栏“索引与主键差异”，只针对真实表。列选择为服务器真实 columnRef 多行选择，可上/下移 key part，前缀与单位、方向、方法和注释分别输入；不以逗号名称文本代替复合键编辑。复杂索引原片段只读显示；当前主键和影响可靠行键的修改醒目标记，名称重复/类型限制给中文原因。

多行草稿仅本地应用，预览零 DDL。确认页 SQL 只读，明确删除唯一约束、替换主键可能改写物理布局/耗时、维护窗口与 DDL 隐式提交不可 rollback。确认句集中中文，未知 ack 拒执行。生成新预览前旧 token 失效；最终按钮同步锁、位置稳定且执行中 disabled，取消独立位置，双击不会触发取消或第二次 apply。

打开和 apply 前检查精确同目标所有表页 dirtyTabs/activeJobs，拒绝并要求先处理数据草稿；其他表和 query 标签不变。成功入口才清前一次已解决的 toast。模态/只读编辑器快捷键不得执行后台 SQL。索引草稿加入原生退出确认；执行中不能关窗口/切目标，取消后 busy 保持到实际 IPC finally。

get/apply 短独立连接不借用户查询 session，不提交或回滚该 session，事务/临时表/诊断状态保持。配置 revision、实际服务器身份、原模式和完整原定义 SHA 在 apply 重核，含当前保守 AUTO_INCREMENT 计数变化；目标变化拒绝旧 token。维护窗口仍必要，重核不是 DDL 锁。

单条 ALTER 不等于所有版本均原子，DDL 可能隐式提交；不能宣称用户 rollback 可撤销。已投递后取消/断连无可靠完成证据时 unknown，保留目标/原 SQL/差异供核对，不发送反向 DDL或失败 fallback。DDL OK 后核验/清理失败保 completed 证明；新执行须明确重新读/预览，不把失败当网络重试。完成后仅同目标空闲无数据草稿自动刷新；unknown/核验失败只标过期，刷新后重新计算可靠行键，失去键则禁止编辑，不保留旧可写判定。

## 实施分工与有效验收

先做独立共享类型/预算、索引读取器与纯计划器；有真实复杂定义 fixture 后再接 Engine/main 白名单/token，最后真实组件/两个入口与独立 UI 测试。可能新增 `shared/tableIndexPatches.ts`、`engine/tableIndexDefinition.ts`、`engine/tableIndexPatchSql.ts`、`engine/tableIndexPatchTasks.ts`、renderer `IndexPatchDialog`/services/helper/中文 locale/CSS，并小范围接 contracts/commands/validation/Engine/main/App/Sidebar/TableTab。不扩大旧 TableDesign，不迁移用户配置 schema，不增依赖。

最有价值的验收顺序：

1. 五库精确 SHOW CREATE/STATISTICS：普通/唯一/主键复合增删改，前缀/注释/方法/列顺序；纯重命名和 DROP+ADD 策略提前选定，预览零 DDL，只有一次真正 ALTER。方向语法接受与实际 COLLATION/定义/执行计划分开验证，未证明则不开放。
2. 字符集前缀单位、超长前缀拒绝、数字/BIT 不可前缀、TEXT/BLOB 合法前缀；含高精度键值、真 NULL、前缀碰撞/排序规则等价值建唯一键失败，不自动改数据或截短键。
3. 主键已 nullable 列、自增键、复合外键、跨库入向依赖、受限权限、分区唯一约束及服务器生成主键边界；拒绝不可证明安全的删除/替换，不偷偷修改列/外键。
4. 未改 generated/复杂默认/charset/collation/其他索引/外键/表尾保持；Maria 风险默认整表门在任何旁索引 ALTER 前拒绝。复杂索引只读不丢属性；原型同名/Unicode/反引号名称和精确大小写不误定位。
5. 真 UI 双入口、复合 key part 上下移和默认恢复消差；只读预览快捷键不后台运行；双击一次、旧toast不遮挡；同表草稿/忙任务保护、跨表草稿和查询事务/临时表保持。
6. 真实 MDL 等待取消、投递后断连 unknown、DDL OK 后核验失败 completed、晚取消不重放；过期/配置改主机/外部定义变化/窗口跨 token 拒绝；close/late/re-read 释放与退出草稿确认。失败现场附原始 error-box/真实结构化进度，不伪造服务事件。

实库仅用已授权 200 五实例隔离随机库，finally 释放自身连接、DROP 精确本例库并核对零残留。记录源码/产物 SHA、真实版本、模式、前后定义、任务数/进度、权限与清理证明；当前本文没有这些执行证据，不能标功能完整或已发布。
