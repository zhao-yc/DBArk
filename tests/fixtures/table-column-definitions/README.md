# 表字段真实定义夹具

本目录仅保留 15 份自主创建研究表的 `SHOW CREATE TABLE` 原始结构，不含插入行、业务对象、凭据、服务器地址、端口或随机研究库名称。原表已在取证结束后精确删除。此目录是纯读取器和 SQL 规划器的离线回归输入，不代表产品 API、实际 ALTER 或桌面验收通过。

## 来源和字节校验

来源为 2026-10-14 的 O01 `run02` 定义取证，完整过程见 `docs/plans/table-column-patches-acceptance.md`。原始输出来自 MySQL **5.7.44 / 8.0.46 / 8.4.11** 和 MariaDB **10.11.19 / 11.4.13**，具体版本后缀、实际 `sql_mode`、连接字符集/排序规则、SHOW CREATE 引号开关与时间戳默认开关逐份保存在 `manifest.json`。

每份 `.sql` 文件保持原始 UTF-8 字节，不加文件头、不格式化、不改引号或换行；`manifest.json` 的 `sha256` 与原始采集证据一致，单元测试会校验。复制时已经剔除运行环境与行观察，只保留建表定义及上述解释上下文。

## 预期能力及限制

| 夹具分组 | 数量 | 需要保持的行为 |
| --- | ---: | --- |
| 五版本 `combined` | 5 | 只改普通列注释时保留同列字符集、排序规则和文本 NULL 默认值；不得重述旁边 ON UPDATE、生成列、前缀索引及 CHECK。MySQL 5.7 的实际定义没有 CHECK，不伪造补回 |
| MariaDB `maria-unsafe-expression` | 2 | 风险默认值触发整表保护，原生 RENAME COLUMN、普通旁列修改也拒绝；仅允许独立批次显式替换或删除全部风险默认值，不将未修改片段相同当作语义保真 |
| MariaDB `ansi-full` / `ansi-incomplete` | 2 | 同一表在普通模式与 ANSI 兼容模式下的真实输出对照。ANSI 文件缺索引注释及表尾，仍保留 AUTO_INCREMENT；纯解析不能补回不存在的属性，不能把它当完整修改源 |
| MySQL 8.4 函数索引/隐藏列/分区 | 3 | 复杂旁列、可执行版本注释、索引表达式和分区表尾不被普通列注释修改重述；隐藏列的未知片段仍保守只读 |
| MySQL 8.4 `literal-defaults` | 1 | 区分 SQL NULL、空串、文本 NULL，保留 BIGINT/DECIMAL/BIT 精度和 `__proto__` / `constructor` 合法名称 |
| MySQL 8.4 两类 COLLATE | 2 | 列 COLLATE 与括号内默认表达式 COLLATE 不混淆，替换默认值不重新提交整列 |

MariaDB 表达式文件具有独立 `run03` 最小重建反例：其原始 Unicode 默认表达式在 SHOW CREATE 中表现为 `xC3x80` 一类文字，原文重建后默认值改变。后续 `run04/05` 又在两版真实 MariaDB 中证实，原生改名、普通旁列修改以及 ADD/DROP 都会改变未指定的风险默认值；因此此前“原生改名及旁列允许”的纯规划断言已被实库证据推翻并修正。`run06` 只为同一 ALTER 全部显式 SET/DROP 风险默认值提供有限语义证据，不恢复任意 ALTER 能力。这里不复制插入行或结果数据，也不根据异常文字猜测修复表达式；15 份 SQL 与 manifest 原始字节及 SHA 保持不变。

`completeDefinition=false` 是夹具来源标记，不是读取器自动识别缺失元数据的能力。生产结构任务必须规范化兼容模式并交叉核对实际目录；本目录的单元测试不模拟这一步成功。
