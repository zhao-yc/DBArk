# Navicat 行为研究与 DBArk 实现依据

记录日期：2026-10-13。本研究针对本机 Navicat Premium 17.0.8 x64，目的是确定数据库工具的可见行为与兼容边界。DBArk 使用自主编写的 Electron/React/TypeScript 实现。

## 样本身份与工具链

| 项目 | 实测结果 |
| --- | --- |
| 目标 | 本机 `Navicat Premium 17/navicat.exe`，文件版本 `17.0.8.0` |
| 格式 | PE32+，机器类型 `0x8664`，x64 原生程序 |
| 大小 | 88,929,576 字节 |
| SHA256 | `ebc0cc7a7d8d45a1671f0cfbb3690b6b8e27e48e38f8f36acf09f40f3e07b739` |
| REA | `6.4.0`，本地 CLI 与独立 stdio MCP 会话 |
| Ghidra | `12.1.4`，发行包摘要已与官方 GitHub 资产元数据核对 |
| Java | IDEA 自带完整 JDK `25.0.2`，REA 校验通过 |
| 平台校验 | REA `doctor --provider ghidra` 返回 `healthy=true`；Windows 原生进程、DACL、NTFS 校验通过 |

安装和复现命令见 [research/README.md](../research/README.md)。所有原始证据保存在忽略目录，公开文档只保留身份、方法、脱敏结论及未确认项。

## 已取得的证据

1. **REA 资源清单**：`inspect-pe-resources` 成功完成，对资源表检查 7,164 项，记录 3,577 个资源；证据 ID 为 `ev_bc5d8e3bf7caf9e8d23878899e4f81f0dfb92d5dc222d1c9867b22205d7d9415`。只用于核对样本身份和资源范围，没有复制图标或界面素材到应用。
2. **只读 PE 导入清单**：主程序包含 42 个导入库，其中引用 `libcc.dll`。同目录 `libcc.dll` 包含 `ssh_channel_open_forward`、`ssh_connect`、`ssh_userauth_password`、`SSL_connect` 等导入项，及 `mysql_real_connect`、`mysql_real_query`、`START TRANSACTION` 定向字符串线索。其 SHA256 为 `ba832287f1ead9c4dca7ffa1f3fe8a3721718c782c93f2a6f06da020833d45a2`。这些证据只说明静态依赖和字节存在，不能证明某个 UI 按钮的实际调用链。
3. **随附手册**：本机安装目录的 `navicat.pdf` 共 346 个 PDF 页面。页号以下均指从 1 开始的 PDF 页码，正文印刷页码通常少 1。手册描述与本次实际操作验证分开标记，不把文档说明当成运行抓取。
4. **Ghidra 主程序分析未完成**：真实执行 `rea inspect navicat.exe --provider ghidra --format json --snapshot ...`，启动上限设为 `900000` 毫秒。REA 返回 `provider_timeout`，失败操作为 `list_documents`；未取得主程序反编译结果。被管理的 Java 进程已退出，原始文件 SHA256 复查一致。该结果不能用来推断程序没有相应功能。
5. **REA/Ghidra 驱动分析完成**：通过同一 REA MCP 会话分析随附的 `libmariadb.dll`，大小 457,728 字节，SHA256 为 `0e84673c6a297fec57b4f9aa452b05b56969de165ae666ab55de3896e1104273`。首次 `binary_overview` 用时 47,168 毫秒，记录 1,234 个过程、1,759 个字符串。连接、执行、取消、提交、回滚的五个公开函数均取得非空伪代码及传入引用证据；证据包导出和 `close_binary` 均成功，结束后原始摘要不变。

### 驱动层的定向发现

| 函数 | 目标内虚拟地址 | 已观察的静态事实 |
| --- | --- | --- |
| `mysql_real_connect` | `0x180006e20` | 存在插件查找、状态初始化和间接连接调用；尚未解析所有插件分支 |
| `mysql_real_query` | `0x1800073a0` | 调用内部命令接口并处理查询结果；伪代码包含无法恢复的间接跳转提示 |
| `mysql_kill` | `0x180007560` | 将目标线程参数交给内部命令接口；未建立 Navicat 停止按钮到该函数的调用关系 |
| `mysql_commit` | `0x1800060e0` | 引用管理器确认调用 `mysql_real_query`；实读目标常量为 `COMMIT` |
| `mysql_rollback` | `0x180006100` | 引用管理器确认调用 `mysql_real_query`；实读目标常量为 `ROLLBACK` |

可发布的证据编号、样本摘要和分析状态保存在 [evidence-summary.json](../research/evidence-summary.json)。REA 的主概览证据编号为 `ev_6819f39c0e8b569432962da5f22c027382c46b4bc56f8b169292b2114300c764`。原始伪代码和引用列表仅留在私有证据目录。

Ghidra 对 `mysql_commit` 与 `mysql_rollback` 报告了终端调用的控制流边界提示，对 `mysql_real_query` 报告间接跳转恢复限制。因此这些结果支持公开客户端 API 的静态调用关系，不能视为原始源码或整个程序行为等价证明。DBArk 仍通过公开驱动 API 自主实现数据库行为。

## 行为、实现与验收对应

| 行为 | 参考证据 | DBArk 实现决定 | 验收方式 |
| --- | --- | --- | --- |
| 直连与 SSH/TLS | 手册第 40、48、50-51 页描述数据库身份、CA/证书、SSH 转发与独立认证；PE 导入提供 SSH/TLS 静态线索 | `mysql2` 管理数据库连接，`ssh2` 建立转发；DBArk 校验主机指纹；每个阶段失败释放资源 | 正确与错误凭据、端口不可达、主机指纹不匹配、CA 不匹配、隧道断开；确认测试连接不遗留资源 |
| 选中 SQL、多结果、执行计划 | 手册第 126-127 页记录这些可见功能 | Monaco 执行选中内容或完整脚本；独立结果集；解释计划用数据库 EXPLAIN | 两个 SELECT、多语句中间报错、存储过程 DELIMITER、字符串内分号、EXPLAIN 返回展示 |
| 取消查询/数据加载 | 手册第 115 页描述停止正在执行的查询，第 85 页描述停止大数据加载；没有证明原产品采用何种取消协议 | DBArk 使用任务编号；取消操作须终止目标查询并结算资源状态，不自动重放写操作 | 单标签执行 `SELECT SLEEP(30)` 后取消，再执行 `SELECT 1`；另一标签独立会话不得被误取消 |
| 编辑应用与事务 | 手册第 84-85 页分别列出 Begin/Commit/Rollback 与 Apply/Discard Changes；驱动静态证据确认提交/回滚调用查询接口 | DBArk 表格收集变更、展示 SQL、同一事务提交；事务会话与标签页绑定 | 提交、回滚、关闭标签页、断线，以及另一会话检查未提交数据隔离 |
| 并发编辑与可靠行定位 | 未从手册或目标运行确认原产品的具体算法 | DBArk 自主约束：主键/可靠非空唯一键定位，完整旧值校验；冲突回滚整批 | 同一行在另一会话修改后提交应失败；无唯一键表只读；复合键、NULL、二进制和尾随空格 |
| 分页、类型和导出 | 手册第 85 页描述页大小，第 186-187 页描述映射与类型参数，第 206 页描述 SQL 文件操作 | 服务端分页、精确类型、完整流式导出；CSV 的 NULL 转义是 DBArk 自身协议 | 百万行只加载当前页；BIGINT/DECIMAL/微秒/JSON/二进制无损往返；导出不被界面行数上限截断 |

## 未确认事项

- 尚未记录 Navicat 对真实测试库的 UI 操作重放、网络/运行时轨迹；本记录不能据此声称已复现其内部架构或所有功能。
- 静态导入、字符串或独立驱动函数不等于 UI 到连接/查询/取消/提交的端到端调用路径。
- Navicat 的取消协议、连接复用策略、更新 WHERE 条件、并发冲突策略尚无完整目标级证据。DBArk 的明确行为由自己的接口、实现和测试约束。
- REA 官方将 Windows Ghidra 路径标记为实验性；当前成功结果仅适用于本次已观测的版本、文件和操作。

## 官方资料

- [REA Windows Ghidra 边界和配置](https://github.com/morluto/rea/blob/main/docs/windows-ghidra-p0.md)
- [REA CLI 与证据格式](https://github.com/morluto/rea/blob/main/docs/cli.md)
- [REA MCP 生命周期及首次查询超时](https://github.com/morluto/rea/blob/main/docs/mcp-contracts.md)
- [Ghidra 12.1.4 官方发行包](https://github.com/NationalSecurityAgency/ghidra/releases/tag/Ghidra_12.1.4_build)
