# SQLite 表重建声明编译基础

本批为已有字段类型／默认值编辑的内部基础，尚未接入 IPC、事务执行或界面，不能在客户端使用，也不增加 R02 已完成功能计数。现有“管理 SQLite 字段”继续使用原生 ALTER；类型、默认值、列重排和主外键重建仍是待完成项。

## 编译边界

`src/shared/sqliteTableRebuildPlan.ts` 接收原 CREATE TABLE、准确表名、原生字段顺序及 hidden 标记、内部随机候选名和受限修改，返回候选 CREATE 及普通列／生成列映射。模块不访问数据库、文件、网络，不执行 SQL 或签发写能力。

- 有位置的词法器区分引用名、字符串、注释和嵌套表达式。除候选表名及指定类型／默认值跨度外，原切片保持不变；不借新建表设计器重建未知约束。
- 类型整体引用，空字符串表示明确去掉声明类型；不能夹带新约束或第二条语句。默认值沿用严格 typed builder，支持无 DEFAULT、NULL、文本、int64、REAL、BLOB 和三种时钟值；原自定义表达式不求值、不推断类型。
- 修改默认值时移除全部旧 DEFAULT 及其命名标记，避免早期默认值重新生效；保留外键的 SET DEFAULT、其它约束和非修改跨度内的注释。本模块不写入已有行，后续复制必须显式包含全部普通列。
- 保留 CHECK、COLLATE、ON CONFLICT、生成表达式、外键动作／DEFERRABLE、表选项及自引用原表名。生成列 hidden 必须与解析事实一致；普通列 `copy:true`，VIRTUAL／STORED 为 `false`。映射不包含隐藏 rowid 的保存方案。
- 区分 `GENERATED ALWAYS AS` 与类型名参与的 `GENERATED AS`；兼容连续／独立 CONSTRAINT、旧式 ON INSERT 和原生接受的重复表选项，不把后两者描述为新增业务语义。
- 只接收 main 普通表定义，拒绝 CTAS、虚拟表、其它数据库、额外 SQL、目录不一致及超预算。限制为 2MiB UTF8 SQL、300,000 token、1,024 列、128 个变更和 256 层括号；候选名固定 48 字符。倒序检查跨度后一次拼接，新增片段和最终输出分别计预算。

它只交叉核对字段名称、顺序及生成标记；不声称已证明声明类型／默认表达式的原生语义、数据转换无损或整份 schema 等价。调用方必须提供同一快照的真实目录；候选 SQL 仍可能因 STRICT、限定表名表达式、自定义排序规则等被 native 拒绝。

## 后续执行与界面

遵循 [SQLite 官方重建顺序](https://www.sqlite.org/lang_altertable.html#making_other_kinds_of_table_schema_changes)，继续实现独立的 `sqlite.tableRebuild.inspect/preview/apply/release` 能力。仍需完成：

1. 独立 writer 的私有 FK／legacy 选项及准确恢复，保持普通 SQL、ATTACH 和 defensive 限制。
2. 写锁内文件身份、连接代次及全目录复核；精确保留 rowid、WITHOUT ROWID 主键和 AUTOINCREMENT 原高水位。
3. 同一写事务内完整复制及逐值核对，不受现有结果上限截断，不用计数、抽样或哈希代替精度证明。复制不触发原业务触发器，任一失败整批回滚。
4. 恢复索引／触发器、核验外部依赖和外键，再接真实 COMMIT／ROLLBACK、取消、close／exit 及 unknown 不重放。
5. 明确读取、只读完整预览、准确原表确认、同库草稿保护及原生窗口验收。

编译成功和候选 CREATE 成功均不能替代上述门槛。[生成列规则](https://www.sqlite.org/gencol.html)要求区别普通列复制与生成值重算；原生亲和性也可能改变值，风险勾选不能绕过精度验证。

## 本批验证

WIN11-TEST 本轮 read_thread 不可达，未派发新测试；按既有授权回退本机 Windows x64，Node 24.17.0／SQLite 3.53.0。测试只用进程内合成库，不访问 Server-200、用户文件、剪贴板或安装版配置。

- 100 项编译核心测试通过，包含真实候选 CREATE、原目录保持、九类默认值、int64／NUL、生成列映射、引用名、自引用外键、STRICT／WITHOUT ROWID、旧兼容语法及一万份重复 DEFAULT。
- 加上原新建表／字段契约，三文件共 135 项通过，Vitest 最多四 worker，默认五秒门槛不变。
- 最终 `pnpm build` 包含严格类型检查及源码构建；原 Zod 注释和大 chunk 警告保留。未运行 GUI、安装包或新的跨平台验收，不用本批专项代替全量回归。

首轮 76／78：测试把 DOUBLE 声明中的最大 int64 默认值未来插入误当成 INTEGER 存储，另一个断言跨越了合法新增 DEFAULT 位置；原始失败日志保留。前者已补独立原生反例，实证 REAL 存储为 `9.2233720368547758e+18`，不能据候选可建便宣称精度保持。第一次构建后还有兼容性修正，因此最终冻结代码另跑构建；日志分别保留于忽略目录 `.cache/sqlite-rebuild-plan-20261101/`。

仅提交源码与文档，不生成开发包、不更新安装版、不创建 Release。
