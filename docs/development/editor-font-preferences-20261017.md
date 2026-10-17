# SQL编辑器字号偏好

固定基线`615c6327913f3c7c7972445103ab96355f40c941`，独立普通clone分支`codex/employee2-editor-font-preferences-20261017`，不使用worktree。

## 产品路径

工作台命令栏新增“编辑器字号”，打开专属轻量弹窗。显示清楚的当前字号、8–32整数输入、恢复默认13、取消与保存字号。草稿及恢复按钮不即时应用；点击保存才更新全局偏好并立即沿既有设置保存链路持久化。保存期间可关闭弹窗；旧回包不能关闭重开的新弹窗。失败明确显示“当前窗口已应用但保存失败”，允许重试，不冒充已落盘。

`AppSettings.editorFontSize`为可选字段，以兼容旧记录和旧调用。主进程settings.save Zod白名单与LocalStore.saveSettings直接入口均严格拒绝越界、非整数、非数字值。新默认为13，读取缺项或损坏的旧值时只回退13，不强转字符串、不改变数据库schema或其他偏好。renderer初始化及SqlEditor读取也使用同一读取函数。

保存只调用`useWorkspace.getState().updateSettings({editorFontSize})`合并最新设置，再复用`flushSettings()`取消防抖并保存当前状态；不持有打开弹窗时的完整settings，不在回包后set旧快照，既有settings.save返回仍是void。保存期间的新SQL、新标签及活动标签因此不被回包覆盖。字号与现有theme、结果网格、表分页、窗口缩放及字体族相互独立。

## Monaco生命周期

所有SqlEditor从同一store订阅字号，包括只读SQL预览。默认fontSize13/lineHeight23精确保留；其他字号的行高按round(fontSize*23/13)派生，不增加独立行高设置。现有Cascadia Code/SFMono-Regular/Consolas/monospace字体族不改，不下载字体。

仅通过原实例的updateOptions更新fontSize和lineHeight，不改变model、正文、undo、选区、格式化动作、会话或补全effect依赖。optionsRef继续保持稳定，只在layout effect提交最新字号；迟到onMount通过原attachContent应用已提交字号，readonly解除仍完全由原正文桥接决定。字号layout effect排在widget生命周期恢复之后，使Suspense隐藏期间修改的字号在恢复时也生效；销毁实例不恢复写入。

## 本次证据

- 新增存储边界4项：旧缺项/损坏值默认、IPC与直接存储严格拒绝、8/32/13正确保存及其他SQL不变、原子保存失败回退。
- 新增真实React7项：从正式App源码提取准确state/命令栏button/开关方法/弹窗表达式，挂载真实弹窗、store、SqlEditor和锁定@monaco-editor/react；验证全实例热更新、恢复/取消、延迟回包、新SQL/标签、旧弹窗回包、失败重试、迟到loader和Suspense恢复。
- 直接回归原正文/只读/格式化生命周期13项及当前语句入口19项。
- 最终43/43，0失败0跳过；TypeScript类型检查退出码0。

Monaco模型/选区/撤销写入口、loader和worker只为RAM端口；真实React及锁定库effect仍运行，未用假SqlEditor代替产品。存储使用原LocalStore的records/saveSettings/mutate/flush，底层单settings表与文件原子写入为RAM端口，不启动SQLite或外部DB，不读取实际配置。正式App其余布局没有在本片完整运行，原生焦点、Monaco视觉/撤销体验、真实落盘和重启持久恢复由Root统一验收。

发现的中间实现红：Suspense隐藏期间改字号，恢复后仍为13而非32。原红JSON与当时SqlEditor副本留在本clone的.cache/editor-font-preferences；调整layout effect顺序后同字节测试通过，不删除原红。测试早期VM缺exports及loader理想ESM端口错误也保留原日志，最终延迟测试改在锁定库实际公开loader端口注入，不把未进入断言计为通过。

```powershell
node D:/svn/DBArk/node_modules/vitest/vitest.mjs run tests/unit/editor-font-preferences-storage.test.ts tests/unit/editor-font-preferences-ui.test.tsx tests/unit/ui-editor-content-bridge.test.tsx tests/unit/ui-current-statement.test.ts --maxWorkers=1 --reporter=json --outputFile=.cache/editor-font-preferences/final-accepted.json
node D:/svn/DBArk/node_modules/typescript/bin/tsc --noEmit
```

本片没有全套/full/build、实际GUI/DB、系统剪贴板、OS原生业务进程、原生文件导出、私料读取、SSH或Docker。没有生产部署。
