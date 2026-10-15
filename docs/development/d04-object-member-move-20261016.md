# D04 对象成员移动实现候选

源提交：`8199bf6ff914e3694206c8dfc93d5f0d43a5237e`。任务分支：`task/parallel-d04-object-member-move-20261016`。本批承接既有结构编辑，不修改0.15历史验收或公开能力范围。

对象菜单的新动作是 `move-member`，编辑表单明确填写原成员和移动后的最终目标序号，从1开始，与记录树的成员#1一致。输入保留原文，不使用浏览器数值归一化；空白、前导零、符号、小数、指数、不安全整数、0和越界序号均不能暂存。默认1到1不产生dirty；改过输入但仍为同位置或完全相同成员的移动不制造新行引用。

纯模型按同一冻结词法文档、对象节点和有序成员身份取跨度。完整键token、冒号及其间空白和值token一起移动；原来的逗号及成员间空白槽位保留，所选对象以外的原文完全保留。例如：

```text
{ "a" : 9007199254740993,  "b":-0,\n "c":1e999 }
从成员2移动到最终成员1：
{ "b":-0,  "a" : 9007199254740993,\n "c":1e999 }
```

不以JSON.parse/stringify重建对象，不按名称查找或去重；重复名称、原始转义、数字词法、孤立surrogate、ZWJ和嵌套标点按原token保留。拼接前累计原262144 UTF-16及UTF-8预算，最终复用节点替换的完整字段解析，再复用记录字段暂存。深度64、节点8192、容器2048等原限制不放宽。

记录层新增动作仍经过 `beginRecordJsonNodeInput`、`assertRecordJsonNodeCurrent` 和 `stageRecordDraft`；已有普通字段输入不能同时进入结构缓冲。会话、陈旧行／选择、连接和加载代次、生成列／只读、原始值并发、三选离开、SQL预览及集中提交继续使用原控制器和引擎；没有新增IPC、后台写入或持久化。

## 共享入口最小接线

按本任务文件边界，本分支不修改 `RecordReadonlyProjection.tsx`、TableTab、useRecordViews或中央协议。对象编辑表单与动作已实现；完整产品树菜单由统筹在集成时接这一行：

```ts
if (selectedNode.kind === 'object') {
  kinds.push('append-member');
  if (selectedNode.members.length) kinds.push('move-member');
}
```

位置是 `RecordReadonlyProjection.tsx` 中 LexicalTree 的 kinds列表，对象根和嵌套对象共用；空对象不提供移动。现有onStructure和useRecordViews泛型入口无需改动。本克隆 `.cache/d04-object-member-move-wiring.patch` 给出可复查的最小接线，尚未应用。接线前不能将本分支称为完整产品入口已验收，不能用单独模型或静态按钮替代。

## 验证与尚未验收

非GUI单元覆盖首中末、同位／唯一／相同成员、重复及转义名称、精确数字、嵌套内容、空白槽位、Unicode、完整预算、非法／越界序号、零部分暂存、原页已有草稿和其它行引用、捕获身份、生成列／只读与三选离开。SSR仅验证真实编辑组件的标签、原文属性和只读控件，不能代替浏览器焦点或交互。

本轮结果：8套313项相关单元通过；类型检查通过；生产构建29.59秒通过；3项真实UI准备在关闭开关、无效主机和不存在的应用路径下全部默认跳过。共享菜单接线补丁通过git apply --check，但未应用到共享源文件。

```powershell
node node_modules/vitest/vitest.mjs run tests/unit/json-object-member-move.test.ts tests/unit/record-object-member-move.test.ts tests/unit/json-structure-input.test.ts tests/unit/record-json-structure-input.test.ts tests/unit/record-json-structure-editor.test.tsx tests/unit/record-json-node-input.test.ts tests/unit/record-input-document.test.ts tests/unit/record-views.test.ts
node node_modules/typescript/bin/tsc --noEmit
node scripts/build.mjs
# 本轮只执行默认跳过，不设置DBARK_INTEGRATION_ENABLED=1：
node node_modules/@playwright/test/cli.js test tests/e2e/table-object-member-move-live.spec.ts
```

默认关闭的真实UI准备为 `tests/e2e/table-object-member-move-live.spec.ts`。它必须在统筹接好真实树菜单、分配GUI和200后明确设置DBARK_INTEGRATION_ENABLED=1及已核对临时账号；默认在桌面启动前跳过，不读取根凭据。三项场景通过实际树菜单、实际编辑器和既有控制器，准备验证精确移动及原页草稿／预览零写／明确提交，三选离开与非法原文，生成列及并发整批回滚。失败保留命令摘要和截图，原helper退出及清理随机库。

本员工未启动Electron、GUI或剪贴板，未访问200。产品原生入口、真实数据库、安装产物、跨平台组合和原生JSON服务器规范化后的表示均未在本轮验收；LONGTEXT真实UI准备不能证明服务器已丢失的原生JSON重复键或格式可恢复。
