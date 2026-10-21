# 表数据嵌套筛选：Windows 源码实库验收

## 来源与源码检查

仓库 `D:\svn\DBArk`，`main` 产品提交 `295af1bbaa783e3cf70c078b86c49b0fbf0368c1`；成功原生实测提交 `5dc77a25f7b970729eb5c9b8b94129c5d2376fc3`，产品树均为 `ff38cc7248623225465116ad7b52b29e6fe0e90a`。后者只修正测试定位器并记录失败，没有修改产品或重建替代原字节。

本机 Windows 授权回退：相关 11 文件 217 项、另 8 项映射检查通过；补齐跨页／替换／复制／粘贴夹具后四文件 125 项通过。最终完整 `pnpm exec vitest run --maxWorkers=2` 为 **628 文件通过、1 文件跳过，12218 项通过、1 项 POSIX 条件跳过**，退出 0，253.60 秒。类型及新 109 文件构建通过，Vite 34.10 秒，原注释／体积提示保留。

最初扩大检查的 4 项夹具失败及首次完整的 **12111 通过／102 失败／1 跳过**均保留；四个夹具提取的原 TableTab 函数缺少新 `filterGroup` 变量，断言前即 `ReferenceError`，没有提高超时或移除断言。完整复验后仅补测试基准的明确数值 CAST、修正测试定位器，原生声明与审计门另 30 项通过。详见[实现和失败记录](../../docs/development/table-filter-groups-20261022.md)。

完整成功日志 `.cache/table-filter-groups-full-unit-fixed-20261022.log`，SHA-256 `28c287ac352cb406623bf5e8fc3cb11dec5012a4d2a0ca306ab51df7efc715ff`；原完整失败日志 `.cache/table-filter-groups-full-unit-20261022.log`，摘要 `913aec5c959efa0b7c174b2d529f9896709c649f14b36f5d51b5cca90a7f5f9f`。

## 首次原生失败保持

准确 `295af1bb` 的 CLI PID64576，UTC `2026-10-21T21:35:14.1303248Z`—`21:35:53.4073919Z`，退出 1、39.3014684 秒，报告 1 失败、0 重试。已走过真实分组、81 行两页、末位小数、两级排序及停用叶的前置断言；方案区域定位器的 `has` 内层重复带入外部表祖先，在填写方案名称时 30 秒超时。方案保存、正常退出和清理未完成，原窗口及隔离库继续保留，没有借后继成功补退出或清理。

原 `.cache/table-filter-groups-ui-local-20261022/gui/stdout.log` SHA-256 `330366a5f83355b4078e535db3a34b6af849d1f3200532a8def68c12e0429508`；原进程回执摘要 `345c1200794d0c56a4f28b810809d0ac90198aaaf4e233c7428b47930ad001a4`。修正使用真实命名区域定位，不改断言、120 秒期限、重试数或全局审核门。

## 独立成功用例

新 `.cache/run-table-filter-groups-live-fixed-20261022.mjs` 固定 `5dc77a25` 与既有新构建；使用新输出目录、新随机 `dbark_e2e_*` 库和新所属客户端。INTEGRATION／TABLE_SORT／TABLE_FILTER_GROUPS 三门显式开启；默认列表只登记，不能计执行。

CLI PID **49740**，UTC `2026-10-21T21:37:38.6847671Z`—`21:37:48.7654955Z`，退出 **0**、10.1017202 秒；单例 **8833 毫秒，1 通过、0 失败／跳过／flaky／重试**。辅助连接逐次确认 200／13384 的 MySQL 8.4.11、Linux、大小写设置与准确 UUID。仅在自身新库创建 121 行夹具，不创建用户或改权限，不访问业务数据，无 Docker 或系统剪贴板操作。

实际 UI 添加 `(id<=60 OR id>=100) AND amount>=0.12345678901234567890`，其中 id60 比边界低最后一位。独立参数化 SELECT 使用手写 SIGNED／DECIMAL CAST 验得 81 行，不调用产品生成器。真实分组面板明确应用才读取，第一页 50 行、第二页 31 行；在第二页应用 `amount ASC／id DESC` 回第一页，完整两级排序和组树保持。逐个停用两个 OR 叶后该子组省略，恢复后仍得原精确范围。

命名方案通过真实本机控件保存、关闭面板再打开、清空当前条件、重新选择并应用，原分组及排序恢复；这是面板重开，不是客户端重启。Main 实际原 handler 审计：**15 次分页、1 次列偏好读取、方案 list=2／save=1／apply=1，pending=0、产品数据库写操作=0**，pageErrors 为空；任务均 completed。局部设置和方案写本机 SQLite，辅助夹具的建库／插入／删库不冒充零服务器写入。

## 资源及原字节核对

成功轮原客户端正常退出；辅助连接 prepare／cleanup／verify-absence 均确认原生正常关闭和 stream.closed。定义摘要及完整 121 行摘要保持，唯一表、例程、触发器、事件及连接均按精确目标核对，随后只删除成功轮自建库；Root 另以只读连接确认该库及其活动线程缺失。首轮旧现场没有参与本轮清理。

Root 复读 `.cache/table-filter-groups-ui-local-fixed-20261022/manifest.json`：**16 项、0 不符**，**2159** 项源码／测试／脚本及实际 dist 输入前后不变，私有配置不变，已知认证扫描 0 命中。

- 成功回执 SHA-256：`234321526ba7657f1e3c2c0495f704d7ffd456fd392c6fe3c10d142afbc603bd`。
- 原清单：`b1e28cb37f98e8b76a3ccd6350005a99c1cc279f6cc2ac09b70904fcec5a102c`。
- 实际 UI 审计附件：`1eb3bbc7e11228c45e6fd2bbfae0317f1d938ec6c68cc973e1c3bd7e3b7726d0`。

## 未验边界

新安装包、macOS、其它 MySQL／MariaDB 版本与 SSH/TLS 组合另验；关联范围和隐藏列复制来源的分组拒绝反例、草稿取消、ABA 及 SQLite 物理重开为专项 RAM／真实 SQLite 证据，不冒充本例全部原生组合。新 CI 另行回收，旧 `3a53efb8` 的 Linux／Windows 成功及 arm 取消不外推到本轮。暂不发布，不增加完整 Navicat 工作包计数。
