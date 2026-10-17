# 新建表前缀索引首片

基线为 `7a423b7712ba80c4a9e8555e60f6d846fe14c93f`。第一批可编译合同与计划器提交为 `8d9b55d1a7dfd0b7ac000a7667c347ba8456b55c`；后续提交接通设计器、确认页、专用任务和独立后核。

## 输入与能力边界

新表 API 使用 `TableCreateDraft` 严格合同：每个索引只允许 `columns` 或 `keyParts` 一种表示。`keyParts` 只包含准确字段名和可选正整数前缀，不接受 SQL、目录列引用或方向表达式。全局 `IndexInfo`、`TableDesign` 及公共 `buildDesign` 接口没有扩展；已有表编辑显式取回整字段模型。

只有实际包含前缀的请求读取专属事实，首片要求准确 MySQL 8.4.11、InnoDB、实际 16KiB 页及 DYNAMIC 默认行格式，DDL 显式包含 `ROW_FORMAT=DYNAMIC`。完整字符集 MAXLEN 目录和这些服务器事实绑定快照，预览、执行前及 ACK 后重新核对。旧无前缀输入不增加该能力读取，不限制原 MySQL 5.7/8.0、Maria、外键和显式编码配对路径。

计划列与实际目录列分开：只根据严格解析的待建类型及实际 MAXLEN 证明预算，不制造 COLUMNS 行。CHAR/VARCHAR 按字符、BINARY/VARBINARY 按字节；整数仅支持完整字段组合。每条索引最多 16 项、总键预算 3072 字节；主键前缀、含外键的前缀新表、未知索引类型、重复／缺失字段、不可证明的组合及超预算均在签发预览前拒绝。TEXT/BLOB、DESC、特殊索引及其他版本的前缀能力未开放。

等于声明全长的受控字符串前缀在计划层规范为完整字段，主键前缀仍先拒绝。生成 SQL、SHOW 及 `SUB_PART=NULL` 的期待保持一致；较短前缀逐值匹配，不扩大等价范围。该规则来自准确 [mysql-8.4.11 sql_show.cc](https://github.com/mysql/mysql-server/blob/mysql-8.4.11/sql/sql_show.cc#L2105-L2111) 及 [STATISTICS 文档](https://dev.mysql.com/doc/refman/8.4/en/information-schema-statistics-table.html) 的源码／文档推导，不是本任务实库验证。

## 生成与后核

新表字段选择和长度控件只维护结构化草稿，表示切换会删除旧表示；任何修改都撤销旧预览。确认页复制固定草稿，沿原准确目标、修订、TTL、风险勾选和单次令牌路径。生成器共用原列类型／默认值渲染规则，前缀索引单独从类型化计划渲染，不替换旧 SQL 或接受任意 SQL 参数。

CREATE ACK、完整定义核验及资源释放仍为独立事实。前缀路径核对完整 SHOW、真实 COLUMNS 的类型／字符长度／字节长度／编码、TABLES 行格式／排序规则、STATISTICS 的名称／列序／SUB_PART／唯一性／方法／方向／表达式与可见性，并最后复读 SHOW。只有 CREATE 后真实 COLUMNS 行才进入 `deriveTrustedIndexColumn`。目录不证明生成来源；显式索引来源由准确 CREATE 设计、完整 SHOW 一一对应及无外键边界共同约束。任一后核失败只保留 ACK，不补 DROP 或重放。

Maria 的表选项白名单未扩展。`src/engine/index.ts` 和 `connection.ts` 未修改；资源释放继续仅接受既有 `StructureTaskHost.onResourcesReleased` 可信通知，员工3的公共生命周期修复由 Root 后续整合。

## 本轮验证与未验收范围

相关纯测试、真实 ReactDOM／RAM 服务端口和真实 Engine／RAM 驱动测试分别保存为 `.cache/table-create-prefix/` 中 JSON 报告。包括组合总预算、类型／能力拒绝、等全长规范化、目录逐项不符、未知只保留 ACK、预览零 DDL、单次令牌、快照撤销、连接修订／ABA、字段控件和确认页双击。`075eac3`含补修的十份相关测试382/382通过、0跳过；类型检查、普通克隆隔离构建及真实默认关闭list均通过。原 7a423b7 普通目录执行同字节 Engine 测试：新前缀正常链为红，旧整字段正常预览为绿；按名称过滤的其他项不计为执行。初始调试失败报告保留，不当作产品父红。

类型检查和构建均在员工2普通克隆中完成，未安装依赖，构建产物不进入提交。真实 GUI、DB、SSH、CIM、私料读取、系统剪贴板、CI、安装及 Docker 操作全部为 0。内存驱动、React 端口和构建成功不能替代真实 MySQL／桌面验收。

## 默认关闭的正式准备

入口为 `tests/e2e/table-create-prefix.spec.ts`，`--list` 优先短路，不加载桌面或认证夹具。实跑须由 Root 同时明确 `DBARK_INTEGRATION_ENABLED=1`、`DBARK_TABLE_CREATE_PREFIX_UI=1`，本轮 13384 明文目标、UUID、既有账号以及 `DBARK_TEST_DATABASE=dbark_e2e_prefix_<32位小写十六进制>` 专用隔离库。代码不创建用户、不授权、不建库、不读取回填 env 或证书；正式表单仍沿产品安全保存密码流程，不能称为凭据仅 RAM。

正式场景通过真实字段／索引／确认控件创建随机表，另外使用应用受管的独立只读会话核对服务器、SHOW、TABLES、COLUMNS 和 STATISTICS，不额外创建裸驱动观察连接。继承已审的本地永久停链、原始 90 秒期限和所属桌面保护；失败／未知保留现场。成功后关闭受管会话和所属应用，**保留随机表供 Root 复核，不自动 DROP 或清理数据库**。Root 应冻结整合源码与产物、核对员工3生命周期修复，使用单 worker、零重试执行，再统一处理本轮明确的隔离资源。默认关闭的 list 占位不计作正式执行。


## 追加的目标与完整目录反例

端到端提交 `ecd868c` 后，追加真实React反例复现同连接数据库A→B→A未向冻结确认草稿传播父窗口失效的问题。父窗口现在显式传递永久失效标记，迟到预览只释放、不展示或提交。原红保存在 `target-window-red.json`，补修相关React／接线53项通过。

另以未建索引的实际二进制列为对照，原后核在长度、编码及EXTRA异常时仍可能报告完整：原报告 `unindexed-columns-red.json` 为1正常通过／4反例失败。现在所有实际COLUMNS行都进入真实目录语义核对，只有键列另外核预算能力；非键列不被伪造成计划键列。完整补修后采用 `accepted-final.json` 的382项全绿结果；此前376项及初始调试报告保留，不覆盖或混计。


## 父租约同步窗口补修

Root要求补查重绘前窗口后，075上的真实React反例为1正常通过／6失败（其余45项按名称过滤）：父观察先看到修订B、另一订阅同步恢复A并点击旧提交时，子订阅和React尚未重绘，单独invalid布尔未能阻止apply。另覆盖首次prepare，以及get、preview、旧能力释放和apply等待后的父租约失效。

父设计器现在将解析后的固定草稿与当次目标／修订／草稿代次／lifetime一起保存。确认页固定接受该父guard函数，函数内部活读父refs；每次请求前、等待后和结果回调前检查，首次false或异常永久撤销，后续true及ABA不能重领。迟到快照／预览只释放，已经发送的DDL事实留在原引擎任务，不回调新目标或重放。

本轮只改两个UI组件、相应React测试和本文档；引擎／共享合同未再修改，未重复382项。UI及接线60/60通过、0跳过，原红与固定头分别保存在 `.cache/table-create-prefix/live-parent/`。ECD原红及075的非键列后核差异继续保留；ECD的引擎审查仍须覆盖075差异，本轮UI补修没有增加引擎差异。W03及DefinitionViewer文件未动。


## 引擎元数据评审补修

员工1固定075评审暴露的三项问题由同一生产作者收口：mysql2真实文本解析器在大整数选项下返回页大小字符串；SHOW可能省略字符集默认COLLATE；非键BLOB两项目录长度同时缩小仍可能通过。原诊断用例及完整性文件只读复制留存，没有覆盖ECD、075或fd原红。

页大小和MAXLEN仅接受安全的正整数或规范十进制整数字符串，拒绝空白、前导零、指数、尾随字符和精度丢失。规范化后仍须准确满足16KiB和原能力约束，数字及字符串表示生成相同事实摘要。SHOW显式COLLATE继续逐字核对；只有省略时才读取同一实际会话的准确CHARACTER_SETS行，由DEFAULT_COLLATE_NAME及MAXLEN与TABLES和事实目录共同补证。缺失、重复、错字符集、错默认排序规则或容量矛盾都保留CREATE ACK，但不报完整后核。

所有实际列继续走目录适配器，非键列不能跳过。另按真实DATA_TYPE逐一证明TINYBLOB、BLOB、MEDIUMBLOB、LONGBLOB的255／65535／16777215／4294967295双长度容量及NULL字符集／排序规则；不从两个互相一致的短长度反推子类型。没有增加LOB索引能力，未扩大既有类型或未知选项的放行范围。容量及目录语义依据MySQL官方[字符串类型](https://dev.mysql.com/doc/refman/8.4/en/string-type-syntax.html)和[字符集目录](https://dev.mysql.com/doc/refman/8.4/en/information-schema-character-sets-table.html)。

补核先在503父版本记录1正常通过／4失败，其中三个引擎反例及一个服务open等待反例。新增引擎补核25项，连同原计划器33项和真实RAM引擎链35项共93/93通过。反例与目录缺失／矛盾、四种非键BLOB容量均由真实任务链核验，只替换传输；没有实际数据库执行，不把RAM结果当作MySQL验收。
