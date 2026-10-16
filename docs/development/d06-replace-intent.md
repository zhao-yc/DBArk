# D06 替换命令的单调意图修复

日期：2026-10-16。员工5普通克隆分支 `codex/d06-replace-intent-20261016`，直接父版本 `fd838c491eee892369c1db1bf54523a7d2b44410`。本次独立修复迟到替换授权，不包含正则捕获替换；保留原 fd838c4 提交、文档和界面用例。

ROOT后续已集成并完成正式六组合验收：单处补充run646共6次通过，可靠键修复d94930f后完整两项run650共12次通过，当前完整3337单元/类型/构建通过。原MySQL保留字夹具失败、5.7重复键误冲突及各证明层见[正式验收](../../tests/integration/acceptance-d06-current-and-key-guards-20261016.md)。下面保留作者纯检查边界；真实UI不代表实体输入法或全部迟到时序都经过原生自动化，0.18尚未发布。

## 问题和修复契约

fd838c4 在 Worker 返回时比较当前替换文字、组合布尔值和页面快照。替换文字先改动再恢复原值（ABA），或组合开始后结束，可能使旧请求再次满足相等条件。员工4对固定 fd838c4 完整生产面板的探针记录中，正常命令、替换文字 ABA、组合开始结束都写入了1次；本次把后两项明确改为必须写入0次。原始只读审查材料保留在员工4克隆 `.cache/review-d06-fd838c4/review-result.json` 和 `component-probe.json`，不修改该证据。

- 每次替换文字编辑、查询/类型/列/大小写/整格/正则选项编辑、组合开始、组合结束、上一处/下一处和取消查找，都同步递增单调修订，撤销旧预览与成功后接续位置，并走现有 WorkerClient 真实取消路径。值恢复相同不能恢复旧授权。
- Worker 返回同时核对请求序号、意图修订和页面快照；单处命令还复核精确出现位置与网格同步选择对象。已经算出结果但尚未完成线程终止确认的请求，同样受到修订约束。取消完成前不释放在途写命令锁。
- TableTab 最终应用再次读取同步 RecordContext、完整原值与选择令牌。选择离开后回到相同行列产生新令牌；取消有效网格选择同步清空令牌，无需等待 React 渲染。单处计划必须只有当前行列的一个补丁。
- 正常单处替换仍只写一次本地草稿，成功后沿用 fd838c4 的下一处定位。整批预览也保存意图修订，编辑或组合事件会撤销已显示的旧预览。数据库提交仍由既有预览确认路径负责。

用户正则的 Worker 隔离、启动/执行截止和预算政策保持现状；本次没有加入捕获插值，也没有改变字面替换语义。

## 纯单元证据和验证边界

新增 `tests/helpers/pageFindPanelHarness.ts` 在独立 VM 中编译完整当前 PageFindPanel。仅替换 React 调度、展示组件和 Worker 传输端口；实际事件接线、生产 WorkerClient、匹配和计划函数均使用当前源码。传输端口能保存迟到消息并控制终止确认，不使用真实等待、GUI、网络或数据库。

`page-replace-intent.test.ts` 的13项覆盖：正常单处写稿；替换文字、查询、列范围、大小写的 ABA；组合开始结束；下一处再上一处；网格选择 ABA；结果已生成但等待终止确认时的文字/组合 ABA（包括事件间没有 React 渲染）；已显示整批预览的旧确认处理器。负例要求0次写稿，随后新命令仍能正常写1次，并核原 original、精度和二进制保留、线程已终止。

`page-replace-current.test.ts` 保留原41项，仅补齐真实处理函数的新同步状态及参数，另加选择 ABA 与清空选择两项，合计43项。清空选择与选择 ABA 直接执行当前 TableTab 生产处理函数和最终写稿守卫，不复制一份资格判断。

```powershell
$env:TEMP = Join-Path (Get-Location) '.cache/d06-test-temp'
$env:TMP = $env:TEMP
New-Item -ItemType Directory -Force -Path $env:TEMP | Out-Null
node node_modules/vitest/vitest.mjs run tests/unit/page-replace-intent.test.ts tests/unit/page-replace-current.test.ts tests/unit/ui-page-find-replace.test.ts tests/unit/page-find-worker-client.test.ts tests/unit/table-cell-keyboard.test.ts tests/unit/record-views.test.ts --maxWorkers=2
node node_modules/vitest/vitest.mjs run --maxWorkers=2
node node_modules/typescript/bin/tsc --noEmit
node scripts/build.mjs
node node_modules/@playwright/test/cli.js test tests/e2e/page-find-replace-live.spec.ts tests/e2e/page-find-replace-offline.spec.ts tests/e2e/query-stream-million.spec.ts --list
```

实际结果：定向6个文件152项通过；全量162个文件3081项全部通过（maxWorkers=2，73.08秒）；TypeScript检查通过；生产构建通过（29.21秒，保留既有第三方注释及大分块提示）；D06 live/offline及百万行界面合计仅收集9项，没有执行测试体。全量单元和构建顺序运行，TEMP/TMP固定在本克隆可写目录，避免 Windows 沙箱默认临时目录的存储原子重命名权限问题。日志保留在本克隆忽略目录 `.cache/d06-intent-full-unit.log` 和 `.cache/d06-intent-build.log`。

未运行 Electron GUI、剪贴板、实体输入法、200服务器或 Docker。模拟组合事件与完整组件调度是纯进程回归证据，不属于实体输入法或实际桌面验收。已有 D06 与百万行界面用例的源文件、ID、断言和期限完全未改，原公开安装包的历史验收口径保持原版本。
