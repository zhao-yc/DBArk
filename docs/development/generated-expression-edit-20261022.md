# 修改已有数值生成表达式

## 入口与范围

对象树或表页“字段差异编辑”→选择已有数值生成列→勾选“修改生成表达式”→填写新表达式→应用本行草稿→预览旧、新表达式及完整 SQL→四项确认→执行一次。名称、整数／DECIMAL 类型、VIRTUAL／STORED、NULL、备注和位置保持；没有实际差异不发送 DDL。

只开放已有五个准确 MySQL/MariaDB 基线、Linux、大小写敏感、ASCII 库表名、非分区 InnoDB 且完整目录及物理身份可靠的可空生成列。允许前序普通整数／DECIMAL 列、十进制常量、正负号、加减乘与括号。依赖索引、主外键、CHECK、分区、其它生成／默认表达式或未知属性时拒绝，不自动重构依赖。

## 执行与核验

专属 `generation` 投影和单列、单属性补丁不扩展原七项普通属性权限。只替换原 SHOW 已证明的 AS 括号内部范围。所有修改强制 `ALGORITHM=COPY`；MySQL VIRTUAL 另带 `WITH VALIDATION`，两者是独立、逗号分隔的 ALTER 项。预览明确复制表、重算旧行、sql_mode、精度、溢出、锁等待和磁盘影响，不能承诺在线或可回滚。

保留 2048 字符／256 词元／16 层／32 次引用及 65 位文字量预算；实际重建输出也完整重解析，不只检查输入长度。一元正号只在比较键中消去，保留十进制尺度、负号和运算次序，不在客户端求值。

get→preview→apply 重核原定义、修订、全列目录和原 TABLE_ID。一次令牌在执行前消费；取消、断线、明确 ERR 或后核失败均不自动重放。DDL 后只允许物理编号及目标表达式变化，同列数／顺序、其余目录、原类型及定义片段均保持，并独立核对新 AST、EXTRA 和存储方式。结构后核不证明数据级原子 CAS 或全部外部依赖无影响。

## 实测与后续

准确 `c99cf166` 的[验收记录](../../tests/integration/acceptance-generated-expression-c99cf166-20261022.md)：Windows 类型、368 项相关、完整 14041 通过／1 平台跳过及构建通过；六实例共 12 次 VIRTUAL／STORED 修改，90 条原连接严格收尾，包含严格 TLS。MySQL 四实例精确确认旧行越界错误；MariaDB 越界分支未验。13384 明文 VIRTUAL 正式窗口首次通过，原数据保持、四确认、一次提交及正常退出闭合。Linux 候选 CI 检查成功。

存储方式转换、普通列互转、非数值／函数／除法／生成链、新表／分区及完整依赖仍待开发。macOS、实际安装包、真实长 DDL 取消和本片限权组合未验；不增加完整 O01 或发行计数，暂不发布。

语义依据：[MySQL 8.4 修改生成列](https://dev.mysql.com/doc/refman/8.4/en/alter-table-generated-columns.html)、[5.7.44 准确语法源码](https://github.com/mysql/mysql-server/blob/mysql-5.7.44/sql/sql_yacc.yy#L7787-L7791)、[MariaDB 生成列](https://mariadb.com/docs/server/reference/sql-statements/data-definition/create/generated-columns)。文档和静态语法证据不代替产品实测。
