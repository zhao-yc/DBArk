# SQL编辑器正文桥接与可交互就绪合同

基线：`586ae3252a4aa9d762f130d41991e87278d3d7ac`。独立普通克隆及分支：`codex/employee2-editor-content-bridge-20261017`。仅两个产品文件：SqlEditor与专用editorContentBridge；QueryTab、公共caret、Main、store、5秒/13秒断言及候选均未改。

此变更修复已确认的合同缺口：锁定@monaco-editor/react 4.7.0的编辑器先暴露模型/DOM，正文监听稍后才在effect绑定；模型在订阅前发生的事件不会向新监听重放。CI586白名单只证明失败后模型匹配、Main草稿空、renderer未知，不能证明其实际时序或唯一根因。本修复不追认CI586或旧469通过。

## 正文与就绪顺序

1. 原生widget初始readonly，正文容器visibility隐藏、aria-hidden并inert，外层aria-busy和既有加载文案清楚呈现等待，固定高度不跳。DOM存在不能提前成为普通role可访问或可聚焦编辑器。
2. 按editor/model实例绑定模型正文及销毁监听、editor模型切换及销毁监听。
3. 当前外部props仅向模型同步，受控事务不回传onChange；没有从既有模型getValue向store补发的路径。
4. 订阅及同步完成后解除原生readonly、发布界面就绪，最后调用父层onReady。readonly预览仍保持readonly。
5. 卸载、editor销毁或模型失效先锁定输入并释放旧监听。旧模型已经排队的事件也须通过有效世代与版本检查，不能写入新回调。

桥接只持有当前已提交props的引用，最新onChange不靠解绑重绑生效；取消的并发渲染不会把未提交回调交给旧模型。两个查询的桥接相互独立，没有全局正文、store或调试接口。

## 受控value路径

锁定库原value effect在可编辑时调用widget.executeEdits，readonly时调用setValue。若仅叠加监听，外部更新可能被当成用户输入回声；readonly的setValue还会重置编辑历史。

本变更只给库defaultValue，不传value/onChange，库不再负责后续正文同步或第二条onChange订阅。外部props由同一桥接通过公开`model.pushEditOperations`及`pushStackElement`同步，保留模型编辑栈，不用setValue，也不为同步临时解开readonly。锁定Monaco 0.55.1的widget.executeEdits会拒绝readonly，故未使用该路径处理只读更新。

同步期间抑制回传，同步后记录受控版本上界，延迟交付的受控事件与被其取代的旧事件同样不回声。外部LF/CRLF按模型EOL比较，等价换行不重复编辑。只有有效当前模型的新正文事件才转发给最新onChange，正常用户编辑、建议接受、格式化及Undo/Redo仍经该事件链路；不会主动刷新Main或改变400ms持久化。

SqlEditor公开props未变。be28的QueryTab选区格式化直接使用Monaco编辑事务，随后仍经正文事件返回草稿；本分支没有修改或覆盖该文件。Root可将两个独立提交整合，组合GUI与单次撤销仍待Root实际验收。

## 定向证据

```powershell
node node_modules/vitest/vitest.mjs run tests/unit/editor-content-bridge.test.ts tests/unit/ui-editor-content-bridge.test.tsx tests/unit/ui-current-statement.test.ts
node node_modules/typescript/bin/tsc --noEmit
```

38项通过：13项桥接模型端口测试、6项真实锁定库/ReactDOM/SqlEditor测试、19项原当前语句及快捷键窄回归。真实库测试只替换loader、worker和Monaco原生/模型边界，没有替换@monaco-editor/react组件：

- 旧路径反例在后置监听前交付合成正文，模型变化但onChange不补发；该RAM时序不是CI原生时序证明。
- 新路径在真实库创建模型时核对ReactDOM的busy/aria-hidden/inert/visibility及readonly均处于等待态；合成原生早输入被readonly拒绝。onReady时模型监听已建立、库onChange订阅数0，随后一次正文事件只转发一次。该RAM检查不替代浏览器无障碍树或原生焦点验收。
- readonly及普通外部value更新无回声，不调用setValue；最新回调、双标签真实Zustand更新及原400ms保存路径分别验证，未调用实际Main。
- 延迟受控事件、被外部值取代的旧事件、模型切换/销毁、卸载、半途订阅失败及同步失败不复活旧监听。

类型检查退出0。原`sql-completion.spec.ts`、named-window、CALL三文件只执行`--list --reporter=json`，显式关闭实库/专项门，发现原9+2+2项，results均空；没有改E2E文件、选择器或期限。原件在本克隆忽略目录`.cache/editor-content-bridge-evidence/`。

本轮未运行GUI、200、剪贴板、手动CI、产品构建或候选重建。所有原失败和冻结控制保持。实际Monaco原生输入、Windows时序、安装产物、组合格式化撤销及真实持久化链路均由Root后续验证。

## 可选后续诊断（尚未实现）

若实际复验仍出现模型正确/Main空，可在非发布诊断构建仅增加模型世代内的onChange命中计数、目标是否活动查询、回调更新匹配布尔、保存安排/发送/成功/拒绝计数；不返回SQL、tabId、store对象、hash或错误正文。沿原失败后500ms共享采样预算，不新增输入重试、额外flush或等待窗口。当前产品未增加全局调试后门。
