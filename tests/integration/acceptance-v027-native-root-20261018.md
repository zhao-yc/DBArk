# 0.27 常用文件与新表属性：Windows 源码实际验收

固定测试头 `b3125098df2adc934e10da65ec3ef4f2a8f2caa4`，产品构建 `50626ec69cc20df699c9073a29640510ef6bf36c`。2026-10-18 的 `run1835` 两个正式身份同轮通过：CSV 7015ms，新表 6797ms，总计 15678ms，0 失败／跳过／重试。仅 Windows 源码窗口与准确 Server-200 MySQL 8.4.11，不是安装包或 macOS 验收。

运行前通过 `ssh server-200` 只读核对 Server-200／root 及机器身份摘要，未使用 Docker。Root 批准的源码清单为 112 文件，其中 108 个编译文件逐项匹配原构建；清单 SHA-256 `498ed2252b722804da99e378f74e5a32b3a8feadb2396b691a78940669e4b888`。私有凭据仅在本轮 RAM 和直接子进程环境中提供，关闭 trace／截图／视频，不操作剪贴板。

| 正式身份 | 实际验证 |
| --- | --- |
| CSV 分隔符、映射失效与正式文件导入 | 逗号／分号／Tab 三份 UTF-8 文件从真实 TableTab／TransferDialog 进入，Main 签发三个真实文件令牌，三次导入各两行。分隔符和编码切换撤销旧映射；该样本按 UTF-16LE 的空字段预览不能沿旧映射提交。独立读取七行，精确比较 UINT64、正负 DECIMAL(30,12)、NULL／文字反斜线 N／空串、BLOB HEX、引号／CRLF／emoji；原目标旁行和邻表不变。 |
| 新表时间属性、前缀索引与单次 CREATE | 三种错误组合在读取目标准备前拒绝；普通时间和前缀索引两次真实 SQL 预览均核目标表尚不存在、apply 为 0。准确确认后正式 apply 恰好一次，两次 get、两次 preview、一次 apply 的五个任务完成；SHOW CREATE／COLUMNS／STATISTICS 核 DATETIME(3)、TIMESTAMP(6)、DEFAULT／ON UPDATE、普通时间列、前缀 12 和旁列默认值，表保持 0 行、邻表不变。 |

唯一文件选择回答使原 `showOpenDialog` 返回本例固定输入路径；返回草稿确认另用原 page 私有句柄对准确 `window.confirm` 提示回答一次并立即恢复。两者均不代表人工操作系统弹窗验收。原 UI、preload、Main 文件授权、Engine、数据库结果、SQL 预览和执行控制流均未替换；Main 旁观审计仅保存有界计数／布尔／枚举。

每例沿原 TestInfo／120 秒和正常退出门执行。成功 journal 均以 `desktop-cleaned` 结束，先真实退出／所属 PID 门，再核服务器事实、创建 ACK、nonce／case 标记、完整表集合和独立数据，精确删除本例输入与随机库、核缺席，原观察流正常关闭，最后准确桌面目录消失。Root 只读复核原 report、附件与 journal 前缀一致、两目录／输入缺席及本轮 TEMP 为空。原报告没有输出 PID 及原线程编号供独立外部审计，不能把 fixture 内检查写成额外的外部 PID／线程核零。

原始报告 `.cache/parallel-integration/run1835-v027-native-source-prefix-fixed/report.json` SHA-256 `af85e77b5bab91a5a1449aca8f209dbc998d43cc90d60b779b1ab45ab21a5266`；Root 复核 `.cache/parallel-integration/run1838-v027-native-postcheck/proof.json` SHA-256 `c91280fc950ff07938635e872e889beb3b93d6141c3c73fb9354a49bd168c594`。复核脚本首轮 `run1837` 因本地路径分隔符字面量语法错误未执行，修正后的只读 `run1838` 成功，未重跑 GUI 或补清理。

此前四轮原报告和失败现场保留，详见[逐轮记录](../../docs/development/daily-workflow-root-20261018.md)：错误编码预览期待、CAST 输出别名排序、CDP 确认二次回答、BIGINT 索引元数据字符串期待。它们均作为失败保留，后两轮各有独立 CSV 正式通过，未与新轮相加为更多不同用例。失败例的正常退出／清理未确认，不自动删除其目录、文件或随机库。

必要准备回归最后为五文件／84 项及类型通过；固定产品此前完整 CI 为 508 文件／9439 通过／10 条件跳过、类型与构建成功，二者不相加。此次不增加已公开版本；Windows 安装包、新能力 macOS、其它数据库版本／TLS、UTF-16LE／GB18030 实际 CSV 导入、时间列真实 DML 自动更新、其它表类型与百万行导入仍待各自验收。O01／F01 保持“部分”。
