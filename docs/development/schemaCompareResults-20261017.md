# M02 结构差异筛选与查看

## 用户可见行为

- 正式结构比较窗口支持类别、结果状态、名称子串组合筛选，默认隐藏相同项；名称搜索不区分大小写，不解释正则，保留原始名称用于身份和选择。
- 显示当前项数和报告总数。没有匹配项时提示重置筛选；没有比较项时提示核对范围与忽略项。
- 筛选只影响显示。隐藏已选项仍参与原有 SQL 预览，界面明显提示数量，用户可明确清除隐藏选择；清除不影响可见已选项。
- 变化属性及不可可靠比较原因始终可见；两侧原定义按需展开，以 React 文本渲染。缺失定义与 SQL 中的 NULL 字面值分别显示。
- 每份报告使用自己的筛选与展开状态。相同项、不可可靠比较项继续禁选；SQL 预览、保存、释放快照及取消协议保持原样。

## 接口与归属

新增 `SchemaCompareResults` 接收现有 `SchemaCompareResult`、`selectedIds`、`disabled`。选择回调仅发送带原 `snapshotId` 的增量意图：单项勾选/取消，或明确清除本次隐藏集合。

子组件校验当前渲染绑定，拒绝旧报告、旧筛选或卸载后的回调。父窗口接纳前同时核对事件原快照、回调捕获报告、活读的当前快照和忙碌状态；旧回调不能借新报告改选择或撤销新预览。选择采用函数式增量更新，避免整份旧选择覆盖新状态。

唯一已有产品文件改动是 `SchemaCompareDialog.tsx` 的结果区域接线及其必要选择门；不改 App、main、engine、contracts、连接、依赖、版本或执行入口。

## 验证与边界

基线为 `813fcf687f64faa2fbee31587a4a593a048aad0f`，普通独立克隆，分支 `codex/employee3-schema-compare-filter-20261017`。

专项命令：

```powershell
node node_modules/vitest/vitest.mjs run tests/unit/schemaCompareResults.test.ts tests/unit/schemaCompareResults.react.test.tsx tests/unit/schema-compare-dialog.test.tsx
node node_modules/typescript/bin/tsc --noEmit
node node_modules/@playwright/test/cli.js test tests/e2e/schemaCompareResults.spec.ts --list
```

专项覆盖组合筛选、计数/空结果、特殊名称和 NULL、文本转义、按需展开、未知/相同禁选、真实 ReactDOM 复选框、隐藏选择清除、正式父窗口预览以及旧报告迟到回调。内存 DOM 不证明原生浏览器布局、键盘或屏幕阅读器可用性。

本分支专项 3 文件 15 项通过（纯逻辑 5、真实 ReactDOM 8、已有入口 2），类型检查通过；Playwright 只列举 1 个默认关闭占位项，没有启动桌面。CI 状态单独随固定提交交接，不用基线或其它分支的结果替代。

开发中首轮内存 React 测试出现测试端口缺项：`disabled` 特性没有反映到属性，`textarea.defaultValue` 没有反映到文本和值；仅补齐本测试端口后重跑。没有降低断言或修改产品行为来绕过这些失败。

新增正式 UI 用例默认关闭，`--list` 也先短路，不导入桌面或回环协议模块。仅 Root 取得 GUI 时段并明确设置 `DBARK_E2E=1` 与 `DBARK_SCHEMA_COMPARE_RESULTS_UI=1` 后才可运行；它验证正式工具栏/IPC/驱动到回环协议的组合筛选、预览及两侧定义，仍不代表真实数据库验收。本任务不执行该 UI 用例、不运行完整测试/构建、不连接 200、不碰剪贴板或 Docker。

B01 整库备份另行规划；本交付只改善现有结构比较，不计为备份或结构同步执行能力。
