# 0.19候选：旧引擎现有整数自增列上调

本候选从冻结的 `80b65746242190b9ca3ea22fdb2677c0a8046d0d` 建立普通分支，不合入ROOT、不改全局版本或发行说明。0.18的核心/UI用例、旧版本只读通过记录和发行验收文件保持原字节。本轮仅完成官方资料、代码、纯回归、类型、构建及列表检查；没有连接200、运行GUI、重启服务器或新增凭据。纯驱动替身不能证明真实目录新鲜度或重启行为。

## 官方依据与实现边界

| 事实 | 官方主来源 | 对本候选的约束 |
| --- | --- | --- |
| MySQL5.7计数仅保存在内存；重启会撤销仅由CREATE/ALTER指定的计数效果。首次状态读取可初始化计数并取得锁。 | [Oracle归档5.7自增处理](https://docs.oracle.com/cd/E17952_01/mysql-5.7-en/innodb-auto-increment-handling.html) | 5.7.44增加明确告知和第四项重启确认；不能承诺跨重启保留。客户端不发MAX，服务器内部初始化仍可能扫描已有记录。 |
| 5.7的TABLES.AUTO_INCREMENT为下一计数，目录查询和SHOW TABLE STATUS存在对应关系。 | [Oracle归档5.7 TABLES](https://docs.oracle.com/cd/E17952_01/mysql-5.7-en/information-schema-tables-table.html) | 原生SHOW前后夹住完整定义和目录读取，三处计数逐字一致才继续；不对5.7发送MySQL8统计缓存变量。 |
| MySQL8目录统计可缓存，information_schema_stats_expiry=0可直接读取。 | [MySQL8 TABLES](https://dev.mysql.com/doc/refman/8.0/en/information-schema-tables-table.html) | 保留8.0.30及以上8.0版本/8.4原守卫、独立会话SET及回读0；不以旧引擎兼容为由跳过原检查。 |
| MariaDB InnoDB计数持久化，但非事务性；失败插入、回滚和恢复可能影响观察。 | [MariaDB InnoDB自增](https://mariadb.com/docs/server/server-usage/storage-engines/innodb/auto_increment-handling-in-innodb) | 说明持久化与当前观察区别；不承诺下一次插入值或重启后精确值，不以纯测试宣称重启验收通过。 |
| MariaDB10.11/11.4的SHOW/TABLES填充调用引擎HA_STATUS_AUTO；InnoDB读取受互斥保护的当前自增计数。 | [10.11.19 sql_show.cc](https://github.com/MariaDB/server/blob/mariadb-10.11.19/sql/sql_show.cc#L5398)、[10.11.19 handler](https://github.com/MariaDB/server/blob/mariadb-10.11.19/storage/innobase/handler/ha_innodb.cc#L14113)、[11.4.13 sql_show.cc](https://github.com/MariaDB/server/blob/mariadb-11.4.13/sql/sql_show.cc#L5530)、[11.4.13 handler](https://github.com/MariaDB/server/blob/mariadb-11.4.13/storage/innobase/handler/ha_innodb.cc#L14134) | 依据目标版本官方源码推断原生状态读取路径，辅以前后夹读；这仍需ROOT在实际目录核对，不是实测证明。先限精确10.11.19/11.4.13，不默许其他补丁版本。 |
| MariaDB没有super_read_only；有自己的压缩表只读开关。 | [10.11变量差异](https://mariadb.com/docs/release-notes/community-server/about/compatibility-and-differences/system-variable-differences-between-mariadb-and-mysql/system-variable-differences-between-mariadb-10-11-and-mysql-8-0)、[11.4变量差异](https://mariadb.com/docs/release-notes/community-server/about/compatibility-and-differences/system-variable-differences-between-mariadb-and-mysql/system-variable-differences-between-mariadb-11-4-and-mysql-8-0)、[InnoDB变量](https://mariadb.com/docs/server/server-usage/storage-engines/innodb/innodb-system-variables) | MariaDB不查询或伪造superReadOnly；要求实际compressedReadOnly为0，保守拒绝该开关启用的实例。所有模式字段必须唯一、完整且为字符串。 |
| Galera只关闭会话wsrep不能阻止其他节点的更新；全局关闭才阻止加入集群。 | [MariaDB wsrep_on](https://mariadb.com/docs/galera-cluster/reference/galera-cluster-system-variables#wsrep_on) | MariaDB同时要求全局/会话wsrep_on为0；缺变量或启用时只读，不自动改配置。 |
| MySQL5.7存在read_only与super_read_only；开启时限制不同权限用户的写入。 | [Oracle归档5.7系统变量](https://docs.oracle.com/cd/E17952_01/mysql-5.7-en/server-system-variables.html#sysvar_super_read_only) | 5.7沿用两个实际只读变量，并要求InnoDB只读/强制恢复为0。不能因为当前账号可绕过只读就放行。 |

Oracle归档用于5.7事实；当前dev.mysql.com旧版本URL可能重定向到新版，不能把重定向后的内容当5.7依据。上表的变量默认值均不是放行依据，必须读取运行时实际值。

## 代码与安全边界

- 新能力选择器区分MySQL8缓存回读和三个旧引擎原生状态分支；MariaDB仅去掉已知`5.5.5-`兼容前缀。5.7先限5.7.44，未知版本、方言错配和其他补丁继续只读。
- 旧分支依次执行精确目标的SHOW TABLE STATUS、现有完整结构/目录读取、再次SHOW TABLE STATUS。Name、InnoDB、唯一行、规范正十进制字符串均须成立，且与SHOW CREATE和目录相同。mysql2生产连接已有supportBigNumbers/bigNumberStrings；若真实驱动仍返回Number，即使小数值也不转换，保留只读原因。
- 保持现有列、整数类型上限、完整定义、原生TABLE_ID、服务器身份、连接修订、同表租约、实际直接ALTER权限和模式复核。只生成单条表级ALTER，不新增列，不发MAX、ANALYZE、FLUSH、全局SET或权限变更。
- 前后观察一致不阻止最后一次读取之后的外部DML/DDL。仍要求维护窗口暂停写入；计数或模式变化使旧令牌失效，失败也消费令牌。
- MySQL8仍需原来的三项确认；5.7增加`restart-volatile`，服务端按固定快照要求全部四项。IPC仅扩展一个已知确认，执行时不允许向MySQL8夹带第四项。MariaDB缺失superReadOnly字段表示该变量不适用，绝非已读为0。
- 结果保留“实际发送”“收到DDL完成响应”“结构核验”“目录计数吻合/不同/未知”的独立事实。OK、取消、断线或较大的观测都不自动视为成功，不重放。
- 不新增持久化身份或保存SHOW GRANTS原文；目录权限不足、直接ALTER权限不能证明、压缩表只读/恢复/Galera或未知模式均只读，不提权、不展开角色、不删除既有reasons。

## 新验收入口与端口期望

新入口只接受同时设置 `DBARK_INTEGRATION_ENABLED=1` 和 `DBARK_TABLE_AUTO_INCREMENT_LEGACY_019_TEST=1`。不复用旧0.18自增开关，不读取.env，不新建账号。正式UI使用独立显式环境帮助文件，真实连接表单/IPC/产品Engine均保留；仅原生确认框和CA文件选择回答沿用既有测试方法。UI文件默认关闭trace，并在读取连接参数前检查实际trace选项；ROOT实跑也须保持`--trace=off`。

| 端口 | 实际版本期望 | writablePort含义 |
| --- | --- | --- |
| 13357 | MySQL5.7.44 | 候选写入，必须四项确认；不验证重启保持 |
| 13310 | MariaDB10.11.19 | 候选写入，必须实际模式/原生字符串读取成立 |
| 13311 | MariaDB11.4.13 | 同上 |
| 13380 | MySQL8.0.30及以上8.0版本 | 原MySQL8写入守卫的回归 |
| 13384 | MySQL8.4 | 原MySQL8写入守卫的回归 |
| 13484 | MySQL8.4，严格TLS | 必须同一显式CA和证书/主机校验，不降级 |

这六个端口来自ROOT已有隔离实例清单；端口只用于验收预期，不能证明能力。建库前必须将实际方言/版本与端口再次匹配，生产放行不依赖端口号。范围仍仅200的既有六实例。

- 核心新文件：`tests/integration/engine-table-auto-increment-legacy-019.integration.test.ts`，6项声明，包含真实原生计数类型/变量核对、大数单ALTER、无自增/整数上限、DML/修订冲突、同定义物理重建、实际唯一MDL等待再取消。finally/afterAll只清本轮UUID隔离库，并验证目录和本任务线程归零。
- 正式UI新文件：`tests/e2e/table-auto-increment-legacy-019.spec.ts`，3项声明，覆盖两个入口、只读SQL预览、大数一次执行、无自增只读、非规范/降低计数及返回编辑。5.7第四项未勾选时必须禁用执行。
- 本员工仅做关闭开关的list，不实际执行这些新入口。ROOT后续仅运行新文件，避免把0.18旧只读用例套用到0.19新能力；原0.18通过记录不重写。

## 本轮验证与ROOT待实测

本地证据位于 `.cache/auto-increment-legacy-019-20261016`，交付时由`verification.json`记录固定候选、文件摘要、纯测试、构建及列表结果。实际调用本仓库已有node_modules中的工具，未安装或升级依赖：

本轮最终相关纯回归为18个文件315项通过、0失败、0跳过；类型检查退出0，构建退出0（34.13秒，保留既有注释标记/大块提示）。清除DBARK环境后的核心list退出0、活跃项0，核心源码声明6项；正式UI list退出0、发现3项。7份冻结文件与80逐字相同，MySQL8原模式查询逐字相同。

```powershell
node node_modules/vitest/vitest.mjs run <本轮相关纯单元文件> --reporter=json --outputFile=.cache/auto-increment-legacy-019-20261016/related-results.json
node node_modules/typescript/bin/tsc --noEmit
node scripts/build.mjs
node node_modules/vitest/vitest.mjs list --config vitest.integration.config.ts tests/integration/engine-table-auto-increment-legacy-019.integration.test.ts --json
node node_modules/@playwright/test/cli.js test tests/e2e/table-auto-increment-legacy-019.spec.ts --list
```

列表子进程清除全部DBARK环境字段，不访问目标、CA或凭据。首次`pnpm`调用尝试由Corepack下载锁定工具时网络不可用，因此改用仓库已有同等工具；最终验证不依赖该下载。曾发现测试使用的findLastIndex超过本仓库类型库范围，已改用受支持写法后重新类型检查。

ROOT尚须逐端口真实运行新核心和正式UI，核对：小计数和2^53以上计数的原生驱动类型、前后原生/完整定义/目录一致、真实只读/权限能力失败的拒绝、单ALTER与物理身份不变、取消前实际唯一MDL观察、核验失败不重放、隔离库和线程清零。若某目录/变量不成立，保留失败及只读原因，不用mock替代。

本批没有重启授权或重启实测。若ROOT随后单独安排隔离实例重启，需分别验证5.7仅ALTER上调后重启的失效及MariaDB持久计数在正常/失败插入情形的恢复；不得据当前候选宣称已验证。无需重启即可先完成本批原生目录、单ALTER及UI验证。
