# 命名整理方案：Windows 源码实库验收

## 固定版本与准备

仓库 `D:\svn\DBArk`，`main` 实测提交 `edd7bd57ef38b7fe91b248d3a999df1d7cc762b6`，`src` 树 `211de7353c685fc8ad72fc70c4cea429cad9bf21`。最终 `pnpm build` 类型与构建通过，Vite 30.55 秒；原注释／分块体积提示保留。

本轮完整单元首次 11886 通过／5 失败／1 平台跳过，旧 schema7 夹具误含后增可选表，另四项 Worker 原五秒门超时。修正准确旧版 11 表夹具、追加新表为空检查后，保持原超时，以两 worker 复验四文件 84 项通过；完整 `pnpm exec vitest run --maxWorkers=2` 为 **619 文件通过／1 跳过，11921 通过／1 跳过**。最后 UI 名称 C1 校验与四项回归，以及未用类型导入清理后，八文件 **352 项通过**，最终构建成功；完整回归先于该最后局部修正，不追认首次失败。

早期测试的错误模块路径、只读赋值、8 MiB Buffer 通用深比较超时及 Main AST 人造跨 realm 均保留原因和修正；另有真实旧按钮绕过刷新门的问题已加同步失效门禁，详见[实现记录](../../docs/development/query-result-presets-20261022.md)。没有提高超时、缩小配额或替换真实 SQLite。

WIN11-TEST 新准备在进程创建前被审批策略拒绝，原测试未启动，未重试被拒绝的克隆／TLS 操作。依据用户明确授权在本机 Windows 接续，VM 旧现场保持。只读预检及正式原观察连接均核对既有 200／13384 的 MySQL 8.4.11／Linux／UUID 身份；无 Docker、服务端写入、系统剪贴板、认证截图或 trace。

## 实际客户端单例

命令：`node node_modules/@playwright/test/cli.js test tests/e2e/query-result-presets.spec.ts --reporter=json --output=本轮独占目录`，由 `.cache/run-result-presets-live-20261022.mjs` 启用原 INTEGRATION／COLUMNS 与新增 PRESETS 三门。此前 `--list` 仅登记默认关闭占位，不计执行。

CLI PID **22180**，UTC `2026-10-21T20:12:56.6321453Z`–`20:13:13.0672855Z`，退出 **0**、16.457662 秒；报告 **1 通过，0 跳过／失败／flaky／重试**，单例 14653 毫秒。原 120 秒、强归属、原观察流和正常退出门保持。

实际 UI 在原重复列名／高精度三行查询上形成完整嵌套表达式及两列排序，设置 NULL 前后与大小写后依次：新建方案、预览完整条件／排序、仅重命名、关闭并清筛选／排序、重新选择应用、一步撤销／重做、第三次打开明确覆盖后删除。恢复行序为 `1／3`，删除方案不改变已应用的结果；随后原 RAM 合成复制及 CSV／JSON 导出通过。

Main 审计附件确认本地方案命令恰为 `list=3/save=2/rename=1/read=1/delete=1/total=8`，真实回包 token／source／CAS 均核验；仍 `queries=1`、`exports=[csv,json]`、`pending=0`、连接目标 `revision=0`，首次 SELECT 后查询历史保持，pageErrors 为空。原 `finish/afterEach` 的任务结算、客户端正常退出及原观察连接关闭检查通过。

## 独立导出读回与封存

另用 Python 3 标准库 CSV／JSON 只读解析，独立手写 2 行／6 列期待，拒绝重复 JSON 字段，验证 BIGINT／DECIMAL 原字符串、NULL、空串、二进制及重复别名的输出顺序。PID **44716**，UTC `20:13:47.7223477Z`–`20:13:47.8297957Z`，退出 **0**，文件句柄／路径及前后身份保持。原 GUI 回执仍明确该阶段没有运行 Python，没有改写其事实。

| 输出 | 字节 | SHA-256 |
| --- | ---: | --- |
| CSV | 177 | `a8d7e0d2949aec1d5ba342b1cd6bb9c30d98901c1edacbb17fc021c5a8cf9048` |
| JSON | 321 | `fd0979ab54e513de5b565d11a2dfa1174cccc4b18393a8d338b813c26aeb4678` |

Root 独立复读 `.cache/query-result-presets-ui-local-20261022/manifest.json` 的 **18 项，0 不符**；本轮 **2135** 项源码／测试／脚本和实际 dist 输入前后不变，私有配置不变、已知认证扫描 0 命中。

- GUI 回执：`085766c2e2ab2e39b8e60d06a3720277142a725928390b56af72f22f8e6fecc2`。
- 原封存清单：`c3c84fb98099a633c74071ab2a515d7279e267c340cb9560dde205d44725d163`。
- 附加 Python 回执 `.cache/query-result-presets-python-20261022.json`：`2027dbb47770a6d48ba591fa3c18283ee3aa0960d1382d011dcd2927dbdb1579`。
- Python 脚本 `.cache/verify-result-presets-20261022.py`：`c9a8210735201b9c69ae0089fbb670f9854b05e32ca9efa9608e5979a6dbdc68`。

## 未验边界

本轮为本机 Windows 源码客户端及指定 MySQL 8.4 实库单例。同连接跨标签为真实 React RAM 证据，跨启动持久化为真实 SQLite 关闭重开证据；未追认为客户端原生重启验收。新安装包、macOS、其它数据库版本及 VM 几何另验。新提交 CI 另行回收；暂不发布，不增加完整 Navicat 工作包计数。
