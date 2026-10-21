# 勾选值筛选：Windows 源码实库验收

## 准确版本及本地检查

仓库 `D:\svn\DBArk`，`main` 实测提交 `8a2b81457db2da095b12e08825cacc8cdb6b8336`，产品 `src` 树 `100267fb9c98866a64e0b11dd5058f92ac1077c4`。先行修正单测平台夹具的提交为 `bf70fd14`，其 [Linux 原失败与根因](verification-presets-restart-linux-gate-20261022.md)独立保留。

初次纯逻辑与选择控制器为 64 项通过，相关十文件 489 项通过；补足生命周期反例后组件为 206 项，随完整回归通过。完整命令 `pnpm exec vitest run --maxWorkers=2`：624 文件通过、1 文件跳过，**12112 项通过、1 项 POSIX 条件跳过**，退出 0，251.07 秒。类型检查及 `pnpm build` 通过，109 文件新构建，Vite 33.42 秒，原依赖注释／体积提示保留。完整单元日志 `.cache/query-result-selected-filter-full-unit-20261022.log`，SHA-256 `7e0d93492dc9c9fe31eef96941713c3219641a69e2269abed7b554dacb4fd8dc`。

沿用户授权在本机 Windows 回退；WIN11-TEST 原准备未创建新进程，未重试被拒绝的克隆／TLS，原现场保持。实际仅预检及连接既有 200／13384，核 MySQL 8.4.11、Linux、准确 UUID；无 Docker、服务器写入、系统剪贴板、认证截图或 trace。

## 单次真实 Electron

`.cache/run-result-selected-filter-live-20261022.mjs` 固定上述提交与产品树，开启 INTEGRATION／COLUMNS／SELECTED_FILTER 三门，调用原 Playwright `query-result-selected-filter.spec.ts`；默认 `--list` 仅登记关闭占位，不计执行。保持原 120 秒期限、0 重试及原 Main／owner／观察流检查，不替换产品控制器。

CLI PID **67588**，UTC `2026-10-21T20:59:57.5234315Z`–`21:00:13.4610234Z`，退出 **0**，15.9620093 秒；报告 **1 通过、0 失败／跳过／flaky／重试**，单例 14218 毫秒。

真实 UI 在原 `1／3／2` 两级排序中勾选不连续行，点击 BIGINT 列，核草稿完整候选值 `18446744073709551615` 与 `2`。取消不改视图；重新明确勾选后应用，结果为 `1／2`，完整两级排序保留；一次撤销／重做恢复相应行序。清筛选后验证全 NULL 列生成独立空值草稿并取消。之后原文本、区间、集合、嵌套分组、NULL／大小写、历史与两格式导出流程继续通过。

Main 原审计为 `queries=1`、`exports=[csv,json]`、`pending=0`、目标 `revision=0`；首次 SELECT 后历史不增，pageErrors 为空。原任务结算、正常退出及原观察连接关闭通过。复制仅使用 RAM 合成事件，不代表系统剪贴板验收。

## 独立文件读回与封存

Python 3.12.14 标准库单独解析 CSV／JSON，手写两行六列期待，拒绝重复字段，核 BIGINT／DECIMAL 字符串、NULL、空串、二进制和重复别名顺序，前后路径／句柄身份保持。Python PID **16420**、退出 0；控制脚本调用前／返回后 UTC 为 `21:00:31.0335736Z`／`21:00:31.1206697Z`，该范围不是原生进程创建／退出观测。原 GUI 回执保持“当时独立 Python 未执行”，没有回填。

| 输出 | 字节 | SHA-256 |
| --- | ---: | --- |
| CSV | 177 | `a8d7e0d2949aec1d5ba342b1cd6bb9c30d98901c1edacbb17fc021c5a8cf9048` |
| JSON | 321 | `fd0979ab54e513de5b565d11a2dfa1174cccc4b18393a8d338b813c26aeb4678` |

Root 复读本轮 `.cache/query-result-selected-filter-ui-local-20261022/manifest.json`：**18 项、0 不符**；**2150** 项源码／测试／脚本及实际 dist 输入前后不变，私有配置不变、已知认证扫描 0 命中。

- GUI 回执 SHA-256：`239911557a542017d3bd32023f8c22a0bca2215e2562f0deb3197e983812ac44`。
- 原封存清单：`a02a1f7344bca35fe702aca72d97227da13b309ea62a2c62d31b4a4017ad4ade`。
- 附加 Python 回执 `.cache/query-result-selected-filter-python-20261022.json`：`982199f75f41de0acce02edf9c7ce54e7afa16f93a41fcf28463d237b6682f91`。
- Python 脚本 `.cache/verify-result-selected-filter-20261022.py`：`8ce0a47126e57394ea97dc440e01ca27150cb991fcfec6c1a503f55bbc166f2a`。

## 边界

本轮为本机 Windows 源码客户端及指定 MySQL 8.4 实库。混合 NULL／空串、预算和旧回调反例为真实 React 控制器 RAM 证据；安装包、macOS、其它版本及 10 万行极限界面耗时另验。新 CI 另行回收，暂不发布，不增加完整 Navicat 工作包计数。
