# 既有普通BTREE索引改名的正式UI回归准备

固定产品基线为 `968628d22ea55faed705710e440ce859f4a22996`。已有入口是表页或对象树的“索引与主键差异”→“编辑索引差异”→仅修改“索引名称”→应用草稿→只读SQL预览→风险确认→执行。产品原生 `RENAME INDEX`、快照、单次令牌、重核与后核验未改，本片只调整验收定义。

## 文件与收集边界

`tests/e2e/table-index-patches.spec.ts` 先检查 `--list` / `--list=…`，列表收集不读取任何环境门，不导入实跑模块。非列表模式必须同时显式设置 `DBARK_INTEGRATION_ENABLED=1`、`DBARK_INDEX_PATCH_UI=1`，才加载 `table-index-patches-live.ts`。默认和列表仅注册一项关闭占位，不能把占位计为实际UI用例通过；双门开且非列表才注册原七项加一项并发变更，共八项。原用例标题和120秒期限保留。

`tests/unit/table-index-patches-list-guard.test.ts` 用真实入口转译代码、RAM端口和环境读取代理核对两种列表形式及四种开关组合；另只注册延迟模块的八项标题，不运行任何钩子、Electron或数据库。旧入口在门控测试下12项失败，新入口应全部通过。

共享 `desktop-fixture.ts`、`live-helpers.ts`、六组合目标检查、员工4特殊索引定义均未修改。没有新测试框架、运行时依赖或生产逻辑变更。原fixture仍负责每项唯一隔离库、正式退出和清理，实跑时保留其失败证据；本片不统一吞错或降低超时。

## 六组合执行准备

| 显式端口 | 必须复核的版本与连接 |
| --- | --- |
| 13357 | MySQL 5.7.44；不设置该版本不支持的降序或不可见索引 |
| 13380 | MySQL 8.0.46 |
| 13384 | MySQL 8.4.11 |
| 13310 | MariaDB 10.11.19 |
| 13311 | MariaDB 11.4.13 |
| 13484 | MySQL 8.4.11，显式严格TLS及既有CA |

必须显式提供 `DBARK_TEST_HOST`、`DBARK_TEST_PORT`，不再覆盖主机、默选13384或使用旧 `DBARK_COLUMN_PATCH_TEST_PORT` 别名。只接受既有200主机及上述端口。复用 `assertDefaultEncodingLiveTarget` 纯门；原始进程目标与helper目标必须相同。13484保留 `DBARK_TEST_TLS=1`、明确CA及证书校验；保存连接后再次核对同一目标与CA，观察会话要求实际非空TLS cipher。实际版本在隔离库建立后、业务表夹具写入前核对，不向相似版本外推。ROOT实跑前仍须重新确认服务器、现有账号权限、独占窗口和认证来源，不创建用户或证书。

ROOT后续准备好固定产物及环境时，正式入口为 `pnpm exec playwright test tests/e2e/table-index-patches.spec.ts`。只跑改名三项可追加 `--grep "双击只改名一次|真实锁阻塞|改名预览后外部结构变化"`。三项乘六组合为18次执行准备，完整八项乘六为48次；这些数量不是通过记录。默认 `--list` 始终只显示关闭占位。

## 改名三项覆盖

1. 两真实入口、名称表单、只读预览零DDL、编辑器快捷键零执行、双击只投递一次真实apply。被改目标为普通非唯一BTREE复合键；仅名称变化，列序、前缀、已支持版本的DESC、注释及方法完整保持。唯一旁键、普通旁键、可见性目录及整表SHOW CREATE严格比较；两行数据含大整数和二进制，用观察连接原值完整比较。MySQL8不可见/MariaDB忽略旁键保持只读且不变；5.7无该能力，不创建替代夹具假装覆盖。PRIMARY名称输入禁用。
2. 真实MDL阻塞后经面板取消，等待真实终态；明确 `ddlSubmitted=true`、`ddlCompleted=false`、`outcome=unknown`，执行按钮保持禁用且真实apply仅一次。解锁后全结构和数据等于取消前；关闭后表页过期，不能把unknown改写成确定回滚。
3. 原预览建立后，由观察连接明确修改一次表注释。原真实执行按钮触发重核拒绝；事件必须证明 `ddlSubmitted=false`、`outcome=not-sent`。旧预览消费且不能再点执行，结构和数据严格等于外部修改后快照，原目标名保持，不自动重放。

观察包装只记录真实索引apply的令牌/任务号并完整透传原IPC参数及结果；只对外返回数量和身份完整性，不保存原始令牌或认证内容。用例不用直接IPC发起产品DDL、不替换服务、模型或React状态、不操作系统剪贴板。

## 当前证据与未验边界

员工5仅执行入口纯测试、既有索引定向纯测试、类型检查、默认关闭和列表收集。GUI、200、六组合实库、数据库写、系统剪贴板、Docker和人工CI均为0。本片既不改变产品权限，也不宣称真实锁、取消、断线、安装版或六组合已经通过。表达式、特殊索引、未知能力、真实权限失败等边界继续沿产品保守只读和既有专项，本片没有扩大范围。

语法依据：[MySQL 5.7](https://dev.mysql.com/doc/refman/5.7/en/alter-table.html)、[MySQL 8.0](https://dev.mysql.com/doc/refman/8.0/en/alter-table.html)、[MySQL 8.4](https://dev.mysql.com/doc/refman/8.4/en/alter-table.html)、[MariaDB 10.5.2发布说明](https://mariadb.com/docs/release-notes/community-server/old-releases/10.5/10.5.2)。官方语法支持不替代精确版本和严格TLS实际验收。
