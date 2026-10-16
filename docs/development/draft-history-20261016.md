# D02：本页会话草稿撤销与重做

基于ROOT固定提交 `407c65f43087c45ea64c4d014e2e5fd6210ecd4b`，独立普通克隆及分支 `codex/employee3-d02-draft-history-20261016`。本功能归D02网格编辑，仅处理当前页尚未提交的内存草稿；D08实际提交结果追溯、持久历史、跨页或跨连接历史仍未实现。没有修改主进程、共享协议、IPC、依赖、存储或原有“撤销全部”。

## 实施计划与入口核对

先核对TableTab所有草稿发布、记录输入及失效入口，再独立实现稀疏行差异历史，最后接入工具栏和局部键盘事件。所有草稿仍由原有守卫校验后通过同一个setRows同步发布；表单的真实useRecordViews控制器继续一次性暂存整行字段、文档或树节点输入。

| 原入口 | 历史边界 |
| --- | --- |
| changeRows、普通网格编辑 | 一次最终网格提交为一步，编辑器逐次改字仍留在网格本身 |
| pasteClipboard → pendingPaste → changeRows | 整个多格矩阵只形成一步 |
| addRow、deleteSelected、Delete清空 | 一次新增、勾选集合删标记或单格清空为一步 |
| duplicateCurrentRow、readCompleteCopySource | 来源读取完成并通过原守卫后的一次追加为一步；重做只恢复已保存的完整草稿，不再补取 |
| stagePasteInsert | 已消费计划的一次整批追加为一步；重做不再次消费计划或生成UUID |
| useRecordViews.onRows | 表单、字段窗口、整行文档、树节点或结构的整批暂存为一步 |
| applyPagePlan、applyReference | 一次替换计划或关联字段选择为一步；去掉提前回写rowsRef的语句，由setRows统一捕获前后差异 |

## 内存与值合同

`draftHistory.ts`只保留变化行的版本和位置，每一步不保存整页数组，也不深拷贝完整页、original、大文本或BLOB。当前页数组只保留一个同步身份锚点；构建差异和重放会产生与当前页规模成比例的临时索引及浅数组，不会给每个历史步骤累积整页副本。既有各入口按不可变方式更新DraftRow。

两栈合计最多100步、8 MiB保留预算。预算按UTF-16字符串长度、原始Base64长度和保守对象/引用开销计算，original也纳入保守计量；这不是进程RSS测量。超过合计预算时淘汰最早操作。单次操作自身超预算则清空旧撤销/重做栈，完整新草稿仍正常暂存，界面提示“草稿已保留”。没有静默截断、自动SQL或拒绝当前用户修改。无变化发布不占一步；撤销后新编辑丢弃重做分支。

撤销与重做仅应用保存的行差异，保留UUID、original引用、插入/删除状态、缺字段DEFAULT、NULL、空/非空BLOB、大整数/十进制/微秒字符串和JSON原文，不重新解释数值或JSON。受影响行的当前data会浅复制为新身份，旧记录输入票据不能通过“改回旧值”复活；旧页面数组、粘贴计划、复制读取和查找代次也不重用。复制键保护标记随当前行和有界两栈保留，分支编辑淘汰的旧UUID标记同步回收，重做后的重复键仍受原集中预览保护。

## 失效与交互

加载开始、加载成功/失败、分页清空、页面大小/筛选/排序变化、目标或连接修订、目录签名/刷新代次、过期标记、卸载都会清空历史。环境在渲染时同步比较，观察过变化即永久清空，返回原值不复活。清历史本身不丢弃已有草稿；分页放弃仍用原确认流程，外部连接或目录变更仍按原过期保护保留草稿。

仅生成SQL预览及取消预览保留历史；消耗正式提交票据后、调用table.apply之前清空，提交成功、失败、取消或结果未知都不提供执行前重做。没有绕过原可靠键、只读、跨页、原值冲突或一次提交守卫。

工具栏显示“撤销上一步”和“重做下一步”及可用步数。运行、模态窗口、记录未暂存输入和网格文本编辑期间禁用；处理器还同步读取加载、关联、提交、偏好、预览和复制读取占门。仅DataGrid活动且非文本焦点处理Ctrl/Cmd+Z、Ctrl/Cmd+Shift+Z、Ctrl/Cmd+Y；输入框、contenteditable、Monaco、EDIT态和IME保留原输入行为。没有全局键盘监听。原有“撤销全部”仍刷新当前页并使用原草稿放弃确认。

## 验证

所有运行均在员工3独立克隆内，仅使用合成RAM/IPC端口。`.cache/d08-edit-history`是忽略的本地证据目录，不进入提交。

| 命令/证据 | 结果 |
| --- | --- |
| `node node_modules/vitest/vitest.mjs run draft-history record- paste-insert ui-clipboard table-cell-keyboard --config .cache/d08-edit-history/vitest.config.mjs --reporter=json --outputFile=.cache/d08-edit-history/related-release.json` | 23文件、627通过，0失败/跳过；含原593项及34项历史相关测试 |
| `node node_modules/typescript/bin/tsc --noEmit` | 通过 |
| `node scripts/build.mjs` | 构建通过；原大资源块提示保留 |
| 正式Playwright配置对`tests/e2e/draft-history.spec.ts`执行`--list --trace=off` | 2项默认跳过，实际执行0；需同时显式开启集成和`DBARK_D02_DRAFT_HISTORY_UI`门才可后续安排 |

34项新测试包含完整生产TableTab及真实useRecordViews/helpers的RAM回放。只替换React状态调度、DOM、组件显示壳和IPC返回端口；没有复制一套修改逻辑。覆盖原子多格、增删/复制/批量新增、表单暂存及重建、UUID和original保真、键冲突、ABA、操作数/字节淘汰、超限保稿、未变大BLOB行不进入小改动历史、空栈、复制标记回收、焦点/IME、目录/连接/分页/排序/筛选，以及预览与两种提交结果。旧AST处理器测试仅补齐新增历史端口，原断言保持。

尚未实际验收GUI布局、浏览器/系统原生输入或数据库。未执行200/私网、SSH、Docker、系统剪贴板、真实env/key/CA、人工CI；正式UI用例只是默认关闭的准备资产。未修改Root工作区或既有冻结审查资产，不把纯回放、类型或构建成功当成实际产品验收。
