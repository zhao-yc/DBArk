# 完整流式CSV/CSV ZIP分隔符后台验收准备

基线为 `388e1eed1c3dc2a435b36e98b59cd967042d2000`。本次只准备真实Engine专项及RAM护栏，不运行集成入口、列表、数据库或GUI；18个场景均尚待Root明确开启实跑。

## 场景清单

| 稳定场景身份 | 格式 | 编码 | 分隔符请求 |
| --- | --- | --- | --- |
| csv/utf8/default | 单CSV | UTF-8 | 省略字段，原逗号 |
| csv/utf8/semicolon | 单CSV | UTF-8 | 分号 |
| csv/utf8/tab | 单CSV | UTF-8 | Tab |
| csv/utf16le/default | 单CSV | UTF-16LE | 省略字段，原逗号 |
| csv/utf16le/semicolon | 单CSV | UTF-16LE | 分号 |
| csv/utf16le/tab | 单CSV | UTF-16LE | Tab |
| csv/gb18030/default | 单CSV | GB18030 | 省略字段，原逗号 |
| csv/gb18030/semicolon | 单CSV | GB18030 | 分号 |
| csv/gb18030/tab | 单CSV | GB18030 | Tab |
| csv-zip/utf8/default | CSV ZIP | UTF-8 | 省略字段，原逗号 |
| csv-zip/utf8/semicolon | CSV ZIP | UTF-8 | 分号 |
| csv-zip/utf8/tab | CSV ZIP | UTF-8 | Tab |
| csv-zip/utf16le/default | CSV ZIP | UTF-16LE | 省略字段，原逗号 |
| csv-zip/utf16le/semicolon | CSV ZIP | UTF-16LE | 分号 |
| csv-zip/utf16le/tab | CSV ZIP | UTF-16LE | Tab |
| csv-zip/gb18030/default | CSV ZIP | GB18030 | 省略字段，原逗号 |
| csv-zip/gb18030/semicolon | CSV ZIP | GB18030 | 分号 |
| csv-zip/gb18030/tab | CSV ZIP | GB18030 | Tab |

每例301行，含无符号BIGINT接近上界、有符号BIGINT下界、DECIMAL(65,30)、DATETIME(6)、正负TIME(6)、JSON内64位大整数、SQL NULL/JSON null/空字符串、首反斜线、引号、CRLF、分号、Tab、中文和emoji，以及NULL/空/非空二进制。标题也分别包含候选分隔符、引号和换行。

## 实际执行路径与独立期望

入口为 `tests/integration/engine-query-csv-delimiter.integration.test.ts`。声明阶段只计算双门并登记18例；动态live模块只在获准的实际回调中导入。VM护栏验证list参数先短路，零环境getter；默认仅看双门，不读凭据、不导入Engine/mysql2/live。

每例通过现有公开 `connections.open`、`sessions.open`、`query.execute`、`query.exportStream` 和 `closeAll` 使用真实Engine、mysql2、原会话和原子文件。仅观察并透传原connect、底层query/execute、帧消费者和partial创建，未替换任何产品结果、写入或提交。Main文件选择器不在此后台验收范围。

固定脚本为：独立常量空行集 → `DO 0`状态 → 一次源表查询。单CSV指定第2个行结果；ZIP包含空集CSV、301行CSV和版本1清单，状态占第2结果但不生成CSV。导出期间精确核三条原语句、原managed/物理thread、text路径及连接数不增加，拒绝额外目录查询、重放或read-all替代。完整文件301行、预览200行且截断、队列峰值1行同时核对。

独立observer以SQL CAST/DATE_FORMAT/HEX/JSON_TYPE/JSON_EXTRACT投影先验证手工种子，保留JSON原数字token及服务器规范文本。期望字段从这些投影生成；CSV文法由独立 `csv-stringify/sync` 生成全部期望字节，并以ICU解码及 `csv-parse/sync` 二次核对。没有使用产品CSV serializer生成期望。ZIP使用已有独立ZIP64目录/CRC解码器，逐CSV核BOM/编码/标题/每个字节，并准确核清单分隔符、结果及行结果序号、列位置/原名/输出名/类型、行数、字节数和状态。EOF警告计数按原协议可省略，出现时必须为0。只对这个小型、至多2MiB的已完成验收文件整体读取，不改变Engine消费路径；不调用系统tar。

## Root实跑前提

仅允许Root本轮明确提供以下环境值，不能从旧.env补齐、猜账号或回退地址：

- `DBARK_INTEGRATION_ENABLED=1` 和新门 `DBARK_QUERY_CSV_INTEGRATION_ENABLED=1`；旧INSERT专用门不能授权本专项。
- 新的32位小写十六进制 `DBARK_QCSV_RUN_NONCE`。
- `DBARK_TEST_HOST=192.168.31.200`、`DBARK_TEST_PORT=13384`、`DBARK_TEST_TLS=0`。
- 显式存在的 `DBARK_TEST_USER`、`DBARK_TEST_PASSWORD`，空口令只有明确提供空串才接受。
- `DBARK_TEST_EXPECTED_SERVER_UUID=f568f70e-c730-11f1-8190-3e6c830dde01`。

所有原连接还要核peer和thread。独立observer使用已验的 `-IGNORE_SPACE`，并以只读事实门核MySQL **8.4.11**、准确UUID、Linux、大小写、autocommit、InnoDB严格模式和普通建表能力；source会话通过公开查询再核同一事实。source只在自身会话设置严格模式及UTC，不修改服务器全局配置。拒绝SSH/证书旁路、用户目录/可执行程序覆盖、预加载和大小写环境别名；任何配置漂移永久撤销当前绑定。

Root确认后可仅运行该文件（此命令本轮未执行）：

```powershell
node D:\svn\DBArk\node_modules\vitest\vitest.mjs run --config vitest.integration.config.ts tests/integration/engine-query-csv-delimiter.integration.test.ts
```

按原Vitest 3.2.7的 `task.result.startTime` 和原120秒deadline运行，禁止重试、重复及并发。直接复用已验的 `qisLifetime` / 原句柄finally helper，不修改旧helper或旧授权。任务/result/时钟/期限/配置失效、前景动作重叠和迟到ACK都会停链；在途真实命令未结束时保留未知，不重连、强退或把清理包装成新授权。

## 资源与失败边界

每例随机产生独立 `dbark_qcsv_<32位nonce>`，只建 `__qcsv_owner`、`source`、`neighbor`；还创建本clone缓存中的随机目录及一个旧内容目标文件。非递归创建、`wx`和建库前精确缺席核对，拒绝认领旧资源。日记 `.cache/qcsv-<nonce>.ownership.ndjson` 在资源写入前登记，逐次fsync并核原inode/大小，最多48条/32KiB；保留库、场景/运行nonce、case hash、表结构哈希、数据期望摘要、目录/目标身份、原thread及精确partial名字。日记不含凭据、令牌、SQL正文或样例值。

成功收尾顺序为：任务已结算 → 原Engine正常关闭及原流close → 按确切thread核PROCESSLIST为零 → 再核准确服务器、建库ACK、标记行、完整表集合/注释、SHOW CREATE原文、无视图/触发器/例程/事件、source/neighbor未变 → 原目标和目录inode/规范路径/字节摘要及partial缺席 → 删除唯一目标并核缺席 → 仅DROP本例精确随机库并核缺席 → 原observer正常close且同流已关闭 → 删除已空且原inode的唯一目录并核缺席 → 留日记。

任一步失败、超时或身份不明都停止后续例并保留现场；finally仅打印有界资源身份附录，不补发cancel/close/DROP，不清旧资源，不遍历或递归删除。资源检查是本例观察时点的归属证据，不声称对其它进程提供跨路径CAS。没有用户/权限/容器操作。

## 准备验证范围

本轮只运行两个新增RAM护栏文件及既有INSERT护栏回归，3文件123项通过（新增86项、既有37项），类型检查退出码0。既有INSERT测试保留了Vitest第三参数options的弃用提示，本次未改其源码或依赖。新增测试以手写三分隔符CSV和手工RAM ZIP64夹具核验证器正反例；这些不代表18例真实导出已经通过。未运行集成入口、任何实际Playwright（含list）、GUI、Electron、数据库、SSH、Docker、端口、剪贴板或新CI；未改产品、依赖、版本、发行工作流或旧helper。Root独审整合后才另行实跑。

```powershell
node D:\svn\DBArk\node_modules\vitest\vitest.mjs run tests/unit/query-csv-integration-policy.test.ts tests/unit/query-csv-integration-assertions.test.ts tests/unit/query-insert-integration-policy.test.ts
node D:\svn\DBArk\node_modules\typescript\bin\tsc --noEmit
```
