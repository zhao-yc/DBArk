# 准确MySQL5.7.44普通新建表

Root 后续实证：固定整合 `509a57b` 的完整 6480 项、类型及构建通过，一个正式 Windows/准确 MySQL 5.7.44 新建表界面身份单次通过并核六资源零。见[实际验收及限制](../../tests/integration/acceptance-table-create-mysql57-root-20261017.md)。下文作者阶段实际0保留其原来源；这是新建表能力证明及已验组合，不表示首次支持 5.7 连接/查询，也不代表完整类型、FK、新表 tableID、安装或 macOS。

本片固定基线 `6d817d9c775d15ac5ec3f32ef811ab10e84022ff`，新普通克隆及分支 `codex/employee4-table-create-mysql57-20261017`，不使用worktree，不修改Root或两旧分支。

## 原有支持与缺项

基线 `tableCreateTasks.ts` 已沿原生成器创建普通MySQL/Maria表，已有5.7.44主键、唯一索引及完整列BTREE的RAM后核，但普通版本矩阵只断言过CREATE完成，不能代替准确5.7事实或真实验收。原8.0准备合同明确不接受5.7，缺少准确5.7.44专属正式入口。此次不复制SQL生成器或取消/令牌链，不把其他用途的准备合同当成5.7能力证明。

[MySQL5.7时间字段文档](https://docs.oracle.com/cd/E17952_01/mysql-5.7-en/timestamp-initialization.html)明确：关闭explicit_defaults_for_timestamp时，首个TIMESTAMP可能被赋予隐式自动默认/更新属性。该资料只解释需要读取事实的原因，不能替代本轮实际服务器事实。MySQL官网的部分5.7链接已跳转新版，因此使用明确标示5.7的Oracle官方存档。

## 生产路径的最小能力门

MySQL5.x普通新建表只在准确5.7.44及无空白、非Maria发行后缀下取得本片许可。实际独立会话读取 `@@version`、`@@explicit_defaults_for_timestamp`、`@@innodb_strict_mode`，并有界读取ENGINES与CHARACTER_SETS。实际版本必须与连接版本一致，InnoDB必须明确YES/DEFAULT，严格模式必须为1，字符集目录完整、唯一且不超过256项；错误、缺项、未知或目录预算不足均停在只读，不签发可用能力，不吞错补默认值。

这些事实纳入原身份摘要，在get、preview、apply之前及ACK后随原read链重核。只证明InnoDB与真实目录字符集；未启用显式TIMESTAMP行为时，含TIMESTAMP设计保守只读，不自动SET或重写字段。JSON、TEXT/BLOB及空间类型不接受非空默认值；省略SHOW定义的模式只读。普通列、主键、普通及唯一完整列BTREE仍由原生成器及SHOW/COLUMNS/STATISTICS完整交叉后核；DECIMAL默认值逐字保持，不经JS Number转换。

没有探测information_schema_stats_expiry、GIPK或其他8.x专属变量，没有向5.7发送失败探测后吞错放行。FK及复杂表达式继续沿原边界，本片不扩大能力或宣称已完成其实测；8.x/Maria原路径不增加这些查询。新片不转换已有表或数据，不改共享契约、设计器、主进程、连接与通用SQL生成器。

## 父红新绿与边界

父版本两条语义反例均为红：未核清隐式TIMESTAMP行为时仍能生成预览；其他5.7补丁仍能取得通用创建预览。修复后同两例转绿。原设计器预览、准确库.表名、两项风险、单次令牌消费、取消、资源关闭及未知不重放保持。新测试使用真实Engine，仅替换RAM驱动，并补普通复合索引、5.7显示宽度、实际能力错误/漂移、版本边界、能力查询取消、ACK后未核验与精度反例。

当前GUI、DB、SSH/200、CI、安装、clipboard、构建、私料读取及部署均为0。正式入口保持默认关闭，实际验收由Root独审后另行安排；纯测、能力门或本文档不能代替5.7.44原生实证。

## 默认关闭的正式定义

`table-create-mysql57.spec.ts`先处理list，只有 `DBARK_INTEGRATION_ENABLED=1` 与 `DBARK_TABLE_CREATE_MYSQL57_UI=1` 且raw自有host/port/TLS/user/password/Root UUID全部明确，才注册13357/plain正式定义。拒绝认证回填文件，不增加认证范围。注册固定raw和helper身份，内部await持续核同一TestInfo/page/application，传入原connectAndCreate内部，配置恢复不复活旧身份。

任何DDL前先以无默认库观察连接核准确5.7.44/Linux/lower0/Root UUID、5.7已有会话变量及InnoDB/utf8mb4目录，并严格等待同一原生流QUIT/close；第二观察连接重核事实及准确隔离名称缺席后才进原建库表单。原设计器仍走准确确认、两风险及单次apply，合成普通列、主键、普通复合索引与唯一索引分别经SHOW、COLUMNS、STATISTICS及空表查询独立观察，并核原目录刷新。

本地retained先永久落定，再尽力通知共享夹具一次。own/observe/外层catch/finally/afterEach共用此锁，通知失败或后来恢复、allowClosed、空任务列表及activity结束都不能解除；活动超时、迟到close、任务未终态、退出/DROP/最终关闭未知均停链保留，原首因及聚合cause保持，不补救、不重放。原45秒预算及0重试保持，不修改共享fixture/live-helpers/quit或旧8.0/8.4定义。

入口纯测执行真实注册函数及原connectAndCreate正文，驱动与DOM端口仅给RAM。正常对照完整执行主体与收尾，反例覆盖完整raw身份、能力目录、严格nativeclose、内部等待、通知设置前失败、状态恢复、超时、任务和清理未知。真正CLI list开启双门时禁止认证环境读取，结果只能为默认关闭定义且实际运行结果为空。

```powershell
node D:/svn/DBArk/node_modules/vitest/vitest.mjs run --config .cache/table-create-mysql57/vitest.config.mjs --reporter=json --outputFile=.cache/table-create-mysql57/final-results.json
node D:/svn/DBArk/node_modules/typescript/bin/tsc --noEmit
node .cache/table-create-mysql57/list.cjs
```
