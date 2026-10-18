# 0.25 批量字段填充真实界面／数据库专项准备

本准备基于固定提交 `e80b05a86ccda291a7a71381e98efbec13715540`，仅新增测试、专项门控和本文。没有改动 Main、engine、renderer 或原测试断言。员工4仅运行离线 RAM 门控对照；两个正式 Playwright 用例、列表、类型检查、构建和实库均未运行。完整 CI 的既有结果不能作为这些新增用例的实际通过证明。

## 两个正式用例

1. 实际网格勾选两条完整已有行，打开“批量填充字段”，选择 `note` 的 SQL NULL 模式并暂存；观察两行草稿、第三行控制不变。一步撤销恢复两行，一步重做恢复整批；暂存、撤销、重做及集中预览后分别查询真实库，全三行快照仍等于原值。通过原预览窗口的“确认执行”只提交一次，库核恰好两条 `note` 变为 NULL，第三条完全不变；UI 重新读取后无修改草稿。
2. 相同实际入口暂存文本并打开原集中预览。观察连接仅外改实际网格顺序的第二条选中行，再通过同一预览确认一次。要求原错误明确报告并发冲突及整批回滚，确认按钮禁用且显示不会自动重试。全库快照验证外改保留、第一条未部分更新、第三条不变；连续三次、间隔至少250毫秒的只读观察保持相同。返回编辑仍保留两条文本草稿，旧历史因投递已清空，撤销／重做不可用。该有界观察与一次性按钮一起核验本次投递不自动重放，不宣称无限时间的运行证明。

每例使用一个新随机 `dbark_e2e_<时间>_<随机标识>` 库和一张 `batch_fill_subject` 表，三行、无触发器或外部副作用、InnoDB。可靠主键大于 JS 安全整数，两条选中行之外另有一条控制行。旁列包括无符号 BIGINT 最大值、`DECIMAL(30,6)`、`DATETIME(6)`、含大整数的 JSON 和含零字节的二进制。快照用 SQL 的 `CAST`、`DATE_FORMAT`、`HEX` 直接取得字符串，JSON 以服务器原字符串比对，不通过 JS 浮点或 JSON 解析重写旁列。控制表名不从环境接收。

## Root 未来运行前提

本轮没有获得实际运行许可，也没有执行以下命令。Root 先独立核对 `deve-server.yinzon.com` 对应实际200服务器和隔离 MySQL 8.0 服务身份，再确认 `192.168.31.200:13384` 及本轮服务器 UUID。这里只准备这一准确目标；不自动改端口、开启TLS/SSH、建容器或退回其他服务。作者没有访问服务器、Docker、GUI、端口或系统剪贴板。

在 Root 新整合分支完成必要类型检查和源码构建后，从该构建目录执行，采用正式 Electron／Playwright 窗口。当前专项只接收源码构建模式，不声称安装产物验收，不接受 `DBARK_DEV_URL` 或 `DBARK_EXECUTABLE_PATH`。正式 `desktop-fixture` 每例分配独立用户配置目录，不注入 renderer store/model，也不直接调用 `table.preview`、`table.apply` 代替用户入口。

以下为非秘密开关，必须由 Root 在本轮进程环境中显式提供：

| 参数 | 本轮要求 |
| --- | --- |
| `DBARK_INTEGRATION_ENABLED` | `1` |
| `DBARK_D02_BATCH_FILL_UI` | `1` |
| `DBARK_BATCH_FILL_SERVER_VERIFIED` | Root 完成独立身份核对后设 `1`，不能用该声明替代核对 |
| `DBARK_TEST_HOST` / `DBARK_TEST_PORT` | `192.168.31.200` / `13384` |
| `DBARK_TEST_TLS` | `0`，只用于既定隔离测试目标 |
| `DBARK_TEST_EXPECTED_SERVER_UUID` | Root 本轮取得的实际 UUID，格式及精确值均核验 |
| `DBARK_TEST_SSH` | 不设置或显式 `0` |

另由 Root 已批准的安全进程环境提供 `DBARK_TEST_USER` 和自有字符串 `DBARK_TEST_PASSWORD`，不得复制到命令日志、报告、截图或仓库。不要在本文填值，也不创建或读取新的凭据文件。`DBARK_TEST_DATABASE`、`DBARK_TEST_CA`、`DBARK_DEV_URL`、`DBARK_EXECUTABLE_PATH` 必须不存在，空字符串也不接受。仅存在旧 `.cache/dbark-test.env` 不构成许可；原帮助器加载后还会核对本轮环境的自有字段和取值，任何补填或漂移均永久拒绝本轮绑定。

默认两个用例跳过；即使门开启，`--list` 或 `--list=...` 也只注册跳过身份，不加载桌面、MySQL 驱动、目标绑定器或旧帮助器。离线 RAM 用 VM 解释真实 spec 声明门，模块加载哨兵会立即拒绝任何未经许可的路径；不启动 Playwright。

Root 取得运行窗口并满足上述条件后，未来仅执行这一文件，不运行其他旧专项：

```powershell
node node_modules/@playwright/test/cli.js test tests/e2e/table-batch-fill.spec.ts --workers=1 --retries=0
```

本专项每例120秒，串行且不重试；正式 trace、截图、视频均关闭，原隔离帮助器的失败截图也显式关闭。账号仍通过原连接表单填写，实际连接、预览、提交及事务均沿产品代码。

## 资源归属、清理与停链

本例在任何建库前建立一条只读探针，核实际 `@@server_uuid` 与 MySQL 8版本后关闭；原隔离fixture另持一个观察连接，进入表级准备前再次核 UUID。建库和连接建立沿 `live-helpers.isolatedDatabase` 的真实连接表单及准确建库确认流程；观察连接只创建本例表／三行、执行快照，以及第二例的一次明确外改。

成功后由原严格隔离fixture先确认本例 Electron 的退出及所属进程消失，再 `DROP DATABASE` 本例随机库并从 `information_schema.SCHEMATA` 核不存在，最后关闭观察连接。所属临时用户目录由原桌面fixture限定为系统临时目录的 `dbark-e2e-*` 后删除。每例只清理自己随机库与配置目录；不会触碰引擎测试库、其他成员资源或旧 run1556。两例成功时总共创建／删除两个随机库及两张表。

每次 UI／数据库 await 前后核原目标、原 TestInfo 期限和本例桌面归属。任何断言失败、目标漂移、未知事务／退出／清理结果或迟到回包均停链；正文失败先标记 `retainOwnedDesktopResources`，原fixture不继续退出、删库或强制杀进程。现场保留时由 Root 根据本例配置目录和实际随机库人工核对处理，不扩大清理范围；串行下一例不继续使用失败现场。不输出本轮凭据。

## 本轮验证与未验边界

仅运行 `tests/unit/table-batch-fill-live-gate.test.ts`：46项 RAM 对照通过。它们证明默认／单门／列表不加载实跑模块，明确参数才注册正式用例，拒绝旧目标、原型／访问器回填，观察到漂移或原期限失效后不会复活；真实正式注册器也在VM中核对为两例、串行、无重试和严格准备门，原生及数据库端口均为禁止调用的哨兵。这不证明两个 UI 用例或数据库业务验收通过。

尚未运行正式 Playwright（含列表）、真实200／数据库／GUI、类型检查、构建或完整套件；未推送。选择器、实际服务器、事务回执和退出清理仍须 Root 在新整合提交上实际核验。本准备没有更改任何 Main／engine 合同。原旧 run1556 仍不执行，也不绕过其门控。
