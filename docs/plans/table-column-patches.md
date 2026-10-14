# O01 表字段差异修改设计

状态：本文保留 2026-10-14 的原始设计及后续实施约束，末尾追加各阶段证据与修正。当前已实现并执行产品测试，尚未发布；实际通过、失败和待验以 [O01 产品验收](../../tests/integration/acceptance-o01-columns-20261014.md) 为准，不改变已冻结旧版本的文件。

## 1. 目标与现状

首批提供既有表的字段差异编辑：新增、删除、重命名、类型、可空、默认值、注释和位置。每次只生成用户修改过的列及属性；未修改的列、复杂索引、外键、生成列、分区及表选项不从简化模型重建。

只读代码证据：

- `src/renderer/components/SchemaDialog.tsx` 将默认值输入中的空串转成 `undefined`，输入文本 `NULL` 转成 `null`；显示又把 `null` 与空串合并。用户无法可靠表达无默认值、SQL NULL、空文本和文本 `NULL`。
- `src/engine/sql.ts` 的 `buildDesign` 从简化 `TableDesign` 重新生成列定义，对保留列产生 `CHANGE` 和位置信息，并带上表选项，无法恢复列字符集、表达式及其他未建模属性。
- `src/engine/metadata.ts` 的 `unsupportedDesign` 与引擎额外检查，对部分复杂定义整表转到 SQL 入口；这保护了旧路径，但不能完成字段级编辑。
- `schema.apply` 接收渲染进程传来的 SQL；没有绑定原定义、目标和实际预览的执行令牌。该命令继续作为明确的手工 SQL 功能存在，新入口不调用它。

推荐独立 `schema.columns.get / preview / apply`，不把旧表设计器的完整对象回传当作差异，也不以“打开 SQL 编辑器”计为本功能完成。

## 2. 首批范围

| 操作 | 首批行为 | 限制与保留策略 |
| --- | --- | --- |
| 新增普通列 | 类型、可空、默认值、注释、FIRST / AFTER / 末尾 | 明确普通列；不自动创建索引、主键、外键或自增属性 |
| 删除普通列 | 明确显示永久删除数据，单独风险确认 | 拒绝删除最后一列；涉及本表索引、外键、生成表达式、CHECK 或分区依赖时拒绝该补丁，不自动删除依赖 |
| 重命名普通列 | 支持普通名称、Unicode、反引号、`__proto__` | 5.7 使用完整原定义的 CHANGE；其他基线优先专用 RENAME COLUMN；不做字符串全局替换 |
| 类型修改 | 结构化白名单类型，参数单独校验 | 目标列未改属性原片段保留；与保留属性不兼容则拒绝或由服务器明确报错，不自动移除属性 |
| 可空修改 | NULL / NOT NULL 明确选择 | 收紧约束可能因现有数据失败；不填充 NULL、不清理数据 |
| 默认值 | 无 DEFAULT / NULL / 文字量 / 受支持表达式四种 | 空文本与文本 `NULL` 必须能分别保存；表达式首批为受控 CURRENT_TIMESTAMP 及精度，不接任意 SQL |
| 注释 | 支持空注释与任意合法文本 | 按实际模式编码；长度按目标能力拒绝，不静默截断 |
| 位置 | FIRST / AFTER 明确列引用，支持尾部新增 | 不改其他列定义；依赖位置的生成列 / 默认表达式必须检查，无法证明时只禁该位置操作 |
| 同次多列修改 | 合并为一条 ALTER TABLE | 同一原列最多一个修改补丁；不能合并或需多条 DDL 的组合首批明确拒绝，不暗中拆开 |

首批不编辑：生成表达式及 VIRTUAL/STORED、AUTO_INCREMENT、列字符集/排序规则、ON UPDATE、可见性、SRID、COLUMN_FORMAT、STORAGE、系统版本列、列级 CHECK、任何索引或外键、分区、表名和表选项。这些定义仍须在无关字段修改后保持。已有上述属性的**目标列**按属性级能力决定：例如只改 DEFAULT 可用专用 ALTER COLUMN；需要 MODIFY/CHANGE 的操作只有完整原片段可安全拼接时才开放，否则明确该列/该属性只读，不能整表禁用其他普通列。

首批类型建议：整数族及 UNSIGNED、DECIMAL、FLOAT/DOUBLE、BIT、CHAR/VARCHAR/BINARY/VARBINARY、文本/二进制大对象、DATE/TIME/DATETIME/TIMESTAMP/YEAR、ENUM/SET。长度、精度、scale、元素数组分别类型化；数值默认值保留字符串，ENUM/SET 元素不拼任意类型 SQL。JSON 及空间类型首批可读/原片段保留，新增或改成这些类型在方言规则及默认值测试完成后再开放。REAL 受 `REAL_AS_FLOAT` 影响，界面使用实际 FLOAT/DOUBLE，原 REAL 定义不自作转换。

## 3. 无损定义模型

新增基于词法 token 和源范围的 CREATE TABLE 读取器，不使用逗号或换行正则切列。复用现有 `SqlScriptScanner` / 参数词法的引号、注释与模式规则；提取可共用的词法状态，不另写弱化的第二套 SQL splitter。

读取器必须区分顶层列定义、表约束和表尾，保留所有源片段及偏移。括号嵌套、ENUM 逗号、字符串内 COMMENT/DEFAULT、反引号双写、ANSI 双引号标识符、反斜线、普通注释、MySQL `/*!...*/` 和 MariaDB 可执行注释都要处理。无法确认的可执行片段按 `opaque` 保留；若碰到待修改属性边界则拒绝该补丁，不静默当注释删除。

每列记录：真实原名称、原顺序、原完整片段、已识别属性的唯一源范围、只读未知片段、可编辑属性及原因。标识符使用 Map 或安全自有键对象；比较采用服务器对应名称语义，但原始名称和引用始终保留，存在大小写歧义时拒绝。

生成策略：

1. 仅默认值改变优先 `ALTER COLUMN ... SET/DROP DEFAULT`。真实五版探针确认的例外：MySQL 5.7 时间表达式必须预先选择 MODIFY，并仅替换原列 DEFAULT 范围；MySQL 8.x 专用 SET DEFAULT 时间表达式需括号，MariaDB 可用裸时间表达式。HEX/BIT 文字量不套用此括号规则，不允许执行失败后自动换语法重放。
2. 仅重命名且支持专用语法时优先 `RENAME COLUMN`。
3. MODIFY/CHANGE 从服务器原完整列片段替换**指定属性范围**；未改字节片段原样保留。不从 information_schema 的简化字段重新拼所有属性。
4. 新增列从受控类型及属性模型生成。标识符独立引用，文字量用按会话模式验证的 DDL 编码器；不能直接复用会生成 CONVERT/CAST 函数的查询参数编码来充当 5.7 的字面 DEFAULT。
5. 最终只允许一个 `ALTER TABLE <精确目标> ...`。反向扫描校验单语句、目标、操作数和允许子句；渲染进程传来的任何 SQL 均不参与生成。

“保留原片段”是客户端生成保证，不承诺服务器 SHOW CREATE 输出字节永远相同；服务器会规范化定义。应用后对未改列的语义和不应变化的约束进行核对，并保存前后定义供当前界面查看，不能因核对失败自动执行反向 DDL。

### 默认值语义

补丁使用 `none | null | literal | expression`，缺省属性表示“不修改”，不能与 `none` 混用。读取值另有 `opaque` 和 `serverNormalized` 标记：SHOW CREATE 可能已把最初省略的可空列默认值呈现为 DEFAULT NULL，不能伪称能恢复原始手写 DDL。用户未修改时保留当前服务器片段；用户主动选择 none 才生成 DROP DEFAULT。

文字量细分 text / number / boolean / binary：数值保留十进制字符串，空字符串是合法 text，binary 使用明确 hex。NULL 不能通过文本输入隐式识别。日期、时间文字量不经过 JS Date。非当前首批表达式只读展示原 SQL；受控 CURRENT_TIMESTAMP 对适用列及精度逐方言校验，不能把字符串 `CURRENT_TIMESTAMP` 自动改成函数。

## 4. 方言和模式能力

能力来自真实握手版本/方言及独立结构会话，不信任用户连接配置中的方言选项。下表是设计基线，发布时必须有对应真实服务器记录；不能把官方最新文档的语法直接外推到旧版本。

| 能力 | MySQL 5.7.44 | MySQL 8.0.46 | MySQL 8.4.11 | MariaDB 10.11.19 | MariaDB 11.4.13 |
| --- | --- | --- | --- | --- | --- |
| 纯重命名生成策略 | CHANGE + 原完整定义 | RENAME COLUMN | RENAME COLUMN | RENAME COLUMN | RENAME COLUMN |
| 通用表达式默认值 | 不开放；时间类型特例单独验证 | 8.0.13 起有表达式规则 | 有对应表达式规则 | 方言自身规则 | 方言自身规则 |
| 首批表达式编辑 | 受控 CURRENT_TIMESTAMP | 同左 | 同左 | 同左 | 同左 |
| DECIMAL 最大小数位 | 30 | 30 | 30 | 38 | 38 |
| 默认值解释来源 | SHOW CREATE + 元数据交叉核对 | 同左，含表达式标记 | 同左 | 不使用旧 mariaDefault 的扁平结果作修改源 | 同左 |
| 原子 DDL | 不宣称具有 8.x 原子 DDL 保证 | 按引擎及受支持语句 | 按引擎及受支持语句 | 按 10.6+ 的引擎/语句范围 | 同左 |
| 在线 / INSTANT | 不作统一承诺 | 取决于操作及小版本 | 取决于操作 | Maria 方言规则 | Maria 方言规则 |

MySQL 8.0.13 后表达式默认值有括号、类型与依赖限制，不能与旧版统一处理；首批受控表达式以此为上界，不开放任意函数。[MySQL 默认值文档](https://dev.mysql.com/doc/refman/8.0/en/data-type-defaults.html)

MariaDB MODIFY 要重述需保留的列属性；其索引列删除可能隐式改变索引，因此本方案不让字段删除暗中管理索引。[MariaDB ALTER TABLE](https://mariadb.com/docs/server/reference/sql-statements/data-definition/alter/alter-table)

MySQL 8.4 原子 DDL 与 MariaDB 10.6 起的改进都不是用户可回滚的 DDL 事务，也不能推导出多个 ALTER 的原子性。[MySQL 原子 DDL](https://dev.mysql.com/doc/refman/8.4/en/atomic-ddl.html)、[MariaDB 原子 DDL](https://mariadb.com/docs/server/reference/sql-statements/data-definition/atomic-ddl)

MySQL 官方 5.7 文档 URL 在本次读取中重定向到了 9.7；不把重定向后的内容作为 5.7 证据。5.7 的具体语法和边界由固定 5.7.44 实库 fixture 验证后登记。

模式记录至少包括 `sql_mode`、`character_set_connection`、`collation_connection`、`explicit_defaults_for_timestamp`；对 Maria 的 SQL_MODE 中影响 SHOW CREATE 完整性的兼容标记单独判定。任何影响定义可见性的模式不能默认当作完整定义：独立结构会话可显式建立并记录规范元数据读取模式，或在不支持时拒绝修改，不能改变用户 SQL 标签会话。

读取与执行保持同一个可信词法模式。ANSI_QUOTES 下双引号不是普通文本，NBE 改变反斜线；SHOW CREATE 的当前 quoting 设置也进入快照。模式未知时新建专用连接重新读取，不复用用户 SQL 会话的未知模式，更不能沿用错误的状态位猜测。结构会话的能力/模式读取属于公开说明的准备步骤，不污染查询标签的 ROW_COUNT、FOUND_ROWS 和警告。

## 5. 建议 typed 契约

下列类型是新设计，并非已经存在的 API：

```ts
type ColumnTarget = { connectionId: string; database: string; table: string };
type ColumnDefault =
  | { kind: 'none' }
  | { kind: 'null' }
  | { kind: 'literal'; valueType: 'text' | 'number' | 'boolean' | 'binary'; value: string }
  | { kind: 'expression'; expression: 'current-timestamp'; precision?: number };
type ColumnPosition = { kind: 'first' } | { kind: 'after'; columnRef: string } | { kind: 'last' };
// ColumnType 为分支联合：整数、decimal、float/double、字符串、时间、enum/set 等。
// 不接受原始 type SQL；新增列由 clientKey 标识，既有列引用由快照提供。
type ColumnPatch =
  | { kind: 'add'; clientKey: string; name: string; type: ColumnType;
      nullable: boolean; default: ColumnDefault; comment: string; position: ColumnPosition }
  | { kind: 'drop'; columnRef: string }
  | { kind: 'alter'; columnRef: string; changes: {
      name?: string; type?: ColumnType; nullable?: boolean;
      default?: ColumnDefault; comment?: string; position?: ColumnPosition } };

// get：短独立连接读取，不取得表写锁。
schema.columns.get({ ...target, taskId })
  -> { snapshotId, ddlHash, columns, capabilities, warnings, expiresAt };
// preview：重新验证 get 快照，读取实际服务器状态，生成唯一 SQL 和风险说明。
schema.columns.preview({ snapshotId, patches: ColumnPatch[], taskId })
  -> { previewToken, expiresAt, targetSummary, ddlHash, sql,
       changes, warnings, requiredAcknowledgements, concurrencyPolicy: 'recheck-before-ddl' };
// apply 不收 target/SQL/patches；只执行执行进程内 token 绑定的计划。
schema.columns.apply({ previewToken, acknowledgements: string[], taskId })
  -> { ddlSubmitted: true, ddlCompleted: true, definitionVerified: boolean,
       warnings, after?: { ddlHash, columns }, verificationError?: string };
// 可选幂等释放入口仅清除内存令牌；预览不保留数据库连接。
schema.columns.release({ previewToken }) -> void;
```

默认预算：SHOW CREATE 最大 2 MiB、4096 列、单次至多 100 补丁、IPC 补丁 UTF-8 总量 512 KiB、最终 DDL 4 MiB；注释按服务器限制再校验。标识符字符数量/编码限制按服务器能力，不沿用通用显示名 256 长度当数据库保证。

所有对象 strict，拒绝额外 SQL、路径、连接覆盖字段、重复 columnRef/clientKey、空 changes、冲突目标、同一列 drop+alter、无效 AFTER、自引用/位置环。引用以快照中的不透明标识解析，不能仅用可能已重命名的显示名称。重命名交换环首批拒绝，不生成临时名称或多条 SQL。

## 6. 预览令牌、目标与结构竞态

### 生命周期

- get 用短独立连接读取有界元数据快照，完成即关闭连接；实际快照 TTL 120 秒，不保留锁。
- preview 另建短连接重读原定义并与 get 比较，生成预览后关闭连接。令牌只在执行进程内保存配置修订、公开目标摘要、实测服务器身份/版本、完整模式、原定义与唯一生成计划；实际 TTL 120 秒，整个执行进程至多 32 个快照及 32 个预览，总量 16 MiB。这是全局预算，不是每窗口额度；有效令牌不静默驱逐。不以用户等待确认时间占用物理连接或配置保存锁。
- apply 第一次尝试即消费令牌，包括校验失败、过期、取消或网络错误。先验证配置修订，再建立独立连接；在这个同一短物理会话内核对真实身份、模式、原定义和计划，发送唯一 ALTER 并取得结果。不能在重核后换连接执行。
- 身份由精确连接配置、配置修订、SSH/TLS目标与验证配置、握手方言/版本和服务器可取得标记组成。MySQL 可记录 server_uuid，Maria 的 hostname/server_id 等不足以证明全球唯一，界面不得把它描述为唯一服务器身份证明。任何已观测身份变化直接要求重预览；相同端点背后的透明代理切换不能仅靠这些标记绝对排除，属于标准模式已知边界。
- apply 记录本次实际物理 connection generation/thread id，不要求其等于已经关闭的 preview 会话编号。建连后到重核、执行和收尾期间均登记 withConnectionUse；配置不能在这段期间被替换。preview 后配置变化由修订检查使令牌失效。
- 关闭弹窗、预览替换、TTL、worker exit 清理内存令牌。get/preview/apply 在执行中的连接、SSH通道和取消任务都纳入 closeAll；清除任务记录不能先于实际资源收尾。
- 单次调用只能投递一次 DDL；超时、断线、窗口双击均不自动重试，不因 DDL 语法失败切换另一种语法重放。用户重新预览必须是新的明确操作。

### SHA 与锁

快照保留原始 SHOW CREATE 文本的 SHA-256，并另建结构比较摘要。若希望容许正常 INSERT 推进自增计数，只能由顶层 token 明确剔除表选项 `AUTO_INCREMENT=<counter>` 这一运行值；原始 SHA 仍保留。不能用全局正则删 AUTO_INCREMENT、注释或表选项。若未实现这个特例，宁可出现可解释的“定义已变化，请重预览”，不能放松其他结构比较。

**仅重读 SHA 后发送 ALTER 不提供原子 compare-and-swap**。外部工具可以在两条命令之间修改列，特别是 MODIFY 重述原片段会覆盖刚出现的新属性。进程内互斥或 GET_LOCK 只能协调本应用/自愿合作客户端，无法阻止任意外部 DDL。

**首批标准方案**：在 apply 的独立短会话中重核完整原定义和身份后，立即发送单条 ALTER；不要求额外 LOCK TABLES 权限，也不冒充事务性的结构比较。明确显示“执行前会重核定义，但外部工具仍可能在重核与执行之间修改结构；请在维护窗口执行，并暂停并行结构变更”。仅改变目标属性、保留其他片段降低了无意重建风险，但不消除目标列原定义被并发修改的风险。这个剩余窗口作为真实 DDL 模型说明，不自动把所有常用字段操作拒绝。

**可选强锁方案，暂不作为首批门槛**：用户明确选择并经基线验证后，在 apply 取得 LOCK TABLES WRITE，再同连接重核并发送唯一 ALTER。该模式需要额外 LOCK TABLES/SELECT 权限，会阻塞目标及可能关联表的读写；预览仍不持表锁。锁与引用表、分区、触发器的组合，以及锁到首条 ALTER 的保护是否连续，都必须取得五库真实并发证据。官方说明 ALTER 后显式表锁可能释放，因此不能声称连续多条 ALTER 受同一锁保护。若提供该可选模式，缺权限或验证不支持时明确失败，不暗中退回标准模式；用户可重新预览并明确选择标准风险策略。[MySQL 表锁规则](https://dev.mysql.com/doc/refman/8.0/en/lock-tables.html)

两种方案都禁止为了通过而关闭 foreign_key_checks、移除约束或扩大到全局读锁。外部视图、触发器、例程、应用 SQL 对列名的依赖不能从当前用户可见元数据中证明完整：显示该检查范围，重命名/删除明确要求核对外部依赖；不声称自动修复它们。

## 7. 执行状态、取消和结果

DDL 有隐式提交，用户 ROLLBACK 不能作为恢复方案；新功能只使用专用无业务事务连接，不接收 query sessionId，不提交或回滚 SQL 标签页的事务。单条语句降低部分变更风险，但 5.7、非事务引擎及断线边界必须准确说明，不能宣传跨五库的统一事务性保证。[MySQL 隐式提交规则](https://dev.mysql.com/doc/refman/8.0/en/implicit-commit.html)

任务从建连前登记，统一 taskId 空间，标准阶段至少 `connecting / reading / rechecking / executing / verifying / releasing`；waiting-lock 供可选锁策略使用。失败事件记录 `ddlSubmitted`、`ddlCompleted`、`definitionVerified`、`outcome: not-sent | succeeded | failed | unknown`，不得用普通 Promise 的 rejected 推断“DDL 没有发生”。普通 IPC 可以拒绝，但任务终态保留上述结构化进度。

准备和等待锁阶段取消使用本任务连接的 AbortSignal/KILL 控制；KILL 所用 threadId 必须属于仍存活的同一 generation，不得对迟到或已复用编号发 KILL。执行中取消只表示请求停止：必须等待驱动命令终态及连接关闭/服务端控制确认，不能先报已释放。KILL 权限错误如实失败，不能只断本地等待后宣称后台 DDL 已停止。

收到 DDL OK 后先保存 warningCount 并立即取该命令警告，再读取新定义；后续 SHOW CREATE 失败返回“DDL 已完成，结果核验失败”，不改报未执行。成功提交后到达的取消不伪装撤销。断线或 worker exit 且无法确定 OK 时标记 unknown，保留原预览 SQL/目标供人工核对，不自动重建反向 SQL。

锁释放和物理连接关闭的错误不能被吞掉；即使变更已完成，也独立报告清理状态。closeAll 覆盖连接尚未打开、预览内存令牌、等待锁、执行中和收尾中的资源，拒绝新任务。不能直接复用只显示“读取关联记录”的 helper 而让 DDL 终态语义失真，应抽取公共可取消独立任务调度并保留动作专属阶段。

## 8. 模块边界

| 文件 | 职责 |
| --- | --- |
| `src/shared/columnPatches.ts`（新） | 类型、严格校验、补丁预算、只读能力说明；浏览器可用 |
| `src/engine/createTableDefinition.ts`（新） | SHOW CREATE 源范围解析、未知片段、默认值读取、稳定摘要输入 |
| `src/engine/columnPatchSql.ts`（新） | 纯差异规划、受控类型/文字量编码、保留片段拼接、单 ALTER 校验 |
| `src/engine/tableColumnPatchTasks.ts`（新） | 有界快照/令牌、短独立会话、目标校验、执行状态机、TTL/取消/收尾；可选锁策略独立 |
| `src/engine/index.ts` | 新命令路由、统一编号/closeAll、实际配置 generation；旧 schema.apply 独立保留 |
| `src/engine/metadata.ts` | 提供未经旧默认值扁平化的原数据，必要时添加专用读取函数；不改变旧表页语义 |
| `src/shared/contracts.ts / commands.ts / validation.ts` | 完整 IPC 与 preload 白名单；不接受任意 SQL 作为 typed apply |
| `src/main/index.ts / taskPrivacy.ts` | 连接变更锁、失败阶段转发、退出等待；仅必要任务摘要落盘，不持久化列默认值或完整 DDL |
| `src/renderer/components/ColumnPatchDialog.tsx`（新） | 显式默认值种类、字段差异、只读限制、不可编辑 SQL 预览、风险确认和单次应用 |

不需要配置库迁移。快照、未应用草稿、完整 DDL 与令牌只在当前会话内；长期审计若后续要求，必须另定义默认值/注释隐私规则。

## 9. 必须完成的验收

本轮未运行以下测试。实施时每个 fixture 使用 200 服务器现有独立端口与唯一随机库，精确清理自身库；不依赖本机 Docker、不读取业务表、不新增密钥。五库分别记录版本、模式、权限和结果，不能从 8.4 外推其余四库。

### 纯解析与计划单元

- 全模式组合：NBE / ANSI_QUOTES / 二者同开；反引号、双引号双写、文本伪 DEFAULT/COMMENT、转义反斜线、嵌套括号、ENUM 逗号、可执行版本注释。
- 原型名称、Unicode、多字节边界、默认值 none/null/空文本/文本 NULL/数值零/超 JS 安全整数/小数末尾零/受控时间表达式，确认读取与编辑不互相混淆。
- 只改一个注释时仅一个目标列子句；无修改时拒绝生成 DDL。未修改复杂片段字节保持；目标未知属性不会被静默抹掉。
- 位置引用与新增列 clientKey、重命名后引用、重复/环/冲突补丁、列名碰撞、预算超限、SQL 注入文本、未知类型和额外字段。

### 五库真实 fixture

1. 基础表：自增主键、普通被改列、列字符集/排序规则、时间 ON UPDATE、精确 DECIMAL、BIT64、二进制默认值；分别新增/删除/重命名/类型扩缩/NULL/default/comment/position，核实际行和定义。
2. 复杂未改定义：前缀索引、全文/空间索引、适用版本的降序/函数/不可见索引、虚拟/存储生成列、CHECK、出向和跨库入向 FK、分区、ROW_FORMAT/表注释。功能因服务器不支持时记录真实建表拒绝；不要移除可支持基线的复杂属性使测试变简单。
3. 默认值矩阵：缺省、NULL、`''`、`'NULL'`、带引号/NUL/Unicode文本、CURRENT_TIMESTAMP(6)、现存非首批表达式。核对不编辑时无 DDL，编辑后 `INSERT` 省略字段的真实值，保证有意义而非只比生成 SQL。
4. 非严格模式数据收缩的 warning 与实际后果、严格模式非法转换失败、NOT NULL 遇 NULL、唯一/外键冲突；不自动纠正数据，不把 warning 当“未执行”。
5. 标准模式另会话在 get→preview、preview→apply 期间改定义，应重核拒绝；在重核→ALTER 的实际间隙注入外部 DDL，记录剩余竞态及其后果，不能把它写成已保护通过。若实现可选锁模式，再分别验证锁排队、锁后校验→ALTER 时外部 DDL 被阻塞，以及 ALTER 后锁释放、socket 归零。
6. 低权用户：可读不可 ALTER 必须保留预览并如实执行拒绝；可 ALTER 但无 LOCK TABLES 的用户应能完成标准方案；不可读某些引用定义明确依赖检查范围。可选锁模式缺权限失败不降级，不尝试提升权限，不临时关闭约束。
7. 取消：建连、SHOW CREATE 元数据锁等待、目标写锁等待、真实慢 ALTER、收到 OK 后核验失败/断线；观察实际 processlist/MDL 及最终 SHOW CREATE，断言无重复 DDL与资源释放。至少直连完整五库，SSH/TLS 各覆盖断线、取消和成功保留属性。
8. 用户 SQL 标签开启事务并写未提交值，执行独立结构操作后原标签状态和未提交数据保持；演示 DDL 不能用 UI 的事务回滚恢复。

### 真实 UI / IPC

- 三种默认值空态切换和文字量 NULL；仅单字段差异预览、复杂列旁的普通字段仍可编辑；只读属性有明确原因。
- 调用 apply 时没有 renderer SQL；篡改目标、追加属性、换配置、双击、令牌重用、过期、关闭再开均不能绕过预览。
- 外部修改后阻止应用并保留可重新基于最新定义调整的草稿；不能自动把旧 patch 重新预览并应用。
- 删除数据/收紧类型的后果确认与实际结果；失败后按钮不会自动重发；已成功但核验失败的状态不显示“修改未提交”。
- 弹窗关闭、取消、应用退出与 worker exit 后专用会话/SSH 通道/任务都收尾；原查询事务不被顺带回滚。

## 10. 实施顺序与发布门槛

先做原定义解析、默认值模型、单 ALTER 计划与标准模式五库验证；再实现预览令牌和生命周期，最后接字段 UI。标准模式明确保留外部 DDL 竞态说明，不增加强锁权限或预览长连接门槛。可选锁模式的连续性 probe 单列，未验证前不宣传强保护；某属性无法保留时只报告具体只读范围，不把 SQL fallback 算作完成。

本设计最大风险是重述目标列时遗漏属性、外部 DDL 竞态、隐式提交误导以及取消后仍有服务器工作。首批宁可让特定复杂列/操作明确只读，也必须让普通列的完整差异编辑真实可用；不能再由表上存在任意复杂属性而禁止整表编辑。

## 11. 纯读取器阶段记录（2026-10-14）

本阶段基于固定源码 `5a359ddde68a53a998e15b1903b61604d4e952a8`，只新增 `src/engine/tableColumnDefinition.ts`、`src/shared/tableColumnPatches.ts` 和独立单位测。未接入现有 CommandMap、元数据请求或 DDL 执行路径，没有本批实库、构建或 GUI 验收结论。

实际纯函数入口为 `parseTableColumnDefinition(source, { dialect, mode })`。先复用既有 SqlScriptScanner 校验单条完整语句，再由定义 token 层提供 UTF-16 精确范围。结果包含 head / items / separators / tail，及 columns 数组与内部 columnsByName Map。逐源范围连接可恢复完整输入，包括普通注释和空白；位置目前读取为 ordinal，不生成 FIRST/AFTER SQL。

类型、可空、DEFAULT、COMMENT 与常见复杂属性分别有源范围。生成列只读；未知后缀/类型/无法判定的默认值使该列属性只读，不连带禁用其他普通列。可执行版本属性保留为 opaque，不按当前方言猜测失效；可能改变顶层列边界的执行注释明确拒绝。表尾的分区版本注释作为完整原片段保留。本阶段不解析索引依赖，不把 access 当作服务器权限或最终执行能力。

共享文件提供严格 ColumnPatch 与 `validateColumnPatches`：none/null/literal/expression 分离、精确数字字符串、受控时间表达式、类型参数与预算。读取二进制默认值额外保留 hex/bits 编码和 introducer；它不等同于只能接收 hex 的修改模型。未来 get/preview/apply 输入输出仅导出 TypeScript 类型，尚无公开命令；属性存在性、位次环、服务器依赖及最终 SQL 仍待计划器实现。

验证：类型检查无诊断；新增 18 项纯读取/校验测试，以及既有 SQL scanner 41 项和参数词法 20 项，共 79 项通过。五种服务器形态使用静态语法夹具，仅用于纯解析与精确回放，不冒充五库实测。后续仍按第 9 节完成实际服务器与 UI 验收后才能宣称相应操作完成。

## 12. 纯补丁计划器阶段（2026-10-14）

本阶段新增 `src/engine/tableColumnPatchSql.ts` 及独立单元测试，仍未接公开 IPC、网络连接或执行入口。`buildTableColumnPatchSql(document, patches, { database, serverVersion, columnRefs })` 使用完整快照引用映射生成一条 ALTER，返回子句、最终字段顺序、后果确认及未修改原片段证据。最终执行所需身份、权限、模式与 SHA 重核仍由未来运行时负责。

仅默认值修改使用 ALTER COLUMN SET/DROP DEFAULT，只有改名时除 MySQL 5.7 外使用 RENAME COLUMN；其余需要重述目标列的操作只替换指定属性的源范围，保留目标列其余文字及注释。MySQL 5.7 改名使用 CHANGE COLUMN。旁列、索引、外键、分区与表选项不会放入 ALTER 重建。新增类型与默认值来自受控类型，数值默认值保持精确字符串；文本 NUL 暂明确拒绝，不能假称已覆盖。

位次以引用而非新名字解析，支持新增与改名后的 AFTER 链；引用环、同时要求多个最终 FIRST/LAST、最终名称碰撞、同批复用已删除/改名列旧名称均拒绝。相关索引、外键、CHECK、生成表达式和未知依赖阻止结构变化；分区或未知表尾保守限制结构变化，仍可修改已知普通列的注释/默认值或末尾新增。该依赖策略不是对外部视图、例程、触发器与入向外键的完整分析，必须保留限制说明。

补丁校验在 Zod 之前只遍历普通自有可枚举数据描述符，不调用 getter/toJSON，不 stringify 未知输入；递增计算 JSON UTF-8 字节及转义成本，并限制深度、字段数、数组和节点数量。超过 512 KiB 立即停止，循环、访问器、非普通对象、稀疏数组、非法 Unicode 与显式 undefined 拒绝。DEFAULT 后紧随 COLLATE 的输入整体视为不透明默认片段，不能误拆为列 collation；真实服务器规范输出的归属仍应由五库 fixture 单独证明。

共享模型补充未来 `TableColumnApplyProgress`（阶段、DDL 已提交/已完成、定义核验与 outcome），尚未写入现有 TaskEvent。`TableColumnView.editableType` 仅作为未来读取器确认可完整表达的受控类型投影，缺失时界面不得猜测原类型。本阶段不承诺任意 SHOW CREATE 表达式重述后语义等价，特别是 MariaDB 字符集引导默认表达式的规范化异常仍须真实重建探针确认。

定向验证（07:38）：类型检查无诊断，读取/预算 22 项、计划器 20 项、既有 SQL 41 项和参数词法 20 项共 103 项通过。这里的五版本分支仍是纯单元夹具，不替代独立真实五库执行证据；没有构建或 GUI 结果。


## 13. 短会话运行时实现范围（2026-10-14，待独立实库验收）

本阶段已接 schema.columns.get / preview / apply / release 与 TaskEvent.columnPatch，主进程把可信连接配置修订注入执行进程，并通过有界令牌到连接映射保护配置更新。get/preview 完成后关闭物理连接；apply 同一独立连接重新核对服务器身份、原始及规范模式、完整 SHOW CREATE 与目录元数据，然后只投递一次 ALTER。预览及快照的实际全局容量见第 6 节，未启用可选强锁，也没有原子比较承诺。AUTO_INCREMENT 等完整定义变化目前会使旧预览失效，需重新读取。

完整定义读取去掉 NO_FIELD_OPTIONS / NO_KEY_OPTIONS / NO_TABLE_OPTIONS 及 ANSI 等兼容聚合模式，保留展开的 ANSI_QUOTES / NO_BACKSLASH_ESCAPES，仅影响专用会话。真实 ANSI 夹具保留了 AUTO_INCREMENT，但省略索引注释和表尾；不能把它与其他省略模式混称自增丢失。I_S.COLUMNS 目录用于确认可空性及自增属性，列/表的字符集与排序规则用于证明服务器新增继承 COLLATE 等价；未知新增属性和语义变化不会误报核验成功。

MariaDB 10.11/11.4 原样 SHOW CREATE 重建反例已由独立取证确认：字符集引导默认表达式原值 À汉与重建值 xC3x80xE6xB1x89 不同。首轮产品实库进一步证明原生 RENAME 也损坏默认值，原先“专用改名和旁列保持可用”的推断已撤回。run04/run05 独立原生 SQL 探针证明旁列 COMMENT/RENAME/DROP/SET-DROP DEFAULT、ADD 都可能内部重述同一风险表达式；SHOW CREATE 文本不变、无警告、旧行不变仍不能证明后续默认求值保留。现在计划器以整表风险默认值清单阻止一切仍保留风险的字段 ALTER，后核验发现存续风险也不得返回 definitionVerified=true。

run06 在两 Maria 基线分别证明同一 ALTER 全部 SET 或全部 DROP 风险默认值正确，旧保留行不变。首版修复入口仅允许整批专用默认值补丁覆盖全部风险列，不开放夹带改名/旁列修改/删除列；修改一个风险默认值而保留另一个明确拒绝。普通无风险 Maria 表与 MySQL 不受此表级限制。无法可靠解析的 opaque 默认属性仍保留只读状态，不能承诺当前编辑器可解除所有风险。公开脱敏夹具仍只是 parser/planner 证据；本次保护的产品实库与 UI 须以修复后新轮结果判断，原失败证据保留。

收到 ALTER OK 即登记 ddlCompleted；存在警告时立即执行 SHOW WARNINGS LIMIT 20，先于任何后核验 SELECT。最多显示 20 条、单条 2048 字符、消息总预算 32 KiB，读取失败明确保留已完成事实。随后检查最终字段顺序、请求属性、未改字段及约束/表尾；无法证明的后置结果以已完成但未核验呈现，绝不执行逆向 DDL 或自动重试。持久化任务只用固定脱敏概要。

取消先限定仍属本任务和命令代次的线程，再由控制连接 KILL CONNECTION；成功 ACK 后继续等待原命令回调或真实连接终态，才关闭本地资源和释放任务编号。控制失败只能确认本地破坏，结果仍未知。真实 mysql2 的主动 destroy 可能只有底层 stream.close，因此本地 abort 也必须解除等待，不能把它冒充服务器 DDL 已结束。结构连接和取消控制连接的严格关闭观察 QUIT 写入错误、超时及本地 TCP/SSH 收尾；COM_QUIT 没有服务器 ACK，关闭成功不单独证明 DDL 后果。旧关联读取保持原有宽松关闭接口。

独立集成文件为 tests/integration/engine-column-patches.integration.test.ts，默认跳过。它使用 dbark_colpatch_ 加 12 位随机十六进制库名，不创建临时账户，支持现有直连/SSH/严格 TLS 环境；失败时先把定义及阶段证据写入 .cache/o01-integration-evidence/<随机库>，确认线程已结束后精确清库。若无法确认收尾，日志保留精确库名和已采样连接 ID 供独立核对，不重放失败 DDL。代码完成与纯单元通过不替代随后五基线、SSH/TLS、权限、真实取消和 UI 验收。


## 14. 时间默认值实际方言修正（2026-10-14）

首轮 UI 暴露 CURRENT_TIMESTAMP 默认值语法失败。独立五基线原生探针（.cache/o01-time-default-probe）确认：5.7 的 ALTER COLUMN SET DEFAULT 无论裸或括号时间表达式均拒绝；8.0.46/8.4.11 裸形式拒绝、括号形式通过并规范为 DEFAULT (now()) / (now(6))；两 Maria 裸/括号均可并规范 current_timestamp()。现计划器在发送前选择对应语法，5.7 用原列 MODIFY 仅替换 DEFAULT，保留 nullable、ON UPDATE、注释等全部其他片段。该差异不适用于 HEX/BIT 文字量，不能把所有默认值统一包括号。没有失败后 fallback 或 DDL 重放。

共享 readControlledTimestampDefault 只识别 CURRENT_TIMESTAMP、NOW 函数、0..6 精度和规范外括号，拒绝文字量、注释、运算及其他表达式；前端受控编辑、无变化检查、Maria 风险识别和执行后核验使用同一函数。它不会把任意默认表达式扩大为安全表达式。独立集成新增 0/6 精度、DATETIME/TIMESTAMP 省略值 INSERT 与同语句 NOW(6) 比较，微秒按字符串核对，原 ON UPDATE/注释仍要求保留。只有新轮真实产品测试通过才能补齐对应验收结论。


大对象默认值的后核验使用既有词法层剥除规范外括号，仅识别单个文本、数字、X/B/0x 二进制文字量。MySQL 8 的 TEXT 规范输出可为 `(_utf8mb4'…')`，仅在独立会话的真实列目录确认为 utf8mb4/同族排序规则、解码文本逐字符一致且可无损往返 UTF-8 时核验；其他引导器、字符集不符、concat、算术仍不能假定等价。直接文字量和括号形态使用相同限制，不将 I_S.COLUMN_DEFAULT 的展示文本替代 SHOW CREATE 语义。新增受支持版本 TEXT 文本/BLOB HEX 省略 INSERT 后实际 HEX 比较，以及 MySQL 5.7 非 NULL 大对象默认值预览拒绝用例；尚未取得该新产品用例真实结果时不宣称已完成五库支持。

run04-mysql-eight-four 产品用例确认大对象 `ALTER COLUMN SET DEFAULT` 返回 1101，原失败保留。随后 .cache/o01-lob-default-probe/run01-* 的五基线 40 个独立原生案例确认：MySQL 5.7 非 NULL TEXT/BLOB 默认值均拒绝；8.0.46/8.4.11 只有完整列 `MODIFY … DEFAULT (文字量)` 成功；Maria 10.11.19/11.4.13 的 SET/MODIFY 裸或括号形式均成功。因此 MySQL 8 支持版本预先选择仅替换 DEFAULT 的原列 MODIFY，原字符集、可空性、注释和其他属性精确保留，不在失败后重放。MySQL BLOB 规范为 `(0x00ff0127)`，Maria 为 `X'00ff0127'`；本轮 LOB SHOW 原协议 UTF-8 往返与实际 HEX 均已取得证据，但不能外推到 VARBINARY 或任意默认表达式。原生探针不替代修复后的产品 integration。


## 15. 同版本结构导出保护（2026-10-14）

已证 MariaDB SHOW CREATE 风险默认值重建失真也影响旧版 files.export 的 includeStructure 路径：0.7 及更早版本会原样交付该 DDL，不能从字段编辑保护推导自动结构导出安全。0.8 在现有独立导出连接内、创建 partial 文件前，按完整可信 sql_mode 解析表定义并使用同一整表风险判断；模式未知、会隐藏定义的兼容模式、Maria 不可证明默认值或 opaque 默认均明确拒绝含结构 SQL 导出。保留原目标文件，不猜修复 SQL，不删默认值，不新建网络会话或复用查询标签。

本防线只作用于含结构 SQL，数据-only SQL、CSV、JSON 沿用原路径；普通无风险表仍允许结构导出。新独立单位测执行生产文件写入路径，验证原目标保持、无 partial、失败任务和连接释放，以及三种纯数据格式与普通安全表继续可用。核心集成新增 Maria 风险表的结构拒绝、三格式数据输出、后续省略 INSERT 的默认 HEX 与旧行保持；该新轮结果仍须独立实库确认。历史已发布标签与验收记录不修改，0.8 修复范围不外推为任意表达式/模式的通用迁移保证。


结构导出的对象类型补充：tableInfo 现投影来自 information_schema.TABLES.TABLE_TYPE 的可选 objectKind（BASE TABLE→table，VIEW→view，其他保持未知）。仅基本表进入列定义风险解析；可信视图继续原样导出 SHOW CREATE VIEW 和数据，不以空 engine 或 CREATE 文本猜对象种类。两类对象都必须通过完整 SQL 模式/隐藏选项检查，未知对象类型拒绝含结构导出。新增生产导出文件回归及五版真实 VIEW 用例，避免新防护无说明地破坏原有视图导出入口。

## 16. 二进制文本默认值的独立保真边界（2026-10-14）

.cache/o01-varbinary-default-probe/run01-* 在 MySQL 5.7 与两 Maria 基线记录：VARBINARY 默认原值 `00FF`，5.7 的 SHOW CREATE 文本已是有效 UTF-8 的问号，Maria 原协议含非法 UTF-8 字节；重述该列或克隆结构后分别变为 `003F` / `00EFBFBD`。旁列 COMMENT 的真实结果仍为 `00FF`。I_S.COLUMN_DEFAULT 自身也丢失 FF，既不能从显示文本推断原值，也不能据此自动修复。本证据与 LOB 的有效原协议独立，不概括所有二进制默认均失真。

首批对 BINARY/VARBINARY 的非 NULL 普通文本默认，禁止目标列需要完整重述的操作，并拒绝含结构 SQL 导出。明确 X/0x/B 字节文字量不在该限制内。此限制不混入 Maria 任意表达式的整表 ALTER 风险：旁列及专用 SET/DROP DEFAULT、可靠删除仍可预览，但只要后定义仍保留这种文本二进制默认，就只能报告 DDL 已完成、完整定义未核验。界面将其默认值投影为带原因的 opaque，不把问号或替换字符当原值；内部可定位的 DEFAULT 范围仍允许用户显式覆盖，与语法本身无法定位的只读 opaque 区分。快照和预览警告列出具体列名。

旧整表设计器同样会重述全部列，因此 metadata 在既有 SHOW CREATE 上计算非枚举 unsupportedDesign 标记阻止该重建路径，不增加查询、不尝试 INSERT 探测或恢复默认字节。纯数据 SQL/CSV/JSON 不受此结构限制。新增生产级单测与独立 core 用例分别覆盖原文件保护、旁列实际保值、专用 setter 实际 HEX、旧行保持及未核验事实；远端产品结果仍以修复后的新轮测试为准。

## 17. 排序规则别名的可信目录解析（2026-10-14）

build04 的 MariaDB 11.4 默认库排序规则使结构读取失败，原 UI 失败保留。独立 .cache/o01-collation-catalog-probe/run01-* 两基线取证确认：11.4 未显式指定 COLLATE 时为 utf8mb4_uca1400_ai_ci；10.11 显式 utf8mb4_uca1400_as_cs 同样只有 CCSA.FULL_COLLATION_NAME 能精确找到完整别名，普通 COLLATIONS/CCSA.COLLATION_NAME 都不能直接匹配。两版 CCSA 均实际具有 FULL_COLLATION_NAME；不能将短名 uca1400_* 的 NULL 字符集或名称前缀当成字符集证据。

普通 COLLATIONS 精确解析成功的路径保持不变。只有基本表字符集缺失时，metadata 与字段任务共用受控解析器：先查询 CCSA 的实际字段能力，有 FULL_COLLATION_NAME 则按完整名匹配，否则用标准 COLLATION_NAME；再与真实 CHARACTER_SETS 目录相交，要求结果唯一、返回名称精确相同、字符集非空。空结果和冲突均明确拒绝，未执行 DDL。字段任务注入同一专用会话的可取消查询，不新增连接或重放结构命令。VIEW 的 NULL TABLE_COLLATION 保留原行为，不进入基本表别名解析。

core 隔离库改为仅指定 CHARACTER SET utf8mb4，让每个版本使用真实默认排序规则；新增普通继承表的读取、注释、新增 VARCHAR、INT 转 VARCHAR 和两 Maria 显式 UCA 用例。原明确 utf8mb4_bin 的继承专项仍保留。目录单元覆盖有/无 FULL 能力、空/冲突/错误名字、无真实字符集及视图回归；之前显式 bin 库的成功记录不能替代此修改后的五版、权限与界面新轮验收。
