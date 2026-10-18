# 完整流式INSERT后台集成用例准备

本片从`aad0ddd22b4bfae417964386e28fe7188ccedaa2`建立独立普通clone和`codex/employee2-query-insert-integration-prep-20261018`分支，不用worktree。只新增测试、护栏和本说明，未修改生产实现、版本、依赖、工作流或覆盖总表。

**当前仅准备，真实集成执行为0**，包括数据库连接、只读身份预检、建库、源查询、回放SQL、GUI、Electron、Docker、SSH、端口、剪贴板和新CI均未执行。不重跑1556全套或AtomicFile原红例。后台用例通过也不能代表完整产品或GUI验收。

## 基线和归属修复兼容要求

`aad0ddd`是准备起点，包含Root已发现的prepare前取消/sync失败归属问题，不能直接据本片双门开启就视为可运行。**实际运行前Root必须先接纳`a8d58064`的归属修复或其已核实等价整合版本**，再将本片用例整合到该代码上。Root告知的`6ab46522523b8e26d737d624511872de621ee2ce`尚未在本片取用或依赖；本片没有读取未公开Root对象来补齐实现。

本片不替换`nativeAtomicFileIO`或重建WritableFile；只旁观`node:fs/promises.open`的精确partial创建路径，在委托前落盘登记，之后直接返回原句柄对象，参数、方法、原型及错误不变。因此不会丢弃`protectOwnership`等新增方法。RAM用例核对同一返回对象及新增归属方法透传，但不冒充对实际`a8d58064`或修复后实库路径的运行验证。

## 稳定公共命令和6个场景

入口为`tests/integration/engine-query-insert-stream.integration.test.ts`。使用正式Engine的`query.exportStream(format=sql)`、`TaskEvent.queryInsert`、`query.confirmInsertExport`、`query.cancel`、`sessions.close`和正常Engine关闭链路，不读写Engine私有会话表或重建QueryInsert生成器。

这是后台测试：正式公共输入先经过原strict校验，再像Main后端一样注入Root既有profile及本例唯一filePath。文件令牌仅是合成输入；未验Main文件授权、操作系统选择器或界面确认。

| 用例 | 未来运行内容和验收点 |
| --- | --- |
| utf8 | 301行真实表→同原session单次流式暂存→20条真实INSERT样例→仅发布确认→独立驱动回放 |
| utf16le | 同一输入合同，单独的原120秒case，核UTF-16LE BOM与真实解码 |
| gb18030 | 同一输入合同，单独的原120秒case，使用Node ICU TextDecoder独立解码 |
| cancel | 暂存完成但仍等待确认时发公共取消，原目标字节/身份保持、partial正常释放、旧令牌拒绝、源SQL只执行一次 |
| session-close | 暂存完成后公共关闭原session，等待任务取消且原物理流正常关闭；迟到确认拒绝，不新连、不重放、原目标保持 |
| multi-result | 一个301行SELECT后接第二个行结果；首片合同拒绝，不发布样例或文件，原目标保持，首个源SELECT只发送一次 |

三编码各一例，不通过重编码旧输出冒充正式三编码。每个源表包含301行：BIGINT UNSIGNED从`18446744073709550000`到`18446744073709550300`；有符号最小值起；正负DECIMAL(65,30)；DATETIME(6)/TIME(6)微秒；SQL NULL、空串、文字NULL；中文/emoji、单/双引号、反斜线、NUL、CRLF；BLOB的NULL/空字节/`0001FF805C27`；JSON的SQL NULL、JSON null及含uint64整数的对象。

造数使用手工精确文本与参数，不调用被测生成器生产预期。独立mysql2的CAST、HEX、DATE_FORMAT及JSON投影先核301行源数据，再逐项对照回放后的target和未改source；邻表固定旁行保持。

每个编码成功用例在两个新独立驱动会话中分别设置、复读并验证普通模式和`NO_BACKSLASH_ESCAPES`，然后执行本次实际生成的完整301条INSERT文件；每条ACK影响1行、warning=0，精确结果相等。正常模式回放后仅清空本例target再进行NBE模式，源表不变。不扩展百万行、五版本或新权限账号。

## 默认/list门和原120秒

默认只读取`DBARK_INTEGRATION_ENABLED`、`DBARK_QUERY_INSERT_INTEGRATION_ENABLED`；`list`/`--list`先短路且零环境getter。即使双门已开，收集阶段也只登记6个回调，不加载live实现；凭据、引擎、驱动和文件IO都留到实际回调。未读取.env。

Root未来须显式提供：

| 变量 | 值或约束 |
| --- | --- |
| `DBARK_INTEGRATION_ENABLED` / `DBARK_QUERY_INSERT_INTEGRATION_ENABLED` | 均为`1`，仅Root接纳归属修复后开启 |
| `DBARK_QIS_RUN_NONCE` | 本轮32位小写十六进制身份 |
| `DBARK_TEST_HOST` / `DBARK_TEST_PORT` / `DBARK_TEST_TLS` | `192.168.31.200` / `13384` / `0` |
| `DBARK_TEST_USER` / `DBARK_TEST_PASSWORD` | Root本轮显式既有凭据；不提供默认账号，口令允许明确空串 |
| `DBARK_TEST_EXPECTED_SERVER_UUID` | `f568f70e-c730-11f1-8190-3e6c830dde01` |

服务器必须实际为MySQL 8.4.11/Linux，准确UUID及既有会话/建表能力均由真实只读事实核验，且在任何CREATE DATABASE前完成；身份未知即停，不创建或修理服务器环境。不接受SSH、CA/证书旁路、外部renderer、用户目录、Node预加载或大小写环境别名。

期限取Vitest当前任务原`result.startTime + 120000`，核同task/result对象、原timeout、运行状态、retry/repeat=0和单调时钟，不在准入、主体或清理阶段重签时间。6例顺序运行；前例或准入失败后永久停后续例。实际成功关闭及清理后才放行下一case。

## 写前登记、原session和收尾

运行目录必须是包含本片源码的准确clone，且`.cache`已存在并为规范普通目录，不创建外部证据根。每case生成32位nonce，先以wx创建有界无凭据journal并fsync，再分配任何数据库/目录/目标：

- journal：`.cache/qis-<caseNonce>.ownership.ndjson`，最多48条/32KiB；含本轮nonce、case哈希、准确资源计划和后续阶段，不保存密码、SQL、真实样例或预览令牌。
- 库：`dbark_qis_<caseNonce>`；表仅`__qis_owner/source/target/neighbor`，均有本轮注释，marker保存nonce与case哈希。先核库不存在；CREATE ACK未知不自动DROP。
- 目录：`.cache/dbark-qis-<caseNonce>`，只用非递归mkdir/rmdir；目标名`qis-<caseNonce>-<kind>.sql`，旧目标固定合成字节先落盘并核hash。
- 引擎partial：由正式实现选择`<目标>.dbark-<UUID>.partial`；透明open观察器在原open之前登记准确basename。至多1份，未知路径不创建。不会伪造写入、sync、身份、prepare、提交或删除响应。
- 连接：用途在建连前登记；原native、物理stream、线程ID、profile和正常关闭事实逐项绑定，最多8条；同线程号不能替代同流。主连接返回前的原流线索也保留于失败附录。

透明query/execute观察只计数并原样委托，源SQL发送数必须为1。暂存确认前后比较所有已观察连接的query/execute调用数和connect尝试数，确认及重复/失效确认不得发SQL或新建连接；回放SQL属于确认完成后的独立验证步骤，明确另计。

仅当原导出已终态、原Engine正常关闭、全部相关非观察流正常close且精确线程ID在PROCESSLIST中不存在，才进入精确清理。再次核UUID、marker、完整表集合/注释/SHOW定义及无额外触发器/过程/事件；已登记partial必须由产品释放且核无残留。目标读取前后核规范路径/dev/ino/非链接/单链接/大小/hash；只unlink本例目标，不替产品删除partial。随后精确DROP本例库、核不存在、正常关闭观察流；确认原目录同dev/ino且空，才rmdir并核不存在。

任何失败、迟到、归属变化或退出未知只输出有界资源身份附录并停链，不在finally补发cancel、close、SQL、DROP、递归删目录或强退。journal保留；未知连接thread（若已返回）与准确文件路径由最后附录保留供Root人工核对。本片普通路径unlink/rmdir不声称跨进程原子CAS。

## 本次离线验证和剩余边界

仅运行本片必要的`tests/unit/query-insert-integration-policy.test.ts`及`tsc --noEmit`。RAM使用实际声明、实际护栏、实际open观察器、实际文件检查函数，验证默认/list零live加载、准确目标与漂移墓碑、Vitest原startTime、原120秒迟到停链、原物理流/线程/profile拒绝、写前partial登记、原句柄新增方法保留、句柄失败关闭及inode/字节/路径变化拒绝。

初轮类型检查暴露unknown输入边界、basename回调参数和Vitest链式API类型问题，均已修正；日志保留。这些是测试接线修复，没有改生产代码或运行原集成用例。

实际数据库行为、301行正式写流/三编码/回放、正常连接释放和无残留尚未证明。Root接纳归属修复、整合本片并复核后，才可另开下列单文件命令；本次未执行：

```powershell
node node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts tests/integration/engine-query-insert-stream.integration.test.ts --reporter=json --outputFile=.cache/qis-real-report.json
```

本次离线日志与固定头/输入SHA交接位于本clone`.cache/qis-preparation-evidence/`。不因RAM或类型通过宣称实库/GUI或完整产品通过。

## Root首次只读预检与观察连接修正

固定Root `493dc2f` 的首次utf8实库尝试在第一条只读事实查询被拒绝，源SQL执行0、库/目录/partial创建0，另外五例未运行。原日志SHA-256为 `88944f447ac7b5633c1ba5711b0ec344b31e7213a4c93d7a1b1c1976c3de48e9`。Root随后三条只读查询确认MySQL8.4.11/Linux、原UUID及所有普通能力正确；旧线程43068已不存在，本例库和目录均未创建，新观察连接正常关闭。

独立mysql2连接的默认握手位令其会话sql_mode多出IGNORE_SPACE，超出借用事实门的既有白名单。本修正只为独立观察/回放连接显式传 `flags: ['-IGNORE_SPACE']`；不放宽共享事实断言，不SET服务器配置，也不改产品驱动。原失败及journal保留，须用新nonce和新目录另开验证，不能将首例写成通过。

后续固定 `d9fba31` 的新utf8单例已通过只读事实、造数及一次源查询，301行完整暂存到待确认阶段；随后断言将COUNT的规范字符串`'0'`期待为数字0而失败，未确认发布／回放，另五例未运行。独立连接原已设置`bigNumberStrings:true`，此修正只将两处COUNT空表期待改为严格`'0'`，保留驱动精度和所有文件／会话断言。原日志 SHA-256 `04ab430e03b03a45b0b68958fb27f6b49a00a5e763ee984de71f4a141886444d`，原随机库／目录／partial与journal保留，须先独立核归属再精确清理或作为原失败数据保留，不自动扩大删除。
