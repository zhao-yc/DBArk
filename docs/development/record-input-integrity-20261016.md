# 记录输入超限整次拒绝

员工4已在固定 `35e0b32` 真实复现整行 JSON 和 JSON 节点输入的 P1：浏览器原生 `maxLength` 先截掉粘贴后缀，剩余合法 JSON 前缀通过暂存，dirty 被清除。原有预算门只能看到已经截短的文本。

本次移除这两处原生截断上限，使用 `BoundedRecordTextarea`：

- 粘贴前读取完整 `text/plain`，按文本域的实际 UTF-16 选区计算完整候选；拼接前核对代码单元预算，拼接后核对 UTF-8 预算，超限就取消整次粘贴，明确显示错误并保留旧编辑及原草稿。
- 合法粘贴继续走原生输入事件；不 slice、不补引号、不修补 Unicode、不手工规范化换行。CRLF 沿用原生文本域语义，选区使用 DOM 值的坐标，避免与原始父缓冲偏移混用。
- 普通输入、拖放或组合提交产生的完整值仍由 `onChange` 复用同一预算检查，超限还原受控旧值。父级身份、忙碌和只读检查继续保留。
- `changeRecordDocument`、`changeJsonNodeInput` 以及最终暂存／节点合并共用 `assertTextInputBudget`。完整 JSON 词法、重复成员、节点结构、字段长度、可靠行身份及原子暂存边界不变。

预算没有放宽：整行同时最多 2097152 个 UTF-16 代码单元和 UTF-8 字节；节点同时最多 262144 个代码单元和 UTF-8 字节，完整字段合并后仍须满足原 JSON 词法与记录字段预算。此前已存在合法 dirty 输入时，拒绝新输入后仍能明确暂存旧合法值；非法旧输入不会因此被清洗成可暂存值。

验证结果：208 项相关单元通过（含 17 项新增回归），类型检查和构建通过。新增 10 项独立开发 Electron 组件用例全部通过，原系统剪贴板每种可读格式及纯文本均在独立主进程内存保存并恢复核对成功；不把原剪贴板写入报告或轨迹。

组件夹具直接使用生产 `RecordFormPanel`、`RecordJsonNodeEditor`、`useRecordViews` 及原暂存模型，只提供离线行、元数据和当前精确节点选择。没有数据库、产品主进程 IPC、真实分页或安装产物参与，不代表 200 实库或 NSIS 验收通过。

输入证据分三类：系统剪贴板经 Electron `clipboard.writeText` / `webContents.paste` 产生可信 paste；普通输入经 Chromium `insertText` 产生可信 beforeinput/input；组合事件由 Chromium 协议 `Input.imeSetComposition` / `Input.insertText` 驱动，未操作真实系统输入法，不作为特定 Windows 输入法验收。多行输入可分出多个 `input.data` 片段，断言使用完整 beforeinput／DOM 值，避免把事件分片误报为截断。

```powershell
node node_modules/vitest/vitest.mjs run tests/unit/bounded-text-input.test.ts tests/unit/record-input-document.test.ts tests/unit/record-json-node-input.test.ts tests/unit/record-json-structure-input.test.ts tests/unit/record-input-lexical.test.ts tests/unit/record-views.test.ts
node node_modules/typescript/bin/tsc --noEmit
node scripts/build.mjs
```

组件用例默认在 Electron 启动前跳过。统筹分配桌面与系统剪贴板使用权后再明确开启：

```powershell
$env:DBARK_RECORD_INPUT_NATIVE_ENABLED = '1'
$env:PLAYWRIGHT_JSON_OUTPUT_FILE = Join-Path (Get-Location) '.cache/record-input-guards-native-complete.json'
node node_modules/@playwright/test/cli.js test tests/e2e/record-input-guards-offline.spec.ts --reporter=list,json --output .cache/record-input-guards-native-complete
```

用例覆盖两种入口的全量替换、满预算且已有合法 dirty 输入的非空选区替换、非法旧输入、UTF-8 超限、CRLF、ZWJ／emoji、普通文本输入和协议组合输入。真实剪贴板拒绝后没有原生 input，不产生合法截短前缀；显式暂存后的原控制器行值也逐项核对。独立主进程及回环 Vite 服务在用例结束后关闭，临时用户目录在核对路径后清理。

最终独立复审、产品界面集中提交及安装产物验收仍由统筹安排；本次未访问 200、未改根工作区。
