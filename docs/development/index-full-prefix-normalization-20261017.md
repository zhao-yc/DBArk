# 已有表满列前缀的整字段规范化

基线为Root已推 `7a423b7712ba80c4a9e8555e60f6d846fe14c93f`，分支为 `codex/employee1-index-full-prefix-normalize-20261017`。本产品提交只持有 `src/engine/tableIndexPatchSql.ts`、`tests/unit/table-index-fixed-prefix.test.ts` 和本文。

## 问题与准确依据

原计划保留 `CHAR(255)` 的 `column(255)`。服务器把覆盖整列的键部分显示为无前缀时，SHOW解析后的prefixLength为undefined，STATISTICS.SUB_PART为NULL；原计划仍为255，严格后核因此返回false。该问题同时影响SQL和finalIndexes模型，不能只修改验收期待或让verifier忽略真实前缀差异。

Root给定且本轮复核的准确[mysql-8.4.11官方源码2105–2111行](https://github.com/mysql/mysql-server/blob/mysql-8.4.11/sql/sql_show.cc#L2105-L2111)仅在键部分字节长度与字段完整键长度不同时显示前缀；[4049–4057行](https://github.com/mysql/mysql-server/blob/mysql-8.4.11/sql/sql_show.cc#L4049-L4057)对SUB_PART采用相应条件。[MySQL 8.4 STATISTICS文档](https://dev.mysql.com/doc/refman/8.4/en/information-schema-statistics-table.html)也说明整列索引的SUB_PART为NULL，字符/二进制前缀参数分别按字符/字节解释。这是准确源码和文档依据，尚非本次实库证明。

## 有界产品变化

只在checkedDefinition通过原类型、单位、长度及预算门后规范化：

- 类型严格限于CHAR、VARCHAR、BINARY、VARBINARY；TEXT/BLOB系列的显式前缀不删除。
- 可信目录maxLength必须是正安全整数，且请求prefixLength准确等于该长度。
- 前缀计算字节数必须准确等于独立已证fullKeyBytes；后者缺失、非安全整数、非正或矛盾均拒绝。
- 主键prefix仍在规范化之前拒绝，生成/隐藏/未知类型、错误单位、非法长度及总字节超限仍拒绝。
- 只删除解析克隆后的可选prefixLength，使生成SQL与finalIndexes同为整字段，仍按原计算成本累加预算。三列255×4加BINARY(12/13)的3072/3073边界原样保留，没有降至254。
- 规范后的定义若与旧整字段索引完全相同，返回noop，不误发DROP+ADD。真正部分前缀及服务端短一位仍由原verifier严格拒绝。

没有修改verifier、metadata、共享合同、UI、旧真实核心入口或安装计数。`3fc0142`原件保持；其中MAX案例的独立SUB_PART期待须在产品修复整合后另行修正，IGNORE_SPACE也须独立test-only提交，本产品提交均不混入。

## 红例与正常对照

先只修改目标测试，生产仍为7a原文件：39项中30通过、9失败。四种定长声明及3072组合均在原verifyIndexAfter返回false；另有满长完整成本缺失/矛盾、未知maxLength和旧全字段误重建反例。原日志及源码哈希保留于ignored `.cache/index-full-prefix-normalize-evidence-20261017/parent-red.log` 和 `parent-red-source.json`，未覆写为后来的绿结果。

修复后选定4文件115项通过、0跳过：目标39项、SQL规划20项、严格后核20项、Engine索引链36项。覆盖四种声明规范、无前缀SHOW/SUB_PART NULL、SQL/finalIndexes一致、缺失或矛盾成本、无效最大长度、主键、LOB不规范、3072/3073、旧全字段noop及服务端短一位。独立SHOW/目录均为明确合成事实，不宣称来自本次数据库。

```powershell
node D:/svn/DBArk/node_modules/vitest/vitest.mjs run tests/unit/table-index-fixed-prefix.test.ts tests/unit/table-index-patch-sql.test.ts tests/unit/table-index-verification.test.ts tests/unit/engine-index-patches.test.ts
node D:/svn/DBArk/node_modules/typescript/bin/tsc --noEmit
```

类型检查通过。使用当前公共源码、scripts、package及Vite配置的ignored独立快照执行原 `node scripts/build.mjs`；产物仅证明源码构建，不代表安装或原生功能验收，构建原日志与产物摘要另留本地证据目录。

实际DB、GUI、SSH、CIM、private材料读取、系统clipboard、CI、安装、Docker及200访问均为0。Root旧现场未检查或操作；真实验收继续由Root后续安排。
