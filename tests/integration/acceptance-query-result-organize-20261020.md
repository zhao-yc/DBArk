# 多列排序与结果筛选：Windows 实库界面验收

## 固定来源与范围

2026-10-20，Windows x64、Electron 44.7.0 源码客户端，MySQL 8.4.11、Server-200 的 13384 隔离实例。SSH 已核主机为 Server-200、地址含 192.168.31.200；同一命令先核主机，再只读定位该端口容器并读取 auto.cnf UUID，随后实际 TCP 观察连接核版本、Linux、大小写模式及相同 UUID。未操作本机 Docker、业务表或数据库对象。

用例固定 `e2269f6018443285df31b75874664f285ea28db1`，入口 `tests/e2e/query-result-organize.spec.ts`；产品修复为 `72e30357af37183ec8b4d9409456196203f0885c`。通过真实界面创建临时连接和查询，客户端业务 SQL 为既有三行常量 SELECT；另有观察连接的只读身份检查。认证仅由本地忽略目录驱动在内存注入子进程，不写入仓库或报告。

沿用原 lifetime、IPC 观察器和 desktop fixture：120 秒期限、零重试、原任务/窗口/观察流退出门，trace/截图/视频关闭。未增加宿主、窗口控制、强制退出或失败补清理框架。新旧两轮以下文件字节完全相同：

| 文件 | SHA256 |
| --- | --- |
| 新 spec | `564e100607fe6becaa53c4aa26e6830ab327709003627fae5461ab090498d59f` |
| 新 live 用例 | `f6163207a2a7cc4755742c13bf5b7840a3a4897de38259f8af5d789f4cebcd55` |
| 原 desktop fixture | `25c3cd000ab38b7040360e3141a342ed46ced812c832e52782bac95bea6992ee` |
| 原目标/退出 helper | `a0ec37aa8e9376a5f78654381df7f68c03f3bff9a7e3ddb7a0254e0b643ee603` |

## 原始失败与修复

首次 nonce `a9f5a1ff6fc944ceb1a11d9e4a131592`，产品 `1cfe8d9`，单次实际失败，无跳过或重试。多列优先级、AND/OR、空筛选及第一份 CSV 已走过，第二份 JSON 发现选到了原始第二行。导出模态把过滤/排序控制器绑定到 undefined，清空已完成视图；关闭后按显示位置勾选已对应另一条源行。

原报告 SHA256 `4f583143e0b4464968b38b50469cf8fae78aefe1dcddcb4140518ce81f6a1eaf`，保留于旧普通克隆 `.cache/query-result-native-20261020` 的忽略目录。本例未确认正常收尾，按门保留所属现场；未补读窗口、重试退出、删除或追认成功。

新普通克隆 `.cache/query-result-view-modal-fix-20261020` 只修 QueryTab 快照寿命：模态/保存锁保留已完成视图，操作许可继续沿 busy、活动标签、选择租约及模态守卫。补所选行/全部已返回的连续 CSV→JSON 两例，确认视图保持、旧选择及旧复制仍失效。修前该文件 55 通过/2 失败，修后 57 通过；确认背景网格红灯报告 SHA256 `71da859b417fd19d8da0e4e0fedeaee2bf2a99bfb0398e9236ba94e5e59adf5e`。首版测试曾误取导出预览，已在修产品前纠正并再次复现；原报告均保留。

## 新窗口实际结果

新 nonce `709413cddb4546b58e17455af4fa6bde`，产品 `72e3035`，相同用例和身份配置，单次 **1 通过、0 失败、0 跳过、0 重试**，7668ms。报告 SHA256 `04b0e01d3e237b2425407d5b81836f9b02293ba53e505e7c13c3a6a160b6f586`。

覆盖实际列显隐重排、精确 BIGINT/DECIMAL 多列排序与优先级调整、草稿取消、AND 空结果、OR 恢复、清除筛选、过滤后再次排序及恢复过滤顺序。最终两行连续导出 CSV/JSON，模态关闭后筛选保持；审计核客户端常量查询仅执行一次、两个实际文件任务完成、历史未额外增加。原期限内正常确认窗口及原 PID 退出、观察原流严格关闭，临时用户目录沿原 fixture 清理。

| 实际文件 | 字节 | SHA256 |
| --- | ---: | --- |
| CSV | 177 | `a8d7e0d2949aec1d5ba342b1cd6bb9c30d98901c1edacbb17fc021c5a8cf9048` |
| JSON | 321 | `fd0979ab54e513de5b565d11a2dfa1174cccc4b18393a8d338b813c26aeb4678` |

Root 另用 Python 标准 csv/json 独立读回全部字段，核列序、精确字符串、NULL、空串、二进制和隐藏列排除；目录只含两份输出，无临时文件。数据及原始报告仅保留于本轮忽略目录，不入库。

实际子命令为 `node node_modules/@playwright/test/cli.js test tests/e2e/query-result-organize.spec.ts --workers=1 --retries=0 --reporter=json`。需显式满足 integration、columns UI、organize UI 三门及原 helper 全部目标配置；默认/列表不加载 live。准备阶段类型、40 项守卫及构建通过；修复后类型、12 文件 250 项相关测试及构建通过，入口 100.45 秒。

修复后的完整回归：`node node_modules/vitest/vitest.mjs run --maxWorkers=4 --reporter=json --outputFile=.cache/modal-view-full-unit.json`，**570 文件全部通过、10869 项通过、0 失败、1 平台条件跳过**，172.07 秒。唯一跳过为 Windows 不适用的 POSIX 严格 umask 检查，未改测试或超时。原报告 SHA256 为 `348d8069800484590a5befc17f47f72dca32adb941cd4b883d8487e2712cb04a`，保留在本轮忽略目录。

这是 Windows 源码/实际 MySQL 界面和文件验收；列头修饰键经 Playwright 真实页面事件执行，不等同 OS 全局快捷键。copy 仅合成当前页 DataTransfer，未操作系统剪贴板。安装包、其他数据库基线、SSH/TLS、macOS 和真实性能仍未覆盖。暂不发布，0.28 冻结候选及旧失败保持。
