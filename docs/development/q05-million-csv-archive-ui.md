# Q05 百万行多CSV ZIP正式UI补充准备

日期：2026-10-16。普通克隆任务分支：`codex/q05-million-ui-20261016`。固定起点：`5bbeda275a7d4ceb6fd5a41981fef3b9ff3987c4`。未修改ROOT、产品src、默认测试配置、旧断言、旧期限或旧用例ID，没有使用工作树。

新增稳定用例标识`Q05-MILLION-CSV-ZIP-UI`，在`tests/e2e/query-stream-million.spec.ts`尾部独立describe中追加1项。它是**0.17标签自有246项之外的正式UI补充**；准备代码、`--list`、已通过的Engine百万行证据均不能记作此UI补充已通过。ROOT须分别运行源码和公开NSIS并保存各自证据，不修改既有246项统计。

原百万行CSV/JSON用例完整保留在原位置，其Playwright ID仍为`00f99edc79a95734122b-54fcca3d850aca581611`、第36行。新用例Playwright ID为`00f99edc79a95734122b-174ac86bdbe41b6b322b`。同文件现在收集2项，但本补充单独筛选执行，不据此改写公开标签的测试总数。

## 双门与ROOT注入接口

声明阶段同时要求`DBARK_INTEGRATION_ENABLED=1`及`DBARK_Q05_MILLION_ARCHIVE_UI=1`；否则在自动Electron夹具前skip。`--list`不运行beforeAll、Python、SSH或数据库。新增帮助器只在已启用的beforeAll或测试体内动态加载。原文件已存在的live-helpers导入和旧用例开关保持原样。

ROOT须显式注入：

- 已核对的`DBARK_TEST_HOST=192.168.31.200`、`DBARK_TEST_PORT`、既有`DBARK_TEST_USER/PASSWORD`。只接受六个专用端口`13357/13380/13384/13310/13311/13484`，同时核对原始process.env与既有helper环境逐字相同；不自动改目标，不新增用户。
- `DBARK_Q05_PYTHON`：ROOT已有Python可执行文件绝对路径；无PATH/下载/其它解释器回退。
- `DBARK_Q05_EXPECTED_HOSTNAME`：ROOT已有服务器身份记录的预期主机名（此前已核对的是`Server-200`，本入口仍须实际SSH重新核对）。
- 如使用TLS，沿用`DBARK_TEST_TLS=1`及已有`DBARK_TEST_CA`，严格校验证书及身份，不生成证书或放宽校验。
- 公开NSIS时按既有desktop-fixture传`DBARK_EXECUTABLE_PATH`，指向从公开安装包安装后的实际程序；源码运行则不设置此项。ROOT另行保存公开安装包来源及哈希。

beforeAll先核以上接口，再以固定只读`ssh server-200`核hostname/200地址和`/var/lib/docker`文件系统至少2GiB空间；不执行Docker命令。实际产物目录所在本地文件系统须至少12GiB空闲，产品仍保持10GiB总文件上限、8行/1MiB队列、200行预览等原预算。原用例的600000毫秒不动；新用例单独600000毫秒，导出任务等待240000毫秒、Python校验300000毫秒，不通过延长期限掩盖失败。

## 真实界面与utility证据

复用`isolatedDatabase`、真实连接表单、对象树新查询、Monaco键盘输入、现有完整导出对话框、实际主进程授权和utility Engine链。只替换原生保存对话框返回路径；授权、主进程、驱动、writer、CRC和文件均使用原实现。

服务器在本例随机`dbark_e2e_*`库造100万行，并写入随机所有权标记。字段覆盖超安全整数BIGINT、精确DECIMAL、重复列名、Unicode/emoji/逗号/引号/CRLF、真实BLOB、NULL、空串及反斜线文本。数据模型和协议映射复用已验Engine场景，二进制字段改为真实BLOB，Python按规范字节校验。

1. 普通查询行上限填2，通过真实“执行全部”运行初始化及5行诊断SELECT。必须实际返回2行、显示截断，记录物理CONNECTION_ID、变量0、真实utility请求maxRows=2和sessionId。
2. 把完整四语句SQL写入Monaco，核对持久化源SQL。点击“新执行并完整导出”，选CSV ZIP和目标，核对固定SQL及未确认时按钮禁用，文件选择和配置不新增任务/历史。
3. 点击确认一次：CALL返回百万行与终包、中间UPDATE状态、1行精度小集及空集。只产生1个新导出任务、1条完全匹配源SQL的成功历史，服务器call/success_after哨兵均为1。原结果位置为`rows(1,1),status(2,1),status(3,2),rows(4,3),rows(5,4)`。
4. 核对renderer任务事件、持久化任务和实际utility请求的taskId一致；响应按原wire请求UUID关联；查询会话与初始化及导出CSV中的真实连接ID一致。utility进程来自本次真实fork，并与app.getAppMetrics唯一数据库引擎PID相符。
5. 真实返回预览逐集行数为`200/0/0/1/0`；UI关闭窗口后普通上限仍为2、结果区显示200及截断、网格aria-rowcount=201且实际DOM虚拟行少于80。任务实际写入1000001行，待写峰值最多8行/1MiB。
6. 用ROOT显式Python执行已有`verify-q05-million-archive.py`：64KiB分块、逐CSV行校验全部百万行、CRC、字节数、重复标题和manifest位置，不使用`readQueryCsvZip`或整体读取ZIP/CSV。
7. 再通过正式UI执行一次小型会话诊断，连接ID及变量1保持；它有独立普通查询任务，不重执行导出SQL。导出源SQL历史仍仅1条。三次实际查询请求为初始化、导出、后置诊断，均同一个sessionId且wire UUID互异。

观察器仅透传原`utilityProcess.fork`与`child.postMessage`的同一入参、返回对象及响应。最多8条查询摘要、64个待响应编号、64个已取证线程、8个会话、4个worker PID，只保存最后一条导出进度和事件总数；不收集全部事件或预览行。溢出即验收失败。辅助字段、SQL和数据均为本例合成内容，不记录账号、密码或完整连接配置。

## 独立清理与保留证据

另开只读观察控制连接，复用ROOT已有账号。正式UI退出与随机库删除沿用既有isolatedDatabase；新增代码在其返回后独立按物理ID核对：连接测试/打开返回的真实线程、正式SQL诊断/CSV一致的查询线程、既有helper observer线程均须消失，不按DB过滤。控制连接只做核对，最后end；不把end ACK写成服务器线程核零证明。

原夹具quitDesktop还核本次Electron全部进程退出；新增证据单独核已观察数据库utility PID不再存活、精确SCHEMATA库数为0、本例目标目录partial数为0。这里把“已取证连接按ID核零”与“本次进程退出”分别记录，不假装截获了驱动中每一次瞬时元数据建连。

产物位于本次Playwright输出目录的随机`q05-million-ui-UUID`子目录：owner.json、成功ZIP及evidence.json；截图为`q05-million-csv-zip-ui.png`。目标在测试dataDir之外，退出清理不会删掉大包。没有递归删除证据或触碰旧`.cache/q05-million-archive/dbark-q05-million-1OVzsX`。证据记录app真实版本、isPackaged、实际程序路径、服务器身份、wire/任务/会话/历史/线程编号、进度、Python摘要、哨兵、清理及脱敏原异常。失败与清理错误各自保留，多错误以首个原对象为AggregateError.cause。

ROOT运行示例（当前员工5仅做类型/语法/--list，不执行下面的真实用例）：

```powershell
$env:DBARK_INTEGRATION_ENABLED = '1'
$env:DBARK_Q05_MILLION_ARCHIVE_UI = '1'
$env:DBARK_Q05_PYTHON = '<已有Python绝对路径>'
$env:DBARK_Q05_EXPECTED_HOSTNAME = '<ROOT已知200主机名>'
# 连接凭据沿用ROOT已有本地env注入，不在命令或文档展开。
# 源码：ROOT先按项目流程构建；公开NSIS另设DBARK_EXECUTABLE_PATH。
node node_modules/@playwright/test/cli.js test tests/e2e/query-stream-million.spec.ts --grep 'Q05-MILLION-CSV-ZIP-UI'
```

本轮实际只运行TypeScript类型检查、Playwright语法收集及差异检查，均通过；未运行测试体、Python、SSH、200、Electron、剪贴板或Docker。只读收集命令：`node node_modules/@playwright/test/cli.js test tests/e2e/query-stream-million.spec.ts --list --reporter=json`；文件收集2项，新用例expectedStatus=skipped，单独grep新ID只收集1项。原用例ID、标题、行号及正文未改，产品src、Python读取器和默认配置差异为空。不以准备或收集替代GUI、公开NSIS、实库、真实4GiB/10GiB或跨平台验收。
