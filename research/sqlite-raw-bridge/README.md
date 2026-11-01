# SQLite 任意SQL原字节读取桥（研发准备）

状态：原生模块、独立解码器及[参数／元数据／长SQL适配器](../../docs/development/sqlite-raw-statement-20261102.md)已实现并独立验证，**尚未接入客户端查询执行**。不能据此宣称SQL编辑器的坏TEXT字节已经受到保护；已交付的表／视图分页保护见[表页专项](../../docs/development/sqlite-page-text-20261102.md)。不增加R02完整工作包或发行计数。

新增[有界批次与消费者确认](../../docs/development/sqlite-raw-frames-20261102.md)：原生200行／最多1MiB帧、跨字段分段、错误终态、ACK与协作取消；三编码分别验证百万行计数及RETURNING取消后的真实写入，仍为内部候选。

## 问题与选择

Node 24.17.0／SQLite 3.53.0的普通结果读取会在交给JS前替换坏TEXT。UTF-8的孤立`80`变成一个U+FFFD；UTF-16的孤立高代理在原生转换后变成三个U+FFFD。应用收到字符串后，无法区分这些替换与真实保存的U+FFFD。

不重新执行用户SQL，也不以出现U+FFFD为拒绝条件。前者会改变随机表达式与写入事实，后者会误拒合法文本。Node的[类型转换契约](https://nodejs.org/docs/latest-v24.x/api/sqlite.html#type-conversion-between-javascript-and-sqlite)只提供TEXT到string；对应[运行时源码](https://github.com/nodejs/node/blob/v24.17.0/src/node_sqlite.cc)也在此处调用UTF-8字符串构造。

## 内部模块

- `rawProbe.c`是DBArk自有MIT源码。仅作为显式实验扩展，在原连接上prepare／step原SQL，保留真实事务和authorizer；记住DONE，避免SQLite再次step自动重跑写入。失败时当场保存扩展错误码，后续step及finalize保留该失败，不把主键冲突1555降成19或伪装成功DONE。
- 只在step返回ROW后复制原值，按[原生值编码](https://www.sqlite.org/c3ref/value_encoding.html)记录UTF-8／UTF-16LE／UTF-16BE，再读取独立副本的BLOB字节。遵守[列读取时序](https://www.sqlite.org/c3ref/column_blob.html)，不使用trace回调读列，不改变原statement存储类型。
- `src/engine/sqlite/rawValue.ts`独立解码五类值；INTEGER保有符号64位，REAL保负零及无穷，TEXT首次解码严格校验并保BOM／NUL／真实U+FFFD，BLOB不作为文本解码。原始与UTF-8表示均受原单值预算约束。
- 每格原字节独立返回，避免把整行封成一个大BLOB后额外降低原单值门槛。控制参数明确绑定BigInt；SQLITE_FUNCTION拒绝与ATTACH拒绝分别对照原生错误码1及23。
- 头文件按固定Node版本下载到忽略缓存并核SHA256，不入库；扩展仅由当前源码现场编译。客户端的`allowExtension:false`、IPC、构建和打包配置保持原状。

## 运行与证据

命令：`node scripts/sqlite-raw-probe.mjs`。需要Node 24和项目依赖。macOS／Linux使用`cc`；Windows实验使用`.tools/zig/zig-x86_64-windows-0.15.2/zig.exe`，需先按[官方索引](https://ziglang.org/download/index.json)准备并校验编译器，不自动安装到系统。

每轮创建独立`.cache/sqlite-raw-probe-*`，保留编译日志、原始平台及报告；成功后正常关闭并精确删除合成数据库目录，失败现场保留。无服务器、Docker、安装版配置或系统剪贴板访问。

2026-11-02本机Windows x64：最终三编码独立原生实验通过，覆盖坏字节实证、真实替代字符、五类值、两次函数调用只求值两次、明确事务、RETURNING一次写入、重复DONE不重放、原生权限拒绝、1555扩展错误码及重复失败保持、关闭后独立连接读回和integrity_check。最终原件为`.cache/sqlite-raw-probe-rnWXQ6/report.json`；模块01至04的控制参数／权限码／夹具基线失败及模块06发现的扩展错误码损失分别保留，未追认首轮通过。

26项解码边界单元、严格类型及构建通过；构建仍有既有注释／分块体积提示。扩大相关187文件3741项在`--maxWorkers=3`下通过，保留原5秒门且未启用重试。原默认并发轮4项超时（对象管理、分页比较、页内替换及百万行流读取）及导出收尾失败保留，不能据调度复验宣称原失败根因已证实。原始日志在`.cache/sqlite-raw-bridge-20261102/`。

基础模块准确`49148f5c`及参数适配器准确`c6ab8ead`的三平台CI均已通过，并分别独立核对原始ZIP、实际架构与源码摘要。新版含三编码参数／元数据、长SQL、trigger边界及坏TEXT粘滞失败；实际回执及剩余边界见[语句适配器专项](../../docs/development/sqlite-raw-statement-20261102.md)。

## 接入前仍需完成

参数、元数据、脚本边界与超过1MiB的SQL材料已在三平台候选适配器中验证；有界批次和确认／协作取消另完成内部验证。仍须接入原worker的累计结果／行预算、原IPC ACK、准确进程强取消、事务／错误与已完成写入事实，并完成扩展固定加载位置、能力隔离、三平台客户端构建／签名／打包和性能验收。当前探针不作为生产驱动或兼容回退；Electron窗口、安装版及系统输入仍须单独验证。
