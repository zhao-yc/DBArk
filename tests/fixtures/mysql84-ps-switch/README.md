# 13384单实例P_S切换的只读准备与阻断

本分支基于 `ad7b4495196bc59bb8d821029f009973aa04cdd6`，只增加本目录。没有访问200、读取真实env/key、执行Docker/SSH/GUI、重启数据库或改变服务器设置，也没有修改产品、ROOT、冻结w02、dist或依赖。P_S当前为0是ROOT新MDL实证的前提阻断；这份准备不代表获得停机授权，也不代表MDL已经通过。

## 结论：尚不能按“只改Cmd和labels”执行

ROOT公开run880/run884给出了实际容器、镜像、匿名卷、资源及数据库边界，未给出可证明创建保真的完整Config/HostConfig、原匿名卷的创建绑定方式、唯一Network ID及端点详细形态。run883在原网络预期处拒绝，run884的ready=false也不改写为业务写失败；两轮均没有CREATE/stop/rename/start。

当前只能准备**只读核对器与内存草案**，不交付猜测性的切换执行器。`prepare.py`没有任何POST、DELETE、stop、rename、create、start、rm或回滚执行入口；即使只读草案检查通过，也明确输出 `readyForSwitch=false`、`mutationsImplemented=false`。退出0仅表示草案只读审查完成。

必须先由ROOT在另行批准的只读阶段核实以下阻断，再确定是否批准增加等价配置规范化；本准备不会代填：

- [Docker官方卷文档](https://docs.docker.com/engine/storage/volumes/)明确匿名卷不会自动被后续容器复用。实际Mounts中看到原卷，不等于原HostConfig已有可复用的显式Binds。若Binds为空，原样复制可能分配新匿名卷；加显式原卷绑定又改变HostConfig。本核对器返回 `existing-volume-not-explicitly-bound`，不自行补Binds/Mounts/VolumesFrom。
- run880的原Image引用为 `mysql:8.4`。创建时要固定到已核image ID，不能依赖该浮动标签仍指向同一镜像；但把Config.Image改为ID也是额外字段变更。本核对器返回 `image-reference-not-fixed-id`，不默许此额外变化。只核实际image ID相同并不能消除创建请求中的引用风险。
- 完整inspect HostConfig不能当作通用Create API请求。只读核对器仅接受代码列明的简单字段；未知字段即使为null/0/false也返回 `unsupported-config-shape`，不丢弃、不推断默认值或称为可靠round-trip。当前真实完整形态未由本员工读取，不能声称它符合合成样例。

只有这几项得到明确解决、未来写执行器另行独立审查后，下面的阶段方案才可成为可运行方案。

## 精确范围与网络纠正

| 对象 | 必须保持的实际边界 |
| --- | --- |
| 原容器 | `/dbark-p0-parameters-mysql84-01a13412`；完整ID `b07ab0cfa832f45b14b32a4befa4251b3bbb3aa6277261b3c8e779463f0b7052` |
| 镜像 | `sha256:b3b90af2a6552ae30c266fdb7d5dd55f3afb72404bb78d37fe8a23eb857fd3fb`；Linux amd64，不pull或build |
| 原卷 | `562de7fc2978429f1c6416df4bc5b981a01a2f09637e8d065da7ffe657c506a6`，local，唯一挂载 `/var/lib/mysql`，可写；切换前只有原容器引用 |
| 原网络 | NetworkMode和唯一attached Name均为 `dbark-p0-parameters-01a13412`；**不是Docker默认bridge**。Network ID必须由ROOT独立核实后明确提供，本准备没有它的默认值 |
| 端口 | 只发布 `192.168.31.200:13384` → `3306/tcp`；33060不发布，不扩大地址/端口 |
| 资源 | Memory `805306368`，NanoCpus `1500000000`，restart=no；不提高资源或改重启策略 |
| Cmd | run884记录共5项，仅允许唯一精确 `--performance-schema=OFF` 改为ON，其他项仅在内存逐字保留，不输出值；任何其它P_S拼写/重复开关拒绝 |

不重建网络、不连接默认bridge、不复制网络本身的IPAM配置。未来核对器检查既有网络ID/Name、local/bridge驱动及默认IPAM驱动；端点有IPAMConfig/static IP、Links、Aliases、DriverOpts、IPv6或多网络就停止，不猜复制。保留原NetworkMode文本与实际同一Network ID；未来写执行器还须在每个变更前后重新核ID，不能只按Name接管。

run884的可用内存3186393088字节、max_connections=40、仅四系统schema、其他应用连接0、事务0及UUID `f568f70e-c730-11f1-8190-3e6c830dde01`是当时的ROOT只读事实，不能替代停机前的新鲜检查。`prepare.py`不读取DB凭据、不连接数据库，也不声称独立证明了端口OS层独占、预算或会话清零。

## 只读核对器的门与秘密边界

默认运行立即返回64，在宿主核对、API、报告文件或环境变量访问前退出。未来ROOT只读核准也须同时显式提供 `--root-approved-readonly` 和 `--root-confirm server-200/13384/read-only-ps-switch-review`，以及从实际主机独立取得的machine SHA256、socket dev/ino、daemon ID、Network ID、随机32位run和已由ROOT建立的独占报告父目录。它不从环境、Docker context、.env、认证文件或旧笔记自动发现这些值。

每个HTTP请求之前，包括初次 `/info`，独立核Server-200、Linux x86_64、root、网卡实际私网IP、machine-id及root拥有的原Unix socket dev/ino。每个目标GET前再读info核daemon/宿主/架构，目标GET前再次核本机；不使用DNS或外部命令。API固定v1.45、显式 `/var/run/docker.sock`，不支持TCP/代理、版本降级或重试。未知状态码/连接/JSON错误只给固定错误码，不返回原响应或底层异常正文。

只允许GET info、固定原容器inspect、所有容器的摘要（含停止容器，用于原卷引用）、固定镜像/卷及明确Network ID。其他ID和任何写端点在触网前拒绝。Config/HostConfig/Env/Cmd只留内存，草案禁止repr，不输出摘要/原值，不写文件；未来CLI先关闭核心转储。Python不能承诺字符串的物理内存擦除，进程退出归还内存；ROOT仍须限制调试、dump、终端记录及其他特权读取。

安全报告只允许固定阶段/错误码、run、完整非秘密对象ID和false边界。父目录必须为绝对的 `dbark-ps-switch-<run>`、无链接、root:0700；`preflight.json`用O_EXCL/O_NOFOLLOW:0600独占创建并fsync。已有文件不接管，草案/Config/HostConfig/Env等任一额外字段在文件访问前拒绝。此报告仅是只读准备记录，不是切换阶段日志。

## 未来变更阶段合同（尚未实现、不得据此实际执行）

ROOT首先复核专用schema边界、全部会话/事务、备份恢复准备、端口独占、资源预算和维护窗口，并明确批准单实例正常停止。原容器仅保留为**配置恢复点**，不是数据快照；两个容器共享同一原卷，新实例正常启动也可能写InnoDB/系统状态，不能承诺数据回滚。绝不能让两个mysqld同时挂同卷运行。

[Docker v1.45官方API定义](https://github.com/moby/moby/blob/v26.1.5/api/swagger.yaml)分别定义创建、启动、停止和重命名请求；[官方stop语义](https://docs.docker.com/reference/cli/docker/container/stop/)允许超时=-1等待正常退出，避免超时后强制KILL。未来实现须明确验证目标API版本支持该语义；HTTP超时只表示结果未知，不能据此重发stop或转为kill。

| 阶段 | 前置与单次操作 | 必须证明的后置/异常处理 |
| --- | --- | --- |
| prepared | 全部身份、DB窗口、卷/端口/网络独占及配置保真均核定；在root:0700目录O_EXCL创建只含非秘密状态的日志 | 任何未知先停止，不发送变更；不持久化Config/HostConfig/Env/Cmd/其hash |
| stop-attempted | 先fsync意图，再向完整原ID发送一次正常stop，等待正常退出，不kill | read-only inspect证明Running/Restarting/Paused均false、正常退出且无OOM；请求超时/未知即保留阶段，用GET核实，不自动重发 |
| stopped | 新鲜核同一image、原卷、网络与原端口、无新会话 | 确认终态后才可进入rename；未停不重命名 |
| rename-attempted | 先落盘意图，再将完整原ID重命名为 `dbark-ps-old-<run>` | inspect原ID仍同一配置/镜像/卷/网络，原名称确实空闲；不得rm原容器或-v |
| create-attempted | 再核宿主/daemon/原ID已停与已改名；在内存构造已经批准的固定镜像、原卷、同网络/私网端口请求；只变唯一Cmd与本轮labels | 只发一次create。响应须201、完整new ID、无未知warning；超时/断线不重发、不按名字接管。仅GET对照run/source labels、完整ID及配置恢复现场 |
| created | inspect新完整ID逐字段内存比较Config/HostConfig及Cmd/labels差异，原卷和网络ID实际相同，原备份仍停 | 原卷引用只许已知old+new，任何第三者或未知对象停止；不因端口/网络异常扩大配置 |
| start-attempted | 先落盘意图，再向完整new ID发送一次start | 未知不重发；只读核Running、无Restarting/OOM，实际卷/网络/端口与预算保持。DB另行核UUID/8.4.11、P_S=1、只读策略与四schema、连接事务边界 |
| started-unverified | 只说明进程/只读DB检查结果 | MDL核心/正式UI另行实测，不能由P_S=1推断通过；原容器继续保留、绝不删除卷 |

每次API（包括每次info）都重复独立宿主/socket核对；每个目标请求之前还须新鲜核daemon。阶段意图和结果以完整old/new ID、run、阶段、固定错误码、时间及布尔结果独占追加并fsync，绝不记录body/响应全文/Env。进程崩溃或任一写结果未知时，同run状态不可再次启动写流程；只准另行只读核实并由ROOT决定。

## 明确回退方案

- 新容器尚未创建：先只读核原ID与备份名、原名称空闲、同镜像/原卷/原网络及原容器已停，ROOT另批后单次恢复原名并启动原ID，核原P_S=0及UUID。rename结果未知时先查ID/名称，不重发。
- 新容器已创建但尚未启动且事实明确：不删它或卷。ROOT核new ID/run/config后，将未启动的新容器改为独立保留名；确认原名空闲，再恢复原容器原名。任何改名/创建未知先停止核实，不按名称猜归属。
- 新容器曾启动或start结果未知：首先只读核两容器实际状态、原卷引用及DB会话，无法证明新进程停止则绝不启动旧容器。停止新容器也需ROOT独立批准和正常退出证明；随后保留新容器，按上一步改名保留，再恢复原ID。共享卷可能已有系统写入，恢复的是启动配置，不是数据时间点；发现恢复/一致性异常保留现场。
- 不实现自动回滚、不删除old/new、不移除volume/network/image、不修改MySQL全局设置、不用恢复动作掩盖首次失败。后续清理需要另一份精确范围核定。

## 本轮纯验证边界

`test_prepare.py`用合成Config（含合成秘密标记）、假HTTP/宿主/文件端口，执行正式prepare/GET门/报告控制流；没有实际HTTP、OS宿主探测、密钥/环境访问或文件写入。覆盖原匿名卷与浮动Image引用的阻断、未知字段、错误身份/架构、额外卷引用、端口碰撞、额外网络/static IP/aliases/links、自有网络被误改默认bridge、资源漂移、默认门、每次info及目标GET的宿主顺序、daemon变更和报告泄密。真实HostConfig兼容性、完整切换、未知写恢复、停机与MDL验收均未验证。

只读准备器当前不能解决run880/run884留下的配置形态与额外字段变更授权问题。ROOT若确认要增加原卷显式复用、固定Image引用等变更，应先将这些例外纳入明确方案，再补写执行器并独立审查；不能把本次内存草案当作已批准的重启脚本。

本次15项内存纯检查通过；两个Python文件在内存编译及只读API的AST边界检查通过。命令为 `python -B tests/fixtures/mysql84-ps-switch/test_prepare.py`，未运行prepare.py的获准只读入口。首次内存报告测试因Windows的POSIX假路径不是绝对路径而失败，已将假路径改为平台自身绝对路径后通过；没有因此换到实机测试。TypeScript/产品未改，不执行构建或真实集成。
