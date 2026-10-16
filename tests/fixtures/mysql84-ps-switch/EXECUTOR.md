# 13384单实例观测切换执行器准备

本分支直接基于冻结 `95ed17e03ec0d7c8b1da28136d5ccd7e0f305333`，另建普通任务分支。原prepare.py、原纯测试和README保持，继续作为95ed只读准备记录；本次新增execute.py、test_execute.py及本文档。没有修改产品、ROOT、w02、dist或依赖，没有读取真实env/key、访问200、执行Docker/SSH/GUI、重启或手动CI。

ROOT后续仍须独立审查本固定头和新鲜DB会话/事务、schema、端口、资源边界，再决定实际运行。本次交付的是**默认关闭的执行器准备**，不是已切换、已通过P_S或MDL验收。

## 新批准的等价表示与未放宽的约束

ROOT的run902只读形态补足了原网络ID和63个HostConfig字段；完整Config/Env/Cmd原值未输出。本次按ROOT明确批准准备以下规范化：

| 创建请求字段 | 变化 | 保持的运行语义 |
| --- | --- | --- |
| Config.Image | `mysql:8.4`引用改为已核完整image ID | 仍是 `sha256:b3b90af2a6552ae30c266fdb7d5dd55f3afb72404bb78d37fe8a23eb857fd3fb`；不pull/build |
| HostConfig.Binds | 原null改为唯一 `562de7fc2978429f1c6416df4bc5b981a01a2f09637e8d065da7ffe657c506a6:/var/lib/mysql:rw` | 显式复用已存在的原local卷，不传空Source，不使用VolumesFrom，不新建匿名卷 |
| HostConfig.NetworkMode、NetworkingConfig | Name等价改为完整原Network ID，EndpointsConfig只设该ID的空对象 | 仍是 `dbark-p0-parameters-01a13412` / `6b82e79ed841a73099ceb5014b154bda91e56b0f888bbd49c94af362a1e702a0`，local bridge；不是默认bridge，不重建网络 |
| Config.Cmd | 唯一精确 `--performance-schema=OFF`改ON | 原其它4项逐字保留，不输出值，不追加替代开关 |
| Config.Labels | 只追加本轮purpose/run/source三个字段 | 原两项原值保持，不接管Compose或既有本轮labels |

其余17个Config字段及63个HostConfig字段均在内存完整复制、逐字段比较。未知字段一律拒绝并只报告字段名，因此任何未知非默认字段也拒绝；不丢弃或伪造默认值。已知模式仍要求非特权、非自动删除、restart=no、原私网端口及Memory=805306368/NanoCpus=1500000000。CgroupnsMode/IpcMode限定private、Runtime限定runc、ConsoleSize=[0,0]；若真实值不同须先保留并报告，不能自动换成这些值。

run902未公开的日志/系统路径等原值仍只在ROOT未来进程RAM中读取。执行器对已知字段限定类型/范围，并保留原值：ShmSize为正且不大于原memory上限，MemorySwap在memory至2倍之间，LogConfig仅json-file/local/none且Config为字符串映射；MaskedPaths/ReadonlyPaths分别16/5项并限/proc或/sys绝对路径。任何条件不满足会明确给字段名，请ROOT先补只读事实，不放宽为任意值。新容器创建后再次比对整个Config/HostConfig，只有上述批准差异可存在，否则不start。

[Docker官方卷说明](https://docs.docker.com/engine/storage/volumes/)解释匿名卷不会自动复用。原容器始终保留原卷引用，创建前再次确认卷存在、driver/local/路径和唯一原引用，创建后仅允许已知old+new引用；不调用任何卷创建/删除API。保留原容器同时阻止通常的在用卷删除，但不声称能抵御另一个特权操作者破坏维护窗口。

[Moby v26.1.5网络实现](https://github.com/moby/moby/blob/v26.1.5/daemon/container_operations.go#L384)会将按ID传入的端点归到实际网络Name，并重建运行时地址与DNS。请求不含旧IP、EndpointID、MAC、DNSNames或旧短ID别名。自定义IPAM/静态IP/Links/Aliases/DriverOpts、多网络或非自动DNS均拒绝；动态IP/EndpointID变化是预期运行事实，不当作需要复制的Config。正常停机后Ports可能为空或null，按该官方实现的releaseNetwork语义处理；HostConfig.PortBindings仍严格保持私网原值，启动后实际Ports必须再次精确匹配。

## 默认门与ROOT新鲜证明

没有同时设置 `--execute-switch` 与 `--root-confirm server-200/13384/ps-switch-off-to-on` 时立即退出64，不访问证明、宿主、状态文件或API。没有resume、retry、rollback、delete或清锁开关。以下仅说明未来入口，**本轮未执行**：

```sh
python3 -X utf8 -B tests/fixtures/mysql84-ps-switch/execute.py \
  --execute-switch --root-confirm server-200/13384/ps-switch-off-to-on \
  --machine-sha256 "$ps_machine_sha256" --socket-dev "$ps_socket_dev" \
  --socket-ino "$ps_socket_ino" --daemon "$ps_daemon_id" \
  --run "$ps_run" --state-parent "$ps_state_parent"
```

参数仅非秘密身份值；不通过argv/env/file传Config、HostConfig、Env、Cmd或其hash。machine/socket/daemon必须来自ROOT在实际Server-200的独立核定，无默认值。每个原始API请求（包括初次info）前独立核root、Server-200、Linux x86_64、实际192.168.31.200网卡IP、machine-id和root-owned socket dev/ino；每个目标请求之前重新GET info核daemon，并再次核宿主后才发送目标请求。显式Unix `/var/run/docker.sock`、API v1.45，无TCP/代理/认证配置/版本回退/第三方Docker依赖。

ROOT在同一服务器新建root:0700、无链接的绝对 `dbark-ps-switch-<32位run>` 目录；预先独占写root:0600、普通单硬链文件 `root-preflight.json`。它只允许以下非秘密字段，拒绝任何额外字段，不读取.env或DB认证文件：

| 字段 | 必须为ROOT刚实际核对的事实 |
| --- | --- |
| version/run/checkedAt | 1、相同32位run、服务器Unix秒；停机前0–60秒内且不能来自未来 |
| oldId/imageId/volume/networkId | 与代码内固定完整ID严格一致 |
| serverUuid/mysqlVersion | `f568f70e-c730-11f1-8190-3e6c830dde01` / `8.4.11` |
| performanceSchema/readOnly/superReadOnly | 数值0，拒绝布尔或字符串替代 |
| otherApplicationConnections/transactions/nonSystemSchemas | 0 / 0 / []，必须独立确认维护窗口及系统schema边界 |
| maxConnections/memoryAvailableBytes | 40 / 至少1610612736字节（原768MiB限制的2倍余量） |

这份文件是ROOT的实际DB前置核定，不是执行器独立连DB的证明。执行器不接收DB凭据、不执行SQL。首次Docker核对及取得全局意图后，在停机前再次验证60秒新鲜度；每个写请求前还独立读取实际/proc/meminfo检查同一内存余量。维护窗口内资源仍可能变化；检测到不足停止，不扩大原容器预算。

## 一次意图与四次写入

先只读核完整原ID、image、唯一原卷、精确原网络、端口、资源和Config形态。初始仅允许原完整ID `b07ab0cfa832f45b14b32a4befa4251b3bbb3aa6277261b3c8e779463f0b7052` 处于正常Running、无Paused/Restarting/Dead/OOM。任何未知或异常先停止。

取得 `/run/dbark-ps-switch-13384.intent.json` 的O_EXCL/O_NOFOLLOW:0600持久全局意图，阻止不同run再次启动同一切换。即使未发送容器变更但初始化失败，也不自动删除意图。然后在私有run目录O_EXCL/O_APPEND:0600创建 `switch-state.jsonl`；检查root所有权、单硬链、inode身份，文件和目录fsync。每条阶段记录只含run、时间、序号、完整old/new/image/volume/network ID、固定阶段/错误码和字段名；没有Config/Env/Cmd/其hash或原响应/异常正文。

| 阶段 | 仅一次写入与后置条件 |
| --- | --- |
| prepared→stop-attempted | 意图先fsync，发行仅对应完整原ID正常stop路径的一次凭据，再POST stop?signal=SIGTERM&t=-1。没有kill或restart调用。正常终态须Running/Paused/Restarting/Dead/OOM均false且ExitCode=0；原Config/HostConfig/镜像/卷/网络仍匹配 |
| stopped→rename-attempted | 再核原卷/网络/名称后，单次将原ID改名 `dbark-ps-old-<run>`；核原ID仍同一配置、原名称空闲。原容器保留，不rm |
| renamed→create-attempted | 再核仅原卷引用和精确网络/空闲原名后，单次create原名称。HTTP须201、完整new ID，无未知warning；拿到合法new ID就先持久记录create-identified，再作进一步核验 |
| create-identified→created-verified | 新容器仍未启动，完整Config/HostConfig与内存计划精确相符；原卷同名同路径/driver/RW，仅old+new引用；原备份停机且配置未变。新网络尚未实际连接时，只接受空操作态及固定ID的请求配置，不伪造“已连网”结果 |
| created-verified→start-attempted | 意图fsync后仅向已记录new完整ID发送一次start。再核new实际Running、原old仍停、同image/原卷/精确网络ID/私网Ports及完整Config/HostConfig保持 |
| started-unverified | 仅容器后置已核。输出databaseVerified=false、mdlVerified=false；ROOT另行实际核DB UUID、版本、P_S=1、只读模式、连接事务与MDL核心/UI，不凭Running推断数据库或MDL通过 |

写凭据绑定run、阶段、路径和最近一次已持久序号，一次消费后不能复用；没有持久意图、错误路径、旧序号、已halted状态均在info或写请求前拒绝。每次POST都独立核宿主与daemon。API方法/路径白名单没有DELETE、rm/-v、卷/网络/image创建、kill、restart或旧容器start。

[官方stop语义](https://docs.docker.com/reference/cli/docker/container/stop/)在timeout=-1时不自动升级到强杀。HTTP连接仍有15秒预算；超时、非预期状态码、JSON/响应未知均只表示本步骤写结果未知，不能据此重发。全局意图与已fsync阶段保留，输出安全错误码；不自动查询并接管未知create，不自动回滚。若文件在后置落盘前失败，之前的意图仍在，stdout保留已经收到的完整new ID供ROOT人工核实。

## 异常与回退

本执行器没有恢复入口。原容器是启动配置恢复点，**不是数据快照**；同卷上的新MySQL正常启动也可能写系统/InnoDB状态。未知create/start、状态记录损坏、额外卷引用或连接未清，均保留现场，由ROOT另行只读核完整ID/run/source labels/状态和DB事实；不得删除意图文件后盲目重跑。

新容器不存在且原ID已停时，ROOT另批后可在核名称空闲、原镜像/卷/网络/配置一致后恢复原名并启动原ID。新容器存在但未运行时，先保留并改为独立名称，再恢复原容器原名；不删除任何容器或卷。新容器曾运行或start未知时，先独立核实并正常停止新实例，证明其真实退出及DB连接归零，方可处理原名和启动旧实例。绝不能让两个mysqld同卷同时运行；任何恢复写也只发送一次、独立记录意图，不能用回退改写首次失败。

原95ed只读准备记录、run880/run884/run902事实均不覆盖或重写。后续清除全局意图、两个容器保留点及其它材料，需要ROOT按精确run/完整ID核定，执行器不会自动清理。

## 本轮纯验证

新增测试通过正式switch、Docker HTTP门、CLI和JournalCore，HTTP/宿主/文件/证明/时间均替换为内存端口。覆盖：完整63字段保真逆向比较、四次写后响应丢失及500响应、不持久意图时零对应写、错误/复用凭据拒绝、未知字段名、静态网络/别名/端口/卷/资源与身份漂移、创建后Env/HostConfig变化阻止start、warning/未知ID保留、ROOT证明过期/时钟未来/事务/业务schema/内存不足、默认门零IO、阶段文件替换/权限/硬链、O_EXCL全局意图及fsync顺序、CLI及状态文件无合成秘密标记。

只运行源码和内存纯验证，不运行真实Unix API、Docker/200/SSH/GUI、证明生成或执行入口，不构建产品。真实Docker对这些Config/HostConfig的接受程度、正常停机、卷数据一致性、P_S内存影响、数据库启动及MDL仍待ROOT独立实证。

本次新增19项执行器内存检查，原15项只读准备检查保持，共34项通过。四个Python文件在内存编译通过；生产源码静态检查确认只有四处固定POST、没有进程/环境读取或删除/强杀/恢复入口。实际调用仅为 `python -X utf8 -B -m unittest discover -s tests/fixtures/mysql84-ps-switch -p 'test_*.py'` 及源码编译/静态核对，未调用execute.py的实际执行门。首次CLI内存回归因时钟端口默认绑定早于假时钟替换而拒绝证明，已改为调用时取时钟并完成全组复验；该记录不计实机失败或实机通过。
