# D06 仅延迟原始Worker消息的原生组件回归准备

日期：2026-10-16。员工5普通分支 `codex/d06-native-late-ui-20261016`，直接父版本 `23feb3046a6bfbb61fff3a20639dc6fbe1717d2b`。本提交只新增测试、辅助验证和说明；23预算修复属于已冻结祖先，不在本次测试增量中改动。原 `c5e87acdad960daa9141d1c157afe4e056b23ba8` 迟到分支、用例及证据保持原样。

## 最小控制面

继续使用已有 `tests/fixtures/page-find-replace` 的Electron入口、真实React/TableTab/DataGrid/PageFindPanel、WorkerClient和实际原生Worker，不复制夹具或生产面板。固定离线输入只从原桥接夹具读取，不直接设置或回写任何生产草稿状态。

`pageFindNativeMessageGate.ts` 仅包装目标Worker的传输边界：请求对象及transfer/options照常传给原生Worker；原就绪消息立即转交；被选择的结果只保存同一原生MessageEvent及当时的原生产处理器。释放时交付同一事件/对象，即使已取消，也由生产客户端自己识别旧请求。缓存后调用原处理器是测试控制的交付顺序，不声称浏览器会在原生终止后自然派发该事件。没有调用匹配器、构造match/plan、重跑正则或改写返回状态。

`terminate()` 实际调用原生方法，原样返回其结果，只旁观时间和次数。此版本不合成Promise、不延迟或伪造终止确认，也不把调用原生terminate称为测得操作系统线程/内存回收确认。非目标Worker保持原行为。测试收尾只终止本例创建且尚未停止的线程，并恢复原Worker。

每个主要负例先确认实际Worker已算出预期计划且尚未交付/终止，再通过输入、组合DOM事件、网格点击或翻页产生新意图。实际发送/交付/终止采用浏览器performance时间戳；必须在发送后1秒内交付原消息，或观察到意图取消触发的实际终止，否则用例失败。这是新用例的证据窗口，早于产品原1.5秒期限，不能把超时当作意图撤销成功；产品8秒启动、1.5秒运行和旧E2E期限均未改。

草稿通过实际Zustand subscribe只读旁观dirtyTabs，结合完整网格原值、0行修改、0次脏真值通知和清洁到脏转换判断旧命令没有造成变化；不替换setRows、setDirty、React hooks或最终应用函数。通知数量不冒称setRows精确调用次数，也不证明任意同值内部赋值从未执行。各场景最后由实际替换输入发出新明确命令，要求真实Worker的新结果成功形成本地草稿。

## 独立新用例

新文件 `tests/e2e/page-find-replace-native-late.spec.ts`，独立门 `DBARK_D06_NATIVE_LATE_UI=1`。默认在启动Vite/Electron钩子之前跳过；拒绝集成模式或任何DBARK_TEST_HOST/PORT，不能与200实库环境混跑。

| 新稳定标识 | 实际交互及关键断言 |
| --- | --- |
| D06-NATIVE-LATE-UI-01 | 替换输入 NEW→其它→NEW，释放真实旧计划后草稿不变，新命令成功 |
| D06-NATIVE-LATE-UI-02 | 真实输入DOM冒泡compositionstart/end，最后值不变也撤销旧计划 |
| D06-NATIVE-LATE-UI-03 | 点击第一行note→第二行other→第一行note，ARIA选中状态证明回退，迟到计划不能借相同坐标写稿 |
| D06-NATIVE-LATE-UI-04 | 查找Enter下一处、Shift+Enter回退，旧导航意图不复活 |
| D06-NATIVE-LATE-UI-05 | 实际翻页和原桥接重读，新的Worker预览代次必须大于旧代次；旧原值计划不能覆盖新页同值数据 |
| D06-NATIVE-LATE-UI-06 | 真实正则忽略/区分大小写分别5/4处（含只读生成列匹配），收窄note后3处；默认捕获关闭，美元模板按字面生成计划并完成新命令 |
| D06-NATIVE-LATE-UI-07 | 明确取消后原响应迟到，保留原取消提示，零次改变草稿且恢复正常 |
| D06-NATIVE-LATE-UI-08 | 实际非法正则blocked/invalid照常显示错误；下一轮迟到旧错误不能覆盖新合法查询，最终正常替换 |

原值检查包括note、超安全整数ID、旁列、BLOB预览和NULL；新命令必须产生1行修改和1次清洁到脏转换。所有场景的table.preview/table.apply/query.execute均必须为0。每例附 `D06原消息迟到控制链摘要` JSON，记录真实请求选项/代次、原消息状态、时间戳、终止调用、脏信号、禁止命令及页面错误，不把摘要当作真实数据库证据。

组合事件仅验证真实React处理DOM组合事件的守卫，不是实体输入法或操作系统候选窗验收。非法正则是真实Worker错误，不伪造未知崩溃；不宣称所有未知结果均已覆盖。现有离线夹具保留数据输入替身，因此本组属于原生组件控制链，不能冒称真实数据库、200、安装包或跨平台实库通过。

## 本轮验证及ROOT交接

```powershell
$env:TEMP = Join-Path (Get-Location) '.cache/d06-test-temp'
$env:TMP = $env:TEMP
node node_modules/vitest/vitest.mjs run tests/unit/page-find-native-message-gate.test.ts tests/unit/page-replace-intent.test.ts tests/unit/page-replace-current.test.ts tests/unit/ui-page-find-replace.test.ts tests/unit/page-find-worker-client.test.ts --maxWorkers=2
node node_modules/typescript/bin/tsc --noEmit
node scripts/build.mjs
node node_modules/@playwright/test/cli.js test tests/e2e/page-find-replace-native-late.spec.ts --list --reporter=json
```

新消息门4项纯单元仅用端口哨兵验证事件/对象身份、请求参数、原生终止返回值、错误保持和收尾隔离，不把这些哨兵称为真实Worker计算证据。相关5个文件75项通过，类型检查通过，生产构建通过（31.17秒，保留既有第三方注释及大分块提示）；新文件仅收集8项，JSON中8项expectedStatus均为skipped，未执行测试体。收集JSON在本克隆忽略目录 `.cache/d06-native-late-list.json`，构建日志为 `.cache/d06-native-late-build.log`。

ROOT后续在独占原生窗口、清除实库环境后，单独启用新门并运行新文件；员工5本轮只执行上述纯检查。未启动GUI、Vite服务、200、剪贴板、SSH或Docker，未修改生产逻辑、预算源码、已有夹具、旧用例ID或期限，也未覆盖原c5或23证据。
