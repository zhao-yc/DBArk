# O01 表字段原始定义取证方案与记录

状态：2026-10-14，五基线定义取证共取得 164 份原始 SHOW CREATE，选取 15 份结构建立纯函数回归。后续原生 SQL 语义探针已证两版 MariaDB 的风险默认值会被旁列 ALTER 和原生改名改变，推翻此前仅按目标列重述判断的允许边界；原始证据保留，独立单测改为整表保护后 15/15 通过。以下研究、原生 SQL 和纯函数回归均不代表 `schema.columns.get / preview / apply`、桌面界面或发布版本的真实验收。

## 范围和证据规则

读取 `src/engine/tableColumnDefinition.ts`、`src/shared/tableColumnPatches.ts` 及字段差异修改设计后，为五个数据库基线建立独立规范定义夹具。成功、真实拒绝、服务端规范化和采集错误分别记录。不能将旧版本接受但忽略的定义当成保留成功，也不能为了成功而改用简单语法。

候选基线为 MySQL 5.7、8.0、8.4 和 MariaDB 10.11、11.4；实际完整版本以本轮 `SELECT VERSION()` 为准。每个端口顺序创建一个随机 `dbark_colresearch_<16 位十六进制>` 库，只包含研究表和极少量虚构数据，避免与其他端到端测试的库前缀混用。

运行前通过既有 SSH 别名核对 `Server-200`、内网 IP 与授权用户；静默读取既有测试环境文件，不打印密码，不创建密钥，不执行 Docker 命令，不读取业务库。每个基线结束后先关闭本轮连接，再使用独立观察连接精确删除本轮随机库，并核对该库、该库线程以及原连接 ID 均为 0。未通过清理立即停止后续基线。

执行器、原始输出和错误详情仅保留在已忽略的 `.cache/o01-real-definitions/`，既有发布证据不被覆盖。后续提交纯夹具前另做脱敏审查；只复制规范 SQL、必要模式及版本，不复制测试凭据、驱动配置或完整私有运行环境。

## 定义矩阵

| 分组 | 真实输入与观察重点 |
| --- | --- |
| 普通默认值 | 未声明与显式 NULL、空串、文本 NULL、BIGINT/DECIMAL 字符串精度、BIT/二进制、布尔、ENUM 逗号和引号、中文、反引号、`__proto__`、`constructor` |
| 字符集与排序规则 | DEFAULT 前后的列 COLLATE、`_utf8mb4` / `_latin1` / `N` 文字、括号内文字 COLLATE、函数表达式内 COLLATE、括号表达式后的列 COLLATE；同时读 `COLUMN_DEFAULT`、`COLLATION_NAME` 和实际默认值十六进制 |
| 默认表达式 | 嵌套算术、依赖前列、JSON_OBJECT、TEXT 带括号与不带括号；不支持时保存原输入和错误 |
| 时间与生成列 | TIMESTAMP/DATETIME 微秒、CURRENT_TIMESTAMP、ON UPDATE、`explicit_defaults_for_timestamp=0`、VIRTUAL/STORED/PERSISTENT、生成列索引 |
| 索引 | 前缀、降序、多列、索引注释、MySQL INVISIBLE、MariaDB IGNORED、直接函数索引；同时保存 SHOW INDEX，函数索引拒绝时不改成生成列 |
| CHECK | 表与列约束、NOT ENFORCED；单次负数插入和实际行数区别“被忽略”“明确未强制”“真正拒绝” |
| 复杂尾部 | RANGE/HASH 分区、POINT SRID、隐藏列、普通列与时间/生成列/前缀索引/CHECK 的组合 |
| 会话解释 | 严格模式、ANSI_QUOTES、NO_BACKSLASH_ESCAPES、二者组合；记录实际字符集、排序规则、quote 和 timestamp 开关 |
| 输出完整性负例 | 同一表 `sql_quote_show_create=0`，以及 NO_FIELD_OPTIONS / NO_KEY_OPTIONS / NO_TABLE_OPTIONS / 组合、ANSI 模拟模式，保存规范输出差异和不支持设置的错误 |

每个成功表记录未经改写的 `SHOW CREATE TABLE`、文件 SHA-256、实际会话、列/索引/分区元数据。每条 DDL 后先获取 `SHOW WARNINGS`，再查询其他元数据，避免后续查询覆盖原诊断。默认值观察最多插入一行，仅用于解释服务器语义，不调用 DBArk 产品写入接口。

## 高风险判断

1. DEFAULT 后的 COLLATE 不能仅由输入中的相邻位置判断归属。读取器目前对此选择保守 `opaque`；应结合服务器 SHOW CREATE 和实际列排序规则决定能否进一步细化。表达式内部的 COLLATE 与列属性必须保持各自范围。
2. SHOW CREATE 会规范化省略的默认值、引号、类型和表达式。夹具只能证明当前服务器定义，不能恢复最初用户是否省略 DEFAULT。
3. MariaDB 的元数据省略模式会隐藏部分属性。即使读取器能解析，也不能将缺失属性的输出当作完整可编辑源；独立结构会话应先确保规范模式，并记录实际模式。
4. CHECK、降序索引或版本注释的语法接受不等于功能生效。保留元数据和有限行为观察；没有对应定义或方向时明确标注被规范化或忽略。
5. 分区、可执行注释、生成列和未知属性必须保留完整原片段。纯解析通过不能外推出生成 ALTER 安全，更不能当成 DDL 已应用。
6. 本轮不验证表字段补丁的预览绑定、并发结构变化、一次 ALTER、隐式提交边界、连接中断及应用后校验。这些仍待产品 API 接入后的独立集成与桌面验收。

## 可复现入口

仅生成无网络方案：

```powershell
node .cache/o01-real-definitions/collect.mjs --run=plan01
```

获得专用数据库窗口并完成脚本审查后，才执行真实取证：

```powershell
node .cache/o01-real-definitions/collect.mjs --execute --run=run01
```

执行器拒绝覆盖既有证据目录，默认不联网；本轮未构建应用、启动 Electron、修改版本或提交代码。真实结果及取证中的失败均如下保留。

## 2026-10-14 实际执行记录

### 首轮采集器失败：保留而不算语法拒绝

`.cache/o01-real-definitions/run01/` 中的 170 项均在会话配置阶段结束：精度选项使 `@@explicit_defaults_for_timestamp` 读为字符串，采集器再以字符串 `'1'` 绑定该开关时，五版服务端都报 `ER_WRONG_VALUE_FOR_VAR`。这不是案例 DDL 不受支持，尚未执行案例建表。

五个空研究库均已精确删除，库/库线程/原连接 ID 为 0。采集器改为先严格确认值仅为 0/1，再使用数值绑定；没有修改产品源码。首轮报告和日志原样保留，没有以第二轮覆盖。

### 第二轮五基线真实定义

run02 时间为 **2026-10-13 23:36:14.748–23:36:32.910 UTC**，约 18.162 秒。每个基线执行同一套 34 个独立案例，不自动重试写入、不把失败语法改成其他实现。

| 实际数据库版本 | 成功建表并采集 | 原始 DDL 真实拒绝 | 采集错误 | 输出模式变体：取得 / 拒绝 |
| --- | ---: | ---: | ---: | ---: |
| MySQL 5.7.44 | 20 | 14 | 0 | 6 / 0 |
| MySQL 8.0.46 | 31 | 3 | 0 | 2 / 4 |
| MySQL 8.4.11 | 31 | 3 | 0 | 2 / 4 |
| MariaDB 10.11.19-MariaDB-ubu2204 | 30 | 4 | 0 | 6 / 0 |
| MariaDB 11.4.13-MariaDB-ubu2404 | 30 | 4 | 0 | 6 / 0 |
| 合计 | 142 | 28 | 0 | 22 / 8 |

142 份正常定义加 22 份输出模式变体，共 **164 份 SHOW CREATE**。输出模式不受支持的 8 项是 MySQL 8.0/8.4 对 NO_FIELD_OPTIONS / NO_KEY_OPTIONS / NO_TABLE_OPTIONS / 组合的拒绝，未混入 28 条建表拒绝统计。

这批数据的主要结果：

- 五库的无括号 `DEFAULT _utf8mb4'AbC' COLLATE utf8mb4_bin` 都规范为列 `COLLATE utf8mb4_bin` 在 DEFAULT 之前；实际列元数据和默认值观察吻合。不能把输入中 DEFAULT 后的 COLLATE 一律视为默认表达式。
- MySQL 8.x 与两版 MariaDB 保留括号内 COLLATE 默认表达式，实际列仍为另行指定的 `utf8mb4_unicode_ci`。MySQL 5.7 对这些表达式默认值明确拒绝，未降级成文字量。
- MySQL 5.7 接受本批表/列 CHECK，但 SHOW CREATE 不保留约束，插入负数实际成功；降序索引元数据也实际为 A。其余四版降序方向为 D，表/列 CHECK 负数写入实际被拒绝。MySQL 8.x 的 NOT ENFORCED 则保留并允许负数，MariaDB 对该语法拒绝。
- MySQL 8.x 的 INVISIBLE、直接函数索引与 SRID 列定义成功；两版 MariaDB 对本批 MySQL 形式真实拒绝。MariaDB IGNORED 索引成功；三个 MySQL 对该关键字拒绝。没有用生成列替换失败的直接函数索引案例。
- 五库均取得时间 ON UPDATE、VIRTUAL/STORED 生成列、前缀索引和 RANGE/HASH 分区定义。PERSISTENT 独立记录方言行为。四个引号/反斜线模式全部真实建表，输出文件保留对应实际模式。
- 不只是 MariaDB：MySQL 5.7 同样接受省略选项模式，并在组合输出中丢掉 AUTO_INCREMENT、索引注释和表选项。这些输出不能作为完整修改源。MySQL 8.x 的同名模式则直接拒绝设置。
- MariaDB 的约束错误实际编号为 4025、SQLSTATE 为 23000；mysql2 的符号 code 使用 MySQL 同编号名称，不能以那个错配符号解释错误含义。夹具同时保留实际编号和服务器消息。

证据路径：

- 原始采集与清理汇总：`.cache/o01-real-definitions/run02/report.json`。
- 每版本原始定义、DDL、警告、列/索引/分区元数据和少量行观察：`.cache/o01-real-definitions/run02/<端口>/`。
- 脱敏候选夹具：`.cache/o01-real-definitions/fixtures-run02/manifest.json` 和各版本目录。移除私有地址、账户、线程及随机研究库身份；SQL 字节保持原始 SHA，不规范化或修复。
- 生成夹具脚本：`.cache/o01-real-definitions/package-fixtures.mjs`，只读取本地证据，不联网、不执行产品读取器。夹具索引明确 `readerExecuted=false`、`productApplyTested=false`。

### 第三轮：MariaDB Unicode 默认表达式原样重建不等价

run02 中两版 MariaDB 接受以下虚构定义，默认求值的实际 HEX 为 `C380E6B189`，即 `À汉`：

```sql
v VARCHAR(80) COLLATE utf8mb4_unicode_ci
  DEFAULT (concat(_utf8mb4'À', _utf8mb4'汉') COLLATE utf8mb4_bin)
```

但两版 SHOW CREATE 均把表达式输出为：

```sql
DEFAULT (concat(_utf8mb4'xC3x80',_utf8mb4'xE6xB1x89') collate utf8mb4_bin)
```

经主任务明确授权，run03 在每版各两个全新自有库中建立同名表：原表由原始 DDL 创建，另一库直接执行第一张表的 SHOW CREATE **完整原文，零字节修改**。两表各插入一行仅有 ID 的虚构数据。

| 基线 | 原表默认 HEX | 原样重建默认 HEX | 是否相同 |
| --- | --- | --- | --- |
| MariaDB 10.11.19 | `C380E6B189` | `784333783830784536784231783839` | 否 |
| MariaDB 11.4.13 | `C380E6B189` | `784333783830784536784231783839` | 否 |

重建值实际为文本 `xC3x80xE6xB1x89`。采集同时使用 mysql2 协议字段的原始 Buffer、解码 UTF-8 文件 SHA/HEX、服务器原生 `HEX(COLUMN_DEFAULT)`、接收定义文本的 `HEX(?)` 和实际默认值 `HEX(v)`。原始协议字节与 UTF-8 文本完全相同，排除了 JSON 可见转义造成的假差异。

补证时间为 **2026-10-13 23:39:31.714–23:39:32.230 UTC**。原始输入与前后定义、完整 HEX/SHA、会话模式及清理结果位于 `.cache/o01-real-definitions/run03-maria-roundtrip/`；入口脚本为 `maria-roundtrip.mjs`。此前 run02 数据未改写。

这证明在这两个实际版本、这条确切表达式及本次会话模式下，不能仅凭“保留 SHOW CREATE 原片段”承诺 MODIFY/CHANGE 的未改默认值等价。后续规划器需保守限制涉及该类目标列完整重述的操作，保留无关普通列能力；不能以本次事实推断所有 MariaDB 表达式都有相同问题，也未在本轮验证产品保护或修复。

### 清理与验收边界

run01 的 5 个空库、run02 的 5 个取证库、run03 的 4 个重建库均逐个精确删除。每轮独立观察连接核对本轮库不存在、库线程为 0、原连接 ID 不存在后关闭。没有新增用户、密钥、容器或 GUI 进程；既有测试容器及其他任务证据未改动。

上述 run01–run03 取证阶段只修改自有研究脚本和本文，没有运行纯读取器测试、产品 schema.columns API、字段编辑 UI 或安装包。170 条 DDL 研究与 2 项原样重建反例均不能替代字段补丁功能验收；其后新增的有限离线回归单独记录如下。

## 后续有限夹具与离线单元回归

经主任务授权，在 `tests/fixtures/table-column-definitions/` 中加入 **15 份**有代表性的纯结构定义：五版本组合表、两版 MariaDB 危险表达式、MariaDB 普通/ANSI 输出对照、MySQL 8.4 函数索引/隐藏列/分区、默认值边界以及两类 COLLATE。没有复制全部 164 份定义，没有加入 INSERT 或行结果；文件 SHA 与 run02 原件保持一致。

该目录 README 明确来源、版本、会话模式、能力和限制；`manifest.json` 保存每份完整版本/SQL 模式/字符集等必要解释信息，不含测试地址、端口、账户、连接 ID 或随机库名。清单 SHA-256 为 `a65d8e5776f092bf30bf58153b4af642a98d009116792c6fba0e597c7bbcf538`。

新增 `tests/unit/table-column-real-definitions.test.ts`，共 15 项定向用例验证：

- 五版本实际规范输出中的普通列修改，仅包含目标列，不重述时间 ON UPDATE、生成列、前缀索引和 CHECK；MySQL 5.7 不凭空补出已被服务器忽略的 CHECK。
- 函数索引、隐藏列可执行注释和分区表尾保持；隐藏列自身未知属性仍保守只读。
- 当时的 MariaDB 断言要求风险表达式拒绝类型/注释及组合修改的完整重述，同时允许专用默认值修改、原生改名和普通旁列。后续 run04/05 的实际 ALTER 语义反例已推翻后两项允许边界，见下文；该历史 15/15 不能作为这些操作安全的证据。
- ANSI 不完整输出只作为来源限制证据，明确纯解析不能恢复缺失注释或表选项。该夹具保留 AUTO_INCREMENT，不能沿用此前审查中已纠正的“ANSI 丢自增”推断。
- 真实空串、文本 NULL、SQL NULL、精确数值和合法原型同名字段，以及列 COLLATE/表达式内部 COLLATE 的边界。

首轮为 **11 通过 / 4 失败**，原日志和 JSON 保留。失败均来自本新增测试断言：两项将 MariaDB 原样小写时间函数错误要求为大写；两项将完整 SQL 的表名 `column_invisible` / `partition_range` 误匹配为重述属性。改为大小写不敏感的 SQL 关键字断言，并对实际 ALTER 子句检查复杂属性；保留原字节 SHA 和实质保留断言，未修改运行时代码。

第二轮为 **15 通过 / 0 失败 / 0 跳过**，测试文件内部计时约 40.684 毫秒。TypeScript 全项目类型检查无错误，新增文件差异检查通过。首次 pnpm 入口还产生存储操作锁权限警告，但 Vitest 实际执行并写出上述首轮结果；第二轮直接调用既有 Vitest 文件，避免包管理器自动检查依赖，不安装或修改依赖。

```powershell
node node_modules/vitest/vitest.mjs run tests/unit/table-column-real-definitions.test.ts --reporter=json --outputFile=.cache/o01-real-definitions/real-fixtures-unit-run02.json
node node_modules/typescript/bin/tsc --noEmit
```

结果位于 `.cache/o01-real-definitions/real-fixtures-unit-run01{.json,.log}`、`real-fixtures-unit-run02{.json,.log}`、`real-fixtures-typecheck.log`。这是已执行的纯函数回归，未运行新的远端数据库写操作、真实 API、GUI 或安装包。其余未选夹具仍然只是研究素材，不能把 15 项通过外推为 164 份全部解析或应用通过。

## MariaDB 原生 ALTER 的整表语义边界补证

触发本轮研究的是正式 API 验收中出现的默认值变更反例。本子任务另建独立研究库，只使用原生 SQL 分析服务器语义，未把其结果当作产品 API 通过。先通过既有 SSH 别名核对 `Server-200 / 192.168.31.200 / root`，仅连接既有两版隔离 MariaDB；没有 Docker、创建用户、GRANT 或业务数据访问。ACL 套件不在本轮执行范围。

每个操作使用新的 `dbark_colresearch_<16hex>` 库及自主 `subject` 表，原默认表达式为 `(concat(_utf8mb4 X'C380',_utf8mb4 X'E6B189') COLLATE utf8mb4_bin)`。会话统一 `STRICT_ALL_TABLES,NO_ENGINE_SUBSTITUTION`、`SET NAMES utf8mb4 COLLATE utf8mb4_bin` 和 `sql_quote_show_create=1`，实际模式逐份留存。INSERT 只给 id，风险列由服务器求默认值；ALTER 后立即读取 SHOW WARNINGS，保留前后 SHOW CREATE 原始 UTF-8/协议字节 SHA、目录定义、旧行和新行 HEX。各表只执行一次 ALTER，不复用已经改变语义的对象继续试验。

两版实际版本为 **10.11.19-MariaDB-ubu2204** 和 **11.4.13-MariaDB-ubu2404**，以下逐项结果一致。`原值` 指 `C380E6B189`（À汉），`变值` 指 `784333783830784536784231783839`（xC3x80xE6xB1x89）。

| 单个新表中的操作 | 新插入 v 的 HEX | 未指定的另一风险列 w | 含义 |
| --- | --- | --- | --- |
| 只读对照，无 ALTER | 原值 | 不适用 | 读取定义后再次 INSERT 仍保留原默认值 |
| 普通旁列 COMMENT | 变值 | 不适用 | 未修改风险列也会变值 |
| ADD 整数列 | 变值 | 不适用 | 新增旁列也会变值 |
| 普通旁列原生 RENAME | 变值 | 不适用 | 独立改名不能规避 |
| DROP 普通旁列 | 变值 | 不适用 | 删除旁列不能规避 |
| 普通旁列 SET DEFAULT | 变值 | 不适用 | 修改另一默认值不能规避 |
| 普通旁列 DROP DEFAULT | 变值 | 不适用 | 删除另一默认值不能规避 |
| 风险列原生 RENAME | 变值 | 不适用 | 无完整 MODIFY 仍会变值 |
| 唯一风险列 SET DEFAULT 'SAFE' | `53414645` | 不适用 | 显式替换目标符合要求 |
| 唯一风险列 DROP DEFAULT | SQL NULL | 不适用 | 此可空夹具显式删除默认值符合要求 |
| 两风险列，仅 v SET DEFAULT 'SAFE' | `53414645` | 变值 | 不能仅覆盖一部分风险默认值 |
| 两风险列，仅 v DROP DEFAULT | SQL NULL | 变值 | 不能仅覆盖一部分风险默认值 |
| 同一 ALTER 全部 SET v='A'、w='B' | `41` | `42`，此列也显式修改 | 全覆盖受控目标符合要求 |
| 同一 ALTER 全部 DROP 两个 DEFAULT | SQL NULL | SQL NULL，此列也显式修改 | 全覆盖删除符合此可空夹具要求 |
| 同一 ALTER DROP COLUMN v，w SET 'SAFE' | v 实际不存在 | `53414645`，此列也显式修改 | 删除加全覆盖受控修改符合要求；不因此要求首批开放所有组合 |

全部已执行 ALTER 的即时警告列表为空。风险默认值变化只影响后续省略列的 INSERT；原先已存储的行值保持，删除列的案例只比较保留列旧行。因此“SHOW CREATE 未改片段相同”“没有警告”“旧数据仍相同”均不足以证明未指定默认值的语义保持。有限证据支持对保留任何无法证明等价的风险默认值进行整表保护；它不证明所有 MariaDB 表达式都必然损坏，也不支持根据 `xC3` 字符串特征猜测修复。

另为两版各增加一份独立 VIRTUAL 和 PERSISTENT 生成列表：`v` 由 `concat(_utf8mb4 X'C380',base)` 生成，INSERT 显式传 base 的汉字 HEX。四例在首次 INSERT 之后、任何 SHOW CREATE 或 ALTER 之前读到的 v 已是 `784333783830E6B189`（xC3x80汉）。读取定义、只改普通 note 注释后，旧行和新行均保持该实际值。本轮没有观察到 ALTER 使生成列再次改变，不能把此创建/首次访问阶段现象写成 ALTER 变值。生成列没有回填成期望 Unicode 值以强行制造通过。

三个独立轮次及原始记录：

| 轮次 | UTC 时间 / 时长 | 实际内容 | report.json SHA-256 |
| --- | --- | --- | --- |
| run04-maria-alter-boundaries | 00:35:26.404–00:35:29.649 / 3.245 秒 | 10.11 的 12 项完整对照，9 项观察到非预期默认变值；第 13 项生成列在 ALTER 前因探针对初值的错误假设停止，原失败保留 | `f40bbf31b529be5a3d9d034d1ad58b34d91a6ecc7c51cb7ea039c1eb5ca550d9` |
| run05-maria-alter-boundaries | 00:36:39.473–00:36:43.826 / 4.353 秒 | 修正为先读实际生成列基线：补两版共 4 个生成列对照及 11.4 的 12 个默认值操作；9 项再次观察到非预期默认变值 | `fa227da87ea1cb1e4427a13ecb6aec820f0145bfdd3086089697f66830f70859` |
| run06-maria-all-risk-defaults | 00:38:16.583–00:38:18.158 / 1.575 秒 | 两版各 3 个全覆盖操作，6 项均达到显式目标 | `86d60c8b50e9e422e42ab2ff17b21eddd387bcd5b75516858841506b799784f2` |

所有路径均位于 `.cache/o01-real-definitions/`，每轮含独立日志、report、每端口/操作的 `evidence.json`、提交 CREATE/ALTER、前后 SHOW CREATE 以及该轮 runner 副本。文件只新增，未覆盖此前 run02/run03 或停止轮次。合计建立 **35 个随机库，34 项完成语义比较，1 项在 ALTER 前停止**；所有 35 库、库线程及记录的原连接 ID 均已精确清理并查 0。没有创建临时账户，因此不存在本轮新增账户清理结论。

据上述新证据更新两份 MariaDB 夹具的单测预期：原生改名和普通旁列修改必须被整表保护拒绝；单一风险默认值的独立 SET/DROP 保留能力。`tests/unit/table-column-real-definitions.test.ts` 最新定向 **15/15 通过，0 失败/跳过**，记录 `.cache/o01-real-definitions/real-fixtures-tableguard-run03{.json,.log}`。15 份 `.sql` 和 manifest 均未改，manifest SHA 仍为 `a65d8e5776f092bf30bf58153b4af642a98d009116792c6fba0e597c7bbcf538`；README 修正被实证推翻的允许边界。旧的 15/15 只说明当时纯语法/规划断言满足，不能提升为语义保真证明。

## 五基线时间、HEX 与 BIT 默认值的原生语法探针

本节只读整理主智能体已执行的 `.cache/o01-time-default-probe/` 五份报告及各目录保存的 `probe-source.mjs`。它们直接调用 mysql2 执行自主 DDL，不调用 DBArk 的字段 get/preview/apply；没有 UI、参数令牌、权限隔离或产品后核验通过结论。本次整理没有重新访问服务器、构建或运行测试，不覆盖前述 MariaDB 语义反例和原失败记录。

源码在连接前通过 SSH 严格主机检查核对 `Server-200 / 192.168.31.200 / root`，静默读取既有环境。run01 固定 MySQL 8.4 的隔离端口；run02 在已有五端口白名单中选取另四个版本，实际共五个版本、五个新随机 `dbark_colpatch_<12hex>` 库。每个 case 使用库内独立表，先建立已知默认值，再单次执行所研究的 ALTER；成功后立即 SHOW WARNINGS、SHOW CREATE，然后仅提供 id 插入，由服务器产生默认值，最后同时记录 mysql2 原值和 SQL HEX。失败保存 1064 错误与当时定义，不改用另一种语法将同一例标绿；完整 MODIFY 是另一个新表的独立 case。

### 轮次、数量和源码保存

| 目录 | 实际服务器版本 | 用例数 | 成功并取得实际插入值 | 语法拒绝 | UTC 开始—结束 / 时长 |
| --- | --- | ---: | ---: | ---: | --- |
| run01 | MySQL 8.4.11 | 8 | 6 | 2 | 00:41:15.849–00:41:16.612 / 0.763 秒 |
| run02-mysql-five-seven | MySQL 5.7.44 | 10 | 4 | 6 | 00:44:11.691–00:44:12.361 / 0.670 秒 |
| run02-mysql-eight-zero | MySQL 8.0.46 | 10 | 8 | 2 | 00:44:12.798–00:44:14.125 / 1.327 秒 |
| run02-maria-ten-eleven | MariaDB 10.11.19-MariaDB-ubu2204 | 10 | 10 | 0 | 00:44:14.540–00:44:15.414 / 0.874 秒 |
| run02-maria-eleven-four | MariaDB 11.4.13-MariaDB-ubu2404 | 10 | 10 | 0 | 00:44:15.824–00:44:16.691 / 0.867 秒 |
| 合计 | 5 个实际版本 | **48** | **38** | **10** | 分轮保留，不称一次产品全绿 |

所有 10 个拒绝均为 `errno=1064 / ER_PARSE_ERROR`。38 个成功分支均有实际 `observed` 行且即时警告为空；失败分支没有采集警告列表，不把缺失值写成“无警告”。run01 未包含 `time-modify` 和 `fraction-modify`，因此不能将其余四版的 MODIFY 结果外推为 MySQL 8.4 同轮已测。

`report.json` 使用新增写入方式保存。run02 各执行器在启动时以 `wx` 将自身源码复制到对应目录；四份源码内容 SHA 一致。run01 目录也保留对应 8 例版本的源码副本，内容与 run02 的 10 例版本不同。源码只含环境读取逻辑，没有内嵌密码；本次整理未修改任何报告或源码副本。报告未保存实际会话 sql_mode、时区或原始 DDL 协议字节，不能补猜这些信息。

| 文件目录 | report.json SHA-256 |
| --- | --- |
| run01 | `4c4f64dcd5e065ce9dcb208123ad3173f8ed017488ed87b575d7f0166cb2f2c5` |
| run02-mysql-five-seven | `19f4d4c516b27f34dbca8effb2fd15d1708375e9ed4e79adbefb8d3936d0e3e7` |
| run02-mysql-eight-zero | `de68f0808d72c680c2207fba9f0bd61b5cfb490d97a0d10524d367a7a532d582` |
| run02-maria-ten-eleven | `078182a06e9293cc523f0f736e63b00884263b8ef3d48a293549da21789129b6` |
| run02-maria-eleven-four | `1258ed0ec7e2b66802f32793031354bc970c0ea8c6105db5ec7a46209559b211` |

run01 的 `probe-source.mjs` SHA 为 `47dd02d28b80585f0fb65f465928600774bb1a6be1e8e370996e95460358ba43`；四份 run02 源码 SHA 均为 `9d7410c43678e6e58e9f871e452022c1140e0f5f03bf1b2f3c8b6c3a6ad13996`。

### 实际语法差异与值

下表中时间语法每格同时覆盖 DATETIME 与 DATETIME(6) 两个独立用例：前者用 CURRENT_TIMESTAMP，后者用 CURRENT_TIMESTAMP(6)，并非只测无精度形式。

| 操作 | MySQL 5.7.44 | MySQL 8.0.46 | MySQL 8.4.11 | MariaDB 10.11.19 / 11.4.13 |
| --- | --- | --- | --- | --- |
| `ALTER COLUMN value SET DEFAULT CURRENT_TIMESTAMP[(6)]`，无外层括号 | 两例均 1064 | 两例均 1064 | 两例均 1064 | 两版各两例成功 |
| `ALTER COLUMN value SET DEFAULT (CURRENT_TIMESTAMP[(6)])` | 两例均 1064 | 两例均成功 | 两例均成功 | 两版各两例成功 |
| `MODIFY COLUMN value DATETIME[(6)] DEFAULT CURRENT_TIMESTAMP[(6)]` | 两例均成功 | 两例均成功 | **本轮未测** | 两版各两例成功 |
| VARBINARY 默认 `X'00ff'` | 成功 | 成功 | 成功 | 两版成功 |
| VARBINARY 默认 `(X'00ff')` | 1064 | 成功 | 成功 | 两版成功 |
| BIT 默认 `b'1010'` | 成功 | 成功 | 成功 | 两版成功 |
| BIT 默认 `(b'1010')` | 1064 | 成功 | 成功 | 两版成功 |

MySQL 8.0/8.4 包裹时间表达式在 SHOW CREATE 中实际规范成 `DEFAULT (now())` / `DEFAULT (now(6))`；MySQL 5.7/8.0 的完整 MODIFY 形式规范为 `CURRENT_TIMESTAMP` / `CURRENT_TIMESTAMP(6)`。两版 MariaDB 实际输出 `current_timestamp()` / `current_timestamp(6)`。这些大小写、别名及括号差异是读取器需要解释的实际输出，不表示本节已经验证产品可正确规范化所有变体。

实际 DATETIME 值由 `dateStrings:true` 保留为字符串。无小数声明的成功案例没有小数部分；DATETIME(6) 成功案例保留完整六位，包括前导或结尾的零。以下为逐版可直接回查的代表值，完整其他分支值在报告中：

| 版本 / 用例 | 实际字符串 | 对应 SQL HEX |
| --- | --- | --- |
| 5.7.44 / fraction-modify | `2026-10-14 00:44:01.250681` | `323032362D31302D31342030303A34343A30312E323530363831` |
| 8.0.46 / fraction-wrapped | `2026-10-14 00:44:02.212512` | `323032362D31302D31342030303A34343A30322E323132353132` |
| 8.4.11 / fraction-wrapped | `2026-10-14 00:41:05.150564` | `323032362D31302D31342030303A34313A30352E313530353634` |
| 10.11.19 / fraction-wrapped | `2026-10-14 00:44:03.897550` | `323032362D31302D31342030303A34343A30332E383937353530` |
| 11.4.13 / fraction-bare | `2026-10-14 00:44:05.074486` | `323032362D31302D31342030303A34343A30352E303734343836` |

这里核对的是服务器求值结果的六位小数保留，不是 UTC/本地时区正确性、时钟同步或任意输入舍入规则。报告的 UTC 起止时间来自运行机，列值来自数据库，两者不能据文本直接断言相等。

所有成功 HEX 分支的实际驱动 Buffer 为 `00ff`、SQL `HEX(value)` 为 `00FF`；BIT(8) 成功分支驱动 Buffer 为 `0a`，SQL HEX 为 `A`。SQL HEX 对 BIT 的显示未补齐两位，不应把 `A` 与实际单字节 `0a` 误判成数值不同。MySQL 8.0/8.4 的 VARBINARY 定义显示为 `0x00FF`；MySQL 5.7 的解码 SHOW CREATE 文本出现问号，两版 MariaDB 出现替换字符，但实际 Buffer 仍为 `00ff`。本探针没有采集 SHOW CREATE 原协议字节，因此只记录解码显示与真实值不同的边界，不据此断言损坏发生在哪一层，更不能据显示文本声称重述安全。

### 清理证据边界

五份报告都为 `cleaned:true`；保存源码显示 finally 先严格验证本轮 `dbark_colpatch_<12hex>` 名称，执行精确 DROP DATABASE，再以该名称查询 `information_schema.SCHEMATA` 并确认没有记录，因此能确认 **5 个研究库均已删除且目录查 0**。随后执行并等待 `connection.end()` 后才写出完成时间和报告。

这些报告保存了原连接 ID，但没有独立 PROCESSLIST 归零查询或本机进程清理计数。故本节不把 `connection.end()` 等同于服务器线程已查 0，也不复用前述其他语义探针的线程证据覆盖这五轮。源码没有创建用户或 GRANT。用户后来已授权的 ACL 验收仍由主智能体在统一窗口执行，本次文档整理没有运行该套件。

## 五基线 TEXT/BLOB 默认值语法及原协议字节补证

正式产品 MySQL 8.4 字段用例在 `ALTER COLUMN SET DEFAULT (表达式)` 收到 1101 后，另做本节原生 SQL 研究。原产品失败记录为 `.cache/o01-product-validation/run04-mysql-eight-four/`，没有改成成功或覆盖。本子任务重新核对实际 `Server-200 / 192.168.31.200 / root`，先研究 MySQL 8.4 并反馈，再按 5.7、8.0、MariaDB 10.11、11.4 顺序进行；不调用产品 API、不开 GUI、不改运行时或测试、不创建账户/GRANT，也未运行 Docker。

每版新建一个 `dbark_colresearch_<16hex>` 随机库，每种语法一个独立新表，共 **5 库、40 表、40 个单次 ALTER 变体**。原列从可空 `DEFAULT NULL` 开始，保留列注释、表注释和普通 note 列；完整 MODIFY 使用相同原类型、可空性、字符集/排序规则和注释。会话实际设置并记录 `STRICT_ALL_TABLES,NO_ENGINE_SUBSTITUTION`、`utf8mb4 / utf8mb4_bin`、`sql_quote_show_create=1`，没有修改全局模式。TEXT 测试值含中文、单引号、反斜线和真实换行；BLOB 目标字节为 `00ff0127`。

### 实际赋值矩阵

下表每格包含 TEXT 与 BLOB 两例：TEXT 使用正确转义的字符串文字量，BLOB 使用 `X'00ff0127'`。失败语句没有自动改写重放；MODIFY、setter、加括号和裸文字量分别使用新表。

| 语法 | MySQL 5.7.44 | MySQL 8.0.46 | MySQL 8.4.11 | MariaDB 10.11.19 / 11.4.13 |
| --- | --- | --- | --- | --- |
| `ALTER COLUMN value SET DEFAULT (文字量)` | 两例 1064 | 两例 1101 | 两例 1101 | 两版各两例精确成功 |
| `ALTER COLUMN value SET DEFAULT 文字量` | 两例 1101 | 两例 1101 | 两例 1101 | 两版各两例精确成功 |
| 完整 `MODIFY COLUMN value 原定义 DEFAULT (文字量)` | 两例 1064 | 两例精确成功 | 两例精确成功 | 两版各两例精确成功 |
| 完整 `MODIFY COLUMN value 原定义 DEFAULT 文字量` | 两例 1101 | 两例 1101 | 两例 1101 | 两版各两例精确成功 |

合计 **20 个成功并取得精确实际值，20 个真实拒绝**，无采集错误；其中 4 个拒绝为 1064，其余 16 个为 1101。五版的成功数依次为：5.7 为 0/8、8.0 为 2/8、8.4 为 2/8、两版 MariaDB 各 8/8。此处的成功只表示该原生语法及自主表的实际默认值符合目标，不是产品用例通过，也不证明在存在其他风险表达式时任意完整 MODIFY 安全。

所有 ALTER 均立即保存 SHOW WARNINGS；失败时也保存原始错误、警告和后定义，不将错误诊断的 Warning/Error 行误计为成功警告。成功分支即时警告为空，随后仅插入 id，真实省略 value 的结果为：

- TEXT 实际文本为 `中文'引号\路径`、换行、`第二行`，HEX 严格等于 `E4B8ADE6968727E5BC95E58FB75CE8B7AFE5BE840AE7ACACE4BA8CE8A18C`；列目录及值的字符集/排序规则均为 `utf8mb4 / utf8mb4_bin`。
- BLOB 实际 Buffer 四字节为 `00ff0127`，SQL HEX 为 `00FF0127`；值的字符集/排序规则是 `binary / binary`，列目录字符集及排序规则为 NULL。
- 普通 note 的省略值仍为 9；前后完整定义和列/表注释留在各用例证据中。本节没有尝试把原定义解码后重新执行 CREATE TABLE，不能将字节往返证明外推为所有定义重述的语义证明。

### SHOW CREATE 与目录字节的区别

每例在 ALTER 前后分别保留解码后的 `.show-create.sql` 和 mysql2 `typeCast(field.buffer())` 读取的 `.show-create.raw.bin`，以及长度、完整 HEX、SHA-256、UTF-8 重新编码是否与协议字节完全相同。还将解码文本和原始 Buffer 分别作为参数传给服务器 `HEX(?)` 校核；这项是已有字节的服务器往返检查，不冒充对 SHOW CREATE 的另一种服务器内部来源。

本轮 **40 例的前后 SHOW CREATE 均能完整 UTF-8 往返**，包含所有成功 BLOB 例。不能把前一节 VARBINARY 的问号/替换字符现象泛化到本次 LOB：

- MySQL 8.0/8.4 的 TEXT 规范输出为 `DEFAULT (_utf8mb4'…')`，BLOB 规范输出为 `DEFAULT (0x00ff0127)`。
- 两版 MariaDB 的 TEXT 规范输出为普通转义文字量 `DEFAULT '…'`，BLOB 为 `DEFAULT X'00ff0127'`；本次裸/括号、setter/MODIFY 都归一到这些输出，实际值保持。
- 每例另保存 `information_schema.COLUMNS` 的原默认值、服务器 `HEX(COLUMN_DEFAULT)`、该字段未解码协议字节、列类型/可空性/字符集/排序规则。MySQL 8.0/8.4 的 TEXT 目录默认值带双重转义和乱码形式，其服务器 HEX 与原协议字段字节同样如此，但 SHOW CREATE 和实际插入值正常；因此不能将目录默认值的显示字符串直接当作可重述定义，或把该现象归因于终端显示。两版 MySQL 对应目录原协议 SHA 均为 `b193ff0135729ebc000e70e4e3dd107be1037269fbd07f565d93c87b59d2a021`。

这些证据支持按实际方言/版本选择单次语法，并保留严格文字量与字节检查，不支持“先失败再 fallback 重放”，也不支持放宽替换字符为二进制默认值的解析。

### 原件与清理

证据根为 `.cache/o01-lob-default-probe/`。每个端口目录以 `wx` 保存完整 `probe-source.mjs`、`report.json`；每个变体目录含 CREATE/ALTER 输入、前后 SHOW CREATE 文本和原协议二进制、完整响应/警告、实际值及目录元数据。五份 runner 副本 SHA 一致：`ee1c0028a055b257f424089cc7098d8138dbb55ccf431b4e7dde8e5f780b3acb`。执行器源为 `.cache/o01-real-definitions/lob-default-boundaries.mjs`，不含内嵌凭据；报告和源码未进入公共夹具目录。

| 目录 | 版本 | UTC 开始—结束 / 时长 | report.json SHA-256 |
| --- | --- | --- | --- |
| run01-mysql-eight-four | 8.4.11 | 01:08:10.976–01:08:12.139 / 1.163 秒 | `255e9ec4d1bef584f2e657aac01a7544ff1c4b77917c756ce8485a55da4e4ef9` |
| run01-mysql-five-seven | 5.7.44 | 01:08:54.002–01:08:55.066 / 1.064 秒 | `76370cc07ccf96176f915598ae26d54d7784e085aeb8da05f9861e5724482e54` |
| run01-mysql-eight-zero | 8.0.46 | 01:08:55.437–01:08:56.859 / 1.422 秒 | `b8b05034068b2beccdfd66571ff53aeac10e592c277366e47e1509463ee4f54c` |
| run01-maria-ten-eleven | 10.11.19-MariaDB-ubu2204 | 01:08:57.232–01:08:58.369 / 1.137 秒 | `69b62ce1532d50d7ce54cfd02db056cd8d2f7352994711e4d024e41143dcf57e` |
| run01-maria-eleven-four | 11.4.13-MariaDB-ubu2404 | 01:08:58.739–01:08:59.909 / 1.170 秒 | `7214d45c66dd04251a143d37b2a753e2b73c98b85585b5185dcd7ecf98841e36` |

每版 finally 先结束研究连接，再用独立观察连接精确 DROP 本轮随机库，并分别查询该库目录、该库线程、记录的原连接 ID。五份报告均为 `schemas=0 / schemaThreads=0 / originalConnections=0 / clean=true`；本轮 5 库及其 40 表均已清理。六个既有测试实例、容器、网络保持，未进行账户或权限操作。本节的线程归零只覆盖本轮记录目标，不能补填前一节时间探针未采集的线程证据。

## 三基线 VARBINARY 默认值读取、重述与克隆的语义补证

时间探针已出现 VARBINARY 默认值的问号或替换字符显示，但上一节 LOB 的 80 份前后定义均可 UTF-8 往返。为避免将 LOB 结果外推到普通二进制列，本轮只在 MySQL 5.7、MariaDB 10.11、11.4 的三个既有隔离端口补证。每次执行前重新核对 `Server-200 / 192.168.31.200 / root`；每版一个新的 `dbark_colresearch_<16hex>` 库，三个操作各用独立源表，克隆另建目标表，合计 **3 库、9 个独立变体、12 表**。没有调用产品 API、执行 GUI、修改运行时、创建用户或 GRANT，也没有运行 Docker。

每个源表均为自主结构：主键 id、`bytes VARBINARY(10) DEFAULT X'00ff'` 和默认值为 safe 的普通 note 列。操作前仅提供 id 插入旧行，实测默认值为 Buffer `00ff`、SQL HEX `00FF`。会话实际设置并记录 `STRICT_ALL_TABLES,NO_ENGINE_SUBSTITUTION`、`utf8mb4 / utf8mb4_bin`、`sql_quote_show_create=1`。随后执行一次下列操作，立即保存 SHOW WARNINGS，再读取原旧行及新省略 bytes 插入行；没有失败重试或猜值改写。

### 逐操作真实值

| 操作 | MySQL 5.7.44 新行 HEX | MariaDB 10.11.19 新行 HEX | MariaDB 11.4.13 新行 HEX |
| --- | --- | --- | --- |
| 只修改普通 note 列注释，不重述 bytes | `00FF`，保持 | `00FF`，保持 | `00FF`，保持 |
| 由解码 SHOW CREATE 取完整原 bytes 定义，仅改其注释 | `003F`，失真 | `00EFBFBD`，失真 | `00EFBFBD`，失真 |
| 由解码 SHOW CREATE 克隆，只替换 CREATE TABLE 的目标表名 token | `003F`，失真 | `00EFBFBD`，失真 | `00EFBFBD`，失真 |

**9 个操作全部被服务器接受，即时警告均为空；3 个旁列操作保真，6 个重述或克隆操作改变了实际默认值。** 所有源表旧行仍为 `00FF`，普通 note 值仍为 safe；克隆例比较保留的源表旧行与新目标表省略列插入值，不声称克隆自动复制旧行。仅检查 DDL 返回 OK、旧行不变或没有警告，均无法捕获本轮默认值失真。

完整重述仅定位受控源表中唯一的 bytes 列定义，校验原类型和末尾原注释，只替换该末尾注释，其余解码定义原样保留。克隆要求精确匹配 `CREATE TABLE` 后的已知源表名 token，只改为同一自有库的目标表名，不使用全局字符串替换。此处实际执行的是 mysql2 **已解码** SHOW CREATE 文本，不声称已把 MariaDB 含非法 UTF-8 的原协议二进制直接作为 SQL 重放。

### 原协议和列目录均不能被当作完整原值证明

每例前后均保存 mysql2 普通解码 SHOW CREATE、`typeCast(field.buffer())` 取得的同字段原协议字节、`isUtf8`、解码后重新编码是否逐字节一致。基线出现两种不同失真：

| 版本 | SHOW CREATE 的原协议默认片段 | 原协议 UTF-8 有效 / 解码往返一致 | 解码定义 |
| --- | --- | --- | --- |
| MySQL 5.7.44 | 单引号内为 `5C 30 3F`：反斜线、0、ASCII 问号 | `true / true` | `DEFAULT '\0?'` |
| MariaDB 10.11.19 / 11.4.13 | 单引号内为 `5C 30 FF`：反斜线、0、非法 UTF-8 单字节 FF | `false / false` | `DEFAULT '\0�'`，重编码替换字符为 `EF BF BD` |

MySQL 5.7 的原协议中已经没有 FF，因此“解码往返一致且 UTF-8 有效”不能证明实际默认值保持。两版 MariaDB 的 SHOW 原协议保留 FF，但通过字符串解码已失去原字节。不能把这些现象都归因于终端显示，也不能根据问号或替换字符反向猜测原字节。

另外采集 `information_schema.COLUMNS` 的 `COLUMN_DEFAULT`、服务器 `HEX(COLUMN_DEFAULT)`、该字段原协议 Buffer，以及类型、字符集、排序规则、可空性。三版共同为 `dataType=varbinary / columnType=varbinary(10) / charset=NULL / collation=NULL / nullable=YES`，但目录默认值同样不足以恢复真实 `00FF`：

| 版本 | 目录默认值解码内容 | 服务器 HEX(COLUMN_DEFAULT) | 目录默认值原协议 Buffer |
| --- | --- | --- | --- |
| MySQL 5.7.44 | 单个 NUL 字符 | `00` | 长度 1，`00` |
| MariaDB 10.11.19 / 11.4.13 | 包含两端单引号的文本 `'\0?'` | `275C303F27` | 长度 5，`275c303f27` |

5.7 的目录原协议 SHA 为 `6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d`，两版 MariaDB 同为 `e609bc8e8affc7c2da0b3b3ff872ac55e560e4199207cfa639d2040e6ebe72ac`。这项证据只能帮助识别不一致，不能将 I_S 当作修复或原值恢复来源，更不能把本研究有写入副作用的 INSERT 探针搬到产品只读元数据流程。

本轮明确证明这些原定义的目标列重述及含结构克隆存在风险，应有针对性保护；同时普通旁列操作确实保持 `00FF`，不能将其描述为所有此类表的任意 ALTER 都已证不安全。本轮没有覆盖其他二进制值、其他连接字符集、所有 VARBINARY 长度或 BINARY 类型，不据此扩大能力结论。前述 LOB 成功及 MariaDB Unicode 表达式整表风险各保留独立适用边界。

### 原件、时间与清理

证据根为 `.cache/o01-varbinary-default-probe/`，每轮以 `wx` 保存 `probe-source.mjs`、`report.json`，每个变体保存 CREATE 和实际操作 SQL、前后 SHOW CREATE 文本与 `.raw.bin`、错误/警告/响应、目录与真实新旧行。执行器为 `.cache/o01-real-definitions/varbinary-default-boundaries.mjs`；三个保存副本 SHA 均为 `8a227a1f54ffbce7d161118fc43ec451d8315d21de7924e397d103fff5b7aa91`。凭据仅静默读取既有私有环境，未写入执行器、报告或公共夹具。

| 目录 | 实际版本 | UTC 开始—结束 / 时长 | report.json SHA-256 |
| --- | --- | --- | --- |
| run01-mysql-five-seven | 5.7.44 | 01:14:43.795–01:14:44.389 / 0.594 秒 | `3eb2fb665f3f7da40f93853bb58e6c7b2e1ec1dcfe3cad815bce5b75c157fd80` |
| run01-maria-ten-eleven | 10.11.19-MariaDB-ubu2204 | 01:14:44.775–01:14:45.343 / 0.568 秒 | `5b9154ba54c0b3c916c32094a3ca963a14f6a7c1590e037746307040f5571f43` |
| run01-maria-eleven-four | 11.4.13-MariaDB-ubu2404 | 01:14:45.728–01:14:46.355 / 0.627 秒 | `ca4892477062704d688753b0fcacd558fcb273e905087acf7e83b8f080711b39` |

三份报告均为 `schemas=0 / schemaThreads=0 / originalConnections=0 / clean=true`：研究连接已结束，独立观察连接精确删除本轮库并核对库、库线程和已记录连接 ID 均为 0。3 库及其 12 表已清理，六个既有测试实例保持；本轮未新增用户。本节是原生语义研究，既不把服务器接受失真 SQL 标为保真成功，也不冒称产品 API、SQL 导出修复或 UI 已验收。

## 两版 MariaDB 的 UCA1400 字符集目录别名补证

正式 GUI 在 MariaDB 11.4 默认库上读取字段时报告“无法确认表默认字符集与排序规则”，而此前显式使用 utf8mb4_bin 的用例能够读取。为核对实际目录映射，本子任务另做两版 MariaDB 的原生元数据研究；没有调用产品 API，没有把目录研究结果当作修复或 GUI 复验成功。执行前各自核对 `Server-200 / 192.168.31.200 / root`，只在既有 13311、13310 端口分别建立一个新的 `dbark_colresearch_<16hex>` 库，`CHARACTER SET utf8mb4` 不指定 COLLATE。每库一张不指定 COLLATE 的普通表、一张显式指定目录实际存在的非默认 UCA1400 变体表，共 **2 库、4 表**，没有插入数据。

### 真实能力与精确匹配

两版的 `information_schema.COLLATION_CHARACTER_SET_APPLICABILITY`（CCSA）实际均有五列：`COLLATION_NAME / CHARACTER_SET_NAME / FULL_COLLATION_NAME / ID / IS_DEFAULT`。先读目录列能力及相关行，再选择实际返回的 `utf8mb4_uca1400_as_cs`；没有按名称前缀推断字符集、猜一个不存在的变体或修改全局默认值。四张表均一次 CREATE 成功，即时警告为空。

| 版本 / 表 | TABLES.TABLE_COLLATION | COLLATIONS 普通名精确行数 | CCSA 普通名精确行数 | CCSA FULL_COLLATION_NAME 精确行数 |
| --- | --- | ---: | ---: | ---: |
| 11.4.13 / 未指定 COLLATE | `utf8mb4_uca1400_ai_ci` | 0 | 0 | 1 |
| 11.4.13 / 显式非默认变体 | `utf8mb4_uca1400_as_cs` | 0 | 0 | 1 |
| 10.11.19 / 未指定 COLLATE | `utf8mb4_general_ci` | 1 | 1 | 1 |
| 10.11.19 / 显式非默认变体 | `utf8mb4_uca1400_as_cs` | 0 | 0 | 1 |

每表 VARCHAR note 列的 `COLUMNS.CHARACTER_SET_NAME` 均为 `utf8mb4`，`COLLATION_NAME` 与上表对应的完整表排序规则相同；INT id 列的字符集、排序规则均为 NULL。CCSA 完整名称精确匹配的关键实际行如下：

| FULL_COLLATION_NAME | CCSA.COLLATION_NAME | CHARACTER_SET_NAME | ID | 本轮 IS_DEFAULT |
| --- | --- | --- | --- | --- |
| `utf8mb4_uca1400_ai_ci` | `uca1400_ai_ci` | `utf8mb4` | `2304` | 11.4 为 `Yes` |
| `utf8mb4_uca1400_as_cs` | `uca1400_as_cs` | `utf8mb4` | `2307` | 两版均为空字符串 |
| `utf8mb4_general_ci` | `utf8mb4_general_ci` | `utf8mb4` | `45` | 10.11 为 `Yes` |
| `utf8mb4_bin` | `utf8mb4_bin` | `utf8mb4` | `46` | 两版均为空字符串 |

两版 COLLATIONS 对 `uca1400_ai_ci / uca1400_as_cs` 都只有短名行，其 `CHARACTER_SET_NAME / ID / IS_DEFAULT` 均为 NULL。因此按 `TABLE_COLLATION = COLLATIONS.COLLATION_NAME` 连接会遗漏完整别名，而取短名行的字符集也得不到有效值。两版普通 utf8mb4_bin 的 CCSA 完整名和普通名相同且唯一，说明使用完整名目录能力并不要求放弃这类普通排序规则。

本轮两版 `CHARACTER_SETS` 都有唯一的 utf8mb4 行，`MAXLEN=4`。11.4 的 `DEFAULT_COLLATE_NAME` 为 `utf8mb4_uca1400_ai_ci`，10.11 为 `utf8mb4_general_ci`；与新库及默认表的实际值一致。11.4 的 `SHOW VARIABLES LIKE 'character_set_collations'` 实际返回 `utf8mb4=utf8mb4_uca1400_ai_ci`，10.11 返回空行；服务器、连接的默认字符集与排序规则也逐项保存在报告中，没有改动它们。只记录该真实安装配置，不据此推断所有同版本服务器默认设置相同。

这些证据支持先读取目录能力，在存在 FULL_COLLATION_NAME 时按完整名称精确且唯一匹配，再核对实际 CHARACTER_SET_NAME 与 CHARACTER_SETS。它们不证明另外三个 MySQL 基线具有该扩展字段，也不支持无目录证明地截取名称前缀。产品实现和其他基线回归仍由后端及主智能体完成。

### 原件与资源清理

证据根 `.cache/o01-collation-catalog-probe/` 各轮以 `wx` 保存 `probe-source.mjs / report.json / catalogs.json`、建库和建表原 SQL、每表 SHOW CREATE 及结构证据。`catalogs.json` 保留 COLLATIONS、CCSA、CHARACTER_SETS 的字段能力和相关完整行：11.4 分别为 261、997、40 行，10.11 分别为 217、953、40 行；前两项限于 utf8mb4 或 UCA1400 相关目录，未声称保存整个服务器所有排序规则目录。原执行器为 `.cache/o01-real-definitions/collation-catalog-probe.mjs`，两份保存副本 SHA 一致：`a0d6682825e50a76af2563e73b51d6a772a853dcef70ce65541bbd4301a781d3`。

| 目录 | 实际版本 | UTC 开始—结束 / 时长 | report.json SHA-256 |
| --- | --- | --- | --- |
| run01-maria-eleven-four | 11.4.13-MariaDB-ubu2404 | 01:39:29.675–01:39:29.980 / 0.305 秒 | `c1fd8c7de160a1bbfbe8e1cf1039be2082981901357cfaef20415264a4f43620` |
| run01-maria-ten-eleven | 10.11.19-MariaDB-ubu2204 | 01:39:53.097–01:39:53.418 / 0.321 秒 | `87cf44fbfe5cec1281855e6a23f8634077e00f3b181aeba7cf910e160dc8f64c` |

两份报告均为 `schemas=0 / schemaThreads=0 / originalConnections=0 / clean=true`，本轮 2 库、4 表及记录的原连接线程均已精确清理。没有用户、GRANT、Docker 或全局/服务器配置操作；六个既有测试实例保持。本次新增研究不覆盖前述默认值失真反例或原 GUI 失败记录。

## 新增正式 API 权限边界用例（已准备，尚未实库执行）

新增独立 `tests/integration/engine-column-permissions.integration.test.ts`，共两项；测试调用生产 `Engine` 的 `schema.columns.get / preview / apply`，字段引用来自实际 get 快照，确认项来自实际 preview。没有模拟 SQL、网络、任务或权限目录。当前只完成编写和测试发现检查，**没有执行这两项远端用例，没有新的五基线、SSH/TLS 或桌面通过结论**。

| 权限情形 | 计划核验的实际结果 |
| --- | --- |
| 单表 SELECT，无 ALTER | get/preview 能读取；apply 收到服务器 1142 权限拒绝，任务唯一终态为 failed，仍保守记录 `ddlSubmitted=true / ddlCompleted=false / outcome=unknown`；独立管理连接确认完整 SHOW CREATE 与原行值完全不变；再次使用令牌在发起任务前被拒，不能重放 DDL |
| 单表 SELECT、ALTER、CREATE、INSERT，无 LOCK TABLES | 先通过权限目录和实际显式 LOCK TABLES 拒绝确认边界；正式标准修改只执行一次，收到 OK 且后定义核验成功；字段注释实际变更，旧行、表注释、唯一约束保留；重复唯一值 INSERT 实际拒绝；前后权限清单完全相同，无全局/库级/列级扩大授权及 GRANT OPTION |

四项表级权限取自 [MySQL ALTER TABLE 权限要求](https://dev.mysql.com/doc/refman/8.0/en/alter-table.html)，其中 SELECT 同时用于读取验收。MariaDB 的表级授权能力参考 [MariaDB GRANT](https://mariadb.com/docs/server/reference/sql-statements/account-management-sql-statements/grant)。这些是用例设计依据；能否在各实际基线上成功仍由后续运行决定，不根据文档预填结果。

每个用例在运行时产生新的 `dbark_colperm_<12hex>` 库及 `cp_<12hex>` 用户，密码只留内存；创建用户失败时不输出驱动可能附带认证 SQL 的错误对象。授权精确到单表，不使用可能因下划线匹配规则扩大范围的 `db.*`；不输出可能包含认证哈希的 SHOW GRANTS，改读实际权限目录。仅允许既有 200 服务器五个隔离基线端口；现有严格 TLS 专用端口必须同时显式启用 TLS。SSH/TLS 凭据仍由运行环境静默注入，不创建或复制新密钥。

无论断言成功与否，finally 都先结束 Engine 和独立低权限连接，再采样精确临时用户线程。发现泄漏会保留验收失败；必要清理只 KILL 此临时账户实际返回的安全整数线程 ID，不把回收成功当作产品自动释放成功。随后精确 DROP 本轮用户/库，读取用户、库、用户线程各为 0，关闭管理连接后以另一观察连接核对所有已记录 ID 为 0。任务日志只保存任务 ID、终态和 DDL 阶段等概要，不打印密码。线程 ID 属于实际采样，不能冒充全部短会话的完整协议审计。

默认未启用时 `vitest list` 输出空清单，保存在 `.cache/o01-real-definitions/column-permissions-list.json`。仅为收集设置启用标志后的 `vitest list` 已列出两项，保存在 `column-permissions-enabled-list.json`；list 不执行测试函数，因此未建立数据库连接、未创建用户或库。第一次写完时全项目 tsc 通过；之后收尾复查被另一测试文件的隐式 any 诊断阻挡，原失败保留在 `column-permissions-typecheck.log`。该文件 owner 完成类型修正后，最终 `tsc --noEmit` 再次以 exit 0 通过，独立空诊断日志为 `column-permissions-typecheck-final.log`；本子任务未修改该文件或运行时代码。

```powershell
# 仅发现测试，不执行测试函数；此命令不包含数据库密码。
$env:DBARK_INTEGRATION_ENABLED='1'
$env:DBARK_TEST_HOST='192.168.31.200'
$env:DBARK_TEST_PORT='13384'
node node_modules/vitest/vitest.mjs list tests/integration/engine-column-permissions.integration.test.ts --config vitest.integration.config.ts --json .cache/o01-real-definitions/column-permissions-enabled-list.json
node node_modules/typescript/bin/tsc --noEmit
```

后续真实执行仍需主智能体统一窗口、先核对服务器身份，再静默加载既有环境。每基线顺序执行两个用例，任一清理异常先处理本轮精确资源再继续；不并发创建本机容器、不改全局模式、不扩大授权以掩盖失败。单例 45 秒上限包含建连、两次字段读取、预览/应用、权限负例以及资源核查；没有用固定睡眠等待 DDL 或重试写操作。

## 官方语法依据

MySQL 文档区分文字默认值、表达式默认值及大对象默认值规则；旧版本不能直接套用新版能力。参考 [MySQL 默认值规则](https://dev.mysql.com/doc/refman/8.0/en/data-type-defaults.html)。

索引案例依据原生前缀、函数和可见性语法，保留各基线实际拒绝。参考 [MySQL CREATE INDEX](https://dev.mysql.com/doc/refman/8.0/en/create-index.html)、[MariaDB ignored indexes](https://mariadb.com/docs/server/ha-and-performance/optimization-and-tuning/optimization-and-indexes/ignored-indexes)。

CHECK 的接受与实际强制执行须分别核验；MariaDB 的定义输出受会话模式影响。参考 [MySQL CHECK 约束](https://dev.mysql.com/doc/refman/8.0/en/create-table-check-constraints.html)、[MariaDB CREATE TABLE](https://mariadb.com/docs/server/server-usage/tables/create-table)、[MariaDB SHOW CREATE TABLE](https://mariadb.com/docs/server/reference/sql-statements/administrative-sql-statements/show/show-create-table)。
