# 重命名与侧栏请求门混合候选

本候选在员工1普通克隆`w02-workbench`核对干净并fetch后，从固定`c22ec9775216730f64d3308d81fa6297e3812c56`创建独立分支`codex/employee1-rename-sidebar-compat-20261016`。没有更新或合并main，没有修改ROOT或其它员工克隆。

## 集成顺序及冲突处理

| 原提交 | 本分支提交 | 处理 |
| --- | --- | --- |
| 4b00d80c949a825ad1c0f5b4a040dfc560ec7ce4 | 82e2ea7 | Sidebar、TableTab冲突，按下述方式保留当前侧栏与网格行为 |
| 361b7bec6503d7d4c8fae6d86c7d8a9eae614ad4 | 66abb4a | 自动集成，保留分阶段权限及物理身份名称历史 |
| 86048222931d484d9d85d0cedb8e29a9f48f7cb3 | 0a27d93 | 自动集成，保留未核验/未知结果对来源和目标URI的退役 |

Sidebar沿用c22的`SidebarNodeRequests`、同步展开引用、连接版本挂载key、跨挂载连接结束屏障和真实错误报告，移除旧重命名实现的第二套目录代次。新增精确数据库刷新属性、重命名回调及按钮；重命名通知仍执行`load(false)`读取实际目录，保留当前折叠意图。

TableTab以c22完整工具栏为准，仅新增重命名入口。`applyPagePlan`、`selectCurrentCell`、`jumpToMatch`及`PageFindPanel.getSelectionToken`与c22源码一致。现有备注、默认编码、列/索引/外键等入口、数据草稿和布局偏好保留；所有CSS、包版本、锁文件和CI均未修改。静态一致性和纯组件测试不能代替180px侧栏实际像素验收。

## 实际复现的兼容缺口及修复

三个提交初步合入后的固定源码为`0a27d93c6d795737f5aad45f043deeea7316d89e`。新增9项混合探针实际执行App刷新方法，再沿真实Sidebar→ConnectionNode→DatabaseNode的JSX传递属性，使用完整生产节点及统一请求门，只替换React调度、图标展示和IPC端口。

初步混合源码9项中6通过、3失败：改名刷新发生时若旧目录加载未结束，当前请求门的普通加载去重会吞掉新刷新；连续改名通知同样丢失。两种新旧回包顺序及连续通知因此无法获得最新目录。固定源码归档、失败结果和9项探针原件均保留，不把这些失败解释成夹具问题。

兼容补丁只为请求门增加明确的加载接管参数：`DatabaseNode.load(false)`可取代既有目录加载，普通按钮加载仍去重。接管仍须满足节点存活及原连接修订，不能越过断开/删除；旧回包与旧finally失去状态写入权。原9项断言逐字未改，修复后全部通过。真实后端错误仍报告，旧错误不能改变目录或新请求busy。

## 验证结果与证据

| 验证 | 实际结果 |
| --- | --- |
| 固定0a27混合目录探针 | 9项中6通过、3失败，退出1 |
| 修复后同一混合目录探针 | 9通过、0失败 |
| 当前侧栏请求门及生命周期 | 28通过，含原24项和新增4项接管边界 |
| 混合TableTab选择令牌及三个属性按钮 | 4通过，旧令牌不得写入草稿 |
| 原独立重命名探针 | 30通过；先由实际Engine驱动替身生成回执，再进入实际App方法/JSX回调 |
| 相关回归 | 33文件585通过、0失败、0跳过，限制2个Worker |
| 类型检查及主进程/preload/前端构建 | 均退出0；保留现有前端分块体积提示 |

混合目录组覆盖新旧回包两种顺序、旧finally、明确折叠、已折叠后台刷新、连续改名、旧真实错误、接续连接结束屏障、连接版本重挂载、卸载和三个表属性入口。常规App组继续验证未知/未核验身份停用来源和目标URI、保持DDL完成事实且不重放、同身份完整往返恢复，以及不同/未知身份不得误恢复。

本克隆ignored证据目录`.cache/rename-sidebar-compat/`保存：

- `Sidebar.tsx.conflict.txt`、`TableTab.tsx.conflict.txt`与`conflicts.json`：冲突现场及解决原则。
- `mixed-before-source.zip`、`mixed-before-probe.test.ts`、`mixed-before-harness.ts`、`mixed-before-results.json`：固定混合失败源码及原断言。
- `provenance.json`：固定基线、原件摘要、适配说明；`conflict-audit.json`核对原9项字节、挂载key、折叠/结束处理器、选择令牌和CSS一致性。
- `original-engine-results.json`、`original-results.json`、`related-results.json`及对应日志、`typecheck.log`、`build.log`：纯验证实际结果。

旧候选分支、员工2原失败报告、固定361的27/30失败实证及860的30/30修复实证全部保留。没有改写以前记录或夹带自增起点功能；自增两提交`4fa6155`、`5f3a2c5`继续冻结在原独立分支。

实际主要命令：

```powershell
git switch -c codex/employee1-rename-sidebar-compat-20261016 c22ec9775216730f64d3308d81fa6297e3812c56
git cherry-pick 4b00d80c949a825ad1c0f5b4a040dfc560ec7ce4
# 仅解决上述两个冲突，再继续原提交及后两提交。
git cherry-pick 361b7bec6503d7d4c8fae6d86c7d8a9eae614ad4
git cherry-pick 86048222931d484d9d85d0cedb8e29a9f48f7cb3
node node_modules/vitest/vitest.mjs run tests/unit/table-rename-tree-refresh.test.ts tests/unit/sidebar-async-state.test.ts tests/unit/table-rename-mixed-table-tab.test.ts
node node_modules/vitest/vitest.mjs run --config .cache/rename-sidebar-compat/original.vitest.config.mts
& ./.cache/rename-sidebar-compat/run-related.ps1
node node_modules/typescript/bin/tsc --noEmit
node scripts/build.mjs
node .cache/audit-rename-sidebar-compat.cjs
```

本轮没有GUI、实库、200服务器、Docker、剪贴板或worktree操作，没有新增服务或密钥证书。最终独立审查、正式Electron及实库验收交由ROOT在固定候选继续执行；上述纯验证不代表这些实际环境通过。
