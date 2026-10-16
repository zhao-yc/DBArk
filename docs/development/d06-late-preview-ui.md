# D06 迟到预览的原生组件控制链回归准备

日期：2026-10-16。员工5独立普通分支 `codex/d06-late-preview-ui-20261016`，固定父版本 `23446930f141ae1a42881be76be29283a6169819`。075 捕获替换分支保持冻结，本分支不包含该功能。

## 最小设计与证据边界

复用现有 `tests/fixtures/page-find-replace/index.html`、`main.tsx`、`electron.cjs`，运行实际 Electron 沙箱、React、TableTab、DataGrid、PageFindPanel、WorkerClient 与原生 Web Worker。沿用固定离线数据及受限桥接端口，不新增匹配器或产品入口。

测试侧 `pageFindLateWorkerGate.ts` 继承实际 Worker，只包装目标页内查找线程的传输边界。就绪事件立即转交；请求原对象照常送入原生线程。响应模式保存原生 MessageEvent 及当时的原处理器，之后只交付同一事件；终止模式立即调用原生 `terminate()`，仅暂缓生产客户端等待的测试侧Promise。摘要读取真实返回状态及首个有界替换后值，不构造、篡改或重新计算任何匹配/计划回包。

终止确认门为测试制造的异步等待窗口；浏览器 Web Worker 本身没有可等待的原生退出确认。本测试不能声称拿到了操作系统线程退出或内存回收的确认。主要ABA负例等待真实结果已生成、客户端已处理并清除运行计时器、实际线程已调用终止后，才产生新意图，避免把产品1.5秒超时当成意图守卫成功。

草稿证据通过实际 Zustand `subscribe` 只读旁观 `dirtyTabs`，不替换 React hooks、setRows、setDirty 或应用函数。旧命令必须产生0次真值脏标记、0次清洁到脏的转换，网格完整文字与可见ID/旁列保持原值且没有 `.row-modified`。新明确命令必须在实际网格写出预期文字、出现1行修改并产生1次清洁到脏转换。

脏标记通知可能同时来自 setRows 和原有effect，不能把通知数量冒称精确setRows调用次数；0次脏标记、转换和网格原值共同证明这些会改变文字的旧计划没有落稿。用例只观察本固定数据，不证明任意同值写入的内部调用次数。

## 新独立用例

统一默认门为 `DBARK_D06_LATE_PREVIEW_UI=1`。默认在启动Vite/Electron的钩子之前skip，并拒绝 `DBARK_INTEGRATION_ENABLED=1` 或任何 `DBARK_TEST_HOST/PORT` 环境，不能与200实库验收混跑。沿用原45秒测试期限、30秒首屏等待和产品8秒/1.5秒期限，没有修改任何旧用例ID或期限。

| 稳定标识 | 原生组件控制链场景 |
| --- | --- |
| D06-LATE-PREVIEW-UI-01 | 真实替换输入 NEW→其它→NEW，旧计划被撤销 |
| D06-LATE-PREVIEW-UI-02 | 实际输入DOM派发冒泡的compositionstart/end，最后值仍NEW，旧计划被撤销 |
| D06-LATE-PREVIEW-UI-03 | 实际网格点击第一行note到第二行other再回第一行note，旧选择令牌失效 |
| D06-LATE-PREVIEW-UI-04 | 查找输入Enter下一处、Shift+Enter回退，旧导航意图失效 |
| D06-LATE-PREVIEW-UI-05 | 真实计划响应暂存，明确取消后原事件迟到不能落稿或覆盖取消提示 |
| D06-LATE-PREVIEW-UI-06 | 实际终止已调用但确认仍未交付时取消；未定期间保持忙碌，确认后显示取消并恢复 |
| D06-LATE-PREVIEW-UI-07 | 实际Worker处理非法正则，原blocked/invalid状态不能当成成功或无命中；确认后显示原错误并恢复 |

所有场景随后用真实替换输入Enter发出新明确命令，要求成功写出 `😀NEW前old后old`，并正常查找到剩余位置。01～04使用已计算结果/终止确认门；05的短暂响应门必须看到明确取消提示，不能把运行超时算成取消通过。07仅验证真实非法模式错误，不制造未知Worker崩溃、伪造错误或假装覆盖所有未知结果。

IME用例是原生输入DOM事件经过真实React处理链，不是实体输入法、OS候选窗或真实中文输入体验验收。整个夹具使用预置离线数据与受限桥接，不能冒称真实数据库、200、生产安装包或跨平台实库通过。

每例附 `D06迟到真实控制链摘要` JSON，包含实际Worker时序、草稿信号、页面错误及被禁止的数据库/查询命令；`table.preview/table.apply/query.execute` 必须为0。收尾先通过真实工具栏卸载面板，再释放测试侧确认并恢复原Worker，最后关闭本例Electron并校验后清理唯一临时目录。没有关闭其它任务的窗口或进程。

## 本轮允许执行的验证

```powershell
$env:TEMP = Join-Path (Get-Location) '.cache/d06-test-temp'
$env:TMP = $env:TEMP
New-Item -ItemType Directory -Force -Path $env:TEMP | Out-Null
node node_modules/vitest/vitest.mjs run tests/unit/page-find-late-worker-gate.test.ts tests/unit/page-replace-intent.test.ts tests/unit/page-replace-current.test.ts tests/unit/ui-page-find-replace.test.ts tests/unit/page-find-worker-client.test.ts --maxWorkers=2
node node_modules/typescript/bin/tsc --noEmit
node scripts/build.mjs
node node_modules/@playwright/test/cli.js test tests/e2e/page-find-replace-late-preview.spec.ts --list --reporter=json
```

纯传输门3项单元验证就绪不延迟、请求/原生响应对象及事件身份不变、实际终止先调用、错误不被重写、确认等待、快照隔离与收尾恢复；端口哨兵本身不证明真实Worker匹配结果。相邻5个文件74项单元通过，TypeScript检查通过，生产构建通过（30.48秒，保留既有第三方注释及大分块提示）。新文件仅收集7项，JSON中7项expectedStatus均为skipped，没有执行任何测试体；收集JSON在本克隆忽略目录 `.cache/d06-late-list.json`，构建日志为 `.cache/d06-late-ui-build.log`。

ROOT后续单独启用新门并运行本文件，需先清除实库环境；这不是员工5本轮实际执行的命令。本轮未启动GUI、Vite服务、200、剪贴板或Docker，不新增或覆盖原正式验收证据。
