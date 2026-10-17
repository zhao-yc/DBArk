# 列排序规则私有读取与纯范围核心候选

基线：`8200537a2ff6fe85f317df2d2323a1a1f96e4f17`。员工4交接JSON SHA256为 `148e7e7b81e05582955960f8f8695919fad2cfcf0190ddf2e1df9497e3421b7f`，其中设计正文SHA256为 `10f6af41e78cb9041e4c134cc0754c2662611116da7bb69b23100c9faf0f76a4`，均已核对。

## 本候选的准确范围

本批按Root允许的保守分阶段范围交付新私有helper和纯函数。没有改共享schema、四RPC、Tasks、主路由、UI或既有通用比较器。当前不是已开放的collation修改能力，不生成可直接执行的ALTER，不在任何生产入口接占位实现。

目录复用实际 `readIndexStructure`、`readTableDefaultEncodingCatalog`、`readTableDefaultEncodingAlter`，不另写索引/FK或编码目录副本。新读取器保留原base及原模式；同一规范结构会话中的后续读取只在比较副本上采用原normalizedMode，不覆盖base或放宽全局 `assertStructureDefinitionUnchanged`。

## 冻结的私有接口v1

| 接口 | 返回及边界 |
| --- | --- |
| `readColumnCollationFacts(context,target,base,refs)` | `status:'preparation'`带私有facts，或精确版本/明确目录权限不足时`status:'unavailable',execution:'blocked'`。要求读取base的同一原结构context。 |
| `ColumnCollationFacts` | `kind:'column-collation-preparation-v1'`、target、base、稳定references、完整indexes结果、实际catalog、直接ALTER证明、预算bytes，以及固定阻断的execution联合类型。只供执行进程，不属于IPC。 |
| `assertColumnCollationUnchanged(before,after)` | 重新比较完整定义、原/规范模式、有效编码、EXTRA、稳定引用、索引/FK、候选、权限与阻断状态；不等于允许执行。 |
| `buildColumnCollationDefinition(facts,columnRef,nextPair)` | 只返回`kind:'candidate-only'`的完整目标定义、唯一edit范围、原/新配对和保留证据；没有`sql`字段，execution固定blocked。不是完整任务计划或授权。 |
| `verifyColumnCollationChange(before,after,plan)` | 目标及旁列/目录范围匹配时`structuralMatch:true`，但`definitionVerified`始终false；缺物理/算法与外部依赖证明不得宣称完整核验。 |

## 已实施的读取与纯校验

- 仅握手及同会话 `VERSION()` 都精确为MySQL `8.4.11`时收集；其它版本不发目录查询。
- 使用完整稳定列引用；完整索引/FK读取两遍，第二遍采用第一遍真实映射，避免随机ref导致摘要漂移。编码候选也两遍比较摘要和内容，最后再次读完整表定义，防止拼接两个DDL/目录版本。
- 证据估算沿用真实reader预算并加原快照/候选/引用开销，单份准备结果限制16 MiB；Root接入共享缓存时仍须全量计量，不能仅保存摘要。
- 只有1142/1143/1227这类可识别目录权限不足可转为此属性不可用。取消、broken/fatal、认证1045、未知列/目录、锁超时、死锁、2013断线及未知异常均继续上抛；helper不拥有连接、不自行close，也不吸收外层资源收尾失败。
- 纯范围核心只接受真实候选的唯一同charset配对及实际差异；普通CHAR/VARCHAR的类型/长度/可空目录必须交叉一致。直接ALTER未证明、目标索引/入出FK、incoming不完整、hidden/分区/表达式索引、生成/CHECK/opaque/复杂默认及引导文字量均拒绝；表尾复用既有解析器，物理引擎参数注释仍拒绝。
- 有独立COLLATE时仅替换该属性范围；否则在原charset末尾或type末尾插入，放在NULL/default/comment之前。目标其它字节、旁列raw、约束、head和整个tail保留。范围经原解析器再读，不从Renderer值重建默认值/注释。
- 后核只剥离目标编码属性以允许显式/继承显示差异，并独立比较实际目标pair；旁列不适用此豁免。目标其它词法、所有列顺序/有效编码/EXTRA、索引/FK、表尾（含AUTO_INCREMENT）、身份与模式继续比较。索引只忽略因目标片段长度变化产生的绝对位置，保留完整索引词法和稳定引用。

## 仍须阻断，Root后续负责的读取缺口

**没有TABLE_ID/算法证据。** 本接口不接收任意新TABLE_ID、不接受algorithmVerified布尔，也不套用默认编码修改的同ID假设。Linux/ASCII/lower_case_table_names=0映射、BASE TABLE/ROW_FORMAT/实际表comment和精确AUTO_INCREMENT等独立物理表事实尚须Root接入可信读取。当前纯核心虽限制ASCII名称和已读InnoDB能力，也不能替代这些事实。

**没有完整外部依赖与可见性证明。** 只读到了现有索引/FK证据及直接ALTER权限；触发器、视图等外部引用完整性、所需全局目录可见性及保守角色/部分撤销边界尚未补齐，不能据空列表或ALTER=true推定不存在依赖。

因此execution始终为：`{kind:'blocked',reasons:['table-id-algorithm-unverified','external-dependencies-and-visibility-unverified']}`。纯候选用于审查精确范围，不用于get投影开放可写，更不能被Tasks直接执行；Root必须先补足并审核实际事实与TABLE_ID/算法策略，再设计新的执行授权状态。现有四RPC仍按原strict schema拒绝collation字段，未被本批放开。

## 本轮验证

实际运行仅新定向RAM套件和类型检查：

```powershell
node D:/svn/DBArk/node_modules/vitest/vitest.mjs run tests/unit/table-column-collation-sql.test.ts tests/unit/table-column-collation-read.test.ts --reporter=json --reporter=verbose --outputFile=.cache/column-collation-core/final-results.json
node D:/svn/DBArk/node_modules/typescript/bin/tsc --noEmit
```

RAM采用真实定义/索引解析及纯范围/后核函数；读取器测试仅替换被复用reader的传输边界，校验重读、稳定引用及错误传播，不声称已完成真实目录联合验收。首次60项中59通过，1项是末次规范会话mock仍返回原模式的夹具错误；原失败报告保留，修正夹具后60项通过；随后新增无默认/NULL默认、两份既有COLLATE fixture和版本/预算对照，最终64项通过。新增表达式fixture最初只因预期拒绝文案与更早的既有风险门不同而失败，修正为实际拒绝阶段，未放宽产品门。一次编译提示跨函数校验后的可选EXTRA未收窄，已按前置完整性门显式收窄，不删除检查。

本轮没有actualDB/SSH/Docker/私料/GUI/OS/full/build/clipboard或子智能体。精确提交、最终定向和类型结果及SHA256另见本任务ignored `.cache/column-collation-core/handoff.json`；Root独审、共享接线、物理读取、实际算法和界面验证均未完成。
