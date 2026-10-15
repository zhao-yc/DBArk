# Q01 会话上下文开发检查点（2026-10-15）

状态：0.16 开发中、尚未发行；本页是初始代码 fede8aa 之后的第二检查点，不能与其原生 CI 混算。完整 Navicat 目标保持进行中。

## 结果与实际入口

查询编辑器现从自己的固定会话缓存读取 ANSI_QUOTES、NO_BACKSLASH_ESCAPES 和实际默认库，面包屑也显示实际默认库。已有会话不再退回标签初始库。确认无默认库与未知默认库分开表示；跟踪关闭或错误后显示“默认库待确认”，仍可使用显式库来源。缓存接口不建连、不发 SQL、不改变 ROW_COUNT、警告、事务和临时表。

新连接的原有初始化 SELECT 增加 DATABASE() 列，并设置会话跟踪配置。随后只观察真实 mysql2 协议事件；没有可信报告时不猜测旧值。忙碌/断开时隐藏中间和过期状态。字段补全仍走独立短连接，编辑正文不被自动执行。

## 协议研究

研究入口在 `.cache/research-o16-schema.ts`，使用未修改实现的真实连接；每步额外读 DATABASE() 仅作为研究的旁观断言，不进入正式补全。新建随机隔离库，未创建新账号或授予库级/全局权限；结束后精确清理。

六实例分别保存 22 步研究原件：`run34-schema-mysql-legacy`、`run35-schema-mysql-eight`、`run36-schema-maria-ten`、`run37-schema-mysql-modern`、`run38-schema-maria-eleven`、`run39-schema-strict-tls`。前期 `run33-schema-research` 保留 17 步探索，没有伪装成完整 22 步；首次研究脚本的 CJS 顶层 await 编译错误也只属于工具入口，没有执行服务器操作。

真实结果：普通 USE、跨库 CALL 返回以及直接/动态删除当前库均可报告最终名称，空名称表示确认无默认库；关闭 schema 跟踪后 USE 不报告名称。恢复配置本身没有名称快照。MariaDB 10.11/11.4 支持预处理 USE，MySQL 5.7/8.0/8.4 返回 ER_UNSUPPORTED_PS；正式缓存不假设两者相同。

协议依据参考 [MySQL 会话跟踪](https://dev.mysql.com/doc/refman/8.4/en/session-state-tracking.html)、[MariaDB 会话变量](https://mariadb.com/docs/server/server-management/variables-and-modes/server-system-variables#session_track_schema) 和 [MariaDB OK 包](https://mariadb.com/docs/server/clients-and-utilities/server-client-software/client-libraries/clientserver-protocol/4-server-response-packets/ok_packet)。公开文档用于机制说明，具体基线结论以本次实际包和查询结果为准。

## 当前源码验收

以下路径均相对于本机忽略目录 `.cache/o16-sql-completion/`，日志、摘要和 JSON 原件保留，私密环境未提交。`run56-session-checkpoint.json` 核对 166 个 src 文件、package/锁与构建输入完全一致，单元定义也未在通过后改变。GUI 测试定义的通过后快照另存 `run48-passed-e2e-source.ts`。

| 层次 | 证据与结果 |
| --- | --- |
| 正式单元 | `run42-session-unit-full`，2003/2003、95 文件，9982 ms |
| 最终类型 | `run54-session-typecheck-final`，退出 0，14540 ms |
| 构建 | `run44-session-build`，退出 0，30698 ms，105 个 dist 文件 |
| 构建和许可 | `run44-session-build-attestation.json`，当前源码一致，三份实际许可逐字节相同；Worker 保持 2068097 字节，gzip 366090 字节 |
| Windows 源码 GUI | `run48-session-monaco-recheck`，7/7，0 跳过/重试失败/不稳定，进程总耗时 58595 ms |

七项 GUI 包含原四项补全流程，新增真实 USE 切库、已知 ANSI 双引号完整范围替换、跟踪关闭后不回退旧库、显式来源继续可用、通知恢复，以及两个标签保留不同默认库与模式。均使用真实粘贴、键盘定位、Ctrl + 空格与 Enter，并断言完整草稿。两标签用实际标签按钮切换，没有直接修改 Monaco 模型或伪造 IPC 结果。已查看本轮模式补全截图和首轮失败截图。

每实例 16 项包括原 7 项目录和新 9 项会话缓存：初始有库/无库、USE 后目录、原连接/事务/临时表隔离、ROW_COUNT/警告保留、模式报告、跟踪关闭与恢复、CALL 最终库、ERR 未知、忙碌快照和真实取消，以及预处理删除当前库。共 96 次用例通过。

| 实例 | 轮次 | 通过 | 进程总耗时 ms |
| --- | --- | --- | --- |
| MySQL 5.7.44 | `run49-session-mysql-legacy-recheck` | 16/16 | 20562 |
| MySQL 8.0.46 | `run47-session-mysql-eight` | 16/16 | 30646 |
| MySQL 8.4.11 | `run53-session-modern-final` | 16/16 | 20148 |
| MariaDB 10.11.19 | `run50-session-maria-ten` | 16/16 | 13553 |
| MariaDB 11.4.13 | `run51-session-maria-eleven` | 16/16 | 13602 |
| MySQL 8.4.11 严格 TLS | `run52-session-strict-tls` | 16/16 | 24855 |

真实驱动连接保留原网络和回调，只旁观记录已分配的服务器编号；套件结束逐 ID 核对释放。最终独立 `run55-session-resources-cleanup.json` 时间 UTC 2026-10-15 01:46:15.836：六实例本批库、账号、相关线程均 0，桌面进程与本批新临时目录 0，13 个旧目录保留。没有运行本机或远程 Docker 命令，没有生成需长期备份的新密钥或证书。

## 原始失败

- `run40-session-cache-modern` 为 14/16：新断言按显示列名访问行，实际结果使用稳定列键。按真实结果列键读取后 `run41` 完整 16/16。
- `run45-session-monaco` 为 6/7：旧事务用例在网格首帧前同步读到空文本；失败截图已显示正确连接编号和 BIGINT。改为等待完整文本一致后 `run48` 七项全部通过，未放宽数据一致性要求。
- `run46-session-mysql-legacy` 为 14/16：新测试库没有指定字符集，继承 MySQL 5.7 的 Latin1，中文测试值被服务器拒绝。隔离库显式 utf8mb4 后 `run49` 完整 16/16；没有删除中文覆盖或改变产品编码。
- 目标续跑中断时，run44 已由磁盘摘要确认成功；run45 目录和进程均不存在后才首次启动。归档脚本运行时变量重置造成的工具错误已从磁盘恢复，不把缺失句柄或工具异常当作产品验证成功。

## 仍需完成

临时对象目录、选择列别名及复杂作用域、SSH、当前源码完整旧流程和实际安装/跨平台/公开文件继续推进。第一检查点原生 CI 的 23 离线/107 私网跳过只属于 fede8aa，不能用于本页新源码。

静态核对还发现历史记录和保存查询仍使用初始标签库；切库后历史重开、保存重开、断线重建和恢复标签的上下文必须接着修正，避免把 B 库语句重新绑定到初始 A 库。当前正确的补全和面包屑不等于这些路径已完成，0.16 不据此创建发行标签。

后续修复及独立验收见[第三检查点](acceptance-q03-query-context-20261015.md)。本页保留第二检查点当时的边界，不能用第三检查点结果反向修改当时源码的验收状态。
