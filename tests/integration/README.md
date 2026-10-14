# 数据库引擎真实验收

本目录只连接显式提供的远程专用测试实例，不自行启动 Docker，不使用业务数据库。所有测试库使用 `dbark_test_*` 随机名称，结束时删除。权限用例会创建并删除随机 `dbark_limit_*` 只读账号，需要实例管理员权限。

默认执行 `pnpm test:integration` 时跳过真实连接。设置以下环境变量后执行同一命令：

- `DBARK_INTEGRATION_ENABLED=1`
- `DBARK_TEST_HOST`、`DBARK_TEST_PORT`、`DBARK_TEST_USER`、`DBARK_TEST_PASSWORD`
- 可选 `DBARK_TEST_TLS=1` 和 `DBARK_TEST_CA`：开启 CA 和主机身份验证。`DBARK_TEST_WRONG_SAN_HOST` 用于可到达同一实例、但不在证书 SAN 中的地址，执行错误身份负例。
- 可选 `DBARK_TEST_SSH=1`、`DBARK_TEST_SSH_HOST`、`DBARK_TEST_SSH_PORT`、`DBARK_TEST_SSH_USER`、`DBARK_TEST_SSH_KEY`、`DBARK_TEST_SSH_FINGERPRINT`：通过 SSH 隧道运行核心套件。密钥路径指向本地保管文件，不能提交密钥本身。
- 可选 `DBARK_TEST_MILLION=1`：在 `engine-boundary.integration.test.ts` 启用百万行容量验收，默认跳过以免例行验证产生大文件。

`engine.integration.test.ts` 验证连接会话、数值/日期/二进制/JSON 精度、重复列、事务隔离、全旧值乐观锁、latin1 与宽松排序规则、取消后复用、CSV/JSON 往返、SQL `DELIMITER`/未闭合事务、执行计划边界和大字段限制。TLS/SSH 正负例按环境开关执行。

`engine-boundary.integration.test.ts` 验证只读账号拒绝写入、只中断测试会话时不重放写操作、SQL 结构和数据导出恢复、百万行服务端分页与流式导出及取消清理。此套件的管理员连接直连专用实例，SSH/TLS 完整流程由核心套件单独验收。

`engine-filter.integration.test.ts` 验证集合、区间、否定模式、全部/任一条件、SQL 模式及精确数值筛选；MariaDB 独立覆盖 38 位小数。`engine-edit-precision.integration.test.ts` 验证相邻 BIGINT 定位、目标已被删除及 DECIMAL 末位并发修改后整批回滚。`engine-schema.integration.test.ts` 验证普通字段变更保留索引和外键，以及同名外键分步修改的实际约束行为。本轮五个版本的结果见 [2026-10-14 记录](acceptance-20261014.md)，不能把数据库专属跳过算作通过。

百万行用例打印实际行数、末页大小、造数/分页/导出耗时、文件字节数及 RSS 采样峰值。内存上限是针对本用例的回归门槛，不代表所有操作系统或字段分布的性能承诺。测试产生的密码只保存在受忽略的本地环境文件中；日志和提交文件不得包含密码、私钥、业务数据。

索引差异的真实生产 API、特殊旧键与取消由 `engine-index-patches.integration.test.ts` 验证，权限夹具与字段套件共用；每轮随机 `dbark_idxpatch_*` 库，失败先保留自主定义证据再精确清理。适用条件、原始失败和各传输结果见 [索引验收](acceptance-o01-indexes-20261014.md)。未启用 My8 专属能力时明确跳过，不将其计为通过。

## mysql2 的 TLS 补丁

项目精确锁定 `mysql2@3.24.5`，通过 `pnpm-workspace.yaml` 的 `patchedDependencies` 应用 `patches/mysql2@3.24.5.patch`。该版本在 IP 地址连接时不发送 SNI，但遗漏向 Node TLS 传入真实 `host`，导致证书身份被错误地按 `localhost` 验证。补丁只补传 `host`，继续启用 `rejectUnauthorized` 与 `verifyIdentity`，在认证前拒绝不受信 CA 和 SAN 不匹配证书。升级驱动时必须复查补丁和这两个负例。
