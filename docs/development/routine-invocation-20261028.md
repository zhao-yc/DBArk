# 例程调用草稿（开发中）

## 使用流程

对象树中，存储过程或函数行提供“生成例程调用”。打开窗口后明确选择“读取参数并预览”，核对顺序、方向、数据库类型及完整SQL，再“打开调用查询”。打开前会通过新的独立任务重新读取；定义或目录变化时旧预览失效，必须重新读取。

支持过程IN、OUT、INOUT、函数返回及零参数。新查询保留原库上下文，原查询、结果和事务不被替换；此窗口不执行调用脚本。IN／INOUT使用按序号生成的`:arg_N`，打开查询后通过既有“参数执行”填写九类精确值，实际值不写进生成草稿。

OUT／INOUT使用每份预览独有的会话变量，完整脚本依次初始化、CALL、SELECT输出和SET NULL清值。必须整份执行；失败或取消可能遗留变量值，最后SET只清值、不删除变量。输出列为`out_N`，窗口中保留原参数名称映射。函数使用完整限定名SELECT并返回`return_value`。函数和过程均可能写入、隐式提交或产生外部副作用，不自动执行、回滚或重试。

## 目录与实现边界

`metadata.routineInvocation`绑定保存连接、明确库、对象种类、名称及独立taskId；从建连前登记到严格物理收尾后释放，不借用查询会话。读取ROUTINES、PARAMETERS、SHOW CREATE和相关保存模式，两轮一致后产生SHA256指纹；主进程和界面都拒绝失效来源。

参数目录必须与SHOW CREATE头一致，权限过滤后的空目录不能冒充零参数。只解析CREATE头、参数、RETURNS和特性；正文由真实SHOW CREATE提供，不解析正文SQL，也不把正文送到查询或渲染进程。普通MySQL例程语法按保存的ANSI_QUOTES／NO_BACKSLASH_ESCAPES等模式处理；MariaDB Oracle模式不冒充MySQL语法。

最多200实参，函数另有独立返回项；可解析定义1MiB、目录预算2MiB、生成SQL128KiB，超限整份拒绝。类型仅用于展示和签名核对，不拼接参数实际值；库和例程分别引用，任意参数名不进入占位符或SQL注释。

字段设计对照[MySQL PARAMETERS](https://dev.mysql.com/doc/refman/8.4/en/information-schema-parameters-table.html)和[MariaDB PARAMETERS](https://mariadb.com/docs/server/reference/system-tables/information-schema/information-schema-tables/information-schema-parameters-table)：函数返回是序号0、名称／方向为NULL的独立目录项，DTD_IDENTIFIER包含完整类型信息。权限不足可能使定义不可见，依[MariaDB SHOW CREATE](https://mariadb.com/docs/server/reference/sql-statements/administrative-sql-statements/show/show-create-procedure)保留拒绝路径；不把NULL定义当零参数。这是官方资料静态核对，不代表各数据库版本实测。

## 验证与剩余范围

源码候选以`f2857901`为基线，WIN11-TEST完整类型、八文件170项相关单元及构建通过；专项默认恰1skip、list恰1占位，只证明关闭门，不算正式调用。[分轮验收](../../tests/integration/acceptance-routine-invocation-20261028.md)保留原始PID、源码字节及控制器失败，当前暂不发布。

真实调用拟使用200/13384的单一随机隔离库、空audit表及四个合成例程；新的DDL和调用范围尚待本轮明确授权，未创建或执行。此增量是调用草稿和既有参数查询的衔接；不把它记为完整可视化例程执行器、调试器、其它驱动或完整Navicat工作包已完成。macOS、安装包及兼容性矩阵另验。
