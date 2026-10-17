# 已有表CHAR/BINARY普通BTREE前缀首片

## 范围与实际行为

基线为`cd827a52f901c48d4bc7cb26fc7de12f9fed0540`。已有表的专用索引对话框、逐字段前缀表单、结构化合同、真实快照和后核链路已经存在，原先只开放VARCHAR、VARBINARY及TEXT/BLOB前缀。首片补齐CHAR和BINARY；新建表前缀仍是独立缺口。

生产仅修改`tableIndexMetadata.ts`、`tableIndexPatchSql.ts`，没有新增私有生产helper。界面及共享合同原样复用，CHAR提示字符、BINARY提示字节；字段长度必须来自同一原定义与实际COLUMNS目录，缺失、NULL、零、冲突均不能默认补值。字符前缀按实际字符集MAXLEN计最坏键字节，二进制按每单位1字节计；复合键累计预算继续拒绝超限，不交给服务器自动截短。

[MySQL官方列索引说明](https://dev.mysql.com/doc/refman/8.4/en/column-indexes.html)明确非二进制CHAR/VARCHAR/TEXT前缀参数按字符、BINARY/VARBINARY/BLOB按字节；键限制按字节。[MariaDB官方建表索引语法](https://mariadb.com/docs/server/server-usage/tables/create-table#index-types)支持逐字段长度及索引方法。官方语法说明不等于本次五版本真实验收。

## 沿用的边界

- 原准确版本门：MySQL 5.7.44、8.0.46、8.4.11，MariaDB 10.11.19、11.4.13；InnoDB DYNAMIC、16KiB页，5.7另核large_prefix。未知组合仍只读，本提交没有增加版本或行格式。
- 普通BTREE普通/唯一索引沿现有补丁和确认链路；主键前缀、特殊索引前缀、生成列、隐藏列、未知类型保持拒绝。
- 新增、替换、预览、提交前重核、单次令牌、SHOW与STATISTICS.SUB_PART交叉读取、独立后核和原属性保持均沿原实现。
- 唯一前缀只约束前缀值；不能以全字段值不同推断可创建。服务器重复值错误不转为普通索引、不重放、不补DROP，未收到ACK不报告DDL完成。

## 验证与剩余工作

先在未改生产的基线上运行新增及更新的两个目标测试文件：78项中58通过、20失败；三个生产表达式及注释调整后78项全部通过。新增测试同时使用真实列适配器、能力门、SQL规划器及后核器，覆盖MySQL/Maria目录形状、字段长度、错误单位、3072/3073复合字节边界、SHOW前缀被截短，以及原默认、旁键、索引注释、CHECK、表尾保持。

另在已有Engine单测文件的私有驱动回包中显式增加CHAR/BINARY目录形状，不改共享fixture/helper。正式命令链验证预览零DDL、一次apply、旧令牌消费及独立后核；1062重复前缀为明确合成驱动错误，只验证产品失败状态、关闭和零重放，不声称在数据库上制造或核验了真实冲突。

本轮必要相关套只覆盖元数据、规划、后核、界面草稿和Engine索引链，6个测试文件共180项通过、0跳过，类型及构建退出码均为0；原退出码、日志和实际产物SHA另随交接保存。GUI、数据库、SSH、CIM、系统剪贴板、CI、安装、Docker操作均为0，没有创建或运行真实测试入口。Root另行安排真实矩阵；本首片不代表新建表前缀、全版本/安装版/Mac全覆盖，也不回写历史覆盖数字。
