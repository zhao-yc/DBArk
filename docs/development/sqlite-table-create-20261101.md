# SQLite 可视化新建表

## 使用

在左侧 SQLite 的 `main` 节点右键选择“新建表”，或在对象浏览“表”分类点击“新建表”。设计字段、主键、索引和外键后生成 SQL 预览，再输入准确的 `main.表名称` 确认创建。成功后刷新原库目录并打开新表，不修改已有查询的连接、临时表或事务。

本轮支持字段增删和顺序调整、声明类型、NULL、类型化默认值、BINARY／NOCASE／RTRIM、单列及复合主键、INTEGER 主键 AUTOINCREMENT、普通／唯一复合索引及方向、复合外键及更新／删除动作、延迟约束、STRICT 和 WITHOUT ROWID。主键列明确要求非空。只读连接可以设计和预览，不能创建。

设计草稿仅保留在当前设计器窗口中；关闭或退出后不持久化，需重新设计。预览取消不修改数据库。

文本默认值保留引号、非 BMP 和 NUL；NUL 使用固定 `char(0)` 及平衡拼接，兼容 UTF-8、UTF-16LE／BE，不把 UTF-8 BLOB 错当成数据库编码文本。整数限有符号 64 位，BLOB 接受完整 Hex，REAL 必须有限；普通 SQLite 类型亲和性仍可能转换值，严格类型和主键语义见 [SQLite CREATE TABLE](https://www.sqlite.org/lang_createtable.html)。默认值不接受任意 SQL 表达式。

## 执行与确认

- 三个固定 IPC：`sqlite.tableCreate.preview`／`apply`／`release`。公共输入没有路径、SQL、连接对象、持久化回调或操作编号；Main 从已授权的连接捕获原文档、修订和连接代次。
- 预览仅使用独立物理只读连接，读取目录版本及名称占用，不发送 DDL。执行 SQL 和原设计留在有界临时能力表，Main 仅保存目标和摘要；修改设计、导航、换连接、取消、过期或关闭后不能继续使用旧预览。最终 IPC 发布前再核来源。
- 确认时单次消费预览；错误确认及只读拒绝准确记为 `not-sent`。独立读写连接使用 `BEGIN IMMEDIATE`，在锁内重核文件身份、目录版本和名称，原子创建表及索引，不使用 `IF NOT EXISTS`、替换或自动改名。
- 外键跨表错误可能在准备 DML 时才能发现。本流程使用固定 `EXPLAIN INSERT … DEFAULT VALUES` 触发原生编译检查，绝不执行原 INSERT，也不依赖 EXPLAIN 的输出格式；依据 [SQLite 外键检查](https://www.sqlite.org/foreignkeys.html) 和 [EXPLAIN](https://www.sqlite.org/lang_explain.html)。确认 `sqlite_schema` 的完整定义后才提交；失败整批回滚，回滚未确认则保留未知状态。
- Main 在 COMMIT 前同步保存最小事实，提交 ACK 不因最终响应或关闭失败而降级；重启将未完成阶段恢复为未知，不重放设计。只记录准确目标、随机操作编号、请求／已处理 DDL 语句数及事务确认，不存设计、默认值、SQL、路径或原错误到任务概要。
- 任务中心展示实时建表类别、原目标、语句数及提交／回滚／未知回执。已处理语句数不代表已提交；COMMIT 可能发送或结果未知时取消保持关闭，迟到状态不能重新授权。设计器停止请求仍等待原事务结果，不能据此宣称撤销提交。

预算为 128 字段、32 索引、32 外键、每键 32 字段；单默认值 64KiB，设计整体 2MiB，预览 64 项／64MiB／5 分钟。声明类型整体引用，不把字段类型文字解释为约束或额外语句。

## 验证与后续

本轮 WIN11-TEST 不可达且未派发任务，按既有授权使用本机 Windows 独占配置及合成 SQLite。不访问 Server-200、剪贴板或已安装客户端数据。

首轮共享、Main、真实 backend、组件、导航、旧设计器和配置恢复专项通过；UI 夹具最初在安装内存 `window` 前加载 store，修正加载顺序后 20 项通过；原类型检查另报自引用 mock 未显式标注类型，补类型后通过。静审发现错误确认被误归未知，已在 Main 分发前核对并保单次消费，新增零执行回归。原失败日志保留，没有放宽业务断言、预算、超时或资源保护。

首次完整 21,236 项通过／1 平台跳过、构建及 Windows 建表窗口 15.1 秒和原查询窗口 10.7 秒单次通过。随后发现实时任务 store 尚未消费新回执，补齐任务中心和取消状态；末轮检查又补齐 Main 全局任务编号命名空间，防止与原有分页／完成任务冲突。以上候选结果分别保留，不冒称最终候选结果。

最终 `pnpm build` 严格类型及构建通过；`pnpm exec vitest run --maxWorkers=4` 为 1,041 文件、21,269 项通过，另 1 文件／1 项 POSIX 用例因 Windows 平台跳过，原 5 秒门保持。串行运行 `node scripts/sqlite-workspace-ci.mjs table-create` 和 `workspace`，分别单次 18.6 秒、10.6 秒通过，120 秒、单 worker、零重试及关闭 trace／视频／截图保持。

Root 从最终原始报告独立核对六类字段设计、原生两条 DDL、准确 COMMIT ACK、目录冲突零 DDL／ROLLBACK ACK、任务中心两份真实回执、原表及外部变更保持、默认值／唯一性／STRICT／延迟外键及独立测试写入全部回滚。应用没有用户 DML、查询会话、历史或私有默认值持久化；原工作区回滚、提交后重启读回及草稿恢复保持。合计四次正常退出，两座准确临时目录已删除，仓库测试 Electron 残留为零。

最终私有原件在 `.cache/sqlite-table-create-20261101/`：`build-delivery19.log`、`unit-delivery20.log`、`native-delivery21.log`／`native-delivery22.log`、对应 `*-results/report.json` 和两份 `native-*-delivery-independent-audit.json`，不入库。三平台 CI 增加 `table-create` 源码专项；新提交的远端及安装验收另记。

已有表结构重建设计、CHECK／生成列／表达式索引、更多原生拒绝的逐项诊断及导入仍继续开发。本增量不代表完整 R02 或 Navicat 全功能完成；新建表的 Mac 两架构、安装包及物理系统交互分别验收，暂不正式发布。
