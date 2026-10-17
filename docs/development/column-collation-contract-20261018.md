# 列排序规则执行合同

本文记录 `988ca7b` 的合同冻结点和旧路径关闭保护。后续 UI、真实读取、Tasks 专用计划与后核已在独立任务分支接通，仍待整合及真实验收，见[最新检查点](../../tests/integration/acceptance-column-collation-integration-20261018.md)；不将合同单项计作完成。

- 原四个 `schema.columns` RPC 保持。已有列可选 `collation: { current, access }`，整表可选一次 `collationCatalog`。current 来自真实有效列编码，完整目录与私有事实同源并计入原总预算；不猜表默认值、不截断、不在每列重复。access 只表示快照能力，preview／apply 仍重新读取。
- `alter.changes.collation` 只接受严格 `{ charset, collation }` 配对。首片只能一项 alter、一个 collation 键；不能混入其它属性、列、新增或删除。共享校验只证明载荷形状，实际目录成员、同字符集、差异及权限由引擎证明。
- 不扩大旧七属性必填枚举。旧 SQL 计划器和旧前端属性路径明确拒绝新配对，防止忽略新键生成未变列 SQL。专用路径接通后才替换前端的关闭态保护。
- 目标先限准确 MySQL 8.4.11、Linux 名称映射、非分区 InnoDB、普通无索引 CHAR／VARCHAR；保留完整原定义、EXTRA、索引／外键及权限门。get→preview→apply 发送前比对实际物理身份；执行后 TABLE_ID 允许因服务器操作改变，不能由 ID 单独判断后核结果。
- 专用计划只生成一条完整原列的 MODIFY，唯一差异为请求的有效排序规则，保持其它属性。省略 ALGORITHM／LOCK，服务器可能选择重建；不得承诺 metadata-only 或无锁，见 [MySQL 8.4 ALTER TABLE](https://dev.mysql.com/doc/refman/8.4/en/alter-table.html)。
- 保留 `ddl-implicit-commit`、`external-ddl-window`，新增 `column-collation-semantics` 和 `column-collation-default-algorithm`。预览说明相关查询、视图及程序的比较／排序／分组／连接结果可能改变或冲突，以及重建、锁等待和读写影响。不把全服务器动态 SQL 的负证明设为永久门，也不承诺外部程序完全不受影响。
- apply 消费原令牌后单次提交；收到 OK 后保留完成事实，警告紧随 ACK 读取。专用后核检查目标、旁列、表尾、约束及实际目录的约定范围；失败须返回已完成但核验未通过，不能重放。release、取消、连接修订、窗口归属、严格关闭和原缓存总预算继续复用。

Root `run1552` 的共享合同、旧计划器、旧 UI 和 Main 四文件共 70 项通过，合并类型通过。首次 `run1550` 为 66 绿／4 红，原因是新增参数化测试将数组展开为多个实参；修正仅把测试行包为 `{ patches }`，原断言及载荷不变。原报告保留，四项单独补验通过后才形成上述新编号合并结果。

最终 70 项报告 SHA-256：`8f4d3491158dc259fca9c1dbbcbb61659e7e257a37a8d6975fee1562e377bfd2`。这些是合同及关闭态保护的验证，不是实库、GUI、安装或新三平台检查结果。

新三平台固定头 `c256c063b3e330649d59d8bcd21dfd6c108901b5` 的来源为 `b084246203a6a793a205e1a78366c6d72ec4a4e5`，不含本合同增量；两者必须分别报告，不能继承平台通过数。
