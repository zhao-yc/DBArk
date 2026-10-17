# 复制空表结构：普通数值生成列最小支持

本片从Root普通整合固定 `c1384b6706166616464c2d8a74703d80331c79d2`，建立新的普通独立克隆及 `codex/employee4-copy-generated-20261017` 分支；不用worktree，不改Root、R93候选或原作者固定分支。只追加复制空表结构的生成列支持，不复制行数据，不改通用SQL生成器。

## 实现范围与依据

[MySQL8.4生成列说明](https://dev.mysql.com/doc/refman/8.4/en/create-table-generated-columns.html)明确CREATE TABLE LIKE会保留生成列信息；[COLUMNS说明](https://dev.mysql.com/doc/refman/8.4/en/information-schema-columns-table.html)提供生成表达式及EXTRA事实。文档仅作为接口依据，不能替代本片真实服务器验收。

仅开放准确MySQL8.4.11（允许无空白发行后缀）的普通整数/DECIMAL生成列，VIRTUAL和STORED必须在完整SHOW中明确出现。表达式只接受明确引用名、前置普通整数/DECIMAL列、十进制文字量、括号、正负号及 `+ - *`；引用不能指向自增列、生成列、自身或后置列。明确引用按SHOW中的引用标识符读取，不把裸关键字/无括号函数猜成列名。多次引用和顺序保留，不排序、不去重、不用JS Number换算文字量。

函数、DEFAULT取值、子查询、变量、跨目标限定、字符串、十六进制/指数数值、除法/取模、生成列链、前向依赖、表达式注释和未知语法均只读；数值类型以外的生成列暂不支持。普通默认表达式依赖生成列也只读。单表达式最长2048字符/256 token、深度16、最多32次引用，最多32个生成列。Maria、5.7、8.0及其它8.4补丁的生成列均不因此放行。原8.0普通列/自增能力仍保留。

## 保真与未知停链

- 通用读取仅保留原本已读取但曾丢弃的内部EXTRA；不新增通用字段修改权限，不解除解析器对生成列的只读标记。
- 复制用途看到SHOW生成属性或EXTRA生成标记，才增加一次有界完整COLUMNS读取。若SHOW漏生成属性而EXTRA有标记，不能误当普通列。普通无生成列路径不增加这次SQL。
- 逐列核名称、ORDINAL_POSITION、DATA_TYPE/COLUMN_TYPE、可空性、EXTRA、COLUMN_DEFAULT、GENERATION_EXPRESSION及前次已有EXTRA。生成方式须准确为 `VIRTUAL GENERATED` 或 `STORED GENERATED`，生成列默认值必须为SQL NULL，不能将生成表达式当默认值；普通列必须没有生成表达式，未知EXTRA不放行。普通列在此最小生成列组合中只接受空EXTRA、auto_increment或与显式表达式默认值一致的DEFAULT_GENERATED；含自动更新时间等其它EXTRA组合暂不支持。
- 表达式只做有界词法/语法证明，不eval、不计算、不生成新DDL。目录比较只忽略分隔空白及包围整个表达式的外括号，保留内部结合、文字量字符串和引用顺序，不用数学等价或舍入补证。
- 真正执行仍为原来唯一同库CREATE TABLE LIKE。原完整SHOW正文（只豁免目标名称及既有准确顶层自增计数规则）保持逐字比较；生成目录事实也绑定快照、预览重核、来源后核和新表后核。目录缺失、拒读、前后矛盾或额外未知属性均不能报完整核验。
- 原Linux、lower_case_table_names=0、永久非分区InnoDB、原生TABLE_ID、UUID/模式/编码、GIPK、权限、外键/触发器/视图依赖、索引和表选项守卫不豁免。原有源/目标锁、单次令牌、真实取消/关闭及ACK后不重放、不ALTER/DROP补救保持。

## 最小协议与界面接线

未增加命令或客户端SQL/表达式输入。get/preview仅增加可选只读 `generatedColumns` 摘要，名称、VIRTUAL/STORED、原表达式及引用顺序都由服务端快照产生；返回对象为克隆，不能改写引擎持有计划。预览摘要与get不一致时界面释放能力并拒绝响应。

新增专属确认 `generated-columns-copy`。普通路径仍三项，自增路径仍四项，生成列四项，自增与不引用自增列的生成列共存时五项；两种专属风险不能替代。旧客户端不认识新风险时不能执行。主进程仅扩大该用途已知确认枚举及上限，不接受客户端生成列表达式/计划字段。界面新增文字在共享生成列文案及 `tableCopyStructure.zh-CN.ts` 集中，原表达式作为只读文本展示。

## 父红新绿和纯验证

生产父版本未改时，仅给RAM驱动补齐固定生成列SHOW/目录事实，两条VIRTUAL/STORED反例均在 `writable=false` 处按修复后预期失败；不是模块缺失或网络失败。记录为 `.cache/copy-generated/parent-red.json`。当前相同两例转绿，并沿真实Engine执行预览、准确确认、唯一LIKE和后核。可用当前测试覆盖父源码并筛选“普通生成列应沿既有链创建空表并完整核验”独立复现。

自己的ignored配置 `.cache/copy-generated/vitest.config.mjs` 禁用envDir，worker守卫禁止实际网络、子进程、私料读取和密钥生成；只复用上层现有依赖，没有安装、构建或创建依赖junction。

```powershell
node D:/svn/DBArk/node_modules/vitest/vitest.mjs run --config .cache/copy-generated/vitest.config.mjs --reporter=json --outputFile=.cache/copy-generated/final-results.json
node D:/svn/DBArk/node_modules/typescript/bin/tsc --noEmit
```

13文件累计389项通过：完整矩阵385项通过后，补充精确协议/五项真实React确认及引用顺序/数值末位反例，相关文件分别复测通过；其余文件未改。当前分项：真实Engine复制94、生成词法/确认44、真实ReactDOM25、正式入口及前置18、专用清理14、普通复制SQL16、计数18、8.0普通复制19、main4、接线6、原自增67、注释33及重命名31。TypeScript `--noEmit`通过。RAM严格区分生产实现与外界端口替身，不冒充GUI或数据库验收。

## 默认关闭正式定义与缺项

新增 `table-copy-generated.spec.ts`，list优先短路，只有 `DBARK_INTEGRATION_ENABLED=1` 与 `DBARK_TABLE_COPY_GENERATED_UI=1` 且准确13384/plain原始凭据通过，才加载正式定义；发现回填文件时拒绝加载。定义分别注册VIRTUAL与STORED两例，实际版本/OS/名称模式及Root UUID在任何隔离建库前核对，未知停链；同库合成源行只用于验证原数据未变化，目标仍必须空。新确认与原表达式展示均纳入界面步骤。

原 `8c1965c` 专用退出/清理直接复用原 `cleanupTableCopyStructureCase`。独审发现正式入口的owner只检查窗口、未持续固定本轮配置；本次追加用途专属身份及收尾壳，原共享清理、fixture、live-helpers、quitDesktop、复制正式入口及既有超时/重试均不修改。真正双门开启CLI `--list --workers=1 --retries=0 --trace=off --reporter=json` 只收集默认关闭身份，errors=0、results为空，无实际例执行。

## 独审GEN-UI-R1追加修复

独审handoff SHA256为 `0bafea94e07ac610fde5142b73c39fb466da8824f424cd7ea5280d0df1fa7e7a`。四种漂移（helper凭据、helper目标、raw/helper一致变化、表单等待后凭据）在保留原生产正式入口时均到达RAM建库提交边界，复现为四红；修复后同一组全部在提交前拒绝。记录分别为 `.cache/copy-generated/owner-parent-red.json` 和 `owner-final-results.json`。

注册时固定raw自有host/port/TLS/user/password/Root UUID，原始配置与helper必须显式一致，空密码仍合法。每个关键等待前后重新核对实时raw和helper的值与自有属性；发现一次变化后永久失效，即便恢复也不重新绑定。owner同时固定本例TestInfo、page和application，传入原 `connectAndCreate` 内部等待，表单不会因全局helper变化而继续使用漂移凭据建库。

任何DDL之前，先用无默认库观察连接核准确8.4.11、Linux、lower_case_table_names=0及固定Root UUID，并通过产品严格QUIT等待同一原生流close。Promise end、缺原生连接/流和QUIT回调均不能替代close。严格预检结束后再开本例观察连接并重新核四项事实及隔离名称缺席，再走真实表单。漂移、观察未知或UI失败立即保留，不自动退出或清库；清理只在身份有效、任务终态及所属退出均已确认后推进，DROP未知不重试，原失败保留为AggregateError首项及cause。

新增纯测执行真实注册函数、原表单函数及用途专属清理，覆盖内部等待、DDL前漂移、原生close延迟/失败、原始自有属性、UUID/版本/OS/模式拒绝、任务未终态、退出未知、DROP未知和保留失败。未变更产品生成列复制逻辑、共享fixture/helper/quit或原120秒预算与0重试；GUI、DB、SSH/200、CI、安装、clipboard和构建仍均为0。真实生成列UI验收仍须Root独审通过后另行安排。

本轮GUI、DB、SSH/200、CI、安装、构建、clipboard及部署均为0，不读私料。函数/字符串/时间等复杂表达式、生成列链、其它版本和更多EXTRA组合仍缺项，已明确只读。Root须独审并在新的准确8.4.11隔离库实际核验，不能把本片开发/文档或父红新绿当作真实验收；不自动合并或修改R93候选。
