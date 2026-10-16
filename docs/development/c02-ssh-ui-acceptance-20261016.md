# C02 既有私钥 SSH 正式 UI 验收准备

独立普通任务分支 `codex/employee2-c02-ssh-ui-20261016`，基于退出验证修复 `459347aef45a8d12ceea403386fa28893a39bcec`。该修复另在 `codex/employee2-c02-exit-guard-fix-20261016` 独立推送，父提交仍为冻结的 `520adcf`。本片只新增 SSH 专用文件，不改产品源码、mTLS/退出修复文件或 ROOT/公开归档，不使用 worktree。

## 旧证据及最小范围

已只读核对仓库 [P0 参数 SSH/TLS 记录](../../tests/integration/acceptance-p0-parameters-20261014.md)、[O01 字段差异记录](../../tests/integration/acceptance-o01-columns-20261014.md) 和正式表单/真实连接源码。历史记录已有 13384 私钥 SSH 核心、参数、错误主机指纹，以及字段差异与最小权限结果；O01 早期真实关闭失败与后续修复重跑均保留。这些旧版本证据不等于本片正式表单、utility 或重启通过。

本片不重跑旧核心套件，只准备一个默认关闭的正式 UI 复合用例：错误指纹身份拒绝 → 正确既有未加密私钥测试并保存 → 真实 utility SELECT → 真实退出/PID核验 → 同一独占 userData 重启，不补填身份或密码再连接和查询 → 退出及逐 ID/精确资源清理。

六端口是授权上界，不代表六版本均已完成本片验收。目标必须属于 `13357/13380/13384/13310/13311/13484` 且真实版本系列匹配。新账号所有权沿用 MySQL8 `ATTRIBUTE` 令牌，因此当前只准备 MySQL8.0.21+/8.4 的正式 UI，建议 ROOT 首轮用历史 SSH 目标 13384。MySQL5.7/MariaDB 在创建前明确返回未验并关闭管理隧道，不启动 GUI、不创建用户/库，不为覆盖扩展账号或服务器配置。其它版本及跨平台私网 UI 均仍待验。

## ROOT 显式注入

只消费进程环境中的本片专属值，不读取 `.env`、ROOT 配置或 SSH 凭据文件，不自行运行 `ssh -G`、ssh-keyscan、ssh-keygen 或命令行 SSH。用户名/主机/端口/身份路径由 ROOT 在已核对服务器后解析当前 `ssh -G server-200` 并注入，身份路径须由 ROOT 解析为已有文件的绝对路径；主机指纹另由 ROOT 已认证记录提供，不能把未认证扫描结果当信任来源。

| 环境项 | 约束 |
| --- | --- |
| `DBARK_INTEGRATION_ENABLED` / `DBARK_C02_SSH_UI_ENABLED` | 必须均为 `1`；mTLS/旧通用SSH开关不能启动本片 |
| `DBARK_C02_SSH_ROOT_CONFIRM` | 必须 `server-200/192.168.31.200/c02-ssh` |
| `DBARK_C02_SSH_ALIAS` | 必须 `server-200` |
| `DBARK_C02_SSH_HOST` / `DBARK_C02_SSH_PORT` / `DBARK_C02_SSH_USER` | ROOT当前解析的实际值；主机仅接受已约定的 `192.168.31.200`，端口/用户名无默认值 |
| `DBARK_C02_SSH_KEY_PATH` | ROOT明确的既有普通私钥文件绝对路径，只引用，不复制或改写 |
| `DBARK_C02_SSH_HOST_SHA256` | 已认证主机的规范 `SHA256:<43位无填充Base64>` |
| `DBARK_C02_SSH_KEY_MODE` | 必须 `existing-unencrypted`；只作为ROOT已核对声明，正式驱动仍真实解析/认证 |
| `DBARK_C02_SSH_PASSWORD` / `DBARK_C02_SSH_KEY_PASSPHRASE` | 本片不得提供；密码 SSH、加密私钥口令明确未验 |
| `DBARK_C02_SSH_DB_HOST` / `DBARK_C02_SSH_DB_PORT` | 必须 `192.168.31.200` / 六个现有端口之一，无默认值 |
| `DBARK_C02_SSH_DB_UUID` | MySQL8目标必须提供ROOT已核对的该实例UUID；实际不匹配时不创建资源 |
| `DBARK_C02_SSH_ADMIN_USER` / `DBARK_C02_SSH_ADMIN_PASSWORD` | 显式提供已有数据库管理/观察凭据；绝不从忽略文件或通用环境补齐 |
| `DBARK_C02_SSH_TEMP_PARENT` | ROOT为本轮明确的已有普通临时父目录绝对路径，供独占userData；不能使用原SSH身份目录 |
| `DBARK_C02_SSH_TLS_CA_PATH` | 仅13484必需的明确已有CA公证书绝对路径，正式UI保持CA/身份校验；不涉及CA私钥或客户端证书签发 |
| `DBARK_C02_EXECUTABLE_PATH` | 沿用C02原生夹具的可选显式应用路径；缺省从当前普通克隆正式source产物启动，不指向公开验收归档 |

ROOT先确认固定SHA/产品源码、构建产物及独占GUI时段，再注入环境。只有ROOT后续执行正式命令；本轮只执行 `--list`：

```powershell
node node_modules/@playwright/test/cli.js test tests/e2e/c02-ssh-live.spec.ts --list
# 后续ROOT实际验收，本轮未执行：
node node_modules/@playwright/test/cli.js test tests/e2e/c02-ssh-live.spec.ts --workers=1 --reporter=list
```

## 真实路径与清理约束

管理观察连接经产品真实 SSH 私钥和固定主机指纹，只准备/观察本次随机 `cp_<12hex>`@`%`、`dbark_colperm_<12hex>.subject`。仅 GRANT 精确表 SELECT，用户/表写本次令牌；13484额外收紧 REQUIRE SSL，不增加权限。不创建其它表/账号/角色，不改 GLOBAL、SSH身份或服务器配置，不执行 Docker。版本/UUID/强制角色/观察者直接 PROCESS 权限在CREATE前检查，权限目录验证没有额外库/列/全局或角色授权。

正式 ConnectionDialog 使用现有数据库密码输入及 SSH 页的主机/端口/用户名、原生“选择 SSH 私钥”和主机指纹字段。仅替换本应用文件选择与已知关闭确认的原生回答，文件授权、表单保存、main broker、ssh2认证/forwardOut及utility均为正式实现。SSH密码及私钥口令不填入、不保存。错误指纹仍是规范32字节指纹，必须命中安装 ssh2 源码的 `Host denied (verification failed)`，不能用超时或网络不可达冒充；之后正确指纹实际成功。

公开概要只回传ID及存在性/身份匹配布尔值。实际SQLite只应有数据库密码密文槽，没有SSH密码/口令槽；真实safeStorage在主进程解密后只回传匹配布尔值。系统安全加密不可用（含Linux basic_text/未知后端）会在全部收尾后标未验/skip，不把回退计作无补填重启成功。原未加密key即使能重启使用，也不证明密码SSH或私钥口令。临时数据库密码只进入真实password控件和主进程，不进入Monaco、截图、trace、视频或日志；文件证据仅安全事实。原始认证/SQL错误经C02脱敏，保留受控阶段和首因。

查询由正式新建查询表单、Monaco输入和执行按钮提交，仅 SELECT 本轮subject。网格校验账号/库/随机标记/连接ID，外部观察者记录实际用户线程，实际app metrics要求数据库utility存在；13484还检查真实会话cipher。退出/重启使用459修复后的严格握手与PID责任，不清除未验证旧PID；非ESRCH均不能算已退出。回调finally必须先退出应用/utility及清理其独占userData，再交资源夹具检查用户名和全部已采样ID清零、用户令牌及库内对象归属，精确删除并读目录确认不存在。关闭管理隧道后，再建只读观察隧道逐ID核对旧管理/应用线程，最后严格关闭该观察隧道；不把最后观察连接的本地严格关闭称为外部逐ID实证。

CREATE先记未知，仅成功响应才确认归属；未知CREATE不DROP，对应精确名称保留待ROOT核对；写操作只发送一次，超时不重放。删除与退出失败独立尝试并保留首因，不KILL其它线程。夹具只核对已有key/CA的文件元数据，内容只由正式驱动在ROOT授权运行时读取；没有复制、生成、哈希或删除现存身份材料，也不声称做了原key前后字节核验。ROOT如需该证明须在其受控runner另作摘要核对。本轮没有新可复用密钥/证书需备份。

## 本轮状态

- SSH专属纯门禁/指纹/版本检查 **35 项通过**；没有模拟认证成功。连同原C02策略和退出检查回归共90项，分别计数，不把它们当作新SSH认证结果。
- TypeScript通过；首轮只有纯测试env对象的类型推断过窄，补充NodeJS.ProcessEnv注解后修正，不改产品、依赖或全局TS lib。
- Playwright `--list` 列出1个SSH正式UI用例；默认不开启，无GUI或实库执行。
- 没有启动 GUI/200/剪贴板/Docker，没有读取真实ROOT凭据或密钥，没有修改原520/459及公开归档。
- 新SSH正式表单、utility、重启、原生存储、六端口及跨平台私网的实际结果均待ROOT执行，旧核心证据不能计入本新UI通过数。
