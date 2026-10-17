# 单列排序规则私有执行计划与专用后核

固定基线：`101fbb4019026e6dee0a3e9976d53ea7bd1856a4`。普通克隆 `D:\svn\DBArk\.cache\parallel-20261015\employee3-column-collation-execution-20261018`，分支 `codex/employee3-column-collation-execution-20261018`。本片只新增 `tableColumnCollationExecution.ts`、独立RAM单测和本文；不改shared、Tasks、UI、main、物理reader或旧v1准备模块，仅保留本地提交。

## 冻结接口

```ts
buildColumnCollationExecutionPlan(
  facts: ColumnCollationFacts,
  physical: Extract<ColumnCollationPhysicalResult, {status:'observed'}>,
  columnRef: string, next: TableEncodingPair
): ColumnCollationExecutionPlan
verifyColumnCollationExecution(
  beforeFacts: ColumnCollationFacts, afterFacts: ColumnCollationFacts,
  beforePhysical: Extract<ColumnCollationPhysicalResult, {status:'observed'}>,
  afterPhysical: Extract<ColumnCollationPhysicalResult, {status:'observed'}>,
  plan: ColumnCollationExecutionPlan
): {definitionVerified:boolean; tableIdChanged:boolean; reasons:string[]}
```

计划保留Root冻结的`kind:'column-collation-execution-v1' / candidate / sql / warnings:string[] / requiredAcknowledgements:string[]`。追加私有字段为：`target、columnRef、columnName、before、next、originalSourceDigest、beforeFacts、beforePhysical`。其中beforeFacts/physical是独立完整副本，普通数据对象及数组冻结；Map独立复制且保留只读类型，运行时Map条目若被改写，后核完整重建会拒绝。Tasks应把这些副本计入私有缓存预算，不能将原plan或facts开放为IPC输入/输出；返回公共预览时仅按共享合同挑选字段并复制数组，不追加修改私有warnings/ACK。

requiredAcknowledgements精确为`['ddl-implicit-commit','external-ddl-window','column-collation-semantics','column-collation-default-algorithm']`，后两项直接复用冻结共享常量，Tasks不要再次拼接重复旧ACK。

## 核对与边界

构造器先拒绝Proxy、访问器、自定义原型、循环、非有限数值及超预算证据，再核private facts字段/完整引用、原source、索引事实及服务器/规范模式一致性。物理结果只接受observed、准确target/serverIdentity、MySQL8.4.11、Linux/debian-linux-gnu与原reported值、lowerCaseTableNames=数值0、BASE TABLE/InnoDB、无分区、准确INNODB_TABLES目录和`database/table`映射；TABLE_ID必须是1至uint64上限的十进制原字符串，不转Number。

复用原candidate-only builder和冻结配对schema，核独立原source SHA256及候选原摘要/范围，只拼一条`ALTER TABLE qualified_target MODIFY COLUMN candidate.definition`，没有额外ALGORITHM、LOCK、FIRST、AFTER或自执行。普通CHAR/VARCHAR、同字符集、直接ALTER、真实候选唯一配对、完整索引/FK及原core其它硬门继续生效；当前未发现必须修改原v1数组才能满足本片的阻断。

后核先用传入的真实原事实/物理结果重建完整plan，包含SQL、候选/范围、源摘要、私有快照、四ACK和warnings逐内容核对；再聚合原`verifyColumnCollationChange(...).structuralMatch`及post物理映射。post TABLE_ID可变，但准确serverIdentity、逻辑target及所有mapping必须相同。原v1门仍固定blocked，原后核仍固定definitionVerified=false，均未改动。

新definitionVerified=true**仅表示已读取定义范围匹配**，不证明数据、实际算法、外部程序语义或持续无并发DDL。tableIdChanged仅由两份有效且同映射的原ID文本比较；失败时false只表示没有确认变化，不能用它证明物理表稳定。原始模式保留在beforeFacts；post事实须满足旧core要求的`before.normalizedMode === after.originalMode`，不得改写旧快照来伪造匹配。

完整同值的RAM对象无法自行证明来自真实数据库，本模块不是事实认证入口。Root必须仅把Tasks内部真实reader的原始结果传入，负责预执行重读、ACK、缓存、任务进度、发送、取消及严格收尾；本模块不调用DDL、reader、Tasks或网络。

## 实际验证

### V2：对象键漏计的窄修

员工1对固定3431的独审发现：`base`增加33,554,433字节普通自有旁键、值为1且reader声明bytes不变时，原复制器只计字符串值，仍保留该键并返回计划。此项是私有畸形输入的预算缺口，没有证明外部入口、远程可利用或实际DDL发送。原红记录封存在本克隆`.cache/column-collation-execution-budget-v2/original-red`，不改写原独审目录。

V2保持32MiB、300000节点、48层深度门和既有接口。每次复制调用的32MiB为UTF-8内容及文本结构预算：普通对象键和字符串值按原始UTF-8字节加引号2收费；对象字段另加冒号/分隔2，容器加2，数组每项加分隔1，Map每项加条目/分隔4；null/undefined/boolean/有限number按其文本长度收费。对象引用复用时只复制并收费一次容器及其内容；每个字段键和每次出现的字符串值仍各自收费。普通对象在读取属性描述符和写入副本前先给键收费，Map键继续走字符串复制路径。

这是限定内容与逻辑文本结构的预算，不是JSON序列化大小或严格堆内存上限；不计JSON转义膨胀、V8对象/属性开销、输入本体、枚举临时数组、摘要临时字符串或并存的多次复制峰值。节点/深度门独立约束容器结构；Root Tasks仍需对实际保留的facts/plan及公共投影计总缓存成本，不能用该单次预算替代缓存总额。

新`table-column-collation-execution-budget.test.ts`仅通过AST提取真实私有复制器测键/Map/值同预算、中文UTF-8、恰界与超1字节、ASCII旁键、引用/访问器和节点/深度门；不新增生产导出。原E6保持独立真实RAM reader准备路径，仅在隔离副本重定位源码路径后复验。没有重复55项旧执行计划测试。

V2实跑：原E6单项通过（同文件其它7组明确跳过），新增7项边界对照通过，`tsc --noEmit`及`git diff --check`通过。隔离E6首次因Vitest默认排除`.cache`未找到测试；调整专用配置的exclude后实际执行并通过，原首次输出未作为测试通过证据。报告分别为`.cache/column-collation-execution-budget-v2/original-e6-fixed.json`及`boundaries.json`。

以下55项及其报告SHA为3431原片历史验证，本次V2未重跑。

`node node_modules/vitest/vitest.mjs run tests/unit/table-column-collation-execution.test.ts --reporter=json --outputFile=.cache/column-collation-execution/tests.json`：55项RAM通过，覆盖非observed/伪造mapping/不同目标、uint64及相邻超安全整数、同ID定义错、新ID定义正确、原物理租约变化、源/范围/SQL/ACK/warnings/私有快照篡改、原v1 blocked/false、原模式保留、反射副作用拒绝。

`node node_modules/typescript/bin/tsc --noEmit`及`git diff --check`通过。报告SHA256：`751abcb60ec26cdcfdb8cd2fde9c7950485ccdc677dfa4fbff09a4f9458f07fa`。没有实库、网络、认证、GUI、剪贴板、full/build或DDL执行；未操作远端。Root整合后再做真实函数连测。
