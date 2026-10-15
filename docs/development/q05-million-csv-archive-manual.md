# Q05 真实百万行多CSV ZIP手动验收准备

日期：2026-10-16。固定起点：`82e07a0788c78ea3e68df397fabb4820deb82587`。员工5普通克隆分支：`task/parallel-q05-million-archive-20261016`。本次只新增手动脚本、专用夹具和说明，不修改产品src、依赖、默认CI或E2E配置，不使用工作树。

当前状态是**准备完成，未执行真实百万行实库验收**。旧百万行CSV/JSON、生成器到文件层的4GiB验证、读取器的小样本自检分别证明不同边界，均不能替代本入口的真实Engine→MySQL驱动→CSV ZIP结果。

## 默认关闭和执行前置条件

入口：`scripts/manual-q05-million-archive.mjs`。不带参数或`--preflight`只读Git提交、产品源码指纹和本地可用磁盘空间，不读取env、执行SSH、连接数据库、启动GUI或Docker。`--self-check`只生成7行的小型Python标准库样本；不经过产品Engine或数据库。

真实执行同时要求`--run`及父进程`DBARK_Q05_MILLION_ARCHIVE_ENABLED=1`。ROOT还须显式提供：

- 已有本地env普通文件的绝对路径；脚本不搜索凭据、不创建数据库用户、不打印或提交账号密码。
- 已有账号须具备本例隔离库的建库、建表、造数、CREATE ROUTINE/执行过程和清理权限；权限不足明确失败，不自动提权。夹具显式设置自身连接autocommit=1，以核对已提交前缀，不改变其它连接。
- `--port`，必须与env的`DBARK_TEST_PORT`逐字相同；host必须为`192.168.31.200`，账号及密码必须明确存在。只支持直连此隔离端口，拒绝启用另一个数据库SSH隧道。TLS沿用env的`DBARK_TEST_TLS/DBARK_TEST_CA`，不关闭证书校验。
- `--expected-hostname`，由ROOT已有服务器身份记录提供，不能把本次读取值自动当成预期。入口先以`ssh -T -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10 server-200`执行固定只读命令`hostname; hostname -I; df -Pk /var/lib/docker`，同时核对预期hostname、200地址及Docker数据目录所在文件系统至少2GiB空间，成功后才允许数据库连接。不执行Docker命令；未知SSH主机密钥会失败，不自动接受。
- Python可执行文件绝对路径。本地至少12GiB可用空间，保留产品10GiB总文件上限及余量；远程空间检查针对已核对主机上的`/var/lib/docker`文件系统。如实际Docker数据目录不在此文件系统，ROOT应先调整此只读检查再执行，不能将错误文件系统空间当作通过。

脚本只把允许的DBARK_TEST字段传入子进程，不复制其它DBARK测试/SSH变量。专用Vitest配置在本例缓存目录生成，只发现`tests/manual/query-csv-million.manual.ts`；该后缀不匹配现有unit/integration/E2E规则。夹具再次核对随机标记、服务器身份摘要和各产品源码SHA256，防止启动期间源码变化。

## 一次导出与预期位置映射

服务器内通过6个十进制小表交叉连接构造100万行，不向客户端传入百万行数组。内容包括顺序号、超过JS安全整数的BIGINT、`DECIMAL(40,12)`、Unicode/emoji/逗号/引号/CRLF、多字节二进制、NULL、空串、与NULL标记相似的文本`\N`。只在随机`dbark_stream_时间戳_随机值`中创建表、过程及哨兵。

真实Engine打开连接和固定查询会话。单次`query.exportStream`捕获以下完整SQL脚本，绝不为后续结果重新执行：

1. `CALL q05_large()`：会话变量只增一次、服务器call哨兵只增一次，返回有序百万行和CALL最终状态。每行带真实`CONNECTION_ID()`及本次变量值。
2. `UPDATE`独立success_after哨兵，产生真实中间非行集状态。
3. 小行集：同会话ID、变量值、最大无符号BIGINT、精确20位小数，以及重复列名。
4. 零行集，仍须有CSV标题和清单映射。

| 原结果序号 | 语句序号 | 类型 | 行集序号/文件 | 数据行数 |
| --- | --- | --- | --- | --- |
| 1 | 1 | rows | 1 / results/rows-001.csv | 1000000 |
| 2 | 1 | status，CALL终包 | 无CSV | — |
| 3 | 2 | status，中间UPDATE | 无CSV | — |
| 4 | 3 | rows | 2 / results/rows-002.csv | 1 |
| 5 | 4 | rows | 3 / results/rows-003.csv | 0 |

最后才追加manifest.json。Engine终态须是4条语句完成、1000001行已写、文件提交成功；预览各行集最多200行，待写峰值不超过8行/1MiB。本入口不调整产品限额。只保存有界进度摘要、峰值RSS/堆和任务ID，不积累全部事件或行对象。

`scripts/verify-q05-million-archive.py`完全独立于产品实现，仅用Python标准库。先以固定尾部读取ZIP32/ZIP64目录预算，限制中央目录128KiB/201项，然后zipfile逐entry解包。一次最多读64KiB，独立累计CRC32和字节；csv.reader逐行比对全部百万行的顺序、每个精度字符串、Unicode、二进制、NULL/空串/反斜线区别及会话ID。物理行64KiB、字段4096字符的本例预算避免损坏文件的无界readline；本例字段远小于此值。只把不超过8MiB的清单整体解析，绝不整体读取ZIP或CSV。逐项核对原结果位置、语句号、行集号、重复标题、列位置、实际行数/字节数、CRC及空集。

## 取消、失败与收尾

成功场景之后，在同一会话单独执行两个故障场景，每个也仅调用一次真实导出：

- 后续SQL失败：提交failure_prefix哨兵、返回小行集、读取本例缺表后失败；断言已完成2条、failure_prefix恰为1、failure_tail为0、旧目标字节不变、未发布partial，不自动重放或回滚已提交前缀。
- 真实写盘取消：读本例百万行，使用每行`SLEEP(0.001)`确保取消窗口；观察到至少256行且65536字节的实际进度后，独立PROCESSLIST确认固定线程正在运行本例命令，再调用原`query.cancel`。即使观察断言失败也先取消。必须是真实进度触发，40秒安全取消不算通过；终态需cancelled、已写行数介于0和100万之间、旧目标不变、cancel_tail为0，并等待服务器命令结束。最后同会话ID和变量仍为原值。

其它导出场景5分钟安全期限到达会请求真实取消并明确失败；观察查询设5秒客户端期限。安全期限不会重试写入或取得后集。真实连接观察器只透传原`connect`及全部参数，在原函数成功返回后登记同一个ManagedConnection的真实threadId；未替换驱动、writer、数据、偏移或CRC。测试框架spy仅用于旁观，包括默认库为空的基础/取消控制连接。

收尾各步独立尝试：Engine.closeAll，等待取消，observer逐实际非observer线程ID核零（不按DB过滤），复核本地owner与服务器`__dbark_owner`唯一随机标记，精确DROP本例库，查询SCHEMATA核零，严格关闭observer，恢复观察器，核本例partial为零。没有批量按前缀删库、KILL陌生连接或递归删除验收目录。原始失败对象顺序保留，多项失败用AggregateError并以首错误为cause；落盘前隐藏凭据。

CREATE已确认但所有权标记创建失败、网络不可达、清理失败或仍有partial时，必须报告失败并保留证据，不扩大删除范围。ROOT按owner和实际线程核对后处理残留。这里不承诺OS强杀后自动清理。

## ROOT执行方式与证据

仅在ROOT安排的隔离验收窗口运行；以下占位值必须替换为已有env、明确端口、已知主机名及Python路径，不在聊天或仓库填写凭据。

```powershell
# 安全预检，不读取env或访问服务器。
node scripts/manual-q05-million-archive.mjs --preflight
# 仅小型纯文件读取器自检。
node scripts/manual-q05-million-archive.mjs --self-check --python '<Python绝对路径>'

# ROOT明确启用真实手动验收；本轮员工5没有执行此命令。
$env:DBARK_Q05_MILLION_ARCHIVE_ENABLED = '1'
try {
  node scripts/manual-q05-million-archive.mjs --run --env-file '<ROOT已有env绝对路径>' --port '<隔离端口>' --expected-hostname '<已知200主机名>' --python '<Python绝对路径>'
} finally {
  Remove-Item Env:DBARK_Q05_MILLION_ARCHIVE_ENABLED -ErrorAction SilentlyContinue
}
```

输出保留在当前克隆`.cache/q05-million-archive/dbark-q05-million-*`：owner.json、SSH身份观察及通过记录、成功ZIP、两个旧文件保护目标、evidence.json、脱敏runner日志。目录保留用于ROOT复核，不提交产物。evidence记录固定起点/实际提交/源码指纹、真实版本/会话/线程/任务、Python校验、原异常及清理结果；只有整体验收终态passed且清理核零，才能记为本切片实库通过。SSH身份预检失败会在连接数据库前停止。

本轮验证：Node入口语法、Python AST语法和TypeScript类型检查通过；只读预检通过；缺少显式开关的`--run`提前拒绝；专用手动夹具收集1项、默认跳过1项。Python仅7行样本的6项有界读取自检通过，包括普通/ZIP64尾部、错误精度、错误位置映射、CRC损坏及超长物理行。GUI、剪贴板、200、Docker和真实百万行均未运行。本入口仍不能替代真实跨4GiB或10GiB、原生Windows解包器、GUI/安装包及跨平台验收。
