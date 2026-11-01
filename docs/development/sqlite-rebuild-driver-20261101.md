# SQLite 重建私有连接与全量核对

后续增量已接入 [SQLite 已有字段类型与默认值编辑](sqlite-table-rebuild-20261101.md)。下文保留本基础批次的历史范围和原验证记录；当前业务入口及新证据以链接文档为准。

本批继续实现已有字段类型／默认值修改的执行基础。新增内部 writer、复制编号和完整候选核对；**尚未接入 Main 业务能力、渲染 IPC 或客户端界面**，不增加 R02 可用功能计数，不生成开发包或 Release。普通查询和现有表管理仍走原入口。

## 独立连接与资源确认

`SqliteDriverSession.openRebuild()` 固定创建读写的 `table-rebuild` 连接。普通 `open()` 不能透传 mode，worker 再次校验原型、完整自有字段和只读标志。只有该连接在安装普通 authorizer 前固定关闭 FK、开启 legacy alter 并读回；不借用查询会话、临时表或用户事务。

普通 SQL 仍不能修改 PRAGMA、ATTACH／DETACH、加载扩展或绕过 defensive／DQS。只有私有连接给候选附加字段和 window 内部投影保留额外原生列空间，上限为 `min(原生编译限, 2050)`；普通连接及结果头仍为 1,024 列，普通百万行／32MiB 门不变。字段值与 SQL 的原有限制继续生效。

私有连接有活动事务时拒绝正常 close，不隐式制造 ROLLBACK／COMMIT。调用方明确收束后，关闭路径仅临时放行固定的 legacy OFF／FK ON，读回后才发恢复标志、closed、closeAck，最后确认原进程 exit 0。失去恢复回执不能当作正常关闭；强退只能证明资源退出，不能补造回滚事实。

## 复制编号与完整比较

`compileSqliteTableRebuildCopyDefinition()` 复用原跨度编译器，在原首列名称 token 前加入随机 INTEGER NOT NULL 编号列，并提供独立完整唯一索引及移除语句。原首列前的空白和注释留在编号之前，避免原生 DROP 首列吞掉它们。编号不属于最终用户结构。

未来 Main 必须用固定 `INSERT OR ABORT` 显式复制全部普通列、真实 rowid 和连续编号；生成列不直接插入。源顺序取真实 rowid 或完整 WR 主键，各项明确 `COLLATE BINARY ASC`，不使用标签页当前排序。OR ABORT 防止原 ON CONFLICT IGNORE／REPLACE 静默丢行。

`rebuildCompare()` 是内部请求，不接收 SQL。比较器要求原 writer 的真实事务，并核对：

- 两端为准确 main 普通表、全部用户列顺序一致，候选仅多一个真实 INTEGER NOT NULL 编号；其唯一索引不能是 partial、表达式或多列替代物。
- rowid 表必须同时证明两端可访问的实际 rowid。未遮蔽伪别名或真正 INTEGER PRIMARY KEY 才可使用；列级 PK DESC 和普通唯一键不能冒充。候选失去最后别名时拒绝。
- WR 使用完整真实 PK 形成一致总序；候选即使因类型转换改变物理主键顺序，仍按编号和源行对应。
- 每组最多 256 个用户列，连同 typeof、TEXT 原字节及行身份最多 770 个结果列。双游标逐行核对、编号严格从 1 连续，两边都到真实结尾；所有组的完整行数一致才返回成功。

不累计全表到 JS，不抽样、不用摘要或 count 替代逐值证明，也不通过普通结果上限截断。每 256 行让出事件循环并检查取消；无行值进度逐帧 ACK，消费者未收束前保持 busy。进度是各组累计比较行数，最终等于 `verifiedRows × columnGroups`；成功结果只返回完整行数及组数，不含 SQL、值或目录。

## 精度与授权转换

全部用户列都参与检查，包括 VIRTUAL／STORED 的重算结果。同存储类型按 int64、REAL 的 `Object.is`、TEXT 原库编码字节、BLOB 原字节或 NULL 比较。跨类型前还要证明 TEXT 解码完整，保留 BOM 和 NUL，不借 JavaScript 替换字符掩盖坏字节。

`losslessColumns` 缺省为空：未改类型、仅修改默认值的列必须保持原存储类型。未来 Main 仅从实际字段类型变更生成准确白名单，不能给所有列开放转换。白名单中的 INTEGER／REAL 必须 BigInt 反算相同；TEXT 到数值还要求规范原文往返一致，TEXT→REAL 用十进制有理数与 IEEE754 精确分数核对。REAL→TEXT 必须还原相同数值及零符号。前导零、长小数舍入、超精确整数等仍拒绝，不能靠风险勾选放行。[SQLite 类型规则](https://www.sqlite.org/datatype3.html)

## 仍需完成的上层门槛

该通道证明的是**当前带编号候选**，不签发业务提交。后续继续实现原目录／文件／连接代次绑定、只读预览、写锁内复核、移除编号后的原值与完整 schema 后验、附属索引／触发器恢复、准确序列及全 FK 检查，再接真实业务事务回执、取消、草稿保护与界面。

不能仅比较用户列而遗漏隐藏 rowid；不能用 MAX(id) 替代 AUTOINCREMENT 原序列；不能假定 DROP 编号只影响候选。旧双引号定义可能使 DROP 拒绝或触发全 schema 修复，必须核对全部原定义并在意外变化时回滚。旧表限定 CHECK 也可能使候选 CREATE 拒绝。遵循[官方重建顺序](https://www.sqlite.org/lang_altertable.html#making_other_kinds_of_table_schema_changes)，不使用 writable_schema 修补。

## 本轮证据与范围

WIN11-TEST 本轮读取不可达且未派发新任务，按既有授权在本机 Windows x64 串行验证。仅用内存或独占临时 SQLite 文件；不访问 Server-200、用户配置、安装版、剪贴板或系统输入。Node 24.17.0／SQLite 3.53.0 的证据不能代替 Electron 窗口、安装包或 macOS 实测。

本地原始日志保留在忽略目录 `.cache/sqlite-rebuild-driver-20261101/`。复制校准覆盖首列注释／引用名精确保留、1,024 列、PK DESC、真实行号变号反例、WR 类型及排序变化、约束冲突、生成列、外部依赖、旧 DQS 拒绝后回滚，以及已删除自增高水位。真实 child worker 专项包含超过 32MiB payload、取消／消费者／busy、正常恢复关闭，以及真实编译→复制→完整核对→移除编号→提交→独立原盘回读。

| 验证 | 最终结果 | 原日志 |
| --- | --- | --- |
| 编译100、复制13、比较50、私有driver18及旧driver23 | 六文件204项通过 | `unit-final-09.log` |
| 全项目单元回归，最多四worker、默认超时不变 | 1,100文件22,563项通过，1个POSIX条件文件／用例跳过 | `unit-full-11.log` |
| 严格类型检查及源码构建 | `pnpm build`退出0；原Zod注释和大chunk警告保留 | `build-10.log` |

冻结后只补文档，不混入其它源码改动。转换授权门的加强在最终专项、构建和全量回归之前完成；两项夹具修正后的真正截短／负零反例保持原拒绝目的。

百万行逻辑用例使用真实 schema 加惰性模拟游标，不能作为百万行实库或性能验收。界面、Main 业务提交、新安装包和当前改动的三平台验收仍待后续闭合。

原失败分别保留：首轮临时编号插入位置误删原 leading trivia、窗口复制原生列预算不足；一个 rowid 投影断言因原生 IPK 输出重名失真，后改为准确别名；恢复 FK 后修改被引用父键被原生正确拒绝，后改为合法独立记录。比较首轮另有两项夹具假设错误：当前 REAL→TEXT 可精确往返，且 REAL 亲和性已把负零变正零。已独立原生 probe 核实，改用真正截短文本及无声明类型的 VIRTUAL 负零保留原拒绝目标，不放宽精度门。
