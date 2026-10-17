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

初始提交 `b405c523e910fe0ba376363cf520d609ae3ed64b` 的专项 3 文件 15 项通过（纯逻辑 5、真实 ReactDOM 8、已有入口 2），类型检查通过；Playwright 只列举 1 个默认关闭占位项，没有启动桌面。此结果不覆盖下述独审发现；CI 状态单独随固定提交交接，不用基线或其它分支的结果替代。

开发中首轮内存 React 测试出现测试端口缺项：`disabled` 特性没有反映到属性，`textarea.defaultValue` 没有反映到文本和值；仅补齐本测试端口后重跑。没有降低断言或修改产品行为来绕过这些失败。

新增正式 UI 用例默认关闭，`--list` 也先短路，不导入桌面或回环协议模块。仅 Root 取得 GUI 时段并明确设置 `DBARK_E2E=1` 与 `DBARK_SCHEMA_COMPARE_RESULTS_UI=1` 后才可运行；它验证正式工具栏/IPC/驱动到回环协议的组合筛选、预览及两侧定义，仍不代表真实数据库验收。本任务不执行该 UI 用例、不运行完整测试/构建、不连接 200、不碰剪贴板或 Docker。

B01 整库备份另行规划；本交付只改善现有结构比较，不计为备份或结构同步执行能力。

## 预览首次等待前的选择围栏修复

员工5对固定 `b405c52` 的独立 5 项为 4 绿 1 红：预览服务在首次 `await` 前同步重入旧选择回调，UI 从 Alpha 变为 Alpha 与 Alpha.IX 两项，已发出的预览请求及返回稿仍仅包含 Alpha。原红保持在独立受审克隆，不用原 CI 成功替代该缺口。

原件 `independent.test.tsx` SHA256 为 `e4dc941f64567904796f94e3ea52c0103123395290906252b5b01dd40790d500`，员工5封存交接报告 SHA256 为 `58200aa53d61c867736d55557c31f801292cdd8b4630455b19cf099fcefa2877`。

补修仅修改正式父窗口的预览/保存生命周期：首次调用服务前同步登记操作 owner 并封锁选择；重绘仍保留 owner 的封锁。请求固定原快照和选择，保存固定 SQL。入口同时核当前渲染 epoch 与快照，旧 handler 不能重新领取；异步终态仅由同一 owner 释放，不解除比较或关闭持有的门。没有在返回时替换选择、放宽选择回执或忽略新选择掩盖不一致。

补修后只复跑原件的两个预览窗口项（原红及等待后正常对照），同字节原件 2 绿、其余 3 项名称过滤；追加 7 个作者围栏项全部通过，原文件的已有 8 项名称过滤。新增覆盖同步选择及重复预览、保存成功/取消/失败、同步抛错/快照过期后恢复、旧渲染及旧快照 handler 不能重新领取。类型检查通过；没有重跑原 15 项、完整套或构建，也没有实际 GUI、数据库或剪贴板操作。

复跑证据在本作者克隆的 `.cache/employee5-schema-review/`，原件 SHA 不变；`original-replay.json` SHA256 为 `ed3b8ed1216e2a9bb8b450cdd7b34bd25d99e4c3cbaf5ca42d5772277a0a3429`，`author-guard.json` 为 `e1a9f46ea9e7dd54b7d92df3a9178ec9f633df48042935e916b26cb14b1806db`。独立复跑守卫记录网络、私有材料读取、密钥生成均为 0；只允许编译工具链，拦截可选网络盘枚举，未产生产品进程。

## 同一渲染内选择先于预览的反向窗口

员工5对固定 `7d8782fcbecc066c4dc6cac593da3050f693aeb4` 另有独立单项 1 红：同一原渲染先接纳 Alpha.IX，再立即调用该渲染真实预览 handler；React 尚未重绘，闭包仍只含 Alpha，请求与最后两项选择不一致。原红及其报告不改；原件 SHA256 为 `ed98d0bd94deeac6b92ac6c1218c17e4c651dedf5d133c40bde4f3df37d42610`，封存交接报告为 `2f757013d01da18ce4d275f40f7ed538f31474285b1d41964868e55cdfcb1301`。

补修将已接纳选择作为同步权威引用，绑定报告身份、精确选择集合及单调选择代次；接纳意图时先更新该引用并撤销旧稿，再排队 React 显示状态。预览仍保留原 `currentEpoch` 门，并活读同一报告的已接纳选择，不再取旧闭包。审查稿也绑定其选择代次；同一渲染先改选择再调用旧保存 handler 时，失效稿不能保存。关闭沿用当前渲染与操作 owner，等待终态再清权威状态；没有回滚勾选、清选择或放宽旧 handler 的接纳条件来掩盖问题。

最小复跑：同字节反向原件 1 项及原正向两窗口项，共 3 绿（原正常 3 项名称过滤）；作者新连续选择/隐藏清除、旧稿保存、关闭等待 3 项，加保存取消及预览过期恢复 2 项，共 5 绿（其它 13 项名称过滤）；类型检查通过。反向观察确认 handler 来自同一原渲染且两次调用间无重绘，最终选择、真实请求和合成审查稿均包含 Alpha 与 Alpha.IX。未重复完整作者专项、完整套、构建或实际环境操作。

本次复跑在独立 `.cache/m02-reverse-fix/`；`original-replay.json` SHA256 为 `f95893a5bbe371245b2b4e9639f80a7183464fde1b4de692702cd365460e04cc`，`author-replay.json` 为 `e0e2d6b0bb239d368330c0f7a64e3753d27bbdaf374c73e1594d11b3149e2e5d`。原受审目录和本次证据相互独立。
