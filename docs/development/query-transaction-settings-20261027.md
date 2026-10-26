# 查询标签的本会话事务默认设置

## 使用

在查询工具栏打开“事务设置”，读取该标签原物理会话的默认隔离级别、默认只读属性、实际数据库、服务器版本及连接 ID。可选 `READ UNCOMMITTED`、`READ COMMITTED`、`REPEATABLE READ`、`SERIALIZABLE`，以及默认只读或读写。修改后点击“应用到本会话”，服务器确认并读回成功后才显示已应用。

这是 SESSION 默认值，不是当前活动事务的实际属性；手写一次性 `SET TRANSACTION` 可以覆盖下一事务。读取会改变 `ROW_COUNT()`、`FOUND_ROWS()`、警告等会话诊断信息，已有可视查询结果、正文和执行历史保留。设置不写入连接配置；新标签或重新连接沿服务器默认值初始化。

活动事务中允许读取，禁止通过此入口应用设置。先明确提交或回滚，再重新读取和修改。设置或读取失败后必须显式重新读取，不自动重试。原标签、连接修订或物理会话变化时，本次弹窗失效。

## 实现边界

严格 IPC 只接受原会话 ID、独立任务 ID、四值隔离枚举、真正布尔值及完整预期快照；不接受任意 SQL 或 GLOBAL 参数。Engine 在原会话互斥内重新读取并核对物理身份、版本、数据库、默认值及新鲜协议事务／自动提交位；活动事务、未知状态、过期快照均在 SET 前拒绝。

两个属性合并为一个固定 `SET SESSION TRANSACTION`，校验无警告的原服务器确认包后再读取核对。无隐式提交、回滚、自动提交开关、重连或重放。SET 可能发送后的取消、断线及读回失败保留“设置可能已改变，请重新读取核对；不会自动重试”，任务事件与调用错误一致，原取消控制落定后释放占用。

变量名按实际版本选择：MySQL 5.7.20+、8.0.3+、8.4 使用 `transaction_*`；MariaDB 10.11 使用 `tx_*`、11.1.1+ 的 11 系列使用 `transaction_*`。其他分支明确拒绝，不在报错后试另一条 SQL。布尔读取精确区分 `OFF`／`ON`、`0`／`1`，连接 ID 保持十进制文本。

## 验证记录

WIN11-TEST 本轮读取仍返回主机不可达，未派发本轮任务；按用户授权在本机 Windows 串行接续。未使用本机 Docker、系统剪贴板，未创建用户、密钥或证书。

| 检查 | 实际结果 |
| --- | --- |
| 最终类型／相关 | 退出0；9文件372项相关通过 |
| 完整单元 | 845文件17888项通过、1项POSIX平台条件跳过，退出0 |
| 构建／默认门 | 构建退出0；正式窗口列表恰好1例；未显式启用时实库与窗口各1例跳过，无私网连接或窗口 |
| 六实例 Engine | MySQL 5.7.44／8.0.46／8.4.11、MariaDB 10.11.19／11.4.13及13484严格TLS，各1整例，共6通过、零跳过；每次先独立核对版本、容器及MySQL UUID |
| Windows 正式窗口 | 13384的1项复合例通过，零重试／跳过；真实控件读取5次、应用2次、普通SQL执行3次，原Main请求全部落定 |
| 原连接与清理 | 24个Engine产品连接严格关闭；原窗口正常退出后精确清理，最终独立读回7个准确库、40个登记线程及对应事务均为零；独立核对连接也确认物理关闭 |

实库逐项核验两会话隔离、默认只读真实拒写、活动只读／写入事务零SET、外部观察未提交行不可见、显式回滚后原表为空、手写修改后的过期快照零SET、新会话恢复服务器基线；一次性只读覆盖经过诊断读取仍有效，并核对真实只读错误。正式窗口核客户端排序、原结果／正文及历史保持、只读拒写后的协议状态刷新和回滚、未提交行保护与第二标签默认值独立。两张原始窗口截图已人工检查，控件与提示完整可见。

初轮类型检查失败保留：Root遗漏两条公开命令白名单、一个无效布尔输入测试须经 `unknown` 断言。补齐后类型通过，第二轮相关测试中的两个 `%j` 标题因 BigInt 序列化失败；仅改为用例序号，全部BigInt输入与原断言保留。第三轮完整验证及实库／窗口全部通过，不把原失败改记为通过。原始日志和输入哈希保留在 `.cache/transaction-settings-core-{first,corrected,verified}-20261027`、`.cache/transaction-settings-live-verified-{matrix,ui}-20261027`，不入库。

本轮新功能尚未验 macOS 原生窗口、安装包、系统原生输入、真实网络断线／服务器重启／确认包丢失及所有权限组合；SET前后取消、异常读回和取消收尾拒绝由单元覆盖，不冒充真实断线验收。没有修改原生门槛或其它平台结论。

## 官方依据

- [MySQL SET TRANSACTION](https://dev.mysql.com/doc/refman/8.4/en/set-transaction.html)：SESSION 默认值与当前／下一事务的区别。
- [MySQL 5.7 系统变量](https://docs.oracle.com/cd/E17952_01/mysql-5.7-en/server-system-variables.html#sysvar_transaction_isolation)：5.7.20 的现代变量名。
- [MariaDB SET TRANSACTION](https://mariadb.com/docs/server/reference/sql-statements/administrative-sql-statements/set-commands/set-transaction) 与 [系统变量](https://mariadb.com/docs/server/server-management/variables-and-modes/server-system-variables#transaction_isolation)：隔离级别、只读模式与变量版本。

本项只补查询事务设置入口，不增加完整 Navicat 工作包或发行计数，暂不发布。
