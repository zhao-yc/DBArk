# SQLite 任意SQL原字节读取桥

状态：现已[接入实际 worker](../../docs/development/sqlite-native-runtime-20261102.md)，原生源码移至 `src/engine/sqlite/nativeRows.c`。本文件以下实验记录保留各自历史范围；独立探针不代替 Electron 或安装验收。不增加 R02 完整工作包或发行计数。

接入前的[有界批次与消费者确认](../../docs/development/sqlite-raw-frames-20261102.md)：原生200行／最多1MiB帧、跨字段分段、错误终态、ACK与协作取消；准确`33227fb7`的三平台CI及原始ZIP独立核对通过，三编码分别验证百万行计数及RETURNING取消后的真实写入。该历史检查点仅验证内部候选。

## 问题与选择

Node 24.17.0／SQLite 3.53.0的普通结果读取会在交给JS前替换坏TEXT。UTF-8的孤立`80`变成一个U+FFFD；UTF-16的孤立高代理在原生转换后变成三个U+FFFD。应用收到字符串后，无法区分这些替换与真实保存的U+FFFD。

不重新执行用户SQL，也不以出现U+FFFD为拒绝条件。前者会改变随机表达式与写入事实，后者会误拒合法文本。Node的[类型转换契约](https://nodejs.org/docs/latest-v24.x/api/sqlite.html#type-conversion-between-javascript-and-sqlite)只提供TEXT到string；对应[运行时源码](https://github.com/nodejs/node/blob/v24.17.0/src/node_sqlite.cc)也在此处调用UTF-8字符串构造。

## 内部模块

- `src/engine/sqlite/nativeRows.c`（原 `rawProbe.c`）是 DBArk 自有 MIT 源码。在原连接上 prepare／step 原 SQL，保留真实事务和 authorizer；记住 DONE，避免 SQLite 再次 step 自动重跑写入。失败时当场保存扩展错误码，后续 step 及 finalize 保留该失败，不把主键冲突 1555 降成 19 或伪装成功 DONE。
- 只在step返回ROW后复制原值，按[原生值编码](https://www.sqlite.org/c3ref/value_encoding.html)记录UTF-8／UTF-16LE／UTF-16BE，再读取独立副本的BLOB字节。遵守[列读取时序](https://www.sqlite.org/c3ref/column_blob.html)，不使用trace回调读列，不改变原statement存储类型。
- `src/engine/sqlite/rawValue.ts`独立解码五类值；INTEGER保有符号64位，REAL保负零及无穷，TEXT首次解码严格校验并保BOM／NUL／真实U+FFFD，BLOB不作为文本解码。原始与UTF-8表示均受原单值预算约束。
- 每格原字节独立返回，避免把整行封成一个大BLOB后额外降低原单值门槛。控制参数明确绑定BigInt；SQLITE_FUNCTION拒绝与ATTACH拒绝分别对照原生错误码1及23。
- 头文件按固定 Node 版本下载到忽略缓存并核 SHA256，不入库；自研库由当前源码编译。客户端仅启动时固定加载，随后关闭扩展加载；现行构建及隔离策略见接入文档。

## 运行与证据

命令：`node scripts/sqlite-raw-probe.mjs`。需要 Node 24 和项目依赖。macOS／Linux 使用 `cc`；Windows 使用 `.tools/zig/zig-x86_64-windows-0.15.2/zig.exe`，缺少时共享构建器按固定官方 ZIP 摘要下载到项目，不安装到系统。

每轮创建独立`.cache/sqlite-raw-probe-*`，保留编译日志、原始平台及报告；成功后正常关闭并精确删除合成数据库目录，失败现场保留。无服务器、Docker、安装版配置或系统剪贴板访问。

2026-11-02本机Windows x64：最终三编码独立原生实验通过，覆盖坏字节实证、真实替代字符、五类值、两次函数调用只求值两次、明确事务、RETURNING一次写入、重复DONE不重放、原生权限拒绝、1555扩展错误码及重复失败保持、关闭后独立连接读回和integrity_check。最终原件为`.cache/sqlite-raw-probe-rnWXQ6/report.json`；模块01至04的控制参数／权限码／夹具基线失败及模块06发现的扩展错误码损失分别保留，未追认首轮通过。

26项解码边界单元、严格类型及构建通过；构建仍有既有注释／分块体积提示。扩大相关187文件3741项在`--maxWorkers=3`下通过，保留原5秒门且未启用重试。原默认并发轮4项超时（对象管理、分页比较、页内替换及百万行流读取）及导出收尾失败保留，不能据调度复验宣称原失败根因已证实。原始日志在`.cache/sqlite-raw-bridge-20261102/`。

基础模块准确`49148f5c`及参数适配器准确`c6ab8ead`的三平台CI均已通过，并分别独立核对原始ZIP、实际架构与源码摘要。新版含三编码参数／元数据、长SQL、trigger边界及坏TEXT粘滞失败；实际回执及剩余边界见[语句适配器专项](../../docs/development/sqlite-raw-statement-20261102.md)。

## 历史接入前清单

累计结果／行预算、原 IPC ACK、准确进程强取消、事务／错误与已完成写入事实及固定资源隔离现已接入原 worker。三平台客户端、签名、打包和性能按接入文档分别验收；本探针仍只验证独立原生 API，不作为兼容回退或安装证明。
