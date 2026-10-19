# 已返回查询结果的列头排序

本轮从已封存的 `e5cfcca`、`df66f9f` 提取排序及预算拒绝修复，接入 `codex/query-result-sort-20261020`；基线为已完成含列名复制的 `fe5e5c7`。独立普通克隆串行开发，不修改 0.28 冻结候选、旧副本或失败现场。只改变 SQL 工作区已经返回、执行完毕的结果视图。点击可排序列头，或将键盘焦点放在列头后按 Enter／空格，依次升序、降序、清除；“恢复原返回顺序”也可清除。一次只按一列排序，Ctrl/Cmd 组合也不隐含多列规则。

界面明确显示当前范围：不重发SQL，不改ORDER BY，不读取未返回记录，不采用数据库collation。截断结果单独提示。规则为NULL升序在前、降序在后；空串独立于NULL；相等键在两个方向都保持原返回次序。文本（包括JSON原文、ENUM/SET和字符串形式的BLOB/TEXT）按UTF-16代码单元比较，不做拼音、大小写折叠或JSON解析。

## 比较准入

- 使用Engine现有ResultColumn.type（mysql2协议类型名）；补充明确的普通SQL类型别名，不从列名或值外观推断类型。
- 整数与DECIMAL使用符号、整数位数及逐位小数比较；不转Number。明确UNSIGNED元数据不接纳负值。精确类型若已是非整数或不安全number则拒绝，避免把丢失的精度当作原值。FLOAT/DOUBLE只比较已返回的有限number，不把字符串猜为浮点。
- DATE、DATETIME、TIMESTAMP按返回的日期／时间字段比较，微秒保留到6位；TIME支持负值及最大838小时。均不转Number或Date，不推测时区或绝对时刻。零日期按原字段顺序处理。
- 字节包装、BIT/GEOMETRY、未知类型、类型不匹配、访问器及非法时间格式均明确禁用该列。BLOB元数据对应实际字符串时可按文本比较，真正二进制不解码排序。重复的源行对象引用或内部列key无法可靠交给原网格身份合同，拒绝排序并说明，不伪造行键。
- 有界准入：100000行、1024原列、2000000可见单元格、单值4096 UTF-16单位，候选键扫描累计8 Mi单位。超限显示原因，减少返回行数或可见列后再排序；不截断排序键，也不按局部值猜顺序。

## 行身份和既有接口

QueryResultSort保留source结果、源行／列引用及sourceIndices。排序只创建冻结的索引向量、行引用数组与QueryResult视图容器，原row对象、原columns数组、源SQL和数据都不克隆或修改；清除返回原结果对象。固定结果仍由原快照逻辑从原结果创建，不把显示排序写回固定快照本体。

QueryTab让原ResultExportSelection、QueryRowDetails、ResultsGrid及QueryResultFind共同绑定这份视图。RDG rowIdx和ResultGridSelection.indices只索引同一view.rows；显示第一行若来自source第3行，复制、查找、详情、勾选与导出拿到的仍是那个原行引用。详情翻行沿视图次序，完整原列保持。所有导出继续走既有显式确认窗口；本功能没有新增任何IPC、文件或剪贴板调用。

每次排序先撤销旧勾选、活动行、查找与详情，界面明确提示在新顺序重新选择。结果／固定快照／可见列布局／查询任务／连接修订／切标签／模态／关闭及卸载隔离；排序仅属于当次有效显示代次，不持久化。追加批次、列元数据、源数组或排序键漂移会撤销原租约。即使React尚未重绘，旧复制、导出、详情及排序动作也先核原排序来源；恢复原引用不能复活旧闭包。忙碌流式结果不能排序。

权限撤销与只读行显示分开：二进制等既有内联查看器打开模态时保留当前行引用数组，仅撤销旧选择／操作租约，避免更换rows导致查看器自动关闭。关闭后仍为同一原行，旧回调不能借恢复值重新使用。

共享接口保持：ResultGridSelection、ResultSelectionBinding、导出IPC、gridClipboard及ResultsGrid原复制／选择事件体不变。ResultsGrid仅增加可选sortReasons供本入口显示准入原因，继续复用原sort/onSortChange；其它消费者的服务端排序不接本地规则。本轮已与含列名复制整合，两者使用当前 grid.rows 及原 selectionScope，选择下标不重新索引 outcome.results 的源 rows；保留布局和字节查看器关闭后的同格重新选择修复。

## 验证边界

规则单元验证精度、时间、NULL／空串、稳定性、预算、隐藏字段及原身份；React测试运行真实QueryTab、store、选择、查找、详情和导出对话框，仅虚拟布局与Monaco为内存端口。键盘测试提取本机锁定RDG包的实际HeaderCell.onKeyDown/onSort，连接真实QueryTab回调，在RAM验证Enter／空格三态，不宣称实际窗口键盘验收。原两个声明VM只补真实QueryResultSort依赖端口，不删原断言。

本轮 Windows 使用本克隆独立安装的冻结依赖，实际执行：

```powershell
node scripts/check-local.mjs --build tests/unit/query-result-sort.test.ts tests/unit/query-result-sort-ui.test.tsx tests/unit/query-result-header-copy.test.ts tests/unit/query-result-header-copy-ui.test.tsx tests/unit/result-selected-query-port.test.ts tests/unit/ui-explain-plan-state.test.tsx tests/unit/result-selected-grid.test.tsx tests/unit/query-result-columns-ui.test.tsx tests/unit/query-result-columns.test.ts tests/unit/query-result-columns-revocation.test.ts tests/unit/query-row-details-ui.test.tsx tests/unit/query-result-find-ui.test.tsx tests/unit/query-result-find.test.ts tests/unit/ui-clipboard.test.ts
```

类型检查通过，14 文件 178 项全部通过，无跳过，普通构建通过。本地入口总耗时 68.63 秒：类型检查 34.48 秒、定向测试 3.83 秒、构建 30.32 秒。保留依赖注释和大包体积警告，退出码 0。测试包含排序规则 36 项、排序 React 入口 24 项、复制 React 入口 14 项及相关回归。新的排序/含列名复制组合测试验证重排列、精确 DECIMAL 排序、勾选矩阵、单格和恢复顺序共享同一视图，原 SQL 仅执行初始化的一次合成响应。两个旧 AST 端口只补真实排序依赖，保留原断言。

未连接实库、操作系统剪贴板或执行原生窗口、安装包、macOS 验收；本地结果不能替代这些层次，也不证明与 MySQL 排序规则相同。发行继续暂缓。

排序预算不会替代原能力守卫：有排序租约时核当前投影；bind因行／列预算拒绝时核准确未排序源，再分别校验原选择、详情或列管理租约。1025／4096列的真实QueryTab详情父端口保持原合同；原网格在超过1024列时已有选择租约限制，本次未扩大其UI能力。100001行及4097列继续按原能力预算拒绝，排序预算未放宽，不回退为全量导出。反例为原基线父端口2通过、首版排序提交2失败、修复后2通过；恢复原数组也不能复活已撤销的旧详情动作。
