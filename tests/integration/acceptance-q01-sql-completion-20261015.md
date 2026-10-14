# Q01 SQL 语义补全开发检查点（2026-10-15）

当前状态：0.16 开发中，尚未发布。实际入口、解析层和目录层已实现；Q01 工作包仍为部分完成。会话模式、USE 后默认库、临时对象与其它作用域边界继续开发，随后才进入完整发行验收。当前已公开开发预览仍为 0.15。

## 验收范围

本批使用实际 Electron/Monaco、本地解析 Worker、preload/主进程/utility process 和 mysql2。目录核心测试只连接事先核对身份的 200 专用实例。没有使用本机 Docker，也没有执行 Docker 命令。

权限测试沿用本次用户明确授权：在随机 `dbark_colperm_*` 库的 `subject` 表上，仅给本次随机 `cp_*` 账号授予 SELECT；密码只存在进程内存。其它目录对象由已有隔离测试管理连接创建，未给受限账号增加库级或全局权限。每套测试精确删除自己的账号和库，再核对残留。

核心七项覆盖目录前缀与特殊字符、第 270 张表、256 项及更多标记、视图/函数/过程分开读取、受限账号不可见其它对象、原事务/临时表/连接编号隔离、建连阶段取消，以及可信配置直接启动短读。原始版本有六项，最后一项和真实驱动连接记录随后加入。

测试只旁观式记录原 mysql2 驱动对象，网络响应与目录内容未替换。清理后按已取得的真实连接编号查询 PROCESSLIST；未取得服务器编号的建连中取消不冒充逐编号证明。独立资源检查另核对本批前缀、桌面进程和新临时目录。

## 已完成的分层证据

所有以下相对路径位于本机忽略目录 `.cache/o16-sql-completion/`；日志、输入摘要与 JSON 报告分轮保存，不覆盖先前失败。它们是本机开发证据，尚非公开资产。执行方式为项目真实 Vitest、TypeScript、Vite 和 Playwright 命令；私密环境不写入原件或仓库。

| 层次 | 当前证据 |
| --- | --- |
| 全部单元 | `run21-unit-final-checkpoint`，1962/1962，93 文件，0 跳过，9598 ms |
| 类型 | `run22-typecheck-final-checkpoint`，退出码 0，13160 ms |
| 当前构建 | `run20-build-licensed`，退出码 0，30752 ms；105 个 dist 文件 |
| 构建一致性 | `run20-build-attestation.json`，src、package 和锁摘要与构建输入一致 |
| Worker | `completion.worker-DqpMXn3h.js`，2068097 字节，gzip 366090 字节，SHA-256 `b6d24e944f6947e85db8acaf8b60fd584113b9a2c13b7a6b888ce36585ed45d2` |
| 许可 | 三份实际依赖许可逐字节相等，版本/哈希记录在上述构建核验原件；见[许可说明](../../docs/third-party-sql-completion.md) |
| Windows 当前源码 GUI | `run23-monaco-licensed-checkpoint`，4/4，0 跳过，36157 ms；此前修正后 `run10-monaco-ui-recheck` 4/4 |

GUI 四项通过真实粘贴、键盘定位、Ctrl + 空格触发、Enter 接受和撤销，核对完整保存草稿：

- 离线 CTE 显式投影，不连接数据库仍能补全，且不执行 SQL。
- 表别名、已闭合引用名完整后缀替换、第 20 张表之后的对象、显式库来源；任务与查询历史无新增记录。
- JOIN 的正确来源、派生投影、CTE 名称和 INSERT 列清单。
- 保留原 CONNECTION_ID、临时表的 BIGINT 精确值和未提交事务；外部观察连接始终看不到未提交写入，回滚后无新增行。

## 核心数据库矩阵

早期七项核心：MySQL 5.7 `run12-metadata-mysql-legacy`、8.0 `run13-metadata-mysql-eight`、8.4 `run11-metadata-lifecycle`、MariaDB 10.11 `run14-metadata-maria-ten`、11.4 `run15-metadata-maria-eleven`，各 7/7；严格 TLS 修正后 `run19-strict-tls-recheck` 7/7。以下在统一输入与取消文案后的最终源码上重新执行，全部通过，共 42 次断言用例。

| 实例版本 | 最终轮次 | 通过 | 进程总耗时 ms |
| --- | --- | --- | --- |
| MySQL 5.7.44 | `run25-final-mysql-legacy` | 7/7 | 21858 |
| MySQL 8.0.46 | `run26-final-mysql-eight` | 7/7 | 29474 |
| MySQL 8.4.11 | `run27-final-mysql-modern` | 7/7 | 21792 |
| MariaDB 10.11.19 | `run28-final-maria-ten` | 7/7 | 14920 |
| MariaDB 11.4.13 | `run29-final-maria-eleven` | 7/7 | 14795 |
| MySQL 8.4.11 严格 TLS | `run30-final-strict-tls` | 7/7 | 25014 |

`run32-checkpoint.json` 核对六轮核心、最后单元/类型/GUI和构建输入：164 个 src 文件、package 和锁文件的摘要完全一致。构建含 105 个 dist 文件，代码检查点有对应原件，不能把下一轮修改自动并入本轮通过范围。

实际版本在 `run24-checkpoint-resources-cleanup.json` 和最终 `run31-final-resources-cleanup.json` 再次只读核对，均与上述矩阵一致。最后检查时间 UTC 2026-10-14 18:27:39.749（北京时间 2026-10-15 02:27:39.749）：六实例本批库、用户及相关线程为 0，桌面进程和本批新临时目录为 0，13 个更早目录保留。

## 原始失败与修正

1. 最初类型检查的两个新接口类型问题已修正，原工具输出保留；`run01-typecheck` 随后通过。新目录单元先 29/29，加入真实回调生命周期后 36/36。
2. `run02-metadata-mysql-modern` 为 5/6。新测试把 COUNT(*) 期望写成数值 1，实际驱动按项目精度约定返回字符串 `"1"`。修正断言后 `run04-metadata-recheck` 完整 6/6。首轮清理独立核对无残留。
3. 词法首轮为 49/51：一项新断言的长度期望不正确；同时发现 `$` 是名称字符时，扫描会吞掉紧邻的自定义 `$$` 分隔符。修复 token 边界并明确未闭合引用名的保守编辑后，51/51。
4. 语义首轮为 26/28，发现第三方库未提供 INSERT 列候选，且 UNION 两侧的表可能处于同一语句范围。适配修正后 28/28；继续添加 WHERE/连接条件/排序字段不得冒充派生投影的回归，并限制实际 SELECT 投影范围。
5. `run08-monaco-ui` 为 3/4。新事务测试把多结果默认显示的首个 DDL 完成信息当成 SELECT 快照。改为先单独读取实际会话与临时表快照后，`run10` 和当前 `run23` 均 4/4；无对应产品会话隔离缺陷证据。
6. `run16-metadata-strict-tls` 为 6/7。取消发生在读取 CA 时，底层文件 API 返回英文 `The operation was aborted`。产品 `connect` 的取消出口统一为中文后，原测试不放宽，`run19` 完整 7/7。

最初类型、局部单元和独立库评估记录位于 `.cache/o16-parser-eval/` 或原工具输出，后续正式分层记录位于本页列明的目录。所有描述均为 DBArk 自身实现与测试结果，没有新增 Navicat 动态或反编译验证结论。

## 尚未验收与下一步

- 会话缓存的 ANSI_QUOTES/NO_BACKSLASH_ESCAPES 与 USE 后默认库接入，临时对象和其它完整作用域；详细缺项见[实施计划](../../docs/plans/sql-semantic-completion.md)。
- 确定性复现目录读取中的取消、SSH、连接修订/跨标签的真实 UI 时序，以及更大目录和解析预算的端到端压力路径。当前真实取消证据只覆盖建连阶段，读取回调等边界已有单元验证。
- 原有全部桌面流程、当前版本本机 NSIS 安装、三平台原生源码及真实安装、公开资产独立下载，均未以本批结果替代。0.15 的完整 126 项和原生/公开证据只属于该版本。
- SQL 压缩、选择列别名、LATERAL、窗口/例程局部名称、其它驱动以及 Navicat 全功能清单继续推进。当前不创建 0.16 标签或公开发行资产，目标持续进行。
