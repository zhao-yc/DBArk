# 已返回查询结果的列头排序

本增量基于 `8b6bdea014221ae5fc64ebedef5827a7edbd8b91`，只改变SQL工作区已经返回、执行完毕的结果视图。点击可排序列头，或将键盘焦点放在列头后按Enter／空格，依次升序、降序、清除；“恢复原返回顺序”也可清除。一次只按一列排序，Ctrl/Cmd组合也不隐含多列规则。

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

共享接口保持：ResultGridSelection、ResultSelectionBinding、导出IPC、gridClipboard及ResultsGrid原复制／选择事件体不变。ResultsGrid仅增加可选sortReasons供本入口显示准入原因，继续复用原sort/onSortChange；其它消费者的服务端排序不接本地规则。带列名复制分支整合时应继续使用当前grid.rows及原selectionScope，不能将选择下标重新索引outcome.results的源rows。QueryTab及ResultsGrid公共接线由Root整合。

## 验证边界

规则单元验证精度、时间、NULL／空串、稳定性、预算、隐藏字段及原身份；React测试运行真实QueryTab、store、选择、查找、详情和导出对话框，仅虚拟布局与Monaco为内存端口。键盘测试提取本机锁定RDG包的实际HeaderCell.onKeyDown/onSort，连接真实QueryTab回调，在RAM验证Enter／空格三态，不宣称实际窗口键盘验收。原两个声明VM只补真实QueryResultSort依赖端口，不删原断言。

未接实库、系统剪贴板、GUI、build、CI或push。未证明平台窗口、安装包或实际MySQL排序；后续需要新的正式产品UI验收。具体本地命令、测试数、源码／bundle摘要及未验边界见本任务handoff。

本地最终相关验证为12文件163项（新增排序规则36、React入口20，原相关107），全部通过、无跳过；类型检查退出0。执行的是Vitest及TypeScript检查，未运行Playwright或原生窗口。旧的中间验证输出也保留在本clone自有缓存，没有用本地结果替换任何旧CI或scene记录。
