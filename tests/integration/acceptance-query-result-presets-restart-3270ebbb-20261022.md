# 命名整理方案：真实客户端独立重启

## 固定版本和边界

仓库 `D:\svn\DBArk`，`main` 实测提交 `3270ebbb3b945ed74752fd97233841e2864e229d`，产品 `src` 树仍为 `211de7353c685fc8ad72fc70c4cea429cad9bf21`。本批只新增测试，没有改动产品或重建既有 dist；Root 逐字节核对上一轮成功构建的 dist 后签发运行清单，实际 EXE／appPath／resources、主进程／启动器／窗口／renderer 身份在两代启动和退出前分别复核。

继续使用用户授权的本机 Windows 回退：WIN11-TEST 仍为原克隆启动前审批拒绝、测试未启动且空闲，没有重试被拒操作或接续旧失败进程。本例不用 Docker，不改服务端资源，无系统剪贴板、截图、视频或 trace。临时密码只在测试 worker 内存和客户端表单出现，Electron 子进程只继承桌面环境白名单。

## 准备检查

新增声明门禁、原 handler 审计及双 owner 适配器。默认／`--list` 只登记一个未执行占位，不读凭据或身份清单。正式三门为 `DBARK_INTEGRATION_ENABLED=1`、`DBARK_QUERY_RESULT_COLUMNS_UI=1`、`DBARK_QUERY_RESULT_PRESETS_RESTART_UI=1`，另须 Root 原运行清单与摘要。

首轮 runtime 为 **18 失败／3 通过**，原因是 RAM `lstat` 夹具局部变量遮蔽目录造成 TDZ；联合首轮仍 **18 失败／69 通过**。类型检查同时发现该夹具三个类型错误及 MySQL wrapper 到原 observer 弱接口的一处类型断言缺失。仅改夹具变量名和窄类型断言，真实同流门保持；最终五文件 **124 项通过**，类型检查通过。固定后另补每次准备轮询的 owner 前后检查，未增加期限或重试，产品未改。

## 两代真实客户端

实际 CLI：`node node_modules/@playwright/test/cli.js test tests/e2e/query-result-presets-restart.spec.ts --reporter=json --output=本轮独占目录`。

原 CLI PID **56180**，UTC `2026-10-21T20:34:37.2796145Z`–`20:34:48.3949371Z`，退出 **0**、11.1382437 秒；报告 **1 通过，0 跳过／失败／flaky／重试**，单例 9271 毫秒。保持原 TestInfo 单调 120 秒，不从重启重新计时；每代启动前均用准确 200／13384 只读身份查询核 MySQL 8.4.11、Linux、UUID，并严格关闭原 native 同一 stream 后才启动。

1. 第一代通过真实连接表单创建不记住密码的连接，执行一次常量 SELECT。通过界面形成 AND 根／OR 子组、高精度小数上限、停用原文、两列优先级、NULL 前后与大小写；新建并预览“重启保留整理”。随后明确关闭查询草稿，等待空工作区及全部任务结算，再正常退出。
2. 仅在第一代 `will-quit`、close 及全部已记录 PID 消失后，直接只读同一本例 SQLite：schema9、完整方案、1 条历史／1 个完成任务、秘密槽 0、无临时密码明文。未调用产品存储构造器或写盘。
3. 第二代从同一 userData 独立启动，连接 ID 保持且临时密码已消失。真实编辑连接表单重新填密码、不持久保存，再执行相同常量 SELECT。通过方案列表选择并预览原完整方案，手动应用后真实 DOM 行序恢复 `3／1`；一步撤销恢复 `1／2／3`，重做恢复 `3／1`。
4. 第二代正常关闭查询及客户端后，再读 SQLite：原方案文档精确相同，2 条历史／2 个完成任务，秘密槽仍 0、无密码明文。两代各记录 6 个所属 PID，均确认退出；最后仅删除并核实本例配置目录不存在。

原 Main handler 审计第一代恰 `list→save`，第二代恰 `list→read`；每代 `queries=1/pending=0/revision=0`，原 sender、主文档、source、CAS、token 和完整真实回包分别核对。第二代连接配置的当代修订从新 list 获取，不复用第一代 token。关闭工作区允许原 session 关闭并行及退出时的幂等 flush，关闭后禁止恢复非空标签或新增执行；两代 pageErrors 为空。

## 封存和未验范围

Root 独立复读 `.cache/query-result-presets-restart-ui-local-20261022/manifest.json` 的 **14 项，0 不符**；**2143** 项源码／测试／脚本和 dist 输入前后不变，私有配置未变，已知认证扫描 0 命中。

- 原 GUI 结果摘要：`8fcc8520faf70f242401293ef81897cebe3186362e61bd8de69b7b3681783b9e`。
- 封存清单摘要：`0da1dca2672894c0e79cabb515007e9d45ea44b97f7c3aa121a8deb7dd7adfc8`。
- Root 批准运行清单摘要：`0ea8ac57c2b71ad36dc7ea8b7e7165b71ec6f9c5887dc175c1a8606ac15f56fd`。

本例补足 Windows 源码客户端的原生跨启动恢复。此前原结果导出单例、独立 Python 读回、RAM 跨标签及 SQLite 迁移／配额证据各自保持；本例不产生文件导出。新安装包、macOS、VM 几何及其它数据库版本仍未外推，CI 分别回收，暂不发布，不增加完整工作包计数。
