# MariaDB UCA1400新建表后核补证

## 实际问题与来源

1361源码UI在MariaDB 10.11.19完整通过；MariaDB 11.4.13已收到CREATE成功ACK，但返回`definitionVerified=false`，界面按事实显示“CREATE成功但完整定义未核验”。原失败报告保留，不以修改期待值补算通过。

Root的1363只读公开报告SHA256为`2a1a36884d9591f6ece8814919096f8b691edba1fcf0af2b026da9ec20135ee0`。其中SHOW明确返回`DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci`，TABLES实际排序规则一致，但与COLLATIONS联结得到的字符集为SQL NULL。COLLATIONS仅提供通用`uca1400_ai_ci`及NULL字符集，完整名称的APPLICABILITY查询也无结果。文字NULL、普通默认值和索引形状未发现冲突。

[MariaDB官方11.4版本说明](https://github.com/mariadb-corporation/mariadb-docs/blob/main/release-notes/enterprise-server/11.4/11.4.3-1.md#character-sets-and-collations)解释了UCA1400的短名称及COLLATIONS中NULL字符集语义；该说明用于解释别名形状，准确11.4.13实例事实仍来自1363。[官方字符集说明](https://mariadb.com/docs/server/reference/data-types/string-data-types/character-sets/setting-character-sets-and-collations#table-level)说明SHOW CREATE可反映实际编码，且仅指定字符集时表排序规则可能与库默认值不同。因此不能由库默认值、设计值或排序规则名前缀猜字符集。

## 生产修改范围

只修改`src/engine/tableCreateTasks.ts`已有CREATE后核。MariaDB且TABLES联结的字符集严格为SQL NULL时，复用已有默认编码解析器，必须同时满足：

- SHOW尾部解析无理由项，无重复、未知或可执行选项。
- SHOW显式给出字符集和排序规则，字符集准确匹配本次设计。
- SHOW完整排序规则与TABLES实际字符串逐字一致。
- 其余列、默认值、普通及唯一索引和外键核验仍全部通过。

目录字符集已有值时不覆盖，缺属性或空字符串不能补证；MySQL原路径保持。没有新增查询、SET会话、DDL重放或DROP。ACK与完整后核仍是两个独立事实；验证失败不能变成未执行。

## 测试与验收边界

新增非敏感fixture只包含1363实际SHOW、TABLES及COLUMNS形状，不保存资源库名、身份或凭据。测试只将表名改成合成目标；索引驱动明确使用既有独立合成数据，不能称为1363未读取字段的真实证据。

新增21项：实际形状正例、16项缺失/NULL/重复/未知/冲突/MySQL反例，以及4项省略定义模式。修改生产代码前29项中仅新实际形状正例失败，其余28项通过；修复后29项全部通过。26个相关新建表、编码、SQL、列及索引解析器测试文件共853项通过，类型检查及构建退出码均为0。原退出码、日志及构建产物SHA另随交接保存。

本员工仅执行离线单测、类型及构建；真实GUI、数据库连接、SSH、恢复、安装、剪贴板操作均为0。Root独占现场、恢复及后续新编号11.4单项复验。1361整批失败、1351失败保留；10.11已通过阶段不重跑。本提交不代表修复后真实11.4通过，也不增加R93安装215/340或Mac覆盖。
