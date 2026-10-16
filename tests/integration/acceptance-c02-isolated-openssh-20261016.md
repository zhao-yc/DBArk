# C02：隔离OpenSSH密码及加密私钥真实验收

2026-10-16，ROOT在实际核对的200上独立部署本轮OpenSSH服务，验证DBArk现有密码和加密私钥认证。没有修改宿主sshd、authorized_keys、既有Root密钥、生产网络或业务数据库；仅使用已授权隔离实例及随机`cp_`用户对单个`subject`表的SELECT。

## 固定来源与运行边界

测试固定头`3a450b938b1c8a56becee41c053cab9c7a67ccf4`，产品与`80b65746242190b9ca3ea22fdb2677c0a8046d0d`一致。固定Alpine3.23.6 amd64摘要、OpenSSH三个`10.2_p1-r0`包，实核`OpenSSH_10.2p1`及`MaxSessions 0`。本轮安装范围是[公开0.18 Windows x64](acceptance-v018-public-20261016.md)，不是新产品实现或Mac证明。

每条Docker命令前核实际`Server-200`、root、Linux x86_64、私网IP、机器摘要、实际Unix socket和daemon；Docker只使用该Unix地址、本轮空配置及PATH/LANG。容器仅绑定`192.168.31.200:22384`，只允许local TCP forward到13384/13484；shell/exec/SFTP、remote/unix forward、root登录等保持禁止。只读、drop ALL及三项必要cap、受限tmpfs和128MiB/0.5CPU/64PID、日志none均由实际inspect核对。

新生成独立SSH账号、host key、加密Ed25519 client key、密码和私钥口令；Windows新父目录及文件ACL只允许当前用户与SYSTEM。服务器仅接收manifest、host key和SSH密码，client key和私钥口令未传输。证明来自真实容器策略、完整ID、指纹及新nonce，有效期五分钟；客户端仍逐例校验，未用环境自述代替实际核对。

## 实际结果

| 端口 | 核心 | Windows公开安装正式UI |
| --- | --- | --- |
| 13384 MySQL8.4.11 | run844，2项通过 | run854，4项通过 |
| 13484 MySQL8.4.11严格TLS | run847，2项通过 | run857，4项通过 |

核心两项分别是password、encrypted-key：错误密码，错误/缺失key口令，正确认证但错误指纹，以及正确连接经真实ssh2/forwardOut访问subject。实际账号/库/marker/线程与独立观察相符；严格TLS有实际cipher断言。额外协议检查对非白名单direct-tcpip要求明确reason1，对固定版本MaxSessions0下的exec/SFTP要求session channel-open reason2，并确认同一已认证连接仍存活。超时或普通网络失败不能充当拒绝成功。

核心JSON报告保留完整两项实际通过及原退出，但该reporter未归档逐步骤console.info对象；不补造其具体cipher字符串、连接ID或逐认证资源名。上述结论来自固定正式用例的强制真实断言，不能把缺失日志字段写成独立采集证据。

正式UI每端口均为两种认证×两种保存选择，0跳过、0重试。实际ConnectionDialog、原生文件选择授权、主进程/broker/utility和Monaco查询保留：错误秘密和指纹在相应真实阶段被拒绝；正确身份保存后查询成功。记住分支核SQLite无秘密明文、独立SSH/DB加密槽及原生safeStorage实际解密，真实退出/PID核零后重启不补填，再次查询并仅清SSH秘密、DB密码保持。仅会话分支核零持久秘密槽，真实重启不恢复。13484还经正式TLS页选择原CA并核实际加密查询。trace、截图、视频均off，未伪造系统加密能力或使用基本明文后端。

八份逐例`c02-isolated-openssh-facts.json`全部`completed=true`、`unverified`为空；分别记录端口/版本、认证模式、保存选择、容器归属、实际观察线程及DB夹具归还。没有用双端口重复执行增加独立功能身份数。

## 原失败与完整清理

原ff8569轮在apk3参数解析阶段失败，诊断确认`--no-upgrade`不支持；未到认证阶段。新3a仅删除无效参数，不请求升级、保留精确base和包版本，传递依赖仍由apk求解，不能声称全部依赖冻结。原失败轮已于run831/832精确归还。

新轮842在Windows PowerShell5模块自动加载的ACL只读预检退出，改为当前已可用的PowerShell7只读核对后继续。846及首个UI850因服务器时间尚晚于本机而被原freshness检查拒绝，未建DB夹具；实测领先约6秒。新UI入口只在最多30秒内等待本机时间自然到达，再执行原比较和有效期检查；不修改证明时间、系统时钟或正式断言。旧退出及失败报告保留。

所有客户端先关闭应用和已记录连接，再精确核用户ATTRIBUTE、表COMMENT、授权及唯一对象集合；未知CREATE、扩权或线程残留不自动删除。最终run858独立核六实例相关临时用户/库/线程均0；三次公开安装均真实卸载并核注册/进程0。run859按完整ID与labels精确删除容器、无额外引用的网络/镜像及新服务端材料；run860独立确认资源0、端口关闭可绑定，核实际路径/run/dev/ino和四文件摘要后删除服务器fixture。run861原材料删除门实际1项通过，逐文件删除客户端五材料及proof、目录和空父目录。

全部身份为一次性，无后续复用需求，原身份未动；没有保留密钥需要备份。Mac私网、其它数据库版本或SSH服务实现、系统加密不可用和额外认证方式仍待验。本记录没有把材料生成、构建、只读核对或清理操作计为认证/产品用例。
