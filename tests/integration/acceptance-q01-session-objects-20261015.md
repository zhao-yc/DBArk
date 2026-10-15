# Q01 会话临时对象检查点（2026-10-15）

状态：本页记录35b2748的0.16检查点，Q01保持部分，没有新公开版本。后续[元数据边界与初始化验收](acceptance-q01-session-read-and-warmup-20261015.md)已补视图确认、隐藏显示完整性及压力边界。35b2748原生CI中Windows/arm64通过，macOS x64实际安装失败；完整原件和修正范围见后续记录，不能外推为本批全部平台通过。

## 实现与真实入口

查询标签执行 SQL 建立会话后，可点击工具栏“会话临时对象”。目录只属于该物理连接，显示已观察名称、可靠性和有界字段；也可手输库名和表名读回过程或动态 SQL 创建的临时对象。结构读取明确提示会更新当前诊断，自动补全只读内存。SHOW CREATE TABLE 判断当前名称是否被临时表遮蔽，SHOW FULL COLUMNS 获取实际字段、基础类型和可见性；不把原始定义、默认值或行数据存入目录。

同名临时表优先于永久目录，显式库名同样遵守遮蔽。目录按服务器 lower_case_table_names 规则匹配，修订变化使旧建议失效。直接临时字段包含不可见列，派生星号过滤不可见列。[MySQL 不可见列说明](https://dev.mysql.com/doc/refman/8.4/en/invisible-columns.html)与[MariaDB 说明](https://mariadb.com/docs/server/reference/sql-statements/data-definition/create/invisible-columns)均说明可见性属性；具体版本以实测矩阵为准。

不透明调用、无法确认是否包含视图/触发器的来源、失败变更或预算不足会使目录待核对，界面提示从该入口读取结构。未实现的 MariaDB 条件 ALTER 不猜列名，成功后清空可能过期的字段再要求读回。简单 CREATE TEMPORARY TABLE 权限失败不虚构临时遮蔽。关闭会话后不持久化或复活目录，连接中断不重放写入。

## 当前分层证据

所有原件位于本机忽略目录 `.cache/o16-sql-completion/`，包括输入摘要、正式 JSON、原日志和 SSH 身份。证据按轮次新增，不覆盖失败或重复触发建议来掩盖错误。

| 层次 | 轮次及结果 |
| --- | --- |
| 单元 | `run120-session-objects-gipk-unit`：2053 通过，100 文件，0 失败/跳过 |
| 类型 | `run121-session-objects-gipk-types`：退出码 0 |
| 构建 | `run122-session-objects-gipk-build`：退出码 0 |
| MySQL 5.7 / 13357 | `run123-session-objects-release-five`：32 通过，不可见列及 GIPK 两项因版本限制跳过 |
| MySQL 8.0 / 13380 | `run124-session-objects-release-eight`：34 通过，0 跳过 |
| MySQL 8.4 / 13384 | `run125-session-objects-release-lts`：34 通过，0 跳过 |
| MariaDB 10.11 / 13310 | `run126-session-objects-release-ten`：33 通过，MySQL GIPK 一项跳过 |
| MariaDB 11.4 / 13311 | `run127-session-objects-release-eleven`：33 通过，MySQL GIPK 一项跳过 |
| 严格 TLS / 13484 | `run128-session-objects-release-tls`：34 通过，0 跳过，保持 CA 和目标身份校验 |
| Windows 编辑器 | `run129-session-objects-regression-desktop`：28 通过，0 失败/跳过/不稳定，188097 ms |

每个实例 18 项既有目录/会话测试与 16 项临时对象测试，共 200 通过、4 项版本/方言限制跳过。覆盖两个会话同名对象、永久目录分离、IF NOT EXISTS、LIKE/CTAS/附加字段、ALTER 顺序与跨库改名、回滚、切库及引用、纯缓存的 ROW_COUNT/警告/连接/事务保持、CALL/函数/视图/动态执行/可执行注释、失败变更、受限账号负例、真实长查询取消、目录销毁、不可见列和自动隐形主键。

读取取消用例暂停实际 socket 消费，元数据仍由真实服务器执行和返回；使用生产 KILL 控制链路取消，随后恢复消费并排空响应。确认任务取消后修订未变、未发布迟到缓存，原 CONNECTION_ID 可继续使用，再显式读回真实字段。这个结果不等于服务器端长时间元数据锁等待的界面取消已经验收。

权限沿用已授权范围：每个实例只给随机 cp_* 用户授随机 dbark_colperm_* 库 subject 表的 SELECT，不授数据库级 CREATE TEMPORARY TABLES。密码只保留内存。每套测试关闭引擎，精确删本次用户和库，按实际驱动取得的连接编号核 PROCESSLIST 为零；独立资源核对在桌面终态后补录。本批没有本机或远程 Docker 操作，没有新增长期密钥或证书。

`run130-session-objects-final-resources-cleanup.json` 独立核对六实例的本批前缀库、用户和线程均为零，本机项目桌面进程和当前批临时目录为零，13 个历史目录保留。实际版本为 MySQL5.7.44、8.0.46、8.4.11、MariaDB10.11.19、11.4.13，TLS为MySQL8.4.11。`.cache/o16-session-objects-checkpoint-attestation.json` 对10轮的可执行输入逐文件核当前源码相等，最终构建105文件；验收 Markdown 在收尾时更新，单独记录为非执行文本，没有豁免代码或测试差异。mysql2 补丁 SHA256 与 pnpm 锁内 hash 完全相等，并已实际离线重新应用。

## 原始失败与修正

- `run93-session-objects-primary`：26 通过、3 失败。一个测试把字段排在随后删除的字段之后，服务器正确拒绝，修正测试顺序；关闭后错误文案区分不存在与繁忙。实质缺陷是 SELECT 行结果 EOF 未附带实际 SQL，存储函数改变对象后旧字段未失效；补齐固定版本 mysql2 补丁并由 pnpm 更新/重新应用锁摘要。`run94` 原 29 项通过。
- `run104-session-objects-desktop`：14 通过、2 失败。CALL 后默认库仍未知，读取字段不能假定它已恢复，改用显式来源并保留完整正文断言。事务用例写入永久来源后目录保守待核对，增加实际结构读取，保留未提交可见性、原连接、精确 BIGINT 和回滚断言。另增加可操作状态提示。
- `run105-session-objects-cancel`：30 通过，随后增加视图/CTAS 副作用、方言 ALTER 和不可见列的最终矩阵。
- `run115-session-objects-final-desktop`：16 通过，0 跳过/失败/不稳定；保留为隐形主键保护前的检查点。最终 28 项另外包含类型参数与 SQL 流式导出回归。
- `run116-temporary-gipk-probe.json`：单 MySQL8.4.11 会话内启用自动隐形主键，实际返回 my_row_id 与声明字段；未改全局设置，随机库精确清理。不能把无主键 CREATE 文本标为完整字段。[MySQL GIPK 文档](https://dev.mysql.com/doc/refman/8.0/en/create-table-gipks.html)说明该能力自8.0.30提供。补丁初轮 `run117` 为2052过1失败，原有权限负例发现“成功完整性”与“声明失败原子性”被混用；分离两种状态后 `run120` 全2053通过，再验六实例全部原权限断言。

## 后续边界

自动声明摘要仍不能代替服务器完整定义，未实现语法必须显式读回。目前结构读取只处理表，视图本身的非遮蔽确认尚待补齐；未确认来源有保守失效，不能称为完整视图/触发器分析。继续验证隐含字段的隐藏显示设置、兼容模式、超大定义预算、服务器端长元数据等待、断线与关闭中的迟到响应，并完成 Windows 当前安装、macOS 两种架构的原生源码/实际安装及实库范围。完整作用域和其余 Q01 子能力、整个 Navicat 功能目标均未完成，不建 0.16 标签或用旧平台证据宣称本批已发行。
