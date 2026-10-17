# 复制 INSERT 六实例实际回放验收（2026-10-17）

Root在`run1358-copy-insert-replay`串行执行六个既有200隔离实例，每实例两个完整身份，共12项单次通过。员工5只读独采终态公开原件，没有重跑测试、连接数据库或操作剪贴板。本记录接纳该窗口内的源码实库回放，不计入R93安装覆盖。

## 来源与前置验证

| 固定来源 | 已完成验证 | 本记录使用方式 |
| --- | --- | --- |
| `790537e93913342ea18da683aca272e655bb4781` | 100项定向纯测、类型、默认关闭及列表子命令均退出0 | 本次实际回放源码头；默认关闭2项均skip，默认`vitest list --json`输出`[]`、数量0 |
| `0fb9f324b77a0496b64e05fb2c90970b01c12c95` | 完整6859/6859，类型和完整构建均退出0 | 既有完整基线；产品与108份构建摘要沿用且未变，不将其写成790头重新跑过完整大套 |

Root前置汇总控制器曾错误期待默认列表包含2个skipped身份，因实际列表数量0而触发断言失败。原失败及输出保留；底层100项、类型、关闭报告和列表子命令均退出0。后续独立汇总据原件确认默认list为0、关闭报告定义2项且均skip，没有为修正汇总重跑上述检查，也未将该断言归为产品或钩子失败。

固定来源汇总位于仓库根下`.cache/v022-frequency-integration-20261017/.cache/integration/`，分别为`copy-insert-replay-r1/summary.json`和`copy-data-maria-r1/summary.json`。实际入口、关闭报告和依赖元数据均由本轮controls绑定。

## 六个组合与完整身份

| 端口 | 准确实际版本 | 传输 | 结果 |
| --- | --- | --- | --- |
| 13357 | MySQL `5.7.44` | plain | 2 passed |
| 13380 | MySQL `8.0.46` | plain | 2 passed |
| 13384 | MySQL `8.4.11` | plain | 2 passed |
| 13310 | MariaDB `10.11.19-MariaDB-ubu2204` | plain | 2 passed |
| 13311 | MariaDB `11.4.13-MariaDB-ubu2404` | plain | 2 passed |
| 13484 | MySQL `8.4.11` | 原CA、严格TLS及身份校验 | 2 passed |

每组合重新核实际200主机、版本、Linux及名称模式，沿用既有管理员profile，不创建用户、授权或证书。完整身份由固定关闭报告绑定到[正式回放定义](engine-copy-insert-replay.integration.test.ts)的同一文件；套件路径为`复制INSERT真实解码和独立会话回放（默认关闭，Root统一实跑）`，标题为以下两个，再与端口、版本及源码头组合核对：

- `普通模式：真实表页生成INSERT，精确回放无warning且源表不变`
- `ANSI_QUOTES与NO_BACKSLASH_ESCAPES：真实表页生成INSERT，精确回放无warning且源表不变`

普通会话使用`STRICT_ALL_TABLES,NO_ENGINE_SUBSTITUTION`；另一独立会话在此基础上开启`ANSI_QUOTES,NO_BACKSLASH_ESCAPES`。主体60000毫秒、beforeEach 60000毫秒、afterEach 30000毫秒，单worker、显式retry0、bail1。六份原始子进程退出均为code0/signal null；两身份在每份实际报告各出现一次且均passed，零skip、failed、todo和失败消息，stderr均为空。

Vitest公开JSON未投影`numUnhandledErrors`，独采未把缺字段当成0；固定版本默认不忽略未处理错误，遇到此类错误会将退出码置1。本轮六个原退出0、报告success及空stderr共同支持没有未处理错误的结论。

## 回放断言与收尾

真实链路使用`connect(profile)`、`Engine.table.page`解码、`metadata.table`、`buildCopyInsertSql`及独立会话`query.execute`。夹具通过预处理参数和独立数值文字量造数，覆盖精确BIGINT/DECIMAL、JSON和文本的引号/反斜杠/NUL/多字节、空及NULL BLOB、BIT64、日期/时间微秒。逐条INSERT均通过warningCount为0的断言；真实源/目标表页与独立CAST/HEX/日期完整投影相等，源表前后不变。正式断言及通过报告支持这些结论，独采没有另行查询服务器行，本文不收录具体测试行或认证。

准备门及停链约定见[回放准备说明](copy-insert-replay.md)、[纯准备门](../helpers/copyInsertReplayPolicy.ts)和[收尾超时回归](../unit/copy-insert-replay-hooks.test.ts)。收尾首次await前占住下一模式，命令或创建未知、超时、关闭失败及归属变化不补DROP、不重放；只有本例在原期限内完整成功才放行。归属依据为本轮注释、完整定义和精确对象集，不提供新表物理tableID归属保证。

每组合结束后，Root等待六实例相关隔离库、用户和线程资源均为0才继续。六份原资源检查退出均为0，对应`run1358-replay-{mysql-legacy,mysql-eight,mysql-four,maria-ten,maria-eleven,strict-tls}-post.json`。前置`run1357-copy-insert-replay-pre.json`、后置`run1359-copy-insert-replay-post.json`也均为六实例相关资源0；有效native前后总进程和可见数量均大于0，owned为0。以上是1357→1358→1359历史窗口的观察；1361之后的Maria保留资源不属于本次记录，不据此声称当前系统全零。

冻结输入为1520份tracked源码、108份dist及6份controls，独采逐SHA复算匹配；源码另逐份匹配Git 790 blob。活动目录后续文档发生变化后，独采切换`.cache/frozen-source1358-project`完整固定副本核对，未把后续开发变化记为1358失败。只读探针QUIT及同一流close、原CA摘要未变由固定入口控制流及accepted完成支持；独采没有独立探针close回执，也没有读取原CA或私料。

## 原件与边界

Root原件位于仓库根下`.cache/parallel-integration/run1358-copy-insert-replay/`，含终态summary、冻结输入、六份报告/原退出/身份/预算及资源检查回执；前后资源原件位于同级1357/1359文件。原静态短审只覆盖入口、输入及7项RAM默认门，与启动后新增执行原件分开记录。

员工5独采报告位于`.cache/employee5-independent-run1358-20261017/independent-review.json`，SHA256为`8ecc2f63ef3f463b81809eb70110ec016c0e3b94baf2d6668968f8f4f53b2d15`。报告、原件副本及摘要清单保留在本地忽略目录，不随本文提交。Root顶层session60003的exit0由Root工具回报，独采直接核对六个子退出及六个资源退出。

本次实际原生剪贴板读写、GUI、安装、Docker和新用户操作均为0；员工独采的DB、SSH、CIM及其它外部实际操作也均为0。本记录不接纳原生复制按钮体验、安装包、macOS或其它跨平台结果，不扩大为5.7完整类型/FK或其它能力通过。
