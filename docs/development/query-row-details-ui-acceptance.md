# 查询结果整行详情：默认关闭的正式实库UI定义

本片只交付可审的定义、列表收集和静态验证，实际桌面/实库执行次数为 0。产品基线仍为 `8a61e46075b33971a08f3fdfff28fb332770ebb0`；旧AST夹具追加为 `1a32ae87b9c3f440d6d00c32ff0680d7a69be62d`，不改变产品。

入口：`tests/e2e/query-row-details.spec.ts`。只有 `DBARK_INTEGRATION_ENABLED=1` 与本片专用的 `DBARK_QUERY_ROW_DETAILS_UI=1` 同时满足才加载配置门及真实UI模块。`--list`/`--list=...` 先短路，不读环境、不加载桌面。单门、其它专项开关或默认运行均只注册一个明确的默认关闭用例。

## Root执行前准备

Root独占核对和准备 `192.168.31.200:13384` 的 MySQL `8.4.11`，并核对准确 `server_uuid`。本片不接受其它端口、实例、SSH、TLS、证书、开发URL或Node模式。Root提供随机32位小写十六进制 marker，库名必须是 `dbark_row_details_<marker>`；库内 `subject` 已存在且为零行。账号只需读取该表、元数据及只读服务器变量，不需要本片建删库、创建用户、授权或写入数据。

Root通过本轮临时进程环境明确提供：

| 变量 | 要求 |
| --- | --- |
| `DBARK_INTEGRATION_ENABLED` | `1` |
| `DBARK_QUERY_ROW_DETAILS_UI` | `1` |
| `DBARK_TEST_HOST` / `DBARK_TEST_PORT` | `192.168.31.200` / `13384` |
| `DBARK_TEST_TLS` | `0` |
| `DBARK_TEST_USER` / `DBARK_TEST_PASSWORD` | Root本轮提供的非空用户名/密码；不写入本文或提交 |
| `DBARK_TEST_EXPECTED_SERVER_UUID` | Root已核对的准确UUID |
| `DBARK_QUERY_ROW_DETAILS_MARKER` | 随机32位小写十六进制字符串 |
| `DBARK_TEST_DATABASE` | `dbark_row_details_` 加同一marker |
| `DBARK_EXECUTABLE_PATH` | 包含产品基线的Windows安装产物绝对 `.exe` 路径 |
| `DBARK_C02_EXECUTABLE_PATH` | 可省略；存在时必须与上一项逐字同值 |
| `DBARK_TEST_SSH` / `DBARK_TEST_CA` | 省略或分别为`0`/空；不得提供SSH或证书材料 |

不读取 `.env`、私钥或配置文件来补齐缺项。任何已观察到的配置漂移会永久停链。Root对数据库前后身份、零行状态、授权和最终清库单独取证；spec不代替这些证明。

## 正式执行内容

真实连接表单保存连接，通过实际profile ID核对新查询select的角色、名称前缀及唯一数量。正文仅用真实键盘输入，执行按钮仅明确点击两次：

1. 一条只读SELECT，原库 `subject` 只被COUNT读取；字面量派生UNION生成两行。包括重复别名、真实unsigned BIGINT、精确DECIMAL、NULL、空串、实际非空和空字节、带重复键及空白的JSON原文本、超过240单位且含原CRLF的长文本、恶意HTML文本、隐藏字段，以及UUID/版本/库/marker/零行身份字段。
2. 检查真正的网格活动行和详情 `role=region`，原字段顺序、完整隐藏字段、字节Base64、单值展开、下一行边界、关闭、原勾选保持。列布局沿原行为清空勾选后，明确重新勾选再验证详情自身不改变选择。
3. 第二条只读SELECT产生新结果，旧详情消失且入口等待新活动行；history准确为两条成功记录，逐字等于两次实际输入raw正文，任务也只有两次已完成query.execute。绝不自动执行第三条。

平台EOL规范只用于键盘输入落盘比对。原值从真实DOM `textContent`读取，NULL/空串/字节、JSON空白及返回CRLF不得规范化。JSON字段是有意保留重复键和空白的JSON原文本，不声称是MySQL原生JSON类型的序列化样式。

无模型 `setValue`、store写入、内部handler、合成DOM事件、系统剪贴板、文件选择答案或数据库观察连接。只读IPC限定设置、连接列表、history和任务列表。

## 所属资源与执行命令

复用 `query-duplicate-native` 的 `desktop-fixture` strict owner：`preserveOnUnconfirmedExit=true`，单例、零重试，trace/screenshot/video均off。每个动作前后核同一TestInfo、原App/页面和固定配置。成功仅通过原 `confirmOwnedDesktopExit` 正常握手与所属PID消失证明退出，再只读确认原夹具已删除自己的临时配置目录。失败停链保留原App和目录，不自动强退、重启或删除未知资源；spec无finally清库。临时连接凭据仅进入该strict owner的临时安装配置，失败保留时由Root负责后续处理。

Root准备好独占环境并授权执行后使用：

```powershell
node node_modules/@playwright/test/cli.js test tests/e2e/query-row-details.spec.ts --workers=1 --retries=0 --trace=off
```

员工5本片只运行新 `query-row-details-ui-gate.test.ts`：43项通过，覆盖两门、列表先短路、错误目标/SSH/证书/trace拒绝、两个单条只读SQL及真实spec所属门的RAM回归；`tsc --noEmit`退出0。准确spec在双门0/0和1/1、无凭据环境下实际 `--list` 均退出0，只列一个默认关闭项。

实际命令为 `node .cache/employee5-row-details-e2e-v2/run.cjs`、`node .cache/employee5-row-details-e2e-v2/typecheck.cjs`、`node .cache/employee5-row-details-e2e-v2/list.cjs 0` 与 `node .cache/employee5-row-details-e2e-v2/list.cjs 1`。不运行GUI、SQL、构建、打包、部署、全量或旧已绿套件。原始日志及哈希交接保存在ignored `.cache/employee5-row-details-e2e-v2/`；初版36项及列表记录保留在v1，没有覆盖。
