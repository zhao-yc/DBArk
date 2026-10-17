# 同库复制表结构及数据切片交接（2026-10-17）

本片从 `9d2fd9ce8ae09c5a0ad75df884381d0628bc00f1` 建立独立普通克隆，分支为 `codex/employee2-table-copy-data-20261017`。不变更旧“复制表结构”用途、共享桌面夹具、共享认证 helper、退出流程或 Root 工作区。

## 本片行为

- 新增 `schema.tableCopyData.get/preview/apply/release`，固定 `mode=structure-and-data`。主进程、预加载白名单、严格校验器、引擎、任务隐私摘要、侧栏、表页和专属对话框完整接线。
- 仅准确 MySQL `8.4.11`、Linux/名称大小写规则已证明的普通 InnoDB 表，同一连接配置和同一数据库。沿用源 UUID、原生 TABLE_ID、完整 SHOW CREATE、列目录、依赖、SQL 模式、权限及同名检查；另外须显式全局 INSERT，关闭 binlog 或使用 ROW 格式。未知事实只读，不请求扩权。
- 生成列（VIRTUAL/STORED）、隐藏列、外键及反向外键、触发器、视图依赖、CHECK、分区、特殊索引和未经证明的物理表选项均不开放。此处不会继承空表用途已经开放的生成列范围。
- 读取/预览只读取有界元数据，专属会话的规范化 SET 不改用户查询会话，不读取源行、不创建表、不写入行。
- 一次性令牌存于专属缓存。服务端保存模式、来源结构事实、可信连接修订、准确新名及两条固定 SQL；apply 首次等待之前消费本快照全部预览。精确 `数据库.新表` 和五项数据用途确认不可由空表确认替代。客户端不能提交 SQL、列映射、源/目标覆盖或连接修订。

## 执行及失败边界

1. 在既有独立任务、两端执行互斥及专属物理连接内重核源事实与同名冲突，单次发送 `CREATE TABLE ... LIKE ...`。不带 IF NOT EXISTS，不覆盖、不找后缀。
2. 收到建表成功响应后单独记录 `ddlCompleted`；建表有警告时保留表并停止数据阶段。
3. 读取新表原生编号，设置并复核 READ COMMITTED，开启数据事务。两端 `SELECT 1 ... LIMIT 0` 不取源行，在事务内取得元数据锁，然后再次核对源/目标完整结构、原生编号和目标为空。首次目标编号读取与事务锁定之间发生同名替换必须拒绝。
4. 专属会话保留原规范模式，加入并复核 `NO_AUTO_VALUE_ON_ZERO`、`STRICT_ALL_TABLES`。对全部普通列生成显式列列表，一次执行服务器内部 `INSERT INTO ... (列) SELECT 列 FROM ...`。不经 JS 搬运或转换自增值、大整数、DECIMAL、NULL、字符串或二进制字节。不使用 IGNORE、REPLACE 或 ON DUPLICATE KEY UPDATE。
5. INSERT 返回无警告成功响应且 affectedRows 是安全非负整数后，才报告 `insertCompleted`、字符串形式行数，再发送独立 COMMIT。只有提交成功回调后才报告 `dataCompleted`。不可靠行数不会当作精度证明，也不会自动提交。该计数不代表逐行比对。
6. 建表、数据发送、INSERT 完成、COMMIT 发送和数据提交分别进入实时进度。主进程退出仍保留这些字段；建表成功不能变成数据成功。提交成功后关闭失败仍保留提交事实，同时保留资源错误。
7. 失败路径不补发 COMMIT、ROLLBACK 或 DROP，不重试 INSERT，也不重放旧令牌。未提交的数据事务由原任务结束后既有专属连接严格关闭；不能仅凭取消 ACK、本地断线或 Promise 拒绝宣称服务器已回滚。目标表和未知结果留给人工核查。

`CREATE LIKE` 与数据事务整体不原子。数据快照属于 INSERT SELECT 语句执行时所见的已提交数据，预览没有固定数据快照。需要维护窗口暂停两端写入与并行 DDL。CREATE ACK 与首次目标编号读取之间仍有外部窗口：OK 包不携带新表 TABLE_ID，无法从中证明窗口内未发生外部同名重建；本片不宣称消除该窗口。事务元数据锁也不替代维护窗口、两端写入协调或服务器容量管理。

自增列的显式值含 0 一并复制，但不继承来源当前下一自增计数；目标下一值由 MySQL 根据复制数据和运行策略决定。运行策略、完整结构或源当前自增事实漂移会保守拒绝。产品显示“写入前结构已核 + 数据事务提交响应”，不声称提交后逐行一致、任意并发下快照固定或真实平台已验收。

## 官方语义依据

- [InnoDB 各类语句的锁](https://dev.mysql.com/doc/refman/8.4/en/innodb-locks-set.html)：READ COMMITTED 下 INSERT SELECT 的来源为一致性读，目标插入行仍取得锁；自增锁另受运行策略影响。
- [一致性非锁定读](https://dev.mysql.com/doc/refman/8.4/en/innodb-consistent-read.html)：READ COMMITTED 的一致性读采用每次读的新快照，不能把预览时间当作复制时间。
- [原子 DDL](https://dev.mysql.com/doc/refman/8.4/en/atomic-ddl.html)：单条原子 DDL 不等于事务化 DDL，DDL 隐式结束当前事务，不能与后续数据语句合称原子事务。
- [元数据锁](https://dev.mysql.com/doc/refman/8.4/en/metadata-locking.html)：事务内使用的表保留元数据锁至事务结束，阻止并行结构变更；本片仍明确锁定前窗口。
- [SQL 模式](https://dev.mysql.com/doc/refman/8.4/en/sql-mode.html)：NO_AUTO_VALUE_ON_ZERO 保留显式 0；严格模式遇到不合法值不静默当成功。
- [INSERT SELECT](https://dev.mysql.com/doc/refman/8.4/en/insert-select.html)：支持显式目标列及 SELECT 列列表；本片不使用忽略冲突或更新冲突行的变体。
- [KILL](https://dev.mysql.com/doc/refman/8.4/en/kill.html)：取消返回不等待原命令终止确认，清理也需要时间，因此继续复用原任务的真实回调和严格资源关闭。
- [CREATE LIKE](https://dev.mysql.com/doc/refman/8.4/en/create-table-like.html)：复制结构而不复制数据，且不能在 LOCK TABLES 生效时执行；本片未擅自加表锁改变旧流程。

## 纯验证与实际待办

新用途纯测试覆盖引擎、主进程、严格合同、服务适配器、正式产品入口、内存 ReactDOM、双门与列表短路、正式定义的原生关闭/归属/身份漂移/本地永久保留。父版独立源码归档运行同一新引擎反例为 36 失败 / 0 通过，首因是父版不认识 `schema.tableCopyData.get`；新实现对应 36 项通过。未切换或修改任一现有分支来制造父红。

验证命令与准确结果见本次最终交接；本地 JSON 原始报告保存在本克隆 `.cache/`，不提交日志与构建产物。首轮沙箱全量的 212 失败全部为 EPERM；正常权限首轮 6521 通过 / 3 Worker 专项失败 / 0 跳过，保留报告，不把它描述成通过。随后以相同断言及原时限、`--maxWorkers=4` 完整复核：6524 通过 / 0 失败 / 0 跳过，退出码 0。类型检查与构建均退出码 0；默认关闭列表只收集到一个关闭身份，不启动实际模块。构建仅有既有依赖 PURE 注释和较大 chunk 提示。

`tests/e2e/table-copy-data.spec.ts` 默认关闭，`--list`/`--list=json` 在读取任何环境配置或加载实际模块之前短路。只有 Root 另行安排本轮准确配置并显式打开 `DBARK_INTEGRATION_ENABLED=1` 与 `DBARK_TABLE_COPY_DATA_UI=1` 才注册实际定义。原预算 120 秒，retries=0；本片没有打开双门。

两个正式定义为空表、精度表。精度表包含自增 0、9007199254740993、18446744073709551614、DECIMAL(65,30)、NULL/空字符串/空字节/00FF275C80；观察查询用 CAST AS CHAR、HEX 与 NULL 标志独立比较，不用 JS 重新计算数值。每个新物理观察连接核准确版本、OS、lower_case_table_names 和本轮预期 UUID。沿用严格原生 close 的同一底层流终态证明；每次 await 前后复核固定 raw owner、页面/应用、配置与身份；本地 sticky retain 先于共享通知，超时或归属未知时停止后续退出与清库。未更改共享 fixture/helper/quit。

Root/独审者仍需先审固定提交、整合共享合同，再独立安排源码与候选安装包实际。真实待办包括：上述两个正式场景；CREATE/INSERT/COMMIT 各阶段断线与取消；服务器回滚/锁释放；事务内源/目标 DDL 等待；同名/表 ID 替换；权限/模式变化；目标自增下一值的实际观测；Windows/macOS 原生资源收尾。必须使用本轮独立授权与材料，不能继承旧正式实证或 R93 计数。

本片真实 GUI、浏览器、数据库、SSH、200 服务器、Docker、剪贴板、安装、CI 操作和私料读取全部为 0。没有生产部署、没有新软件/依赖安装、没有密钥证书产物。

## 本轮验证命令

```powershell
node node_modules/vitest/vitest.mjs run tests/unit/engine-table-copy-data.test.ts --root .cache/table-copy-data-parent --reporter=json --outputFile=.cache/parent-red.json
node node_modules/vitest/vitest.mjs run --maxWorkers=4 --reporter=json --outputFile=.cache/table-copy-data-full-pure-bounded.json
node node_modules/typescript/bin/tsc --noEmit
node scripts/build.mjs
node node_modules/@playwright/test/cli.js test tests/e2e/table-copy-data.spec.ts --list
git diff --check
```

父版归档命令预期退出 1，其余最终命令退出 0。6524 是本独立基线加本片的当前纯测试总数，不与 Root 后续整合基线的总数混合。没有执行 Playwright 实际 body、Electron 启动、真实观察 SQL 或远程命令。
