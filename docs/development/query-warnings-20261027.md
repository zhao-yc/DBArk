# 查询警告详情

## 执行边界

查询标签新增“采集警告详情”，默认关闭，不保存到配置。只有明确开启才在每条原语句
真实结束后，用原物理会话读取 `SHOW COUNT(*) WARNINGS`，按需读取
`SHOW WARNINGS LIMIT 101`。普通、选区、当前语句和类型参数查询共用该选项；执行计划、
实际分析和全量导出不受此选项影响。

读取诊断会改变后续 `ROW_COUNT()`，依赖该值的脚本应保持关闭。Server-200 六个隔离
实例的独立会话探针均确认：原 `SET` 后为 0，插入 `SHOW WARNINGS` 后为 -1；本轮
`SQL_CALC_FOUND_ROWS` 的 `FOUND_ROWS()` 均保持 3，不能泛称它必然改变。探针无 DDL、
表写入、授权或 Docker 操作，每个原物理连接正常关闭。首轮将 FOUND_ROWS 必须变化
写成研究断言而失败，原日志保留；修正为观察真实值后六实例通过，不把原失败改写成通过。

官方参考：[MySQL SHOW WARNINGS](https://dev.mysql.com/doc/refman/8.4/en/show-warnings.html)、
[MariaDB SHOW WARNINGS](https://mariadb.com/docs/server/reference/sql-statements/administrative-sql-statements/show/show-warnings)。
协议包只有计数，完整消息必须读取同会话诊断，不能通过另一连接补取。

## 快照、隐私与资源

报告按原脚本语句序号组织，CALL 按整条命令处理；不会将多个结果集次数累加为警告。
每组区分原 SQL 完成／失败、总数未知、未取得及截断。参数查询只保留 Level／Code，
不读取或传输条件正文。报告只在内存，不写入历史、配置或固定结果；普通消息纯文本展示。

最多保留 200 组，每组 100 条条件、每条正文 4096 字节，整报告不超过 512 KiB。
服务器 `max_error_count` 等造成的缺项明确标记。采集预算耗尽只停止采集，不停止原脚本；
取消、断线或协议状态未知则沿任务边界停止，不重连、重放、隐式提交或回滚。

报告绑定执行时的连接对象、修订、会话、任务和标签；旧来源不能借新连接复活。
打开、切换和关闭报告均离线，不执行 SQL。新执行会替换旧报告。

## 驱动修正与验证记录

修正 mysql2 `eofWarningCount()` 的有符号读取为无符号 16 位。实际安装驱动的二进制
EOF 测试修复前 9 失败／5 通过，修复后警告／状态／流式协议共 48 项通过。
pnpm 离线应用现有补丁，下载 0，未升级依赖；协议依据为
[EOF 警告字段](https://dev.mysql.com/doc/dev/mysql-server/latest/page_protocol_basic_eof_packet.html)。

首轮 UI／契约验证 92 通过／2 失败，原因分别是新测试 VM 未提供 CommonJS exports，
以及流式导出合法基线夹具误带 maxRows；仅修夹具后原 94 项通过。首轮冻结验证的类型检查
通过，相关 839 项中 824 通过／15 失败，均为旧当前语句 AST 夹具缺采集开关默认值；
补默认关闭端口，保留全部旧断言和时序后重新验证。

首个实库统筹脚本误生成 `query-query-warnings.test.ts` 路径，未找到用例、未创建库；
仅修私有脚本后，第一轮六实例真实 Engine 整例全部通过。Windows 首轮正式窗口在影响
告知处失败：文字只在 title 悬停提示，开启后页面不可见。产品改为开启时显示可见说明，
同时将全局“不完整”提示修正为覆盖服务器少存、预算及采集异常，不降低原断言。

## 最终验收

WIN11-TEST 再次不可达，按既有授权使用 Windows 本机回退，串行执行最终冻结快照：

- 类型检查、839 项相关单元、完整 18,154 项通过／1 项 POSIX 平台跳过、构建通过。
- 两套新增实库门默认关闭时均跳过；列表明确发现 1 项正式窗口复合用例。
- 六端口每实例 1 项真实 Engine 整例，最终 6 通过、0 跳过，13484 严格 TLS；覆盖默认
  零附加 SHOW、真实 ROW_COUNT、SELECT EOF、逐句警告、原错误及继续模式、失败 CALL、
  参数消息隐藏、max_error_count 少存、200 组后尾部写入、事务隔离／显式回滚及真实取消。
- 正式 Windows 源码窗口 1 整例通过，约 5.8 秒，无重试或跳过；4 次真实 Main 查询分别
  验证默认关闭、普通采集、类型参数采集及恢复关闭。可见影响说明、Level／Code／Message、
  语句切换、HTML 字面值、离线重复打开、参数消息及历史保护均通过，并正常退出。
- 独立新连接只读复核两轮合计 14 个准确隔离库、74 个已登记线程及对应事务均无残留，
  核对连接亦确认物理关闭；保留失败轮次，不广扫或清理其他资源。

复现入口为 `tests/integration/query-warnings.test.ts`（额外显式设置
`DBARK_QUERY_WARNINGS_INTEGRATION=1`）及 `tests/e2e/query-warnings.spec.ts`（额外设置
`DBARK_QUERY_WARNINGS_UI=1`），还需已有 `DBARK_INTEGRATION_ENABLED=1` 和预核身份配置。
独立审阅未发现可证的 P0/P1 阻断；内存测试不能代替上述实库或原生结果。
交付收尾仅在两个新模块补充三处中文方法注释；去注释后的 TypeScript 语法树打印结果
逐字相同，未改变原验证的执行逻辑，其余源码、测试和构建输入保持。

安装包及 macOS 新功能验收另行记录。既有 `197ef4eb` 的 CI 与本次功能范围分开：
Linux、Mac arm64／x64 job 通过，Windows 旧连接迁移退出失败仍待[阶段诊断](../testing/windows-quit-ci-20261027.md)。
其中 Mac arm64 实际分配旧镜像，详见[镜像原件](../testing/macos-image-renewal-20261027.md)。
当前不增加完整 Q02 工作包、安装包或发行通过数，暂不发布。
