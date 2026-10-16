# 28fd39c 的两项 P2 修正

本次基于固定 `28fd39cb8bc7872548e0bb9a43e5fea47fef6d2b`，修正员工2独立审查发现的两项准备代码问题。原缺陷与审查证据保留，不重写为历史通过。仍缺省关闭，没有访问200、运行Docker/SSH/GUI、生成或读取真实密钥，没有产品、旧mTLS/SSH流程、挂载白名单、CI、版本或发行说明变更。

## 分开验证通道拒绝

固定 [OpenSSH10.2p1 serverloop.c](https://github.com/openssh/openssh-portable/blob/V_10_2_P1/serverloop.c#L536) 的 session 失败保留 CONNECT_FAILED；[session.c](https://github.com/openssh/openssh-portable/blob/V_10_2_P1/session.c#L1585) 在零会话上限拒绝分配，[ssh2.h](https://github.com/openssh/openssh-portable/blob/V_10_2_P1/ssh2.h#L154) 定义原因2。受禁 direct-tcpip 仍单独要求管理策略拒绝1。

现在协议回放分别核 forward=1、exec/SFTP session=2；必须是 [ssh2@1.17.0 onChannelOpenFailure](https://github.com/mscdex/ssh2/blob/v1.17.0/lib/utils.js#L7) 构造的开通道错误形状，同一认证连接无error/close。普通网络错误附带reason2、已开通道后的exec/subsystem失败、错误原因或连接关闭均拒绝。

服务器 verify 新增固定的只读 `sshd -V`，仅该命令合并stderr供内存解析，所有Docker调用前的身份/socket/daemon核对及环境白名单保留。proof要求实际 `OpenSSH_10.2p1` 和 `MaxSessions=0`，并由租约传给协议检查；旧proof缺字段须ROOT重新verify，不接受客户端补填。这仍是源码和纯端口契约，未声称发行包或真实容器已验。

## 异常授权不可恢复为可删除

五类授权检查（TABLE/SCHEMA/COLUMN/USER/ROLE）及读取异常会设置不可复位的失效事实。cleanup公共门在线程清零后、任何DROP前检查该事实；用例先失败也重新核权限，两个实际删除回调再次检查失效状态。发现异常则用户和库均零DROP，仍关闭原管理连接、执行独立逐ID观察并严格关闭观察者。

CREATE 的 absent/unknown/confirmed 与授权失效分开记录，不为阻止删除把已确认创建伪装为unknown。异常返回继续包含精确随机用户/库及真实状态。正常归还、普通认证/用例失败且权限重新核实合法，仍可按原归属与线程合同删除本轮对象；没有把所有失败一概保留。

## 纯回归与旧缺陷保留

新增的 `c02-openssh-protocol.test.ts` 只替换ssh2协议端口，`c02-openssh-fixture.test.ts`只替换数据库及材料端口，执行正式helper、正式cleanup和实际权限判断；不生成材料、不读当前env、不建连。覆盖正确逐通道拒绝、错误原因/阶段/连接状态、版本策略前置，五类授权在初次/使用后/最终门出现的零DROP，失效不可复位、用例失败重核、正常删除、读取失败和未知CREATE。

旧28fd39c公开源码由Git固化到本员工ignored缓存 `.cache/c02-openssh-revision-28/subject`；员工2原 `independent-protocol.test.ts` 和 `independent-fixture.test.ts` 原样复制保留，10项旧缺陷/控制回放继续复现原行为。这些“通过”表示旧问题可复现，不是验收通过；新断言针对修正后的源码另立，未改写旧探针预期。

本轮仅运行上述纯端口、策略/旧纯回归、Python假命令/文件端口、类型和默认跳过/列表检查。显式跳过原内存密钥格式例，未运行磁盘材料例，避免在本任务产生身份材料。所有事实报告和旧源码在ignored缓存，不进入产品或CI。最终实际通过数、固定提交和推送结果由交接报告列出。

本轮结果为134项Node纯检查通过，1项密钥格式检查按上述边界跳过；其中保留的旧缺陷探针10项、新协议12项、新清理20项，其余为相关策略/旧纯回归。Python7项通过，类型检查退出0；3个集成缺省跳过，4个正式UI仅收集、0执行。没有使用这些结果声明真实会话、Docker部署或完整清理已通过。
