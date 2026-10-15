# D06 当前文字出现位置的受控替换

日期：2026-10-16。员工5普通克隆分支`codex/d06-replace-current-20261016`，固定起点`014f9f0d23bd2dc8c4c1aee50879950d1b22d586`。不使用工作树，不修改ROOT、其它克隆或已有百万行验收目录。

## 实际起点与本次语义

固定起点已经有PageOccurrence、按UTF-16 range限制一次出现的计划和“仅替换当前一处”按钮；不是缺少整套匹配器。本次补齐可连续操作的“替换当前”入口、键盘语义、成功后匹配前进和最终同步写稿守卫，不以用户正则或替换全部代替本切片。

- 当前命中必须已经由“上一处/下一处”或查找框Enter定位。点击“替换当前”或在替换框按Enter，只替换该UUID行、该可见列、该range的一次出现。同格其它相同文字和其它行不变。
- 成功后在新草稿上重新查找，从新替换文字末尾选择下一处；不会把本次插入文字里的查找词立即当作下一处。按页内行、可见列顺序跨格前进，末尾循环定位首处，没有命中则无当前位置。零宽沿用原Worker能力，跳过同一原边界；本次主要验收字面文字。
- 查找框Enter下一处、Shift+Enter上一处；替换框Enter替换当前、Shift+Enter上一处。Ctrl/Meta/Alt组合不接管；忽略长按repeat。键盘导航和替换后定位保留面板输入焦点，不把下一次Enter交给网格。
- isComposing或keyCode229时不导航、不替换；输入法原生文本输入仍保留。面板组合状态同步引用覆盖鼠标命令和迟到预览，按钮的组合Enter/Space不触发原生点击。查询组合结束后恢复字面查找；不在渲染线程运行用户正则。
- 替换文字按字面拼接，`$1/$&`不插值。空串只删除当前出现，不转成NULL。NULL、DEFAULT、数字/DECIMAL、JSON、二进制、生成列和无写资格目标只查找/导航，不能替换。相同替换造成无变化时沿用原“没有可替换”返回，不生成新草稿或自动前进。

## 必要接线和并发边界

修改只限D06纯逻辑、PageFindPanel、TableTab必要接线、tableGrid集中中文文案、对应单元与界面准备。

PageFindPanel继续通过原PageFindWorkerClient/真实Web Worker生成预览，复用原1.5秒执行时限、请求序号、取消/终止和有界预算。当前位置用同步ref维护，写命令使用同步锁，双击或相邻事件不能把同一旧位置应用两次。所有完成消息仍须属于当前请求及同一snapshot，替换文字或组合输入变化也拒绝迟到预览。

onApply允许返回实际写入的rows引用；TableTab返回它刚存入rowsRef的同一数组。只有随后收到的rows正是此引用、info/keys/options相同、generation恰好加一且仍可写，才接续本次定位。其它本地变化、跨页、连接revision、外部更新、结构/列变化或禁用状态会丢弃接续点，旧查找不会跨到其它行继续写入。自动动作只有重新查找和定位，不会再自动替换。

TableTab最后应用同步取getRecordContext，按实际target、connectionVersion、加载代次、结构和行引用计算pageFindGeneration；复用recordReadonlyReason。逐补丁核当前UUID行和列、可见性、可靠键/表对象/InnoDB/生成列等；record输入/脏稿、忙碌、陈旧、未加载、活跃.grid-input均拒绝。之后复用applyPageReplacement核完整行data、original、表签名和generation，一次写本地草稿。原original引用、大整数/DECIMAL精度和其它草稿保持，数据库写入仍只走既有“预览并提交”。任意SQL结果没有接入此可写面板。

未修改驱动、IPC/主进程存储契约、TLS、表属性、数据库提交或其它D06能力。替换全部的预览/确认仍按原路径处理。

## 验证与版本口径

`tests/unit/page-replace-current.test.ts`通过TS AST执行当前生产处理函数和snapshot effect，只替换React/DOM状态端口与Worker消息完成时机，计划/查找及最终TableTab写稿均使用真实实现。覆盖：精确第二处、插入词跳过、相邻/跨格/循环/零宽定位、NULL/空串和精度、已有旁列草稿、IME/229、键盘焦点意图、连续命令锁、迟到预览/取消，以及同步RecordContext、revision、目标、加载代次、隐藏/缺失/生成列、删除行、inline输入、记录输入/脏稿和完整original变化。

已有D06离线UI用例的ID、标题和期限不改。为检验新产品语义，仅把其中替换后“0 / 2、再上一处到第2处”的旧定位预期改为“2 / 2、再上一处到第1处”；原替换内容、整批预览和零写库断言保留。这是新分支随产品行为更新的D06断言，不重写旧标签或旧246项验收证据。

`tests/e2e/page-find-replace-live.spec.ts`追加稳定标识`D06-REPLACE-CURRENT-UI`。默认同时关闭`DBARK_INTEGRATION_ENABLED`和`DBARK_D06_REPLACE_CURRENT_UI`，在自动桌面夹具前skip；启用时只允许200的六个专用隔离端口。ROOT后续安排真实窗口：保留已有旁列草稿，从同格第二处开始按Enter两次，确认插入的old没有被重复选择，随后空串替换下一行；核输入焦点、生成列禁用、NULL/精度/BLOB原值，以及真实table.preview/apply调用均为0、独立服务器数据完全未变。DOM报告组合标志不冒充实体输入法。复用现有isolatedDatabase负责实际退出及随机库清理，没有新增用户。

原0.17公开246项仍属于原版本；本分支不修改其历史统计。新增百万行正式UI补充的用例ID与源文件完全不动。此处新增UI用例仅是准备，不能记作GUI、实库或新安装包通过。

```powershell
# 纯单元、类型及构建；不连接数据库或启动应用。
$env:TEMP = Join-Path (Get-Location) '.cache/d06-test-temp'
$env:TMP = $env:TEMP
New-Item -ItemType Directory -Force -Path $env:TEMP | Out-Null
node node_modules/vitest/vitest.mjs run tests/unit/page-replace-current.test.ts tests/unit/ui-page-find-replace.test.ts tests/unit/page-find-worker-client.test.ts tests/unit/table-cell-keyboard.test.ts tests/unit/record-views.test.ts --maxWorkers=2
node node_modules/typescript/bin/tsc --noEmit
node scripts/build.mjs
# 仅收集；ROOT启用真实UI时另设置双门、已有env及明确实例。
node node_modules/@playwright/test/cli.js test tests/e2e/page-find-replace-live.spec.ts --grep 'D06-REPLACE-CURRENT-UI' --list
```

实际结果：新增41项单元通过；全量161个文件3066项全部通过（maxWorkers=2，74.79秒），类型检查通过，生产构建通过（29.88秒，保留既有第三方注释和大分块提示）。D06 live/offline及百万行UI文件合计仅收集9项，其中新D06补充1项默认关闭；没有运行任何E2E测试体或GUI。完整单元日志保留在本克隆忽略目录`.cache/d06-full-unit-local-temp.log`，构建日志为`.cache/d06-build.log`。

全量首轮在Windows沙箱默认AC/Temp发生SQLite原子rename的EPERM及后续清理错误，136项失败、2930项通过；错误保留在本聊天原工具输出。未修改存储代码、断言或期限，只将TEMP/TMP固定到本克隆`.cache/d06-test-temp`后全量复跑全部通过。构建随后单独执行，未与全量单元并发。

本轮未运行Electron GUI、剪贴板、200、Docker或实体输入法验收。代码现有产品行为已改变，后续应对新构建/新候选验收，不能将旧公开0.17安装包的历史结果覆盖成本次产品修复已通过。
