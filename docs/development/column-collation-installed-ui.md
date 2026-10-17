# 列排序规则正式 Windows 安装 UI 定义（默认关闭，未实跑）

本片仅准备定义、门测试和列表收集，不代表新资源或实际执行已获授权。Root当前实际reader的资源授权边界不变；不得沿用旧许可启动本片。后续由Root先冻结以下接口、取得本轮资源授权，再安装含后端、Main及UI两P2修正（本地追加 `6d09c288e4fd82f4dc61d20cf308d11e5c777a31`）的最新NSIS；不能把开发Electron或旧安装物称作本片正式通过。spec分支基于 `5cd937cf59466059d03ea1af101cb8a885fd41f9`，自身不混入UI修正。

## 待Root冻结的单身份资源接口

每个进程只取一种类型，不用it.each自动串行下一实例：`char` 对应 `char_subject`，`varchar` 对应 `varchar_subject`。随机32位小写十六进制marker，库名为 `dbark_column_collation_<kind>_<marker>`（最长63字符）。Root预备对应零行普通表及非索引 `payload CHAR(n)` 或 `VARCHAR(n)`，当前完整配对 `utf8mb4 / utf8mb4_0900_ai_ci`，目标配对 `utf8mb4 / utf8mb4_0900_as_cs`。长度、完整原定义、表属性、索引/依赖和精确零行事实全部由Root controller前核，本片不造生产fixtures，不猜长度，也不创建用户、授权或库表。

Root controller独占准确 `192.168.31.200:13384`、MySQL `8.4.11`、server_uuid、全部before/after差异和最终精确清理。spec不建数据库观察连接，配置中UUID只固定本轮预期，不声称靠配置字符串独立验证服务器身份。UI检查真实服务器版本展示及应用的定义后核结果；它们不能替代Root精确数据库证据。

| 环境项 | 要求 |
| --- | --- |
| `DBARK_INTEGRATION_ENABLED` / `DBARK_COLUMN_COLLATION_UI` | 均为`1`才进入正式定义 |
| `DBARK_COLUMN_COLLATION_KIND` | 仅`char`或`varchar`，每次一个 |
| `DBARK_COLUMN_COLLATION_MARKER` | 本轮随机32位小写十六进制marker |
| `DBARK_TEST_DATABASE` | 与kind/marker对应的准确专用库名 |
| `DBARK_TEST_HOST` / `DBARK_TEST_PORT` / `DBARK_TEST_TLS` | `192.168.31.200` / `13384` / `0` |
| `DBARK_TEST_USER` / `DBARK_TEST_PASSWORD` | Root明确提供现有授权认证；不写入代码、文档或报告 |
| `DBARK_TEST_EXPECTED_SERVER_UUID` | Root前核的准确UUID |
| `DBARK_EXECUTABLE_PATH` | 本轮新NSIS实际安装的本地盘符绝对`DBArk.exe`路径；Root核安装来源/字节，不接受开发URL或electron.exe |
| `DBARK_C02_EXECUTABLE_PATH` | 可省略，存在时须与上一项逐字同值 |
| `DBARK_TEST_SSH` / `DBARK_TEST_CA` | 省略或`0`/空，不接受SSH/TLS/证书 |

未知 `DBARK_TEST_` / `DBARK_COLUMN_COLLATION_` 配置、SSH/TLS/auth/证书参数及常见旁路认证变量均拒绝；不读取`.env`或认证文件。Windows正式门采用显式平台与win32路径语义，Linux/macOS即使提供Windows字符串也在读取认证前拒绝。RAM测试显式传入模拟平台，不表示启动过该平台程序。

## 真实UI定义

真实连接表单明确取消“安全保存密码”，保存后只读连接概要确认`rememberPassword=false`及实际profile ID；不读取解密凭据。通过对象树打开唯一目标表页，再进入字段差异窗口及payload。勾选仅collation，其余属性保持未勾且禁用；真实目录中准确选目标同charset规则。查看真实只读SQL预览的库/表/payload、原类型及唯一MODIFY形状；这是DOM展示检查，不冒充完整执行SQL字节证明。

四风险确认必须准确存在，前三项勾选后apply仍禁用；第四项确认后只点击一次。等待应用报告“字段差异执行完成并核验”、实际apply任务completed，然后重新读取定义，确认当前配对及原类型，未勾选属性保存消差。最终只允许1次apply、1次preview，history保持0。应用后核和重读证据不等于Root完整数据库验收，终态附件明确`fullDatabaseAcceptance=false`。

只读IPC仅设置、连接概要、任务和history；不借evaluate写store、Monaco、调用apply或伪造能力。无driver、live-helpers、isolatedDatabase、用户SQL、账号/授权/库表创建、清库、系统剪贴板或导出。

沿用原desktop-fixture strict owner，单case、serial、retry0、repeat1、首错停链，trace/screenshot/video全部off。每步核原TestInfo、原App/页面及固定身份；失败保留现场，不强退、不重启、不启动另一类型。成功先由原正常退出/PID消失握手完成，再只读确认原夹具已清除自己的临时profile目录。spec不含finally清理，NSIS安装/卸载与数据库精确清理由Root独占controller负责。

## Root授权后的准确命令

```powershell
node node_modules/@playwright/test/cli.js test tests/e2e/column-collation-installed.spec.ts --workers=1 --retries=0 --repeat-each=1 --max-failures=1 --trace=off
```

入口在list/default先短路，不读认证、不加载owner/driver。本片新门测试65项通过，`tsc --noEmit`退出0，无凭据双门0/0和1/1的实际`--list`均退出0且只收集1项默认关闭定义。实际开发验证命令为 `node .cache/employee5-column-collation-installed-v3/run.cjs`、`node .cache/employee5-column-collation-installed-v3/typecheck.cjs`、同目录 `list.cjs 0` 与 `list.cjs 1`。原件与最终哈希保存在该ignored目录，前序版本保留。不运行GUI/DB/安装/认证/full/build，不推新ref，本地提交由Root统一审查整合推送。
