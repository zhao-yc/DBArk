# 新建数据库时选择实际字符集与排序规则

本切片基于 `968628d22ea55faed705710e440ce859f4a22996`，增加独立的新建库表单和 `schema.databaseCreate.get/preview/apply/release` 命令。原入口为连接行的“创建数据库”；不要求连接配置填写默认数据库。原视图、过程、函数、触发器、事件的DDL编辑和只读定义路径保持原样。

用户填写库名，明确选择服务端实际目录中的字符集和排序规则，再生成只读SQL预览；再次准确输入库名并完成两项确认后，才允许一次创建。切换字符集清空旧排序规则，不猜默认排序规则，不自动选择utf8别名，也不因回车、保存快捷键或预览而执行创建。成功回调沿原App刷新版本更新对象树；表单草稿及未知结果加入应用退出保护。

## 目录与执行边界

- 直接复用 `tableDefaultEncodingCatalog` 的有界读取和Maria完整名称映射。超过8192候选或2 MiB、读取失败、未知版本时只读；歧义别名排除并说明原因。没有从业务表或列推断编码。
- 首批声明的版本范围沿已有目录基线：MySQL5.7.44、8.0.46、8.4.11，MariaDB10.11.19、11.4.13。新功能尚无这些版本的实库通过记录；相似版本不自动外推。
- 名称只接受1～64个BMP字符，拒绝系统库、路径、控制字符、尾空白和旧路径别名前缀。名称、字符集、排序规则分别引用；客户端不能提交SQL、服务器修订或伪目标。
- 目录快照和预览共用原结构缓存总预算及两分钟期限，使用独立 `databaseCreate` 用途。预览绑定连接修订、服务器身份、sql_mode、名称映射和完整目录摘要。预览及确认前均重读；同名已出现、目录或身份变化、过期/释放均拒绝创建。
- 执行令牌在任何等待之前消费，同连接的同名创建同步互斥，租约保留至真实短连接收尾。只发送一次 `CREATE DATABASE … CHARACTER SET … COLLATE …`，不使用 `IF NOT EXISTS`、`OR REPLACE`、ALTER或DROP，不修改已有库、表或列。
- 后核验只在实际SCHEMATA中的名称、字符集和排序规则精确匹配时报告完整核验。Maria别名若不能精确核对，保留“DDL已完成但未完整核验”，不猜等价或自动重放。权限由服务器原账号处理，不创建账号、不扩权。
- main工具进程退出、取消或断线时保留已投递/已完成/未知事实。服务中断或关闭失败不自动创建新预览、不重连重放；用户须先核对实际库再明确重读。关闭失败的Promise也不能抹掉可信完成事件。

## 共享接线与整合事项

新源码集中在 `shared/databaseCreate.ts`、`engine/databaseCreateTasks.ts`、`renderer/components/DatabaseCreateDialog.tsx` 和独立中文文案。必要共享改动仅扩展 `contracts/commands/validation`、结构缓存/任务用途、Engine注册与事件、main令牌/退出/概要隐私、`DdlDialog`新建库分流及App草稿保护。未修改现有目录读取实现、SqlEditor、版本、依赖、dist、ROOT或员工4 fixture。

**ROOT整合时须适配共享 `tests/e2e/live-helpers.ts` 的 `connectAndCreate`。** 其旧流程填写库名后立即点“执行SQL”；新产品流程要求目录配对、预览及准确名称确认，原helper将不再适用。本片遵守共享fixture边界，没有改该文件，不能把旧批次据此视为已经回归。原 `DdlEditorDialog` 的视图/过程等函数体未改。

**实跑前还须ROOT接入其future验证过的 `125206` 严格owner退出接口。** 当前固定基线没有该接口，旧 `quitDesktop` 的Promise返回不能等同服务器/所有者终态证明。新用例现已在退出拒绝时立即停链，不DROP、不关闭observer，也不发起目录清理；原用例失败与退出失败按首因顺序聚合。旧共享fixture的全局目录保留仍待严格owner适配，不能由本文件的RAM检查证明。该最窄修正没有代替严格owner协议，也没有赋予实际执行许可。

## 正式UI定义与当前验证层

新增 `tests/e2e/database-create.spec.ts` 双门入口。仅 `DBARK_INTEGRATION_ENABLED=1` 和 `DBARK_DATABASE_CREATE_UI=1` 同时显式开启、且非列表模式，才导入实跑模块。`--list` / `--list=…` 先于环境门短路；默认或列表只有一项关闭占位，不导入桌面、数据库、私网配置，不把占位算作通过用例。

首个实际UI定义只准备ROOT明确分配的 `192.168.31.200:13384` 明文MySQL8.4.11；严格TLS及其它五组合尚未准备。它通过无默认库的新连接和真实连接行入口操作，覆盖明确配对、预览零DDL、准确名称与完整确认、双击仅一项apply、观察目录精确核验和对象树刷新。实跑模块不使用尚未适配新表单的共享建库helper；唯一随机名称在开始时检查不存在，退出后仅清理本例隔离库。禁止自动重试，trace/video及自动截图关闭，不使用系统剪贴板。ROOT后续核对环境、固定构建产物和独占窗口后可用：

```powershell
# 仅为未来已授权实跑的入口说明，本片没有执行该命令。
pnpm exec playwright test tests/e2e/database-create.spec.ts
```

离线检查包括真实Engine的驱动替身、真实main分派及退出代码、真实ReactDOM内存表单、入口真实转译的四种门与两种列表形式，以及被扩展的共享结构协议。内存DOM只反射输入、选项及布尔属性，不证明原生焦点、布局、输入法或Monaco行为。

当前123项定向纯测试全部通过；最后补充目标连接显示后8项表单检查再次通过，类型检查通过。四种开关组合的实际Playwright `--list` 均只收集关闭占位、错误为空。最初名称代理字符反例及内存测试初始化/字面量类型问题均保留本克隆ignored cache中的失败证据，修正后没有未通过项。

新增清理链纯检查执行正式用例的真实转译体，RAM观察器先制造UI失败再制造退出失败。旧代码1红1绿，红例准确观察到退出拒绝后仍有DROP/end；修正后两项全部通过。它只证明本文件的停链和首因保持，不证明原生退出、服务器断连或严格owner清理已经完成。

本片GUI、200连接、数据库写、系统剪贴板、Docker、人工CI及凭据读取均为0。只交代码、纯测试、类型与关闭入口列表证据；尚未验实库权限、锁等待、实际取消/断线、版本兼容、TLS和安装产物。不将此片称为全部数据库管理能力完成。

语法依据：[MySQL数据库字符集与排序规则](https://dev.mysql.com/doc/refman/8.4/en/charset-applications.html)、[MariaDB CREATE DATABASE](https://mariadb.com/docs/server/reference/sql-statements/data-definition/create/create-database)。官方语法说明不替代本产品精确版本验收。
