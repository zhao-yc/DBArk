# 2026-10-14 高频筛选与结构差异验收

本记录对应首版之后的高频操作增量，实际执行跨越北京时间 2026-10-13 深夜至 2026-10-14。记录工作区源码的验证结果；桌面安装包、发布版本及 UI 综合结果由对应发布记录单独确认。

## 范围与结果

本轮增加集合、区间、否定模式和全部/任一满足筛选，修复精确数值筛选的类型转换，并修复修改已有表时重建同名外键失败的问题。没有更改原数据编辑的预处理 SQL；下列真实回归证明其数值定位和并发检测在五个基线上均正常。

| 实际服务端版本 | 集合/区间/组合筛选 | 精确编辑定位 | 已有表结构差异 | 本轮新增通过数 |
| --- | ---: | ---: | ---: | ---: |
| MySQL 5.7.44 | 7 | 5 | 2 | 14 |
| MySQL 8.0.46 | 7 | 5 | 2 | 14 |
| MySQL 8.4.11 | 7 | 5 | 2 | 14 |
| MariaDB 10.11.19-MariaDB-ubu2204 | 8 | 5 | 2 | 15 |
| MariaDB 11.4.13-MariaDB-ubu2404 | 8 | 5 | 2 | 15 |

五版本新增实测共 **72 项通过**。MySQL 的筛选套件各另跳过 1 项 MariaDB 专属 `DECIMAL(65,38)` 用例；这项在两个 MariaDB 基线上都实际通过。

另外在 MySQL 8.4.11 重跑原核心 13 项及权限/断线/SQL 恢复边界 3 项，全部通过。因此该版本本轮共通过 30 项引擎实测，五版本本轮合计 88 项通过。SSH/TLS 和百万行引擎导出未在本轮重复，不能将前次结果计入本轮通过数；前次证据见 `acceptance-20261013.md`。本轮桌面百万行与对象流程由独立 Electron 验收覆盖。

源码静态与单元验证快照：`pnpm test` 共 15 个文件、176 项通过；其中 `engine-*.test.ts` 共 5 个文件、82 项。`pnpm exec tsc --noEmit` 通过。

## 真实覆盖内容

`engine-filter.integration.test.ts` 经真实 `Engine.table.page` 验证：

- IN、NOT IN、BETWEEN、NOT LIKE，以及 AND/OR 组合；NULL 分支不携带 `value`，NOT IN 保持 SQL 三值逻辑，需包含 NULL 时用任一满足组合 `IS NULL`。
- 空字符串、字面量 `NULL`、原始空白与逗号、Unicode 和补充字符、引号、反斜线及注入样式文本始终按值处理。测试夹具只为新建的真实连接设置会话 `sql_mode`，分别执行空模式和 `NO_BACKSLASH_ESCAPES`，不改共享实例的全局模式。
- 相邻 BIGINT `9007199254740992` / `9007199254740993`、无符号上限 `18446744073709551615`、`DECIMAL(40,18)` 相邻末位；两个 MariaDB 版本另验证 `DECIMAL(65,38)` 相邻末位。
- 非唯一列排序追加可靠行键，连续跳页的行集合及 `hasMore` 正确；空集合、不完整 BETWEEN 和未知列明确拒绝，原表内容无副作用。

`engine-edit-precision.integration.test.ts` 使用实际分页旧行和真实预处理提交：

- 两个相邻 BIGINT 都存在时，UPDATE / DELETE 只操作指定行。
- 目标大整数行被另一会话删除后，UPDATE / DELETE 均拒绝误中相邻主键，并回滚同批此前的修改。
- 非键 DECIMAL 的最后一位被另一会话修改后，乐观锁拒绝覆盖且保留对方的新值。

`engine-schema.integration.test.ts` 经真实元数据、结构预览和执行验证：

- 含自增主键、唯一索引和外键的表，普通列改名/扩容、增加默认值列后，原值保留，索引和外键继续拦截重复值及无父行写入。
- 同名外键从 CASCADE 改为 RESTRICT 时，预览明确显示两条 ALTER 和风险，执行后服务端实际按 RESTRICT 拒绝删除父行。

## 关键实现边界

筛选形状在 UI、IPC 和引擎共享校验：最多 30 条条件，每个 IN/NOT IN 集合 1～200 项，BETWEEN 恰好 2 项，每项最多 4096 个 UTF-16 代码单元，全组合计最多 1000 项、1,000,000 个 UTF-16 代码单元。不裁剪空白或按逗号拆值；`['']` 是合法的空字符串集合，`[]` 不是合法集合。标量、集合和 NULL 判断不能混用参数形状。

元数据提供列白名单，操作符来自固定集合，条件及整组均加括号。精确数值比较参数生成 `CAST(? AS DECIMAL(65,s))`，其中 `s` 从原始十进制字符串确定，参数全程不经 JavaScript Number。真实只读验证曾确认 MySQL 8.4 将数值与字符串比较时可能降为 DOUBLE，导致相邻大整数相等；显式 CAST 后不再合并。普通十进制最多 65 位有效数字，小数尺度默认最多 30；元数据明确声明更高尺度的 MariaDB 列按其声明允许到 38。科学计数法、其他文本或超范围值明确拒绝，避免静默舍入。LIKE / NOT LIKE 保持服务器模式匹配语义。

分页仍为服务端 `LIMIT pageSize + 1 OFFSET ...`，页大小最多 1000，页号最多 10,000,000。显式排序后追加未出现的可靠主键/唯一键以稳定并列顺序；没有可靠行键的表不能保证并列项跨页稳定，数据在翻页间变化也不构成快照读取。本次未改变原结果字节预算及大字段拒绝编辑保护。

结构差异保留未变化的索引和外键。MySQL 不允许在同一 ALTER 内删除并添加同名外键；确需修改同名外键时预览先删除该外键，再执行主体 ALTER。两条 DDL 不原子，第二条失败或取消时旧外键可能已删除；预览明确提示恢复原定义及执行期间暂停相关写入。没有静默改约束名称，也没有关闭 `FOREIGN_KEY_CHECKS`。字段级完整差异及未建模属性保留仍属于后续结构可靠性工作，本轮没有将复杂结构编辑泛化为全部支持。

## 执行方式与镜像来源

真实测试通过被 Git 忽略的本机环境文件加载隔离凭据，不打印秘密。以目标端口覆盖 `DBARK_TEST_PORT` 后执行：

```powershell
node --env-file=.cache/dbark-test.env node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts tests/integration/engine-filter.integration.test.ts tests/integration/engine-edit-precision.integration.test.ts tests/integration/engine-schema.integration.test.ts
```

数据库均位于用户指定的 `server-200`。每条 Docker 命令前均校验实际主机 `Server-200` 和地址 `192.168.31.200`，并固定使用 `unix:///var/run/docker.sock`。本机没有执行 Docker。

MySQL 8.4 复用服务器已有官方镜像；MariaDB 11.4 从官方标签下载，仓库摘要 `sha256:1292844148b311e4ed4300022a996d39083f415a963e970cf47cad1b3b18e3a6`，实际平台为 linux/amd64。其余三个镜像因服务器代理失败而由本机使用已校验发行摘要的 crane 下载官方 linux/amd64 镜像文件，再上传到 200 导入；本机只处理镜像文件。

| 镜像 | 官方 linux/amd64 manifest | 上传 tar SHA256 | 官方 config SHA256 |
| --- | --- | --- | --- |
| MySQL 5.7 | `dab0a802b44617303694fb17d166501de279c3031ddeb28c56ecf7fcab5ef0da` | `e2542be5442243185ff8d0316a6bcf27d888ed20f36f70aa8e919171c4a7f410` | `5107333e08a87b836d48ff7528b1e84b9c86781cc9f1748bbc1b8c42a870d933` |
| MySQL 8.0 | `62fb722c78b24245ddff1796a0fcee4a49cc5b87e0aaaf20c92d1da9e0a2497b` | `4f84b0a464135b6e4d389b1de05b536f6cea7c0f097baa9206a039e2682a8433` | `6cd09145362dfe6831b14545de3d5fd6cc75c37cfd6ef8561429c1fc73518b39` |
| MariaDB 10.11 | `dc9dd57be7f46ad6f350c598a331d64f295899c4abac3ec5652eff831fc38a6c` | `a2775624cb7b77b091f34f87a9736b87e57b30e2a858602e9f4d89eb726bb2e7` | `41096ae9913468679bb5e05bbc19f44edcaf0eae45d67fcde224ffdeda9d3a1f` |

远端先核对上传文件和 config 摘要，仅将归档 RepoTags 改为项目专用名称；MySQL 8.0 的 11 层、MariaDB 10.11 的 8 层还逐个复核改写前后字节摘要一致。导入后通过 `docker image save` 再次核对实际 config 原始字节，避免将新版 Docker 的镜像 ID 误当为 config 摘要。没有覆盖业务镜像标签。

## 资源与清理状态

公开 v0.2.0 Windows 安装包完成 12/12 项实库桌面验收并卸载后，以下五个隔离容器已于 2026-10-14 全部定向删除。它们原使用 `com.dbark.development=01a13412` 标签和 `dbark-development-01a13412` 专用网络；下表保留用于追溯。

| 容器 | 测试端口 | 镜像 |
| --- | ---: | --- |
| `dbark-development-mysql57-01a13412` | 13357 | `dbark-development-mysql57:01a13412` |
| `dbark-development-mysql80-01a13412` | 13380 | `dbark-development-mysql80:01a13412` |
| `dbark-development-mysql84-01a13412` | 13384 | `mysql:8.4` |
| `dbark-development-maria1011-01a13412` | 13310 | `dbark-development-maria1011:01a13412` |
| `dbark-development-maria114-01a13412` | 13311 | `mariadb:11.4` |

每个容器原限制 768 MiB 内存、1.5 CPU、128 MiB InnoDB buffer pool，并关闭 performance schema。销毁前只读核对五个实例的 `dbark_test_*` / `dbark_e2e_*` 随机库和 `dbark_limit_*` 临时只读账号，残留均为 **0**。

清理逐条核对实际主机、IP 和 Unix socket，并检查精确容器名、项目标签及网络成员。通过 inspect 找到五个关联匿名数据卷，确认无业务容器引用后删除；五个容器、五个匿名卷及专用网络全部移除。三个项目专用镜像标签 `dbark-development-mysql57:01a13412`、`dbark-development-mysql80:01a13412`、`dbark-development-maria1011:01a13412` 经引用检查后删除。共享 `mysql:8.4` 镜像保留，`mariadb:11.4` 作为缓存保留。

再次核对，本轮项目容器、关联卷、带该标签的网络以及五个测试端口残留均为 **0**。业务容器的 ID、运行状态、PID、启动时间和健康状态在清理前后完全一致；运行中的数据库、Redis 与存储服务仍为 healthy，原先已退出的恢复容器保持原状态。

远端上传的三个镜像包、临时凭据及启动脚本目录均已删除。本轮复用已按项目备份的随机测试凭据，没有产生新的需保留密钥或证书。本机被忽略的 env/TLS 材料及 E 盘备份继续保留，仅用于将来重建隔离测试和追溯；已有证书和私钥不得用于生产。备份中文用途说明已补记本轮清理状态。

不含秘密的本机清理证据位于 Git 忽略路径 `.cache/development-cleanup-20261014-databases.log`（销毁前五实例零残留检查）和 `.cache/development-cleanup-20261014.log`（删除资源清单、业务状态对比及销毁后零残留检查）。本轮服务器临时测试资源已全部清理完成。
