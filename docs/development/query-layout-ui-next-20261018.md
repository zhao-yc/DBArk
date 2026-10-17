# 查询区分隔条与每标签布局恢复（后续片）

本片从固定`e80f9d7ec272947e5c3c4fdcc6644017f38be5fe`的普通clone开发，分支`codex/employee3-query-layout-ui-20261018`，不使用worktree、不跟随Root HEAD。依次接入员工2固定合同`0eee9e00f410c2ea63e160628f5d0b103c5e82dd`与`731c5b09a40688aa9a6e6b0f97266d644c71a77f`，本clone等值重放为247f6a2、ba51482。本片只基于该正式合同接renderer，不另造合同或修改后台；schema8属于合同后续片，不进入冻结0.22候选。

## 实际行为

原QueryTab的300像素默认保留，读取正式`readQueryEditorHeight`。旧的window pointermove/up实现已替换为真实接入同一SqlEditor包装区的可访问分隔条。没有新建另一套编辑器，没有替换模型或改写正文/会话/Undo桥。

- 拖动只更新临时显示；仅本次pointerup实际发生位移时提交。另一pointer、取消、lostcapture、Escape、失去窗口焦点、卸载和身份撤销均清监听/capture，旧闭包不能结算新手势。
- 方向键每次10像素，Shift每次50像素，Home或独立按钮明确恢复300。连续键从最新租约读高度，不借旧render覆盖前一个按键结果。视觉上限处无有效位移的按键不把大偏好偷偷改成窗口高度。
- 目标、连接代次、标签存续/激活或外部新高度由同步store订阅使手势永久失效；A→B→A也不会复活。只有高度值写入结束时最新tabs中的本query项，其它标签、SQL、标题和sourceBinding原样保留。设置写入使用原store的防抖持久化，回包不向界面回写旧快照。
- 实际QueryTab容器及直接工具条通过ResizeObserver测量，扣除真实工具条/状态占用并给结果内容至少96像素。窗口变矮或隐藏标签只视觉clamp，不自动存储。极短窗口的编辑区可压缩到0，结果区保留最小高度且查询区可纵向滚动，避免固定工具条把结果永久挤出。窗口恢复后按原偏好显示。
- 分隔条具有role=separator、horizontal方向、焦点、aria-controls、像素范围/当前值与中文键盘说明。文字集中在queryLayout.zh-CN.ts。

## 接线与生命周期

`QueryLayoutSplitter`只处理手势/键盘和临时显示，最小/最大/默认值来自正式合同props。`queryLayoutLease`同步撤销上下文并在提交时重新读取；`queryLayoutWorkspace`仅把该租约接到真实store。目标键不含SQL/标题/来源，因此正常后续正文编辑不会被旧tabs还原；但准确连接/数据库上下文或连接修订变化立即拒绝旧提交。关闭确认或当前dialog会拒绝领取/提交。

`useQueryLayoutMaximum`只测量返回显示边界，观察新工具条并停止观察移除节点，卸载清ResizeObserver和resize监听。测试内存DOM补了只读children/classList及默认零几何端口；专项用例提供具体RAM几何，没有声称内存端口执行了浏览器布局。

## 验证与边界

本片新4文件合计30项RAM通过（手势13、租约5、测量2、真实QueryTab/store整合10）；原查询关闭23、复制10、当前语句19合计52项相关回归通过，唯一82项。员工2的97项合同/存储测试不重复。最终类型检查一次退出0，diff检查通过，未full/build。

实际QueryTab/分隔条/store运行于真实ReactDOM；Monaco、IPC、ResizeObserver及几何为RAM端口。整合覆盖每标签恢复、原默认300、显式持久化、短窗口仅视觉变化、标签/目标/连接ABA、旧pointerup、提交合并新SQL/标题/来源、保存晚回包不覆盖后来正文。源码AST逐字核对原42个查询/会话函数及两个SqlEditor JSX元素保持。模型端口身份/版本/Undo标记保持不等价于真实Monaco原生验收。

早期整合夹具用内存DOM不支持的class选择器取节点失败，修正为同一节点的准确class属性选择后再验证，没有放宽产品断言。分阶段定向报告与最终联合报告均保留在ignored`.cache/query-layout-ui`。

命令：

```powershell
node node_modules/vitest/vitest.mjs run tests/unit/query-layout-splitter.test.tsx tests/unit/query-layout-lease.test.ts tests/unit/query-layout-bounds.test.tsx tests/unit/query-layout-integration.test.tsx --pool=threads --maxWorkers=1 --minWorkers=1 --reporter=json --outputFile=.cache/query-layout-ui/final-ui.json
node node_modules/vitest/vitest.mjs run tests/unit/ui-query-close.test.tsx tests/unit/ui-query-duplicate.test.tsx tests/unit/ui-current-statement.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --reporter=json --outputFile=.cache/query-layout-ui/related-query.json
node node_modules/typescript/bin/tsc --noEmit
node .cache/query-layout-ui/audit.cjs
git diff --check
```

没有网络、实库、.env、GUI、Playwright、端口、SSH、Docker、剪贴板或驱动连接，没有修改package。Root仍需按原生Windows/macOS与实际窗口尺寸验收触摸/指针捕获、键盘、焦点、Monaco布局及重启后的真实持久化；本片不推送、不部署、不追认冻结候选已包含本功能。
