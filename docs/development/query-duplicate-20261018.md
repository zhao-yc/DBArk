# 查询标签复制为新查询（员工3，2026-10-18）

## 基线与范围

- 固定基线：`cbb46f456b4a29883a7707ef71a55f91fd1752f3`。
- 普通独立克隆，分支：`codex/employee3-query-duplicate-20261018`；未使用工作树。
- 基线只有空白新查询、从文件另开查询、片段插入等入口，没有复制当前查询全文及明确数据库上下文的完整入口。本次没有改动这些既有入口。
- 修改局限于查询标签工具栏、独立复制控制器、原正文桥的最小 flush 接口、中文文案及专项测试；未改 App、store、共享协议或引擎。

## 行为与归属

真实入口位于 `src/renderer/components/QueryTab.tsx` 工具栏，按钮文字及无障碍名称均为“复制为新查询”。复制前从当前存活的 `editorContentBridge` 取得模型全文，并补交已经输入但模型事件尚未交付的正文。不会以选区或旧 `tab.sql` 替代全文，不执行受控同步或模型编辑，因此不主动改变原模型、撤销栈、标题或保存来源绑定。

`QueryDuplicateIntent` 在点击时捕获原标签、编辑器、模型版本、连接对象及修订号、会话和数据库上下文。flush 等待、协议缓存等待以及打开目标前均重新核对归属；观察到关闭、换连、连接删除或修订变化、模型替换或销毁、新编辑、新作业、切换标签或模态后永久失效，恢复旧值也不复活。重复点击等待中的入口不会发起第二次复制。

无原会话时使用既有显式查询上下文解析规则；有原会话时只读 `query.completionState` 的协议缓存，不附加 SQL，不为复制建连。明确无库保留为 `known/null`，未知、损坏或忙碌的协议上下文拒绝创建副本，不猜测默认库。

目标仅使用白名单字段：`kind/title/connectionId/sql/database/databaseContext`。既有 `openTab` 生成新 ID；副本无保存查询 ID、来源绑定、文件授权、原会话、事务、临时对象、任务、结果、勾选或旧请求。标题加“（副本）”并保留字符边界，遵守既有标题、正文、标签数量限制。新标签继续使用原 QueryTab 的独立会话生命周期，首次由用户执行时才另开会话。复制本身不读文件、不访问系统剪贴板、不自动执行 SQL。

原正文桥新增 `flushEditorContent`：失效或只读桥拒绝读取，外部新草稿尚未同步进模型时拒绝把旧模型覆盖回 store。旧桥清理仅释放自身，不能删除新桥的 flush 或锁住接管后的编辑器。

## 验证

运行命令：

```powershell
node node_modules/vitest/vitest.mjs run tests/unit/query-duplicate-intent.test.ts tests/unit/ui-query-duplicate.test.tsx tests/unit/ui-editor-content-bridge.test.tsx --reporter=json --outputFile=.cache/query-duplicate/duplicate-tests.json
node node_modules/typescript/bin/tsc --noEmit
git diff --check
```

结果：复制控制器 13 项、真实 QueryTab/ReactDOM/store 入口 10 项、既有正文桥回归 13 项，共 36 项通过；类型检查退出码 0；差异格式检查通过。

组件测试只替换 Monaco widget 的内存端口和外界回执，保留真实工具栏按钮、复制控制器、正文桥、ReactDOM 和 store。覆盖未交付输入、外部新草稿防覆盖、已保存源独立、明确数据库及空库、未知上下文拒绝、原会话协议缓存、新标签独立建会话，以及关闭、换连、修订恢复、删除连接、新编辑和重复点击的迟到反例。正文桥回归保留真实锁定版本的编辑器组件及内存 Monaco 端口。

验收边界：以上为 RAM/组件与静态类型证据，模型编辑及撤销调用以端口计数核对；未开展真实 Monaco 原生输入/撤销、桌面 GUI、真实数据库会话或临时表验收。未运行全量测试、构建、Docker、服务器或凭据操作。

## Git 交接

按固定基线仅提交本任务文件。外部推送沿用此前自动审批拒绝后的本地固定提交交接方式，由 Root 独立审查并整合；本文件不表示员工分支已推送。
