# Root 单次系统 Ctrl+S 接力专项

本入口只做准备。没有运行原生用例，没有真实系统输入或保存通过证据。原 Page.keyboard 专项、原失败报告和退出未知现场保持原义；不能用新结果覆盖它们。

- 新标题：单次系统Ctrl+S：Root原生输入、UTF16LE来源完整保存及独立重启。
- 新入口：tests/e2e/query-file-system-shortcut-native.spec.ts。
- 新入口仅在 Windows 本地、CI 未开启、双门与完整参数齐备时加载 live。
- 默认关闭及 --list 只登记一个 skip，不读清单/目录，不加载 live，不探端口。
- 不加入普通 CI 自动执行；本变更没有改工作流、构建或原生命周期框架。

## Root 未来启动前

先核验提交与源/安装清单，保留旧失败现场。Root 单独批准一次运行、一个 UUID nonce 与本 clone 的规范绝对目录：

~~~text
<当前 clone>\.cache\system-shortcut-handshake\<nonce>
~~~

该目录须由 Root 事先新建，不能是链接或旧目录复用；内部不得已有 ready.json / ack.json。目录规范路径、原 dev/ino 会在握手期间冻结并复核。参数不能指定任意文件名称，也不能指向其它 clone 或任意外部目录。

未来手工入口只接受：

| 环境参数 | 值 |
|---|---|
| DBARK_QUERY_FILE_SYSTEM_SHORTCUT_NATIVE_TEST | 1 |
| DBARK_QUERY_FILE_SYSTEM_SHORTCUT_NATIVE_APPROVED | 1 |
| DBARK_INTEGRATION_ENABLED | 0 |
| DBARK_QUERY_FILE_SYSTEM_SHORTCUT_MANIFEST | Root 原清单绝对路径 |
| DBARK_QUERY_FILE_SYSTEM_SHORTCUT_MANIFEST_SHA256 | Root 原清单 SHA256 |
| DBARK_QUERY_FILE_SYSTEM_SHORTCUT_NONCE | Root 新 UUID，小写 |
| DBARK_QUERY_FILE_SYSTEM_SHORTCUT_HANDSHAKE | 上述本 clone 固定 nonce 目录 |
| DBARK_EXECUTABLE_PATH | 仅安装入口可显式给出原绝对路径 |

其它 DBARK 门、认证参数、NODE_OPTIONS、NODE_PATH、ELECTRON_RUN_AS_NODE、大小写别名、CI、配置覆盖和 Playwright 录制均拒绝。Root 外部截图与窗口选择不在 Playwright 录制配置中，由 Root 按已读 computer-use 技能独立管理。

未来手工命令为项目现有 Playwright 程序的：

~~~text
test tests/e2e/query-file-system-shortcut-native.spec.ts --workers=1 --retries=0 --trace=off
~~~

本次没有执行该命令，也没有构建/创建批准清单。原 120 秒起点来自原 TestInfo，包含启动、准备、Root 接力、保存、两次退出和重启；不存在另给握手 120 秒或收到 ack 后续时。

## ready 与 Root 系统输入

共享 live 先完成正式 UI 离线准备、自有 UTF16LE BOM/CRLF 文件来源建立、编辑 dirty、原 Main 来源和焦点快照，以及 Main/DOM 被动观察安装。随后只创建一次 ready.json，使用 wx、最多4096字节、UTF8 单行 JSON 加 LF。文件保留，不覆盖、不删除。

ready 包含 schema/kind、nonce、readyAt、原 deadline、Control_L+s、externalInputRequests=1、原 window/contents、Main/renderer/launcher PID、批准 manifest 摘要，以及来源 tabId/ref/revision、原合成路径和 dev/ino/size/hash。它不含 SQL 正文、凭据或任意动作指令。

Root 必须在原 deadline 前校验 ready 和源身份，使用 node_repl 与 @oai/sky 自行选择唯一新临时窗口、按技能截图核验，并只请求一次系统 Control_L+s。窗口选择、截图、激活和按键不由测试实现。不得把旧失败窗口、另一个窗口、raw CDP 或 Electron 输入派发当作本次系统输入。输入结果未知时不重试；写 unknown 回执或不写回执，专项都会停链保留。

## ack 协议

ack.json 只能由 Root 在该固定目录独占写一次。原始 UTF8 必须是下列字段顺序的 JSON.stringify 对象加一个 LF；不缩进、不追加。readySha256 对 ready.json 原始字节计算，包含其末尾 LF，不能对重新序列化内容计算。

下列对象仅为协议示意；ready、readyBytes 和完成时间必须取 Root 本次已验证的数据，不能照抄样例。只有 sky 单次输入明确完成时 outcome 才是 completed；未知不能写成 completed。

~~~typescript
const ack = {
  schema: 1,
  kind: 'system-ctrl-s-ack',
  nonce: ready.nonce,
  readySha256: createHash('sha256').update(readyBytes).digest('hex'),
  window: ready.window,
  contents: ready.contents,
  mainPid: ready.mainPid,
  sourceRefId: ready.source.ref.id,
  sourceRevision: ready.source.ref.revision,
  input: 'Control_L+s',
  externalInputRequests: 1,
  outcome: 'completed',
  completedAt: Date.now(),
};
// 仅写已批准的固定 ack.json；wx 拒绝旧文件和覆盖。
await writeFile(approvedAckPath, JSON.stringify(ack) + '\n', { flag: 'wx', encoding: 'utf8' });
~~~

ready 或 ack 是链接、硬链接、规范路径变化、同字节异 inode 替换、读取中修改、短读、超预算、重复 JSON 字段、旧 nonce、错摘要、错来源/窗口/PID/revision、早到/迟到、failed/unknown、父门失效或时钟回滚，都永久停链。25毫秒等待只是同期限内查找唯一固定 ack 名称，不是重试系统输入；一旦有 ack 就只解析一次，不接受纠正后继续。

SYS-1窄审反例确认open等待期间目录替换会先写后拒绝；发布验收分支增加取得句柄后的首写前复核，要求原目录、固定名称及空白新句柄一致，错误时零write/零sync、只关闭已得句柄。该修复只关闭已证等待缺口，不宣称消除所有文件系统并发竞态。Sky Window.id是不透明工具标识，不能当作Electron BrowserWindow.id；实际输入前仍须核唯一源窗口和PID对应。

ack 是 Root 的外部请求结果声明，不是 OS 真实按键数实测。报告明确分开 externalInputRequests=1、pageKeyboardSaveRequests=0、Main/DOM 各自被动观察数，physicalKeyCountMeasured=false。before-input-event 和 DOM 保存 keydown 必须各一条、无 Shift/Alt/Meta/重复/输入法状态，save-query 菜单通知一条，完成且 wrote=yes 的保存任务通知一条。

## 后续完整验收与保留规则

同 nonce ack 验证完成后继续共享原 live 的原5秒保存状态断言、UTF16LE golden 字节、原来源 revision+1、savedSqlDigest、仅 open/save 两任务、无 SQL 执行/历史、SQLite schema9、原 owner 正常退出及全 PID 消失、独立第二次启动、来源/模型/字节恢复、再次正常退出和原目录删除门。没有减少任何原文件保存验收；原 runtime 的37 await/52 guard、owner 和文件 fixture 都不修改。

新系统分支只改变保存输入等待点。原入口不传 driver，仍保留唯一原 Page.keyboard 保存请求；准备编辑阶段的 Page.keyboard Control+A/insertText 沿原用例，不是系统保存输入或补保存。失败后只附父内存、停观察并关闭已取得文件句柄；不重放保存、不补 SDK/截图/读 SQLite、不强停、不清理。

握手目录由 Root 预建且在本例原生私有目录之外，成功或失败均保留 ready/ack 作为审计材料；不借 run.finish 删除它。测试仍只删除原已闭环的自有原生私有目录。Root 后续应独立核验握手、系统输入工具结果与真实测试报告，不能只看 ack 或窄 RAM 绿灯。

## R5 ZIP 来源边界

本聊天收到的是“由 Root 内存下载并提供路径”的选择，没有三件 ZIP 的准确 run ID、artifact ID、名称、来源 URL 或摘要。因此当前无法列出准确下载对象，未下载、未猜测，也不阻塞本系统专项准备。拿到三个准确标识/绝对路径后再另行做 CRC、纯文本和真实报告核验。
