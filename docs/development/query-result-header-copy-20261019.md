# 查询结果按可见列复制并带列名

当前查询结果网格增加“复制（含列名）”按钮。有勾选记录时，按当前网格行序复制这些行与全部可见列；没有勾选时复制当前活动单元格及对应列名，活动整行则复制可见整行。没有有效选择时按钮禁用，不回退复制全部结果。原快捷键复制继续只复制数据，不增加表头。

可见列直接来自原列管理传入的 `columns`，按内部唯一 key 读取自有数据字段，显示别名只作表头。隐藏列不读取；重复、空、含 Tab/CR/LF/双引号的列名不作身份或回退键。正文和表头一起复用 `encodeClipboard` 的 TSV 引号策略、字符/单元格预算与 `application/x-dbark-cells` v1：NULL、空串、精确数值字符串、日期字符串和 BLOB 包装保持原政策，不转换成浮点数或显示预览。表头也占原预算。当前网格原本只提供活动单元格/整行和勾选行矩阵，本补丁不新增另一套矩形选择协议。

生产入口在真实 `ResultsGrid` 的查询结果区域，复用原 `selectionScope/isCurrent` 及父端接纳门。选择、活动位置、行列数组、布局、模态、任务、连接、标签或卸载变化后，旧按钮不能恢复旧权限；按钮本身不更改勾选、结果行、只读详情、外键导航、SQL或会话。不新增主进程命令或复制 SQL 路径。

按钮在用户点击的同步调用内，通过 `document.execCommand('copy')` 触发当前文档 copy 事件，临时捕获并取消默认行为，写入原 text/plain 和类型化数据后立即解绑；没有异步重试、焦点操作、临时文本框、DOM选择改写或系统 Clipboard API 兜底。机制参考 [W3C copy 覆盖规则](https://www.w3.org/TR/clipboard-apis/#override-copy)。未触发事件、拒绝命令或上下文失效时显示集中中文错误，不降级成普通文本或全结果复制。本轮不操作系统剪贴板，真实 Electron 平台支持和剪贴板读回仍需后续显式验收。

## Root 整合插入点

`QueryTab.tsx` 当前 `<ResultsGrid columns={visibleColumns} rows={result.rows} selectionScope={selectionBinding} onSelectionChange={selectResultRows} isCurrent={...} onActiveRowIndexChange={selectActiveDetailRow}/>` 调用点继续有效，QueryTab 文件及公共 `ResultGridSelection/ResultSelectionBinding`、原 `onCellCopy` 均未修改。按钮由该调用已经传入的查询绑定识别，无须再插入 QueryTab 按钮或新增跨任务接口。

与员工2列头排序整合时，关注 `ResultsGrid.tsx` 的导入区、选择状态之后的新复制状态、`onActivePositionChange` 捕获和查询区域 return 包装；原 `onSortColumnsChange`、`onCellCopy` 及父回调语义保持。新复制使用传入网格的准确行数组、实际 rowIdx、原行引用和可见列对象，不按显示别名查列，也不建立独立排序或源行映射。

## 本轮验证

从公开 `8b6bdea014221ae5fc64ebedef5827a7edbd8b91` 建立独立普通 clone，fetch 固定提交成功。新增真实编码/同步事件端口9项及真实 QueryTab/ResultsGrid React 入口11项，相关回归10文件共99项通过，`tsc --noEmit` 退出0。React 测试仅替换 Monaco、虚拟网格渲染、Document copy 分派和数据库调用为 RAM 端口；测试只执行初始化的合成查询响应，复制后没有 SQL 重放、文件写入或外部调用。

命令：

```text
node D:/svn/DBArk/node_modules/vitest/vitest.mjs run tests/unit/query-result-header-copy.test.ts tests/unit/query-result-header-copy-ui.test.tsx tests/unit/result-selected-grid.test.tsx tests/unit/query-result-columns-ui.test.tsx tests/unit/query-result-columns.test.ts tests/unit/query-result-columns-revocation.test.ts tests/unit/query-row-details-ui.test.tsx tests/unit/query-result-find-ui.test.tsx tests/unit/query-result-find.test.ts tests/unit/ui-clipboard.test.ts
node D:/svn/DBArk/node_modules/typescript/bin/tsc --noEmit
```

未操作系统剪贴板、GUI、数据库、端口、构建、CI或推送；未修改 Root 或员工2副本。这些结果不等同实际复制、浏览器布局或安装验收。
