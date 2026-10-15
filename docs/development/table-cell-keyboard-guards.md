# D07 网格键盘命令守卫

日期：2026-10-16。固定基准：`9a6b155ff9577466031c6784375e6b1ad0edf96b`。普通克隆分支：`task/parallel-d07-keyboard-guards-20261016`。不使用工作树，不合并主分支。

本次只修正员工5只读复核发现的两个既有边界：组合输入事件可进入Delete/预览等命令分支；page含列而info缺列时，Delete可能绕过列级不可编辑判断。父提交中也可复现，但本次独立修复后不再将它们带入候选。此前只读证据保留在本克隆忽略目录`.cache/review-binary-9a6b155`，不把纯探针称为实机输入法验收。

## 最小产品改动

- `tableCellKeyboard.ts`增加组合标志判断，同时接受`nativeEvent.isComposing`及`keyCode===229`。组合首尾事件可能只有229，处理方式与现有App及记录表单一致。[MDN的IME边界说明](https://developer.mozilla.org/en-US/docs/Web/API/Element/keydown_event#keydown_events_with_ime)支持这一双判断。
- TableTab的ACTIVE态组合事件不调用查看器、Delete、Ctrl/Meta+Enter预览或CtrlF/H。二进制仍preventGridDefault，避免进入普通文本编辑器；TEXT不preventDefault，也不取消其默认IME输入入口。
- RDG的EDIT态会自行处理Enter/Escape关闭及提交；组合事件只preventGridDefault，不preventDefault，阻止提前提交同时保留浏览器原生文本输入。正常EDIT键盘行为不变。
- Delete重新取得当前RecordContext、明确存在的字段以及当前页UUID行引用。只有与活动行是同一个快照、页面确实含列、recordReadonlyReason(context,row,key)允许、无record.dirty/hasInput时才能修改。缺列、生成列、无可靠键、视图、非InnoDB、busy、stale、未加载、待删除行、输入或脏稿以及迟到行均拒绝。使用同步上下文，而不只依赖渲染时的editable布尔值。
- 可写Delete仍只生成本地草稿：nullable列设NULL；非nullable二进制设规范零字节包装；非nullable文本设空串。没有把NULL、DEFAULT和零字节混为文本，original与大整数/DECIMAL原值不变。原生Ctrl/Meta+C/V、左右及其它导航、非组合Enter查看、Ctrl/Meta+Enter预览和CtrlF/H均保留。

没有修改App导航、剪贴板实现、记录JSON、索引、驱动、数据库提交或组件的editable/paste接线。

## 验证方法

`tests/unit/table-cell-keyboard.test.ts`从当前TableTab的TypeScript AST提取真实handleGridKeyDown和editable函数，使用真实组合判断、binary分类与recordReadonlyReason；只替换DOM/React状态端口。它核对实际setRows、openCell、makePreview与openPageFind副作用，避免复制一套守卫实现自证。覆盖：

- isComposing、229及两者同时出现时的Delete/查看/双平台预览/查找命令；TEXT ACTIVE正常输入与EDIT不提前提交。
- 缺失元数据、生成列、只读/无可靠键/视图/未知对象/非InnoDB/未加载/同步busy/陈旧/待删除/输入/脏稿及缺页列。
- 当前上下文与旧渲染信息不同时的拒绝，迟到行引用拒绝；正常NULL/零字节/空串、新行DEFAULT、original引用及精度不变。
- 原生Ctrl/Meta+C/V和导航保持不拦截；TEXT结构不因wire BLOB误判；正常查看、预览和查找命令仍可达。

新增一项默认关闭的真实界面准备，位于`tests/e2e/binary-cell-live.spec.ts`，使用真实DOM KeyboardEvent的isComposing/keyCode标志检查二进制命令无副作用，普通TEXT编辑仍可进入、组合Enter/Escape不会提前退出，再以正常Delete核对nullable NULL与非nullable零字节，并用独立服务器读取证明未提交。该用例只验证浏览器报告的标志，不冒充实体输入法。原有原生剪贴板与导航用例及其全部断言保持原样。

本轮只运行相关非GUI单元和类型检查；ROOT负责真实GUI、200矩阵、完整单元及新构建。没有运行Electron、系统剪贴板、200或Docker。

本轮结果：相关3个单元文件91项全部通过，其中新增键盘守卫33项；TypeScript无输出成功退出；受控界面文件仅收集到6项，没有执行。`git diff --check`通过。以上不代表实体输入法、原生剪贴板或实库界面已验收。

```powershell
node node_modules/vitest/vitest.mjs run tests/unit/table-cell-keyboard.test.ts tests/unit/binary-cell.test.ts tests/unit/record-views.test.ts --maxWorkers=2
node node_modules/typescript/bin/tsc --noEmit
# 仅收集，默认不运行GUI或读取实库配置。
$env:DBARK_INTEGRATION_ENABLED = '0'
node node_modules/@playwright/test/cli.js test tests/e2e/binary-cell-live.spec.ts --list
```
