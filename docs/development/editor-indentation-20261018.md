# SQL 编辑器全局缩进偏好

本片基于固定 `4e647642dfba47a1bfa8f39f23b30f7b99876bde`，在普通独立克隆、`codex/employee1-editor-indent-20261018` 开发，仅本地提交，由Root整合。主命令栏新增独立“编辑器缩进”入口，支持1–8整数宽度及空格/Tab；默认2列、空格。保存、取消、恢复默认及字段均有中文可访问名称，文案集中在 `editorIndentation.zh-CN.ts`。原字号和换行入口逻辑不改写。

已核对本地锁定依赖源码：Monaco的 `textModelDefaults.js` 默认为 `insertSpaces:true`、`detectIndentation:true`；原SqlEditor显式宽度2但未关闭自动检测。sql-formatter 15.9.0的 `sqlFormatter.js` 默认为 `tabWidth:2`、`useTabs:false`。本片保留原默认2/空格，并显式设置 `detectIndentation:false`，防止正文已有Tab或其他宽度盖过用户选择。

`settings` JSON只增加可选 `editorTabSize`、`editorInsertSpaces`，本功能不升级SQLite版本；作者独立基线为6，Root整合版因命名筛选方案升为7。主进程读取及renderer初始化分别做局部安全回退，不丢SQL、标签或其它偏好，不因读坏值自动保存。显式宽度只接受1–8原始整数、空格标志只接受原始布尔值；IPC严格schema与直接LocalStore写入口都拒绝坏值，包括显式undefined。缺项旧调用仍可保存，未知字段仍由IPC strict拒绝。

独立绑定器只调用现有widget的 `updateOptions` 与当前model的 `updateOptions`，同时应用 `tabSize`、`indentSize`、`insertSpaces`。挂载、切model、热更新及隐藏恢复都走同一选项路径，销毁时释放订阅。不重建model，不调用正文替换、自动格式化、Undo、选区或滚动写入方法；只读仍由原正文桥接控制。所有已开SqlEditor和后来新model均使用全局偏好。

保存只一次合并两个当前偏好字段，再使用原settings保存链路；回包不回写打开弹窗时的工作区。关闭权限与pending令牌同步消费，旧成功或失败回包都不能覆盖新SQL/标签/后续偏好或关闭后来打开的弹窗。失败保留窗口内已应用值并提示重试，沿用既有偏好产品语义。

现有格式化器原先使用默认2空格，本片仅在用户原有“格式化SQL”按钮/快捷动作中读取当前偏好，映射 `tabWidth` / `useTabs`。保持原token安全检查、选区范围、CRLF、字面量、两侧Undo stop和单次 `executeEdits`；更改偏好不改SQL，不新增格式化动作或自动执行。

验证限定为14个定向文件、117项通过（20项新例、97项原回归），类型检查执行一次且退出码0。使用真实React组件、锁定编辑器库及生产模型绑定器，Monaco布局/模型端口在RAM，覆盖已开可写/只读实例、新模型/null切换、新标签、迟到loader、隐藏恢复、无效草稿、默认/取消、晚回包及显式格式化。真实sql.js SQLite文件只在本克隆忽略缓存生成，验证保存重启、旧坏值恢复、严格schema/未知字段对照、schema6不变及原子写盘失败回退，不读取用户配置或连接业务库。原换行初始化用例仅在完整对象期望中补两项默认字段，原断言及其它旧用例保留。

固定基线归档中只放入相同两个格式化测试文件，生产SqlFormatting/QueryTab的Git blob不变：旧44项通过，7项新增宽度/Tab诉求失败；修后同51项全部通过。基线反例证明原格式化忽略偏好，不将7个测试失败解释为7个独立问题。原件、固定zip、结果JSON和哈希在本任务忽略证据目录。

实际命令（Node为主机已有24.17.0，依赖只读复用祖先目录）：

- `node D:/svn/DBArk/node_modules/vitest/vitest.mjs run tests/unit/editor-indentation-model.test.ts tests/unit/editor-indentation-storage.test.ts tests/unit/editor-indentation-ui.test.tsx tests/unit/editor-font-preferences-ui.test.tsx tests/unit/editor-wrap-preference-ui.test.tsx tests/unit/editor-font-preferences-storage.test.ts tests/unit/editor-wrap-preference-storage.test.ts tests/unit/editor-wrap-preference-recovery.test.ts tests/unit/ui-editor-content-bridge.test.tsx tests/unit/editor-content-bridge.test.ts tests/unit/editor-content-flush-baseline.test.ts tests/unit/sql-formatting.test.ts tests/unit/ui-query-formatting.test.tsx tests/unit/sql-format-shortcut.test.ts`
- `node D:/svn/DBArk/node_modules/typescript/bin/tsc --noEmit`

未运行完整测试/build、真实GUI/Electron、业务实库、网络、SSH、Docker或系统剪贴板，也未读.env或创建凭据。RAM模型选项和编辑事务检查不替代Windows/macOS原生输入、视图布局与Undo体验验收；由Root合入后在其授权窗口验收。命名方案相关新文件和逻辑未触碰。
