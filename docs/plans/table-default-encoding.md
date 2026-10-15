# 表默认字符集与排序规则受控修改

本切片基线为 `e3b1dd5d0af950cdb7fcfb0001c04111be4fe028`，普通分支 `task/parallel-o01-table-default-encoding-20261016`。只在员工4普通克隆开发，不使用worktree，不改ROOT候选或其他克隆。表注释旧模块未修改，已由其他任务负责其固定提交复审和修复；本切片后核验直接使用规范后的执行模式。

## 行为与接口

对象树普通表操作、表页工具栏均有“表默认字符集与排序规则”专用入口。选择器只展示当前服务器目录证明的配对，切换字符集会清空不匹配的排序规则，必须明确选定两者。预览只读，三项中文风险确认含“仅改默认值，现有列与数据不转换”。同目标隐藏表页的数据草稿和活动操作也会阻断入口，连接版本／目标变化、迟到响应与卸载有同步围栏。

固定生成一条最小语句：

```sql
ALTER TABLE `精确数据库`.`精确表名`
  DEFAULT CHARACTER SET = latin1 COLLATE = latin1_swedish_ci;
```

这只影响以后未显式指定编码的新增列。没有 `CONVERT TO`、CHANGE/MODIFY列、索引／外键重述或其他表选项，也没有任意SQL输入。现有列转换、整表数据编码迁移、数据库默认编码、engine/row_format/AUTO_INCREMENT修改仍是其他工作包，不能将本切片称为完整整表编码功能。

| 命令 | 最小公开输入 | 可信输出／边界 |
| --- | --- | --- |
| `schema.tableDefaultEncoding.get` | connectionId、database、table、taskId | 当前配对、实际候选、只读原因、全部列有效编码、snapshotId、定义摘要、过期时间 |
| `schema.tableDefaultEncoding.preview` | snapshotId、charset、collation、taskId | 重读实际候选、原定义和目录；返回一次性previewToken、固定SQL、前后配对和三项确认 |
| `schema.tableDefaultEncoding.apply` | previewToken、acknowledgements、taskId | 原子消费令牌，精确确认集合；独立会话和同表租约下最多一条ALTER，记录真实执行事实 |
| `schema.tableDefaultEncoding.release` | snapshotId或previewToken | 只释放本用途资源，不能清理字段／索引／外键／表注释令牌 |

新类型独立于 `shared/tableDefaultEncoding.ts`；CommandMap末尾追加，主进程注入连接revision，客户端不能提供SQL、覆盖目标或修订。独立缓存用途及 TaskEvent.tableDefaultEncoding 接入既有取消／退出状态机；共用结构缓存总预算和120秒期限。执行前后均等待真实查询和连接收尾，不因取消控制请求返回而假报完成，不重放、不宣称DDL事务回滚。任务持久化不保存候选业务内容或驱动错误原文。

## 真实目录与授权

候选来自同一可取消短会话的 COLLATIONS 与 CHARACTER_SETS，要求IS_COMPILED确认为Yes。MariaDB先查目录字段能力，提供FULL_COLLATION_NAME时再读实际完整配对；缺映射不猜UCA别名。名称与字符集不能唯一对应时排除候选，当前默认值无法证明则整表只读。每次重读完整候选摘要；最多8192项、2 MiB，截断或目录失败不变成可写的部分列表。

SHOW GRANTS只用于内存证明当前账户的直接全局、精确库或精确表ALTER授权。角色授权、部分撤销、通配库名以及未知授权语法首批只读；不展开角色，也不建议提升权限。直接授权在执行前再读，服务端仍最终强制权限检查。SHOW GRANTS可能包含认证片段，原文不缓存、不哈希、不写日志或返回界面；仅保留可证明与否，不创建用户或凭据。

## 定义与列保真

执行前严格比较新独立会话原模式、规范模式、服务器身份、完整原DDL、列编码和可空目录、真实TABLE_ID、其他表属性及候选摘要。数据插入导致AUTO_INCREMENT变化也会保守使原预览失效，不擅自忽略计数。物理门槛沿用既有范围：Linux/debian-linux-gnu、lower_case_table_names=0、ASCII库表名、非分区InnoDB、MySQL 5.7/8.0/8.4或MariaDB 10.11/11.4。该版本族范围不表示本切片每个补丁版本已实库验收。

执行后先处理服务器警告，再读取真实默认值、全部列有效charset/collation和完整定义。后验比较实际执行模式，即 `after.originalMode == snapshot.normalizedMode` 且规范模式一致；不能误用首次读取的隐藏定义模式与已规范化会话比较。

不笼统忽略整列：只剔除解析器已确认的列charset/collation属性进行剩余词法比较，随后独立核对全部列目录，并要求原显式属性仍同值存在。服务器新增的显式编码必须等于该列原有效值；新增错误值、删改旧属性、表达式／约束中的COLLATE、类型、默认值、生成表达式、索引／外键、表注释、其他选项或计数变化均不能被掩码吞掉。

以下情况明确只读或保守报告未完整核验：

- 未知类型／后缀、不可解析或可执行列／约束片段、未知／重复表尾选项、分区、身份／权限／目录无法证明。
- 非受控默认表达式不承诺修改表默认编码后的求值保真；受控CURRENT_TIMESTAMP精度、普通文字量与NULL另按解析结果处理。MariaDB整表风险默认值保护和原始二进制默认字节保护继续生效。
- COMMENT含MERGE_THRESHOLD等物理参数，首批不证明其他表选项在默认编码DDL中的内部处理，保持只读。
- 服务器合法省略旧显式列编码属性、内部重建导致TABLE_ID变化、警告、后核验读取失败或其他并发变化，均保留“DDL已完成，但未完整核验”，不把它当作未执行重试。首批只自动接受新增显式编码这一窄范围规范化；更多等价显示变化另补证据。

`definitionVerified`只代表目标结构与列编码核验，不代表扫描校验了全表数据。产品不执行现有列转换或数据DML；默认语义以官方语法和受限版本能力为基础，测试使用真实数据及HEX值独立核对。外部DDL在重读到发送之间仍有竞态窗口，进程内租约不等于数据库原子比较交换；请在维护窗口暂停并行结构修改。未承诺无锁、无重建或跨版本数据迁移。

## 官方依据与未验范围

MySQL区分仅修改DEFAULT与CONVERT TO，前者用于后续新增列的默认字符集，后者转换现有值并可能扩大文本类型：[MySQL ALTER TABLE](https://dev.mysql.com/doc/refman/8.4/en/alter-table.html)。MariaDB分别列出DEFAULT和CONVERT语法，并解释字符集与排序规则的继承／显式配对：[MariaDB ALTER TABLE](https://mariadb.com/docs/server/reference/sql-statements/data-definition/alter/alter-table)、[MariaDB设置字符集与排序规则](https://mariadb.com/docs/server/reference/data-types/string-data-types/character-sets/setting-character-sets-and-collations)。这些文档不替代指定补丁版本的实库证明。

候选关联和编译字段：[MySQL COLLATIONS](https://dev.mysql.com/doc/refman/8.4/en/information-schema-collations-table.html)；MariaDB完整映射需实际目录能力，不能用旧目录猜完整名称：[MariaDB COLLATION_CHARACTER_SET_APPLICABILITY](https://mariadb.com/docs/server/reference/system-tables/information-schema/information-schema-tables/information-schema-collation_character_set_applicability-table)。当前目录文档可能包含新版本字段，代码先探测，不据文档向旧服务器盲查。

权限读取、角色与撤销有独立表示，本版只实现直接授权的保守子集：[MySQL SHOW GRANTS](https://dev.mysql.com/doc/refman/8.4/en/show-grants.html)、[MySQL GRANT](https://dev.mysql.com/doc/refman/8.4/en/grant.html)、[MariaDB SHOW GRANTS](https://mariadb.com/docs/server/reference/sql-statements/administrative-sql-statements/show/show-grants)。

## ROOT验收准备

本轮禁止GUI、剪贴板、200、Docker，未做真实数据库、正式UI或安装包验收，未创建秘密。只进行类型、单元、源码构建和默认关闭用例的跳过／收集检查。没有修改ConnectionProfile/TLS字段、连接解析、ConnectionDialog、storage或connection驱动，也没有改版本与依赖锁。

- 核心 `tests/integration/engine-table-default-encoding.integration.test.ts`：4项，每轮显式指定一个200专用实例，五版本族直连加独立严格TLS共六轮；双开关 `DBARK_INTEGRATION_ENABLED=1`、`DBARK_TABLE_DEFAULT_ENCODING_TEST=1` 才执行。使用已有环境变量／CA，不创建账户，完整记录实际连接和取消控制线程编号，清理包括默认数据库为空的线程及白名单随机库。
- 正式UI `tests/e2e/table-default-encoding.spec.ts`：2项，真实对象树／表页、实际候选成对选择、缺规则禁止预览、只读SQL、三项中文确认、预览不改库、双击单次任务、原列编码和Unicode数据、只读物理参数、返回选择释放旧预览。复用真实Electron／原生确认／严格TLS夹具，未用fixture按钮或API调用代替表单。
- 核心复杂夹具覆盖生成表达式、ASCII旁列、前缀／全文索引、外键、触发器、Unicode及二进制HEX数据，先同charset换collation、再换charset默认值，随后新增列证明继承新默认。
- 同DDL重建使用独立无自增、显式主键夹具，并先断言前后完整SHOW CREATE相同再要求身份拒绝；不复用旧表注释有状态夹具。若该前置断言失败，属于夹具未证明条件，不能当作身份验收通过。
- 其他核心覆盖候选归属拒绝、物理参数只读、外部变更／修订失效、真实MDL取消及结果未知不重放。新权限账户矩阵、更多SQL模式、真实断网／工具退出与最终安装包仍需ROOT分别安排；纯驱动替身回归不能代替这些证据。

离线验证命令使用已有node_modules，不下载依赖；在本进程设置已核对的个人 `.cache/default-encoding-tmp` 为TEMP/TMP，避免沙箱系统临时目录重命名限制，不改全局环境：

```powershell
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vitest/vitest.mjs run
node scripts/build.mjs
$env:DBARK_INTEGRATION_ENABLED='0'; $env:DBARK_TABLE_DEFAULT_ENCODING_TEST='0'
node node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts tests/integration/engine-table-default-encoding.integration.test.ts
node node_modules/@playwright/test/cli.js test tests/e2e/table-default-encoding.spec.ts --list
```

2026-10-16本地结果：类型检查通过；最终以 `vitest run --maxWorkers=2` 运行169个文件、3123项单元全部通过，其中本切片新增63项；源码构建通过，保留既有依赖注释和大分块警告。首轮默认并发出现一个既有补全Worker测试5秒超时，未改该用例断言或超时，降低并发后完整复验通过；原失败日志保留在个人缓存，不冒充首轮全通过。最终日志为 `.cache/default-encoding-unit-verified.log` 和 `.cache/default-encoding-build-verified.log`，不提交。集成4项默认跳过，正式UI仅收集2项，均未实际运行。

固定3a复审后的准备追加：核心和正式UI共用 `tests/helpers/tableDefaultEncodingTarget.ts`，补13484白名单；该端口必须显式 `DBARK_TEST_TLS=1`、非空白CA，实际连接还必须启用TLS与证书校验并使用同一CA文件。正式UI沿既有观察连接／表单CA链路配置，在保存后核对目标、严格TLS和按realpath解析后的CA一致性；没有降级路径，原五端口边界、业务断言和期限保持。新默认编码Dialog中的Field、表头和“不适用”文案集中到专属locale，未动旧TableCommentDialog。

本次追加验证：类型检查通过；27项纯准备门正反例与原63项专属单元合计90项通过；新Dialog AST检查无散落中文字面量；核心4项默认关闭跳过、UI仅收集2项。没有运行GUI或连接200，没有重写原3a提交，没有据此宣布六组合实库或正式UI已通过。
