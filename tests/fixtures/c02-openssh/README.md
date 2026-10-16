# C02 隔离 OpenSSH 验收准备

这是交给 ROOT 审核的准备代码，所有真实入口缺省关闭。本次没有访问 200，没有执行 Docker、SSH、GUI、数据库写入或原生持久化验收；纯格式与策略检查不能证明 OpenSSH 互通。未修改产品代码、旧 SSH/mTLS 用例、版本或当前发行说明。

## 固定来源与尚未验证的部分

| 项目 | 选择及官方依据 |
| --- | --- |
| 基础镜像 | `alpine:3.23.6`，固定 amd64 manifest `sha256:1f3591b8a02ea153f41c5bba878ad477f63ab3d19349762cb77504db02a23e15`；[Docker 官方 repo-info](https://github.com/docker-library/repo-info/blob/master/repos/alpine/remote/3.23.6.md)。这不是多架构 index 摘要。 |
| OpenSSH | Alpine v3.23/main/x86_64 的 `openssh-server`、`openssh-keygen`、`openssh-server-common` 固定 `10.2_p1-r0`，使用 `--no-upgrade`；[官方 server 包页](https://pkgs.alpinelinux.org/package/v3.23/main/x86_64/openssh-server)、[官方 keygen 包页](https://pkgs.alpinelinux.org/package/v3.23/main/x86_64/openssh-keygen)。 |
| 客户端格式 | 当前锁定依赖 `ssh2@1.17.0`；[该版本官方说明](https://github.com/mscdex/ssh2/blob/v1.17.0/README.md)。新 Ed25519 client key 使用现代 OpenSSH 容器、`aes256-ctr`、bcrypt 16 轮；正确、错误及缺失口令在本机真实解析。 |
| 转发与会话策略 | [OpenSSH 官方 sshd_config 手册](https://man.openbsd.org/sshd_config)解释 `PermitOpen`、`AllowTcpForwarding` 和 `MaxSessions 0`；后者保留转发并禁止 shell/login/subsystem。 |

Dockerfile 固定基础摘要和 OpenSSH 包版本，并在镜像内记录 `packages.lock`。尚未真实构建，因此不声称仓库仍可安装、依赖完整可重现、容器可启动或 `chpasswd -c sha512` 已通过目标环境检查。依赖不可满足时应失败，不能改用浮动包或其它镜像继续。200 必须实测为 Linux x86_64；其它架构不在此准备范围内。

## 范围与权限

- 只在 ROOT 核对的 `192.168.31.200` 创建本轮 `dbark-c02-ssh-<run>` 容器、网络和镜像，宿主 SSH 端口显式选在 20000–29999；没有默认值。测试中的 `22384` 未在 200 核空闲，不能直接当已获准端口。
- 宿主发布只绑定 `192.168.31.200:<专用端口>`；容器内监听 2222。只允许 local TCP forward 到 `192.168.31.200:13384` 和 `:13484`，禁止远程监听、Unix socket 转发、shell/exec/SFTP、agent、X11、TTY、tunnel、user RC、用户环境和 root 登录。
- 随机新账号 `c02_<run前12位>`，新 host key、新 client key、新 SSH 密码与独立私钥口令。只写容器 `/etc` 和 `/run` tmpfs，不改宿主 `sshd`、`authorized_keys`、既有 Root 身份或凭据。
- 容器只读、非特权，drop ALL 后仅加 SETUID/SETGID/SYS_CHROOT，启用 no-new-privileges；64 PID、128 MiB、0.5 CPU；日志驱动 none。只读挂载本轮 `host.key` 和 `ssh-password`，不挂载 Docker socket或宿主 SSH 目录。
- Docker 为本轮独立 bridge/publish 添加其必要网络规则；脚本没有生产网络接入、host network、NET_ADMIN、手改 iptables/防火墙或清理共享 base 的操作。网络不通应保留现场，由 ROOT 判断，不扩大白名单绕过。
- DB 只允许两个指定 MySQL 8.4 实例，先核真实 UUID、版本、强制角色为空及管理者既有直接 PROCESS 权限，不增管理授权。每例随机 `cp_` 用户、`dbark_colperm_` 库和单表 `subject`，仅授予该表 SELECT；13484 强制严格 TLS 和 REQUIRE SSL。

## 材料与身份核对

客户端新材料目录必须为规范绝对路径 `dbark-c02-openssh-<32位run>`，拒绝 `.ssh`、链接和同名覆盖。五个新文件为 `manifest.json`、`host.key`、`client.key`、`ssh-password`、`key-passphrase`；ROOT 核对记录另写 `server-proof.json`。密钥和秘密不得放入参数、日志、工单、Git 或明文数据库。

POSIX 检查当前用户、0700 目录及无组/其他权限的普通文件；Windows 的 Node mode 不等于 ACL 证明，ROOT 必须先核实新临时父目录的独占 ACL。本次本机格式检查生成的材料已逐文件删除，不代表真实身份的保管验收。

ROOT 后续只向 200 的 `/tmp/dbark-c02-openssh-<run>` 复制 **manifest.json、host.key、ssh-password**；目录 ROOT:0700、文件 ROOT:0600。不得向服务器复制 client.key 或 key-passphrase。传输方式由 ROOT 单独审核，本代码不读取已有 Root key、不实现传输、不自动操作远端。

ROOT 需要先从实际 200 取得 hostname、`SHA256(/etc/machine-id 去首尾空白)`、实际 `/var/run/docker.sock` 的 `st_dev:st_ino`、Docker daemon ID，以及两个实例 UUID；不能从旧笔记或环境自述替代。初次取 daemon ID 前也必须核对实际宿主和 Unix socket。之后 server.py 每条 Docker 命令均再次核对宿主、材料和 socket，显式使用该 Unix socket及本轮空 Docker 配置；子进程只继承 PATH、LANG。

`verify` 从实际 inspect 检查完整容器 ID、image ID、purpose/run/config labels、私网端口、挂载、能力、日志、资源和独占网络，再读取实际 `sshd -T`、`sshd -V` 及新 host key 指纹，写出 ROOT 核对记录。客户端要求记录中实际 `openSshVersion=OpenSSH_10.2p1`、`maxSessions=0`，以及 ROOT nonce、宿主、daemon、socket、run、端口和指纹全部匹配且不超过五分钟；旧版缺字段 proof 必须重新 verify，不能客户端补填。它不冒充客户端直接检查了 Docker。

## 默认关闭与参数

参数名见 [parameters.example.txt](parameters.example.txt)，仅是无秘密模板，不会被代码自动加载，也不应保存实际密码。所有配置只接收本片明确环境变量，不回退通用 `.env`、旧 SSH/mTLS 或 Root 身份。

| 入口 | 必须同时开启 | 额外限制 |
| --- | --- | --- |
| 新材料 create/remove | `DBARK_INTEGRATION_ENABLED=1`、`DBARK_C02_OPENSSH_MATERIALS_ENABLED=1` | ROOT_CONFIRM；remove 另需本轮 run 和 `server-and-clients-closed/<run>` |
| 200 up/verify/down | 全局门、`DBARK_C02_OPENSSH_SERVER_ENABLED=1` | ROOT_CONFIRM；实际 Linux root/x86_64；宿主/socket/daemon核对 |
| 核心验收 | 全局门、`DBARK_C02_OPENSSH_CORE_ENABLED=1` | 新材料、ROOT 新鲜核对记录、实例参数 |
| 正式 UI 验收 | 全局门、`DBARK_C02_OPENSSH_UI_ENABLED=1` | 同上；实际 trace/screenshot/video 均 off，拒绝 CLI 覆写采集 |

任一专项门不顺带开启其它入口。ROOT_CONFIRM 固定为 `server-200/192.168.31.200/isolated-openssh`，它只是明确范围标记，不代替实机核对。材料、管理密码及真实身份参数应仅在 ROOT 指定的非日志化当前进程中注入；不得把含秘密的命令行写进历史。

## ROOT 后续审核运行顺序

以下是未来操作入口说明，本轮没有执行这些真实操作。

1. 核对实际宿主/架构/socket/daemon、两个实例 UUID、TLS CA、候选 SSH 端口空闲及客户端目录权限。ROOT 决定允许的资源后，独立开启 MATERIALS create，提供 `NEW_PARENT` 和 `NEW_PORT`，用 `vitest.integration.config.ts` 单独运行 `tests/integration/c02-openssh-materials.prepare.test.ts`；输出只有路径、run、临时用户名、端口和指纹。
2. 用审核过的方式仅复制三个服务器文件，关闭 MATERIALS 门。在实际 200 的源码目录，ROOT 提供下面变量并开启 SERVER 门。`c02_directory`、`c02_hostname`、`c02_machine_hash`、`c02_socket_id`、`c02_daemon_id` 必须是本轮已核对的真实值，无默认值：

   ```sh
   python3 tests/fixtures/c02-openssh/server.py up --directory "$c02_directory" --hostname "$c02_hostname" --machine-hash "$c02_machine_hash" --socket "$c02_socket_id" --daemon "$c02_daemon_id"
   python3 tests/fixtures/c02-openssh/server.py verify --directory "$c02_directory" --hostname "$c02_hostname" --machine-hash "$c02_machine_hash" --socket "$c02_socket_id" --daemon "$c02_daemon_id" --nonce "$c02_nonce"
   ```

3. 把新 proof 以客户端独占权限放入该轮客户端材料目录，明确注入 PROOF_PATH/NONCE 和相同宿主身份。每轮即将过期时先重新 verify、再复制 proof；不能修改时间戳绕过。DB_HOST 固定 200；先选择13384及其 UUID，再选择13484、对应 UUID和严格 TLS_CA_PATH。管理者凭据仅在 Node 测试进程中，C02Desktop 仍使用自身环境白名单。
4. 只开 CORE 门运行 `tests/integration/c02-openssh.integration.test.ts`。每个端口两种认证均须执行：错密码；加密 key 的错/缺口令；正确认证的错指纹；真实产品 Engine/ssh2 forwardOut 的 SELECT、账号/库/marker/线程核对、13484 实际 cipher。另以真实协议检查非白名单 loopback 的 direct-tcpip 明确 reason=1；固定 OpenSSH10.2p1/MaxSessions=0 的 exec/SFTP 必须在 session 开通道阶段返回 reason=2。二者均要求 ssh2 的 CHANNEL_OPEN_FAILURE 错误形状、同一已认证连接仍存活且无传输错误；普通网络/exec/subsystem错误、任意 reason=2 或超时都不能充当通过。源码依据及修正证据见[28fd39c 后续修正](revision-28fd39c.md)。
5. 先使用项目既有构建命令生成当前实际应用，再只开 UI 门，运行：

   ```sh
   node node_modules/@playwright/test/cli.js test tests/e2e/c02-openssh-live.spec.ts --workers=1 --trace off
   ```

   四例是两种认证 × 原生持久化/仅会话。实际 ConnectionDialog、文件选择授权、Monaco、broker/utility及新测试 userData 均保留真实路径。持久化例必须实读系统安全后端、SQLite 无秘密明文、独立加密槽和真实 safeStorage 解密；真实退出并检查所有 PID 后重开同目录，不补填，实际测试连接及查询成功，再仅清 SSH 秘密并验证 DB 密码仍保留。Linux basic_text/未知后端计为持久恢复未验。仅会话例则验证未勾保存、SQLite 零秘密槽和重启不恢复。不得开启 CLI debug、trace、截图或视频收集秘密。
6. 每例先严格关闭应用/utility，观察随机用户及已记录连接 ID 清零，再凭用户 ATTRIBUTE、表 COMMENT 和唯一对象集合精确 DROP，最后独立观察旧管理/应用连接 ID。授权检查一旦观察到异常或读取失败，就永久失效并在公共删除门阻止用户和库的全部 DROP；即使用例先失败，也须在删除门重核权限。普通认证/用例失败且范围重新核实合法，仍可精确归还。CREATE 结果未知、额外对象、归属不符或线程未清零均保留，报告精确随机用户/库、真实 CREATE 状态及授权失效状态；不重试写操作。测试只证明 DB 夹具归还，事实文件明确服务器及新密钥尚待 ROOT 清理。
7. **所有核心/UI 客户端结束后**，ROOT 在原 200 用相同身份参数运行 `server.py down`。只按 runtime 的完整 ID 和实际归属删除本轮容器、无其它引用的网络/镜像，再核路径、run、dev/ino、白名单及无链接后清理精确服务器材料目录。分步失败保留现场；未知 CREATE 或部分 down 不按名字/通配接管，由 ROOT 对照 runtime 人工核对。
8. 确认服务器和客户端均结束后，只开启 MATERIALS remove，提供本轮 CLIENT_DIR、REMOVE_RUN 和 CLEANUP_CONFIRM，逐文件清除客户端五文件及可选同轮 proof，然后 rmdir。额外文件、其它 run 或对象替换均拒绝删除。一次性材料无后续复用需求；ROOT 如决定跨轮留存，应按用户要求另备份到 `E:\BaiduSyncdisk\codex重要文件备份\DBArk` 并附中文用途/保管/清理说明，不能把秘密写入说明。

## 本轮验证边界

本机只运行 TypeScript 检查、Node 策略与真实临时 key 格式/精确删除检查、Python 内存策略、Bash `-n`、默认跳过集成及 Playwright `--list`。不启动容器、不开远端连接、不运行 GUI、不更改 CI。ROOT 应在真正执行后另记服务器身份、镜像/包实际版本、每个端口/认证/平台结果和精确清理结果；本准备不提升 C02 实测覆盖或平台验收结论。

2026-10-16 本轮结果：118 项 Node 纯检查、6 项 Python 内存检查、`tsc --noEmit`、`bash --noprofile --norc -n entrypoint.sh` 通过；3 个新集成用例缺省跳过。全局/UI专项门的 00/01/10/11 四种组合均仅 `--list` 收集 4 例，实际运行 0 例。自有临时 key 的磁盘读写、拒绝覆盖、拒绝额外内容/其它 run 和逐文件删除已检查，测试目录剩余 0 项。Bash 在沙箱内初始化失败后，只把 `-n` 语法检查移至沙箱外完成，没有执行脚本内容。位于 `.cache` 的本员工普通克隆使用临时 Vitest include/exclude 配置，避免框架默认排除缓存路径；该配置和报告均不提交。
