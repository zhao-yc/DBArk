# 索引参与查询优化器

本切片为已有索引增加独立的优化器使用状态。MySQL 使用 `VISIBLE`／`INVISIBLE`，MariaDB 使用 `NOT IGNORED`／`IGNORED`；索引仍维护，唯一约束仍须执行。它不保证优化器最终选择该索引，也不是删除或重建索引。语义依据见 [MySQL 官方说明](https://dev.mysql.com/doc/refman/8.4/en/invisible-indexes.html)及 [MariaDB 官方说明](https://mariadb.com/docs/server/ha-and-performance/optimization-and-tuning/optimization-and-indexes/ignored-indexes)。

## 设计范围

在表的索引差异编辑器读取实际状态，设置“供查询优化器使用”，生成单索引、单属性预览并明确确认后提交。恢复原状态不生成差异；已有新增、删除、改名或键定义草稿不能混入，也不会被自动丢弃。已不可见／已忽略的索引必须能通过同一入口恢复。

复用 `schema.indexes.get/preview/apply/release`，额外事实通过 `includeOptimizerFacts` 明确请求。专属 `optimizerVisible` 布尔属性不进入旧 DROP／ADD 规划器；旧改名、删除与重建权限不随本功能放宽。未知属性及表达式索引继续保留原定义与只读边界。

首批只开放上述精确现代版本、Linux／名称大小写映射可证明的 InnoDB 基本表，且须读到原生表／索引角色并证明直接 ALTER 权限。角色目录需要额外的读取权限；无法证明时显示只读原因，不自动增加数据库授权。

原生 SQL 明确采用 `ALTER INDEX`、`ALGORITHM=INPLACE, LOCK=NONE`。这不消除元数据锁等待，也不承诺无锁或恒定执行时间。执行前重核实体与快照，令牌仅消费一次；中断写操作不自动重放。执行后必须核对目标状态和原定义，不能仅凭服务器成功回包宣称完整验收。

## 原生行为依据

独立探针已核对五个现代隔离实例的真实身份：MySQL 8.0.46、8.4.11、MariaDB 10.11.19、11.4.13，以及另一个 MySQL 8.4.11 严格 TLS 实例。每个实例验证 13 个空表索引情形，临时库精确清理、原连接流关闭。

普通和复合索引、非主键唯一索引、外键两端的支持索引以及自增列支持索引均可切换并恢复，原 SHOW 定义最终逐字相同，物理表／索引编号不变。显式主键与实际隐式聚簇唯一索引均被拒绝；同一无主键表中的其它唯一索引仍可切换。物理角色根据 [MySQL INNODB_INDEXES](https://dev.mysql.com/doc/refman/8.4/en/information-schema-innodb-indexes-table.html)及 [MariaDB INNODB_SYS_INDEXES](https://mariadb.com/docs/server/reference/system-tables/information-schema/information-schema-tables/information-schema-innodb-tables/information-schema-innodb_sys_indexes-table)识别，不按索引名字或 SHOW 排列猜测。

首探针因重复备选唯一索引的创建警告停下，已独立核归属并清理；修正版仅允许该准确夹具的 1831 警告，属性切换仍要求零警告。这些是数据库行为证据，不等于产品 Engine、界面或安装包验收；真实数据上的约束保持须另行验证。

## 验证边界

类型、22 文件 621 项相关检查、完整 15218 项通过／1 平台条件跳过、构建及默认关闭门通过。2328 份源码／测试／配置输入保持。六实例实际 Engine 整例通过：五个现代组合各 8 组往返，共 80 条原生属性 DDL，5.7 明确只读且零 DDL；唯一约束、父子外键、自增插入及原数据精度／字节保持，全部原生流关闭、任务线程核零并精确清理随机库。这里只承诺本例定义、目录和数据读回范围，不扩大为全库数据证明；原有部分外部目录不会被标为完整。

原对话框的五个迟到确认／丢稿重入反例已修复并保留原失败断言；首次测试环境缺原生计时器的失败及首轮类型标注错误另行保留。WIN11-TEST 派发仍不稳定，新测试未送往虚拟机；按用户授权在本机接续，原 VM 测试已有终态，不重复执行。

准确347ab3a6的Windows正式源码窗口已完成隐藏／恢复，原SHOW、全部STATISTICS和全部原行保持，原App正常退出、精确清理通过，2434份来源输入保持。完整命令、原PID、失败、末尾空行专项及未验范围见[验收记录](../../tests/integration/acceptance-index-optimizer-347ab3a6-20261023.md)。源码通过不等于新安装或macOS实库通过。

MySQL 5.7 不支持该原生能力；安装包、macOS、限权、实际元数据锁取消、断线和大表行为分别验收。完整 O01 工作包继续保持“部分”，暂不发布。
