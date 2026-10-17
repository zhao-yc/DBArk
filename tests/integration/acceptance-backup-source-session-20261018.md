# 备份私有源会话真实检查点

作者固定 `31ef0e6`／`6e9cebc`，Root 整合为 `8389388`／`1b77356`。SourceSession 组合原 SourceReader 与 Source 检查器，保留原 Query、结果承诺、原生命令结束及本地记账。Root 8 项相关回归及类型检查通过；这不是新的完整套件结果。

独审初版四组为三绿一红：已经结束的旧 Query 迟到 error 时，仍继续后续 16 句并发布 completed。修复增加历史 Query 的永久失效观察和发布前一次全量复核。原正常／迟到错误两项窄复核通过，其余三组原绿不重跑；旧红保留。修复独审报告 SHA-256：`b0c65ba72008683deef7f3d5790b35e24d4dc306d69f75fc9546213940fb4b34`。已经发布的 Promise 是历史快照，Root 消费前仍须复核原租约、准确绑定及失效状态。

## 真实 MySQL 8.4.11

`run1488-source-session-actual` 与 `run1497-source-session-normalized` 各单次执行。先经既有 SSH 别名严格核对 200 宿主，再核专用实例的准确版本及 UUID。mysql2 3.24.5、既有凭据仅在 RAM；没有新建账号、授权或读取业务库。

每例各创建一个随机隔离库：数据库本身、三张 InnoDB／MyISAM／MEMORY 表、视图、触发器、过程、函数和禁用事件，共九对象、七类别。原 SourceSession → Reader → Source 实际执行 24 条元数据读取，各原 Query 结束及本地记账逐一确认；九份定义均有摘要，无未分类对象。没有插入测试行、取消请求或未决命令。

| 场景 | 定义会话及可见性 | 正确保留的阻断 |
| --- | --- | --- |
| 1488 默认驱动字符集 | 不满足定义规范化要求；七类可见性均 unknown，元数据 6781 字节 | session-definition-incomplete、七类 visibility、lock-capability-unproven、dependencies-unproven |
| 1497 专属连接显式 utf8mb4_bin | 真实字符集 utf8mb4、排序规则 utf8mb4_bin、SHOW CREATE 引号及生成主键可见条件均满足；七类 proven，元数据 6732 字节 | 仅 lock-capability-unproven、dependencies-unproven |

1497 通过的是连接选项初始化，没有修改全局配置或借用用户标签会话。五个非表对象仍需证明 DEFINER／完整程序依赖；不能把这些待验记录称为已确认的外部依赖，也不能为通过测试删除它们。两例 actualLockHeld 均为 false。

每例先确认原命令全部结束，严格关闭原 source 流，再经独立控制连接重新核同一实例及本例表标记，才精确 DROP 本例随机库。控制端确认库及原 source 服务器线程不存在，再关闭原控制流。创建加删除共十条夹具 DDL，原始数据行写入为零，全部自有流真实 close。

| 原始摘要 | SHA-256 |
| --- | --- |
| 1488 summary.json | `eaeeca6408e1aa3ae0a3ede839fd79aee342fe2dd99a65b2e86d432a9ced2136` |
| 1497 summary.json | `9f1ffe3d09f9f7d7217adfb0b4e9fdbfcb5e8e86b6aee5c5e106def47800982c` |

Root 当前四份输入源码摘要与实际固定作者字节相同。原始定义、授权、连接身份及恢复账本留在私有忽略目录，不进入仓库。本次没有 Docker、系统剪贴板、持锁、CLI dump、备份文件、恢复或 Main／IPC／UI 产品入口。专属连接工厂、依赖证明、全对象锁连续性及完整备份工作流继续，不能据此接纳完整备份能力。

后续固定 Root `cbb46f4` 的[完整 CI 39052439799](https://github.com/zhao-yc/DBArk/actions/runs/39052439799) 已成功：429 文件／8017 通过／10 跳过，类型和构建通过。原始 job 117453572468 日志 SHA-256：`bea9460ba1fa891bb4be6c99b6d58cc551addc35e98971acae1eda87fc238464`。该头包含本源会话，不含随后锁原语或补全增量；桌面和发布阶段按普通分支门跳过，不据此新增原生或公开发行验收。
