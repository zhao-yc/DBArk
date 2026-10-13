# 2026-10-14 P0 SQL 文件与结果导出验收

## 当前状态

本批次用于 Q03 SQL 文件打开/另存、Q05 已返回结果导出。Windows 新增四项离线和三项 MySQL 8.4.11 实库桌面用例均已实际通过；完整回归与定向复验分开记录，不伪装单轮全绿。本记录独立于已结束并清理的 v0.2.0 验收；主分支新功能尚未发布。

## 功能验收结果

全量单元测试 20 文件、228 项，类型检查及构建通过。Windows 完整 source 首轮 17 项通过、事务项一次 DOM 等待失败、百万行旧用例明确跳过，耗时 100.771 秒。失败后截图中真实连接编号和事务状态正确；新增内容等待后事务项单独 1/1 通过，耗时 4.910 秒，仍核对同一连接、观察连接零可见写入和最终回滚。运行时代码没有为测试修改；具体分批结果及初次测试输入错误见 [验证记录](../../docs/validation.md)。

已实际覆盖 SQL 文件三编码/BOM、新独立标签、另存取消、非法编码/大小、严格令牌与原文件保护；成功多结果和固定旧快照的 CSV/JSON 精确值/NULL/BLOB/Unicode、重复空名消歧；真实关闭连接后继续导出，不重新执行原 SQL，主键 INSERT 计数仍为一。压力查询在服务器生成 50000 行，字节预算下实际返回 44882 行；按真实进度取消结果导出，原目标保持且临时文件清理，截断结果只导出已返回部分。

测试结束本批 DBArk 进程、新临时目录及随机 `dbark_e2e_*` 库残留均为零。忽略证据为 `.cache/p0-files-validation.json`、`.cache/p0-files-full{.log,-results.json}`、`.cache/p0-files-transaction{.log,-results.json}`、`.cache/p0-files-process-cleanup.json` 和 `.cache/p0-files-database-cleanup.json`。截图已经查看，SQL 文件独立标签、结果列名预览和原事务保留布局正常。

本批未验证新安装包、macOS 实库或其它数据库版本，也未重跑旧百万行 UI/SSH/TLS 矩阵。原生文件选择返回路径用于自动化，不能等同于人工确认系统覆盖提示。完整 SQL 结果流式导出未实现；当前操作只写出已经返回的数据。

## 已核对环境

所有 Docker 命令执行前均核验 `server-200` 实际主机名为 `Server-200`、实际地址包含 `192.168.31.200`、`/var/run/docker.sock` 为 Unix socket，并显式使用 `docker --host unix:///var/run/docker.sock`。没有使用本机 Docker，没有操作业务容器。

创建前已确认 `13384` 无监听，目标容器和网络名称不存在。新建环境如下：

| 项目 | 实际值 |
| --- | --- |
| 容器 | `dbark-p0-files-mysql84-01a13412` |
| 容器 ID | `ee231e0a9a206ad6511a5cd33b0bd3272c778148bda64a2b452751dc5a134bc2` |
| 专用网络 | `dbark-p0-files-01a13412` |
| 网络 ID | `163062efbcfb7c69d3fe7de7b84857bbf64334acd66774487fd616f809ab42f6` |
| 项目标签 | `com.dbark.development=01a13412` |
| 批次标签 | `com.dbark.batch=p0-files-20261014` |
| 连接地址 | `192.168.31.200:13384` |
| 实际服务端版本 | `8.4.11` |
| 镜像 | 复用已缓存的 `mysql:8.4`，linux/amd64 |
| 缓存镜像 ID | `sha256:b3b90af2a6552ae30c266fdb7d5dd55f3afb72404bb78d37fe8a23eb857fd3fb` |
| 匿名数据卷 | `ef7091448896aeb41c72c531356b13a74d1c6d40ef1f2a63debcaf75036f209e` |
| 数据卷挂载 | `/var/lib/mysql` |

容器限制为 768 MiB 内存、1.5 CPU；实际检查 `innodb_buffer_pool_size=134217728`、`performance_schema=0`。本容器开启 `log_bin_trust_function_creators=1` 和 `event_scheduler=ON`，方便隔离验收创建函数及事件；这些参数没有修改业务数据库。

实际使用 mysql2 只读连接新实例并读取 `VERSION()` 和上述变量成功。就绪检查与创建记录分别位于本机 Git 忽略路径：

- `.cache/p0-files-environment-20261014.log`
- `.cache/p0-files-readiness-20261014.log`

## 凭据与后续验收

复用本机 `.cache/dbark-test.env`、`.cache/dbark-container.env` 中已按项目备份的隔离测试凭据，不在日志和仓库写入秘密。本轮未生成新的密钥或证书。服务器启动时临时接收的 env 和脚本已删除，临时目录 `/tmp/dbark-p0-files-01a13412` 已移除。本机受忽略的凭据和已有 E 盘备份继续保留。

后续测试须使用本批次隔离实例和随机测试库，避免与业务数据库或其他验收库混用。功能验收结果应在实际执行后追加，不能把此次连接成功视为功能通过。

## 清理状态

**本批次源码验收结束后，隔离容器、一个关联匿名卷和专用网络已于 2026-10-14 全部清理。** 每条 Docker 命令执行前均重新核验 `Server-200`、`192.168.31.200` 和实际 Unix socket，并检查精确名字及项目/批次双标签。

销毁前通过真实连接核对，所有 `dbark_*` 随机测试库和临时账号残留均为 **0**。随后定向删除 `dbark-p0-files-mysql84-01a13412`、inspect 关联且无其他容器引用的匿名卷 `ef7091448896aeb41c72c531356b13a74d1c6d40ef1f2a63debcaf75036f209e`，以及清空后的网络 `dbark-p0-files-01a13412`。

清理后本批次容器、关联卷、专用网络和 `13384` 监听残留均为 **0**。共享 `mysql:8.4` 镜像保留，镜像 ID 与创建前一致。其他业务容器的 ID、运行状态、PID、启动时间和健康状态在清理前后完全一致，原已退出的恢复容器保持原状态。没有改动旧批次验收记录。

本机被忽略的 env/TLS 文件及 E 盘备份继续保留；未生成新密钥。E 盘中文说明已追加本批次清理状态，保留材料只供将来重建隔离测试和追溯，不能用于生产。远端一次性清理脚本已移除。

本批次独立脱敏证据位于 Git 忽略路径 `.cache/p0-files-databases-cleanup.log`（销毁前随机库/账号零残留）和 `.cache/p0-files-resources-cleanup.log`（精确资源删除、业务状态对比及销毁后零残留），没有覆写历史证据。
