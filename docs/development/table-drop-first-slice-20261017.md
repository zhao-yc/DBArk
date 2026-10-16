本片新增专用单表删除入口，源码基线968628d22ea55faed705710e440ce859f4a22996。此前只有查询SQL通道，没有schema.tableDrop专用命令。版本和安装包保持不变；这份交付是待Root整合、待原生及200验收的源码，不是当前安装包功能通过声明。

用户从真实TableTab的“删除表”进入，先读取能力，再预览只读SQL。确认文字必须准确等于“库名.表名”，不trim、不折叠大小写；完整勾选永久删除数据和结构、独立会话隐式提交、维护窗口和外部DDL风险三项后才可单次投递。清空表与删除表的命令、令牌用途、确认协议和后核验均独立，删除不复用清空令牌，不重置计数或保留空表。

服务器只允许已有已证明范围：MySQL 8.4.11及其版本后缀、Linux/debian-linux-gnu、lower_case_table_names=0、ASCII非系统库名称、持久普通非分区InnoDB表。未知版本、MariaDB、Windows名称映射、无原生TABLE_ID、生成/未知定义、依赖不明或目录不可见均不给可写预览；不能读取完整基本表时显示明确错误。没有新增数据库授权，保守沿既有读取器证明来源ALTER/DROP和全局SELECT、SHOW VIEW、TRIGGER，INNODB目录不可读取即只读；不自动展开角色、部分撤销或未知授权。

get/preview/apply沿原结构短会话、共享缓存总预算、120秒期限、连接修订和结构执行锁。完整原定义、真实目录属性、服务器UUID、物理TABLE_ID与外键/触发器/视图依赖在预览及DDL前重核。客户端不提交SQL、表目标或连接修订作为apply授权。apply在首次await之前消费本令牌及同快照其它预览，错误确认、取消、失败或未知结果都不能重放；重新读取不重放旧DDL。

DDL始终为一条DROP TABLE，完整限定库和表，不带IF EXISTS、TEMPORARY、CASCADE、关FK、多表列表或隐藏重试。独立结构会话保持FK/唯一检查开启，不借用查询标签事务，不替其它标签提交。执行前重核与MySQL实际取得DDL锁之间仍有外部变更窗口，必须暂停并行DDL和数据写入；本片不宣称消除该窗口，也不自动修复例程、事件、动态SQL或应用代码引用。

成功OK响应只记录DDL已完成；之后重核相同UUID、服务器账户、版本和规范模式，重新证明全局目录可见，再检查information_schema.TABLES不存在原名称，且INNODB_TABLES既没有原TABLE_ID也没有原物理路径，最后再次确认身份与模式未变。表被同名重建、原物理表被并发改名、权限丢失、断线、取消或警告非零，都保留“DDL已完成但未完整核验”的事实，不以空目录或0 affectedRows推断删除行数或成功。

取消沿现有query.cancel、KILL/真实回调终态与严格关闭路径；控制请求返回不代表DDL已结束。发送后断线或进程退出保留unknown与已发送事实，主进程任务持久化继续只写脱敏摘要，不保存准确确认文字或驱动原文。

同目标所有隐藏表页的未提交记录、布局、活动任务和尚未结束的格输入，在进入和发送前均阻断。完成后使用已有workbenchNavigation.retireTable同步废弃迟到导航并停用旧名称URI。完整核验成功且没有新草稿时关闭精确原目标表标签并刷新对象树；未知结果或执行期间出现新草稿只标过期并保留现场，不静默丢弃。异库/异连接同名及查询标签不关闭；连接修订已变时不改变新连接的同名对象。

URI沿当前既有名称协议，退役记录覆盖当前窗口。重启后仍通过真实目录拒绝已消失对象，但跨重启同名重建后的物理身份歧义不在本片证明范围；没有新增持久URI协议或迁移框架。未来若要跨重启阻断同名回收，应由Root单独设计并验收。

本轮验证为117项不同身份的定向纯测试通过（首批114项及新增实际接线3项），包含新增删除70项及原清空/重命名接线47项；React测试使用RAM DOM和Monaco显示端口，Engine测试只替换驱动，主进程测试执行实际dispatch转译代码，导航测试执行实际App完成方法和真实工作区/导航模块。它们不等于原生UI、数据库DDL、任务真正退出或安装包验收。TypeScript全工程检查通过，最终检查结果以交接缓存为准。

正式验收定义默认双门关闭：DBARK_INTEGRATION_ENABLED=1与DBARK_TABLE_DROP_TEST=1必须同时满足。table-drop.spec.ts在--list/--list=json先短路，纯RAM门控测试覆盖两门四组合，证明不读额外配置、不加载live、桌面或观察连接模块。核心定义的生产引擎仅在双门允许的beforeAll动态导入，list也先短路。本轮没有执行正式定义或Playwright list。

未来定义包括核心3项与真实UI1项，每个允许端口分别验收，共8个计划身份：单次DROP与目录消失、入向FK/同名重建/错误确认反例、真实MDL等待取消、TableTab预览确认/关页/旧URI拒绝。只允许已核对200的13384/13484，13484须显式TLS和相同CA；UI保存连接后再次核对实际profile，新增表写入前必须匹配ROOT显式绑定的DBARK_TEST_EXPECTED_SERVER_UUID，核心定义在建库前核对此UUID。UI复用既有isolatedDatabase，它在回调前已建隔离库，因此ROOT仍须在运行该fixture前完成实际服务器及UUID预检；回调内UUID门不能冒充建库前预检。新核心隔离库名称为dbark_drop_<12位小写十六进制>，Root资源清理账本须先识别此精确前缀，未确认owned线程及真实退出前禁止清库。没有绑定当前候选、fixture退出补丁或实跑命令，不能复用历史授权。

本轮GUI、200连接、数据库读写、clipboard、Docker、手动CI、凭据读取均为0。未新增依赖、框架、版本、安装包、Root改动或员工4fixture改动。共享接线只存在于员工3独立普通克隆，供Root后续整合。

语义依据：[MySQL 8.4 DROP TABLE](https://dev.mysql.com/doc/refman/8.4/en/drop-table.html)、[隐式提交](https://dev.mysql.com/doc/refman/8.4/en/implicit-commit.html)、[原子DDL与事务区别](https://dev.mysql.com/doc/refman/8.4/en/atomic-ddl.html)。原子DDL不代表用户可用ROLLBACK恢复已确认的DROP。
