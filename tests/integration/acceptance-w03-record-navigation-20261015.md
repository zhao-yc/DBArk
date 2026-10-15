# W03 命中记录只读定位验收（2026-10-15）

状态：0.17开发中，完整W03和Navicat覆盖目标继续进行。此批增加真实精确定位入口，不将“打开所属表”或候选键提示当作定位完成。

## 实现与范围

数据搜索结果有有效定位引用时，按钮、双击或Enter在独立只读窗口读取当前记录，自动聚焦原命中字段；返回恢复原结果行的键盘焦点。窗口仅显示当前命中字段块的所选列及定位键，不代表全部字段；普通表标签和未提交草稿保持原状，没有写入入口。

`search.recordRead`仅接受连接、任务编号及引擎签发的随机引用，不接受渲染端SQL、键值或身份证明。引用绑定来源搜索和连接，签发起5分钟、最多4000条和32MiB，不保留数据库连接。开始新搜索、关闭窗口、保存或关闭连接、到期及进程退出均释放；有有效引用的来源编号禁止复用。取消与返回同时等待读取实际终态，不把取消RPC返回当作连接已释放。

签发和读取均在独立只读事务已取得目标元数据锁后，核当前账号、服务器与配置端点、有效SQL模式、原生InnoDB TABLE_ID及规范完整SHOW CREATE摘要。摘要仅忽略表级AUTO_INCREMENT计数，仍保留列属性、注释等定义。首批精确身份限五个已验版本族、Linux、lower_case_table_names=0、ASCII字母数字下划线库/表名、非分区InnoDB及当前账号具备读取原生目录的权限；其它范围仍可搜索，但不签发虚假定位引用。没有可靠可读非空唯一键时同样只保留搜索预览。

原生目录身份依据见[MySQL INNODB_TABLES](https://dev.mysql.com/doc/refman/8.0/en/information-schema-innodb-tables-table.html)和[MariaDB INNODB_SYS_TABLES](https://mariadb.com/docs/server/reference/system-tables/information-schema/information-schema-tables/information-schema-innodb-tables/information-schema-innodb_sys_tables-table)。这些是机制依据，不作为本机Navicat行为验证。

BIGINT、DECIMAL和JSON保持原文，二进制保持字节并以HEX显示；NULL与空串明确区分。原生键条件保留索引，再比较精确表示；读取上限2行，不唯一就拒绝。TIMESTAMP搜索保留原日期预览，并另存内部epoch供UTC读取，零日期不转换为1970；DATETIME/TIME仍为原文。会话时区与内部秒数的依据见[MySQL日期时间函数](https://dev.mysql.com/doc/refman/8.0/en/date-and-time-functions.html)，版本范围及具体精度另由下面实库用例证明。

单字段最多4096字符，并按字段数缩小；单记录输出最多1MiB。显示完整表示长度及截断标记，不把截断字段当作完整记录。读取的是当前值，可能与原128字符搜索预览不同。表重建、定义或模式改变、键删除及权限变化均拒绝使用旧引用。记录数据、键、搜索值和服务器错误原文不写SQLite任务概要。

## 执行证据

`run256-record-source-reservation-unit`完整2165项单元全部通过，0失败/跳过；`run257-record-source-reservation-types`最终类型检查exit 0；`run279-record-scope-final-build`最终运行构建exit 0。新增单元覆盖严格输入、归属、期限、来源编号保留、定义摘要、epoch及原生键条件，另补窗口来源释放、失败重试和关闭去重。

| 200隔离实例 | 记录定位15项 | 流式任务15项 | 目录及权限8项 | 搜索计划8项 |
| --- | --- | --- | --- | --- |
| MySQL 5.7.44 / 13357 | run268 | run262 | run195 | run215 |
| MySQL 8.0.46 / 13380 | run269 | run263 | run196 | run216 |
| MySQL 8.4.11 / 13384 | run270 | run264 | run197 | run217 |
| MariaDB 10.11.19 / 13310 | run271 | run265 | run198 | run218 |
| MariaDB 11.4.13 / 13311 | run272 | run266 | run199 | run219 |
| MySQL 8.4.11严格TLS / 13484 | run273 | run267 | run200 | run220 |
| 合计通过 | 90 | 90 | 48 | 48 |

共276项真实用例，0失败/跳过。目录及计划回归在本批较早阶段运行；最终来源编号规则后重验记录定位及流式任务180项。定位覆盖精确大整数/金额/JSON/微秒、复合键/尾空格/二进制、零TIMESTAMP、自增计数正常变化、MyISAM仅搜索、EXPLAIN PRIMARY/const、更新后当前值、删除、同名同DDL同键重建、ALTER、跨连接拒绝/释放、200k字段截断、跨会话时区及SQL模式变化。真实LOCK TABLES WRITE阻塞读取后取消，按具体驱动线程编号确认结束，锁持有会话保持并在finally解锁。

`run280-record-scope-final-ui` Windows源码7项通过，0失败/跳过/重试/flaky，记录397个输入文件摘要。205字段跨页搜索后定位c204及精确BIGINT，返回126处命中与行焦点；保留原查询结果、NULL/HEX、原事务及表格草稿；受限列权限仍正确降级并允许恢复。第7项真实锁等待中返回，确认线程释放后，同一引用可再次定位。最终截图已查看，命中字段实际位于视野且聚焦只读输入框。

`run276-record-package`直接打包最终冻结dist，105个构建文件逐字节一致，生产清单逐字段等于显式去除开发字段后的原清单投影。未签名Windows测试包137939678字节，SHA256：`41f5b82269fe4334e2b69e2d1e04e5b5f621c7ce23108048c75ea42db6198704`，未覆盖公开发行。

`run277-record-installed`真实NSIS安装后，数据7项和结构4项共11项全部通过，0失败/跳过/重试/flaky，记录342个输入摘要。安装ASAR与冻结归档逐字节摘要一致：`e00ac6239df9e43a0158d41bf30f80bc81d16d5b10661b1e6dab4f53befd75bd`。同一安装进程实际exit 0并完整卸载后，`run278-record-final-resources`独立只读核六实例临时库、用户和相关线程、本机进程及本批临时目录全部为0；13个历史目录保留。

`.cache/w03-database-search/record-navigation-attestation.json`汇合以上报告并重新核输入字节、安装包摘要、ASAR一致性和资源清零。原始日志、截图、认证及测试包均留忽略目录，不提交认证、测试数据或第三方程序。

## 原失败、授权及保留项

`run229`至`run234`各14通过1失败，原因是新增模式夹具将参数数组写成字符串；修正夹具后六实例各15项通过，最终run268至273再次通过。`run241`源码6通过1失败：同一SELECT完成后按钮先恢复、结果DOM尚未绘制。搜索关闭后的原快照比较已通过；修正为等待同一执行结果绘制后逐字比较，未重发SQL或放宽值断言。run247、258、275及最终280均7项通过。所有原失败记录保留，不作为重试通过隐藏。

全部服务器操作先核Server-200 / 192.168.31.200 / root，仅六个已授权隔离端口。此批复用既定随机dbark_colperm_*及cp_*的SELECT/INSERT列权限子集，未扩大授权；实际锁夹具只针对独立测试库。finally精确清理，不触业务，无Docker，无新长期密钥。

前一提交4676b30的CI 38720906727终态success，属于前一批，不能作为本批原生CI结果。本批尚未完成macOS私网、SSH、百万行搜索/导航、完整桌面、任意身份范围、可编辑导航或公开0.17下载验收。Unicode/分区/其它引擎/缺PROCESS的身份替代方案，以及TRUNCATE、重命名、交换分区、命名时区DST、极端日期范围仍需专门验收；完整W03还缺定义正文及保存查询全文等子能力。
