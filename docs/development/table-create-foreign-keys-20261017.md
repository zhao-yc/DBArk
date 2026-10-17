# 新建表外键：实际定义后核

本片在新的普通独立克隆 `employee4-table-create-fk-20261017`，从固定 `745cdc7acbef9b5da643f3b85e733dc2247176d0` 建立分支 `codex/employee4-table-create-fk-20261017`。不用worktree，不混入12d的8.0.46准备，不改原745/12d分支或Root候选。仅增强已收到CREATE ACK后的生产只读核验及必要纯反例。

## 行为

原实现对带FK的新表始终不能报告完整核验，即使实际定义正确。现在只有以下事实全部一致才可 `definitionVerified=true`：

1. 复用 `readTableForeignKeyDefinition`，从SHOW CREATE完整识别外键名称、子列顺序、父库/父表、父列顺序、ON UPDATE/DELETE，并逐项等于引擎持有的结构化设计；不把NO ACTION与RESTRICT合并，不按端口或大版本猜默认动作。省略动作只沿已有词法器的准确版本合同处理，未知继续未核验。
2. 只从索引分析中排除已完整证明的FK原范围；其它未知约束、CHECK、额外索引、前缀/特殊方法/未知属性仍由原守卫拒绝完整核验。列类型、精确默认值、自增、表属性和完整索引的原核验继续执行。
3. 复用原 `outgoingRows` 的固定投影、有界查询和字节预算。该函数只导出为 `readOutgoingForeignKeyRows`，原FK修改链仍调用相同读取实现，不重写目录SQL。RC最多256项，KCU最多8192项，总字节不超过4MiB；LIMIT+1识别截断。
4. 复用 `crossCheckForeignKeyCatalog`，将完整SHOW与REFERENTIAL_CONSTRAINTS、KEY_COLUMN_USAGE逐名称、有序元组、父子身份、动作和MATCH规则交叉核对；目录空集、缺项、重复、混入其它目标、未知父键位置或权限拒读都不能当作已证明。
5. 目录读取完成后再次读取同一准确目标的SHOW CREATE，须与前一次完整原文相同。已观测前后变化或复读未知均保留ACK但不报完整核验。这不是物理CAS或原子目录快照。

无FK路径不新增FK目录查询或第二次SHOW，原普通创建能力、版本路由、权限、生成器、单次令牌、确认项、实际strict close及未知目标锁均保持。查询或核验异常由原ACK后核边界转换成明确未完整核验，不重复CREATE、不ALTER/DROP补救、不提高权限。

## 保守边界

- 原设计器仍允许服务器自动创建FK支持索引；该CREATE能力不撤回。若SHOW/STATISTICS多出设计没有表达的隐式索引，本片不猜它的来源、名称或等价性，仍保留CREATE ACK且未完整核验。正常完整核验的复合FK用例显式声明子支持索引。
- 本片验证目标新表的实际FK定义和逻辑目录，不额外查询或修改父表，不承诺父表全结构/物理身份CAS、数据参照完整性审计或隐式索引来源证明。
- 创建ACK、完整定义核验和资源释放仍是三项独立事实；完整FK核验后strict close失败，仍为DDL完成、定义已核、资源未确认。
- 既有MySQL/Maria路径没有新增版本放行或限制。RAM路由/元数据夹具不等于任一实际版本数据库验收。

## 未来正式隔离UI准备

新增独立 `tests/e2e/table-create-foreign-keys.spec.ts`：list先于任何环境读取短路，新双门为 `DBARK_INTEGRATION_ENABLED` 与 `DBARK_TABLE_CREATE_FOREIGN_KEYS_UI`。即使两门开启也只注册skip，不加载live、驱动、桌面、认证或共享cleanup。没有新增可实际执行的UI回调，不改旧验收门、global fixture、helper、quitDesktop、timeout/retry或UI确认项。

未来由Root独占安排真实例时：任何隔离建库、父表准备或其它DDL前，先核本轮Root UUID、准确版本/OS/端口和明确凭据，且只读预检已实际关闭；通过现有设计器显式声明复合子支持索引和FK。真实观察RC/KCU及最终定义并确认apply完成。任务、窗口归属、实际退出或观察清理未知均停链保留，不能借默认取消/退出/DROP继续。该执行回调和验收证据须另行接线与独审，本片不声称已就绪或已验收。

## 纯验证

只复用工作区上层已有依赖，无安装或构建，无新增依赖junction。自己的ignored配置 `.cache/table-create-fk/vitest.config.mjs` 禁用envDir，worker守卫阻止网络、实际子进程、私料读取和密钥生成。

```powershell
node D:/svn/DBArk/node_modules/vitest/vitest.mjs run --config .cache/table-create-fk/vitest.config.mjs --reporter=json --outputFile=.cache/table-create-fk/pure-results.json
node D:/svn/DBArk/node_modules/typescript/bin/tsc --noEmit
```

11文件364项通过：真实Engine新建表79（原47+本片32）、新正式门/list12、旧main5/React14/接线8/list12/预检11、既有FK词法75/目录73/组合读取31/执行44。新增共44项有意义反例。正常MySQL/Maria复合FK、设计/SHOW映射矛盾、目录缺项/顺序/动作矛盾、权限拒读、前后变化、读取未知、模式省略、预算和关闭独立事实均覆盖；无FK回归明确断言只一次SHOW且不读FK目录。TypeScript `--noEmit`通过。

GUI、DB、Server-200、私料、clipboard、Docker、安装、CI、构建和生产部署全部为0。原生成器、Engine任务收尾、协议、旧正式入口和共享fixture/helper逐blob保持745。最终提交与推送、文件哈希见本片ignored交接摘要，Root仍需独审并安排实库。
