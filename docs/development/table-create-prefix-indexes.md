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

相关纯测试、真实 ReactDOM／RAM 服务端口和真实 Engine／RAM 驱动测试分别保存为 `.cache/table-create-prefix/` 中 JSON 报告。包括组合总预算、类型／能力拒绝、等全长规范化、目录逐项不符、未知只保留 ACK、预览零 DDL、单次令牌、快照撤销、连接修订／ABA、字段控件和确认页双击。最终十份相关测试376/376通过、0跳过；类型检查、普通克隆隔离构建及真实默认关闭list均通过。原 7a423b7 普通目录执行同字节 Engine 测试：新前缀正常链为红，旧整字段正常预览为绿；按名称过滤的其他项不计为执行。初始调试失败报告保留，不当作产品父红。

类型检查和构建均在员工2普通克隆中完成，未安装依赖，构建产物不进入提交。真实 GUI、DB、SSH、CIM、私料读取、系统剪贴板、CI、安装及 Docker 操作全部为 0。内存驱动、React 端口和构建成功不能替代真实 MySQL／桌面验收。

## 默认关闭的正式准备

入口为 `tests/e2e/table-create-prefix.spec.ts`，`--list` 优先短路，不加载桌面或认证夹具。实跑须由 Root 同时明确 `DBARK_INTEGRATION_ENABLED=1`、`DBARK_TABLE_CREATE_PREFIX_UI=1`，本轮 13384 明文目标、UUID、既有账号以及 `DBARK_TEST_DATABASE=dbark_e2e_prefix_<32位小写十六进制>` 专用隔离库。代码不创建用户、不授权、不建库、不读取回填 env 或证书；正式表单仍沿产品安全保存密码流程，不能称为凭据仅 RAM。

正式场景通过真实字段／索引／确认控件创建随机表，另外使用应用受管的独立只读会话核对服务器、SHOW、TABLES、COLUMNS 和 STATISTICS，不额外创建裸驱动观察连接。继承已审的本地永久停链、原始 90 秒期限和所属桌面保护；失败／未知保留现场。成功后关闭受管会话和所属应用，**保留随机表供 Root 复核，不自动 DROP 或清理数据库**。Root 应冻结整合源码与产物、核对员工3生命周期修复，使用单 worker、零重试执行，再统一处理本轮明确的隔离资源。默认关闭的 list 占位不计作正式执行。
