# 历史窗口状态定位修复

## 原因和修改

提交 `eb66e7f8` 的 [Windows CI 原失败](https://github.com/zhao-yc/DBArk/actions/runs/40370078612/job/121738133105)中，历史分页两个用例使用无名称的 `getByRole('status')`。历史清理增加选择数量后，该定位同时匹配读取进度和选择数量，Playwright 严格模式拒绝继续。原批次为 79 项通过、2 项失败、362 项条件跳过；不能据此声称安装包已经验收。

历史面板现在分别命名“历史读取进度”“历史筛选状态”“历史选择数量”和“历史选择提示”。旧分页及时间范围用例按准确名称定位读取进度；原扫描数量、匹配数量、损坏记录、停止策略、完整正文和资源检查保持。新增正式窗口用例验证全选后修改筛选时，原读取结果保留、选择清零、待应用提示独立出现，明确搜索后才改变结果。

本次仅增加状态的无障碍名称及测试定位，不改变历史查询、清理、数据存储或数据库行为，不新增 IPC。

## 验收边界

WIN11-TEST 本轮读取仍返回主机不可达，状态核对消息过期，未派发本轮测试。按用户明确授权在开发机接续，记录为本机 Windows 源码验证；不使用系统剪贴板、私网数据库或 Docker，不等同于虚拟机、macOS 或安装包验收。

本轮原始日志和进程退出码保存在忽略目录 `.cache/history-status-20261027/`，源码基于 `eb66e7f8`，改动摘要 SHA-256 为 `dfcd9e31cf2a89466dfa01f2d2786c23dce02feccb82b3d4fa08b2c7762f3ea7`。实际串行结果：

- `node scripts/typecheck.mjs`：退出 0。
- `node node_modules/vitest/vitest.mjs run tests/unit/history- tests/unit/ui-history- --pool=threads --maxWorkers=2`：15 个文件、294 项通过，退出 0。
- `node scripts/build.mjs`：退出 0；与类型检查合起来覆盖 `pnpm build` 的原两步。
- `node node_modules/@playwright/test/cli.js test tests/e2e/history-pages.spec.ts tests/e2e/history-time-filter.spec.ts --workers=1 --retries=0 --reporter=list,json`：实际启用 `DBARK_HISTORY_TIME_FILTER_TEST=1`、关闭实库，六项通过、零跳过、零重试，27.3 秒，退出 0。包含原四项历史分页/上下文/损坏记录/取消重启、新状态区分及时间范围用例。
- `git diff --check`：通过。

私有准备器首次把 Playwright 的 `Total: 6 tests in 2 files` 误写成另一种输出格式，故在列表检查后退出 1，尚未启动窗口；保留原日志，核对原四步均已退出 0、源码未变后，仅接续尚未运行的六项界面测试，没有重跑或追认该准备器成功。

原 CI 失败保留，不通过跳过用例、增加重试或延长超时追认通过。远端完整原生流程及 macOS、安装包、实库不在这六项本机结果中；本次继续源码开发，暂不发布。
