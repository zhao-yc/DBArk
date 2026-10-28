# 已有表 CHECK 约束管理（2026-10-28）

## 实际入口与流程

连接侧栏的普通表操作和表数据页提供“管理 CHECK 约束”，视图不显示入口。明确点击“读取检查约束”后，窗口展示实际名称、表级／列级位置、完整表达式和生效状态；未知范围不会显示成“没有约束”。新建表设计器的 CHECK 输入不属于本次增量。

一次编辑一项：新增、修改名称或表达式、删除，以及支持时的启用／停用。先预览只读 SQL，再分别输入准确数据库名、表名并确认后端所列风险，才提交一次原生 ALTER。替换通过同一条 ALTER 的 DROP＋ADD 完成；失败、取消、断线及资源收尾错误均不自动重放。返回编辑会废弃旧预览，同目标隐藏表页有草稿或活动操作时拒绝进入／提交。

新增或启用可能扫描已有行、等待元数据锁；删除、替换、停用会改变数据完整性保护。DDL 可能隐式提交，不能依赖事务回滚。MySQL CHECK 接受结果为 TRUE 或 UNKNOWN 的行，不应把 NULL 当作自动违反约束。MySQL 8.0.16 以前存在解析而忽略 CHECK 的情况，本实现将 MySQL 5.7 明确设为只读，见[官方 CHECK 说明](https://dev.mysql.com/doc/refman/8.0/en/create-table-check-constraints.html)。

## 能力与保真边界

MySQL 8.0.16 以上的 8.0 和 8.4、MariaDB 10.11／11.4 分别适配。MySQL 单条 NOT ENFORCED 与 MariaDB 的会话总检查开关分开处理；MariaDB 不提供本界面的逐条停用，独立结构连接明确保持检查开启，不改变原查询会话或全局设置。参见[MariaDB 约束说明](https://mariadb.com/docs/server/reference/sql-statements/data-definition/constraint)和[检查约束目录](https://mariadb.com/docs/server/reference/system-tables/information-schema/information-schema-tables/information-schema-check_constraints-table)。

引擎交叉核对 TABLE_CONSTRAINTS、CHECK_CONSTRAINTS 和完整 SHOW CREATE。MySQL 的 80016 NOT ENFORCED 后缀单独解析；未知尾部、目录缺漏、名称歧义或无法证明物理身份时保持只读。MariaDB 通用 DROP CONSTRAINT 的名称匹配由实际目录排序规则核对，不依赖 JavaScript 猜测 Unicode 等价。JSON_VALID 列检查不作为可自动丢弃的辅助信息。

表达式按实际 ANSI_QUOTES／NO_BACKSLASH_ESCAPES 做有界词法封装，禁止逃离 CHECK 括号或注入多语句，不使用生成列的简化算术白名单。CASE、函数、字符串、JSON 等语义最终由服务器裁决，预览不保证数据能够通过检查。完整定义、目录、模式、连接修订和物理 TABLE_ID 绑定短期单次能力；提交同时退休父快照和兄弟预览。当前可写物理身份门沿用已证明的 Linux、lower_case_table_names=0、ASCII 命名、非分区 InnoDB，其它组合仍待扩展。

## 验证与后续

WIN11-TEST已通过类型、分轮257／317项相关单元、完整19326项通过／1平台跳过、构建和正式spec默认／list关闭门。Root已回读原退出码、完整输出及冻结源码；夹具缺依赖、一次测试通道中断和观察器缺证分别保留，结果见[验收记录](../../tests/integration/acceptance-table-checks-20261028.md)。静态实现及 RAM 测试不能替代真实数据库 DDL 和原生窗口；本轮隔离资源仍待独立授权。Windows／macOS 安装包、更多引擎／名字映射、新建表 CHECK、完整兼容性及发布仍属后续，不增加完整工作包或发行计数。
