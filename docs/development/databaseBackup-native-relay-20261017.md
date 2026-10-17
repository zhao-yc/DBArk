# B01 原生 TCP 私有中继

初版普通独立克隆分支 `codex/employee3-backup-native-relay-20261017`，基线 Root `9169fdc55581dd78ded79cd188cf4087019dd6fd`。本次隐私窄修在新普通克隆分支 `codex/employee3-backup-native-relay-privacy-fix-20261017`，基于初版固定提交 `1bc7a288afce4da5ae697f092324fb3c44477811`，只改 NativeRelay、专属 RAM 测试和本文档，不改 NativeProcess、SourceReader、执行器、连接退出、共享合同或主进程入口；初版现场保持原样。

## 实际 Node 适配与 Root 接线

```ts
const relay = new DatabaseBackupNativeRelay(owner, {
  ip: pinnedSource.ip, port: pinnedSource.port,
  family: 'mysql', version: '8.4.11', serverVersion: pinnedSource.versionText,
}, {
  checkOwner: binding => sourceScope.assertCurrent(binding),
  register: operation => { sourceScope.retainRelay(operation); },
}, sourceScope.signal);
relay.start(owner);                         // 唯一实际 listen 入口
const endpoint = await relay.listening;     // 实际127.0.0.1随机端口，交受控CLI启动器
const greeting = await relay.handshake;     // 私有四元组、版本、threadId
```

默认适配直接使用 `node:net.createServer`、`new net.Socket`、原 `.listen/.connect/.read/.write`。导入、构造适配器及构造 relay 都不 listen/connect；Root 显式 start 后才分配原 Server/Socket。稳定 Promise 在构造时建立，Root register 在实际原生分配及 listen/connect 前同步保留同一 relay。retain getter 随后提供原 Server、上游 Socket、所有已接收客户端及各自原 close Promise；同步流方法失败也不会丢原句柄。

监听固定 `{host:'127.0.0.1',port:0,exclusive:true,backlog:1}`，不能由 renderer 指定。首客户端登记后立即请求关闭监听，只有该客户端能触发一次上游 connect。迟到第二客户端只登记原 owner、暂停读取并标失败，既不转发，也不重连；原额外 Socket 留待 Root 显式清理。不能将随机端口和环回地址当作本地进程身份认证，Root 仍须绑定自己启动的 CLI。

上游仅接受 Root 固定的规范数字 IPv4/IPv6 和端口，不接 DNS、zone ID 或 renderer 地址；设置准确 family、autoSelectFamily=false，额外 lookup 回调始终拒绝。只在实际原 Socket connect 事件读取 localAddress/localPort/remoteAddress/remotePort，核远端与固定目标一致。取消后的迟到 connect 仍记录原四元组，但不恢复转发或登记可用的新连接。

owner 为 `{taskId,planToken,sourceLease,connectionRevision}`，要求原对象及原字段一致，并由 Root 当前注册表同步核验。Root 应通过注册表或 signal 撤销租约，保持原 owner 对象字段不变，以便清理自己的旧句柄。目标字段在构造时复制；换绑输入对象不会换目标。同一 relay 只 start 一次，不自动监听第二次或接管新 owner。

## 握手与字节转发

首包按3字节小端载荷长度+1字节sequence读取，要求seq=0、protocol=10，包头与载荷合计最多4096字节。只解析有界ASCII版本NUL边界及紧随其后的4字节无符号connectionId，并检查现代握手固定区足够长。版本必须与 Root 已验证的准确原文完全相等；当前配置仅允许 MySQL8.4.11（可含-commercial）及MariaDB11.4.13准确文本。未知协议、过长、缺NUL、截断、零ID或版本不符均阻断。

包可任意分片，同一读块的握手后尾部另外保留，必须在原握手写回调成功且所需drain完成后再按原字节转发。握手副本只在该真实本地写完成后清除；取消、关闭请求或Promise拒绝不会假报写完。原写回调迟到成功仍只更新原句柄的写事实，不恢复已封存的转发。

手动 readable/read，每次最多16 KiB。每方向最多一笔 write，等待成功写回调，且write=false时还须等drain，才取下一块；目的已有writableLength计入16 KiB写队列上限。同块尾部最多16 KiB，握手副本最多4096字节；没有全流数组/SQL日志或data累计队列。Node内部读水位设16 KiB，但highWaterMark是阈值，并非整个进程/内核缓存的硬上限，本片不声称提前约束内核或底层一次读取的瞬时内存。

握手之后不解析、修改、记录认证、SQL、行或TLS数据，不缓存整个dump。没有认证证明、UUID推断、服务端身份等价证明或通用代理入口。relay.handshake中的版本/ID及四元组都是私有观察事实；尤其四元组是客户端Socket视角，不能假定NAT后的服务器PROCESSLIST HOST一定相同。

## EOF、失败与显式关闭

两侧均配置allowHalfOpen=true。代码不使用pipe、pipeline或会在迭代退出时销毁流的异步迭代器。CLI EOF只停止转发，绝不自动end/destroy上游；任一侧错误只标失败，不暗中销毁对侧。第二连接、15秒首握手期限、Root显式timeout、Socket timeout、租约失效及取消均永久停止新转发并封存监听。已发原写的回调与本地close事件仍属于原记录。

- `listening`：实际环回监听地址；取消后的迟到listening仅触发原监听关闭请求，不返回可用地址。
- `upstreamConnected`、`handshake`：私有连接/首包事实，不是登录、同UUID实例或服务器线程退出证明。
- `flowStopped`：EOF或停止边界；`failure`：首个固定原因码。原始异常、字节及认证内容不出现在snapshot或安全错误中。
- `seal(owner)`：封存新accept，既有上游Socket不关闭；尚无客户端时终止等待，不允许再启动监听。
- `requestClose(owner,'upstream'|'clients'|'server'|'all','destroy'|'end')`：Root明确授权关闭原资源的唯一入口。end/destroy返回只表示请求，原Socket的closed Promise及listenerClosed只由各自真实close事件完成。
- `retained(owner)`：原句柄与稳定Promise；`snapshot(owner)`：本地观察和有界队列计数。没有后端serverClosed字段，也没有常量true的后端关闭、认证或资源释放证明。

所有运行数据改为真实JS `#` 私有字段，包括owner、target、四元组、原Server/Socket、握手及在途写Buffer、Promise状态容器和回调。公开稳定Promise通过非枚举原型getter保持原接口；通用JSON不会枚举这些私有事实入口。`toJSON`与`nodejs.util.inspect.custom`显式返回同一白名单安全快照；即使关闭自定义inspect，实例也没有可枚举的运行字段。安全快照只含固定状态/原因和有界计数，不含owner、端点、四元组、threadId、原错误或协议字节。

准确握手事实仍由显式 `handshake/upstreamConnected` 私有API取得；原四元组移到同owner的 `retained(owner).upstreamTuple`，取消后迟到connect也会保留，原Socket后续关闭不会删除该事实，不为脱敏删除原句柄或四元组。直接调用这些私有API得到的Promise/事实/原Socket仍须留在Root scope，不能另行交给日志或renderer。序列化不触发租约检查、转发、关闭或任何IO。

**Root必须保留上游原Socket与源端口，先通过另一个已登记控制会话，在同一已证明实例上核PROCESSLIST ID、原HOST/USER及本例归属，再确认线程不存在或KILL本例并等待真实终态，最后显式关闭上游。** 中继不执行SQL/KILL、不启动控制连接。Root还须分别等待CLI进程、三流、全部客户端、上游及监听的本地终态；close事件不能提升成后端线程退出证明。TLS、SSH、工具注册及完整备份能力由Root另接，当前模块不为它们填已完成。

## 依据与验证

首包格式依据[MySQL HandshakeV10](https://dev.mysql.com/doc/dev/mysql-server/8.0.46/page_protocol_connection_phase_packets_protocol_handshake_v10.html)及[MySQL包头](https://dev.mysql.com/doc/dev/mysql-server/latest/page_protocol_basic_packets.html)，并核对项目锁定mysql2 3.24.5的 `lib/packets/handshake.js::fromPacket`、`lib/packets/packet.js::readInt32/readNullTerminatedString`。本片更严格检查NUL和完整边界，不复用驱动对越界版本字符串的宽松读取。

半关闭和监听close语义依据[Node net](https://nodejs.org/api/net.html)，写回调、drain、highWaterMark及避免自动结束对侧的语义依据[Node stream](https://nodejs.org/api/stream.html)。本地写回调只证明Node已处理该写，不能当作远端TCP确认或MySQL消费确认。

另核[Node24 net源码](https://github.com/nodejs/node/blob/v24.10.0/lib/net.js)：Socket将水位选项交Duplex，read/_read负责按需启动底层读取，接受端pauseOnConnect会传pauseOnCreate；源码核对不能替代Root真实连接验证。

```powershell
node node_modules/vitest/vitest.mjs run tests/unit/databaseBackupNativeRelay.test.ts --reporter=default --reporter=json --outputFile=.cache/database-backup-native-relay/relay-tests.json
node node_modules/typescript/bin/tsc --noEmit
```

RAM测试使用EventEmitter原生接口替身，不调用真实Server.listen/Socket.connect。覆盖分片/尾部、4096边界、双向字节/背压/队列上限、CLI EOF/异常不关上游、显式关闭不冒充close、第二/迟到客户端、撤销与晚到connect、超时、版本和包错误、原句柄同步失败保留。本轮仅只读浏览官方资料，未开真实中继端口或发起产品TCP/数据库连接，未执行产品OS/GUI/剪贴板，也未跑full/build；真实200服务器、CLI退出与PROCESSLIST归属验收交Root执行。

初版24项专项全部通过，`tsc --noEmit`退出码0。旧克隆忽略目录 `.cache/database-backup-native-relay/relay-tests.json` SHA256 为 `25b110383c4ab4247dbacd12ecc66f39c5e102bbbc6eac8325138a2f30ed579d`；该记录不覆盖随后独审发现的通用序列化隐私缺口。固定本地提交交Root独审及统一整合，不重试此前被自动审批拒绝的外部推送。

## 隐私窄修原件

员工1独审报告 `.cache/review-backup-relay-1bc7a288-20261017/review.json` SHA256为 `1a6fbddee49e67613e00a8333a122f781bd634edda7132584a0c72f3f21c700a`；同字节 `independent.test.ts` SHA256为 `ae8825f80afb4362ab529c23bf59a0bc9145f5cc30433b273f441765d30d1ac7`。本克隆复制原件至忽略目录 `.cache/relay-privacy-fix/`，只单跑R4，先复现快照四元组及实例JSON/inspect在途合成payload原红，再验证修后原件转绿，没有改原件/旧结果。

新增单组“隐私出口与显式私有API对照”，核默认JSON/inspect及禁用customInspect后的实例不可枚举数据，保留准确handshake/原句柄、在途callback/drain和真正close事件；原24项只做两处断言访问路径调整以适配安全snapshot移除四元组，未重跑原24项、全套、构建或实际环境。

最终：原R4单组通过（其余3组过滤），私有API对照单组通过（原24项过滤），`tsc --noEmit`退出码0。旧头仍为1bc7a28且工作区干净。本克隆 `.cache/relay-privacy-fix/` 保留以下报告：

| 报告 | SHA256 |
| --- | --- |
| baseline-red.json | `83b87d464327ad4a1e1258eeaf8276c688b29921ff46dc4bdece5a77c5b8e9e0` |
| fixed-original.json | `7d79b3e5b57fbb96631bb816b75c8616c9e26b755f40b245a04ffc2c6c1cd4fd` |
| private-api-control.json | `f9b280f9ab073c0bec3a5ecb7229bd3dfc04c7ca01e431a2d43bfe013636282f` |
