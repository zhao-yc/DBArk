# C02 正式 Electron mTLS UI 验收准备

从固定 `bda84bcd49f6f48d448692c75556ef3df21f0e7a` 创建普通分支 `codex/employee2-c02-mtls-ui-20261016`，没有使用 worktree，没有修改 ROOT 或公开归档。分支先独立提交 Unicode 产品修复 `6d8bada434636cc78b46ec65ce78e397193f14ed`（仅共享 TLS 校验和 19 项测试），UI 准备另成提交，不混入该修复。

ROOT run602 核心实证已只读核对并追加至 [核心说明](c02-mtls-core-acceptance-20261016.md)：固定 bda、13484/MySQL8.4.11、复合用例 1 通过、0 失败/跳过、资源及临时材料归零。它不计作本 UI 分支通过。

## 准备的两个独立 UI 用例

入口 `tests/e2e/c02-mtls-live.spec.ts`，使用本片专属生命周期，不导入会读取通用 `.env` 或自动创建其它数据库的 `live-helpers`。`--list` 不启动应用，默认关闭亦不启动应用。正式执行时：

1. **原生安全存储**：真实 ConnectionDialog 新建 cp 受限连接，三类证书经正式文件选择与路径授权进入表单；真实密码控件先输入错误 TLS key 口令，测试连接真实拒绝，再输入正确值真实连接成功并保存。检查公开概要只有存在标记，实际 SQLite 的 profile 没有秘密字段或标记，原生 safeStorage 独立解密 password/tlsPassphrase 两槽匹配且明文不在 UTF-8/UTF-16 字节中。正式查询表单、Monaco、执行按钮、结果网格、main broker 与实际 utility 读取本例 subject、账号/库/连接 ID 及 SSL cipher。真实退出保存握手及本例全部已记录进程结束后重启，不补填秘密，测试连接和 utility 查询仍成功。再关闭本例全部查询标签，从正式编辑入口明确点击清除 TLS 口令，验证只清 TLS 槽、数据库密码保留且仍由原生 safeStorage 解密匹配；再次真实退出/重启，TLS 存在标记不恢复，缺口令的测试连接真实拒绝。
2. **不记住的会话回退**：同样经正式表单填入并真实测试，安全保存密码取消勾选。当前进程存在标记和 utility SELECT 可用，磁盘没有 password/tlsPassphrase 槽；真实退出/重启后两标记均不恢复，不补填秘密，真实测试连接拒绝。这不依赖或伪造系统加密不可用状态。

系统安全加密能力来自真实 Electron safeStorage 和正式 app.info。不可用时，第一个用例在本例 app/utility、实库资源及临时文件收尾后正式标记 **跳过/未验**，不把内存会话回退计作加密持久化通过。Linux `basic_text` 或未知存储后端也不计作系统安全加密；第二个用例仍可独立验证 remember 关闭。没有 mock safeStorage、连接认证、broker、utility、SQLite 或认证成功回包。

秘密只从运行期临时租约进入真实密码输入控件或主进程。为避免 Playwright `fill(口令)` 的步骤标题保留明文，密码控件使用原生 value setter 加 input/change 事件，仍走正式 React onChange、表单测试/保存、IPC 和认证路径；不注入 React/store 状态，不直接调用 connections.save 植入配置。非秘密字段正常使用 UI 操作。证书选择与已知关闭确认仅替换本应用原生对话框的回答。

## 租约、目标及退出边界

`runC02MtlS(env, callback?)` 增加可选回调，省略时保持原核心默认行为。回调额外要求 UI 开关；它仅拿到本轮受限 cp 用户、一天期文件、subject 标记和只读线程观察方法，不拿到管理账号、CA key 或签发口令。原核心成功连接先严格关闭，UI 复用同一随机账号/库/证书；回调 finally 等待真实 app/utility 退出并精确清理其独占 userData，再交原核心夹具按用户和已观察线程查证清零、核所有权令牌、精确删除账号/库/四个证书临时文件。回调归还后观察方法失效。

目标仍只准 `192.168.31.200:13484`。ROOT 确认串、UUID、严格 CA/IP SAN、cp_12hex/dbark_colperm_12hex.subject SELECT、REQUIRE X509、未知 CREATE 不 DROP、写操作不重试、保留首因等限制全部沿用原核心。不会创建 dbark_e2e 库、其它账号、其它表或其它授权，不改 GLOBAL。正式 UI 的 SQL 只有 SELECT/SHOW，不使用系统剪贴板。

每个用例独占 `dbark-c02-ui-*` 临时数据目录，重启复用此目录；删除前核对绝对父路径、命名、dev/ino、非符号链接及本例记录进程已退出。PID 读取只有 ESRCH 才算消失，EPERM 或未知异常不能冒充全零。只终止本次 launch 的 PID 树，不按 Electron 名称关闭其他应用。正常退出失败保留为失败；兜底强杀不能改判为正常退出通过。外部错误去掉可能含秘密的原消息/属性/堆栈，保留受控阶段、错误编号与因果结构；UI 操作/退出和实库清理失败均保留首因。

Electron 子进程只继承必要桌面环境和本例 DBARK_USER_DATA，不继承 ROOT 管理口令、CA key 口令、通用实库变量、DBARK_DEV_URL、NODE_OPTIONS 等启动注入项。测试文件显式关闭 trace、截图和录像，不截取成功/失败画面、不转存原始错误或完整 profile。SQLite、安全存储和概要检查只返回布尔值/数量；仅所有收尾成功后输出 `c02-ui-facts.json`，其中不含明文、密文、证书内容或 CA/key 路径。

## ROOT 后续执行

先核对固定 SHA/产品源码并构建本分支正式 source 产物，再取得独占 GUI 时段；不能占用当前公开归档的窗口、数据目录或产物。核心环境参数仍按核心说明由 ROOT 显式注入，不加载任何 `.env`。另需：

| 环境项 | 要求 |
| --- | --- |
| `DBARK_C02_MTLS_UI_ENABLED` | 必须 `1`；同时要求 `DBARK_INTEGRATION_ENABLED=1`、`DBARK_C02_MTLS_ENABLED=1` |
| `DBARK_C02_EXECUTABLE_PATH` | 可选，ROOT 明确选择的已有应用可执行文件绝对路径；缺省从当前普通克隆的正式 source 产物启动 Electron；不要指向正在验收的公开归档 |

```powershell
# 仅静态列举，不启动 GUI/200；本轮已执行此命令。
node node_modules/@playwright/test/cli.js test tests/e2e/c02-mtls-live.spec.ts --list

# 仅由 ROOT 在显式环境与 GUI 时段准备后执行，本轮未执行。
node node_modules/@playwright/test/cli.js test tests/e2e/c02-mtls-live.spec.ts --workers=1 --reporter=list
```

`c02-ui-facts.json` 是本次真实执行的安全事实记录；系统安全加密不可用会明确写“未验”并跳过，不能只看核心 evidence 存在就声称 UI 通过。Windows/macOS/Linux 的真实 UI、私网、系统安全存储和跨平台发行均仍待各原生主机验收。

## 本轮纯检查与未验

- 类型检查通过；本片两组策略/生命周期纯测试 **37 项通过**，其中原核心 27 项、新 UI 10 项。没有执行认证替身或实际 GUI。
- 专用核心入口在关闭开关下 **1 项跳过**；Playwright `--list` 可列举两个 UI 用例。
- 首轮 `--list` 发现 CommonJS 工程不能使用 import.meta 的 wasm 路径解析，已改为明确工作目录下 createRequire；未因此改 package.json、TS lib 或依赖。
- Unicode 修复另有 **38 项相关纯测试通过**，其中新增 19 项；与上述 UI 策略数分别报告，不称为新 UI 认证覆盖。
- 本轮未访问 200、未启动 GUI/utility、未读原始证书/key/ROOT 凭据、未操作剪贴板或 Docker、未签发新证书。所有 UI/safeStorage/重启/清除流程只有可审查准备代码，等待 ROOT 真实执行。

## ROOT后续实际执行

以上保留520准备时的原始边界。独立复审发现的退出P2由459347a修复后，ROOT集成为90348a1/9217124；完整3267单元及类型通过。run630正式Windows两项真实GUI均通过，原生安全加密实际可用，无跳过/重试；run633原无回调核心也通过，原CA未变且材料与相关资源核零。具体入口、真实重启/仅清TLS/不记住回退、原失败和仍未验组合见[正式验收](../../tests/integration/acceptance-c02-mtls-ui-20261016.md)。0.18仍未发布，不把本轮外推为安装包/macOS/SSH全部通过。
