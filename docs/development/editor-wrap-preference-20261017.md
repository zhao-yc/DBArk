# SQL编辑器自动换行偏好

固定基线`7d0cc767c7b371250176b0302be78b288197b519`，独立普通clone分支`codex/employee2-editor-wrap-preference-20261017`。不使用worktree。

## 完整产品路径

工作台命令栏新增独立“自动换行”按钮，以aria-pressed表示当前状态，中文tooltip解释开关。字号入口、字号弹窗和文案均未修改；不添加系统快捷键。

`AppSettings.editorWordWrap?:boolean`沿现有settings.save保存。新默认true保持既有wordWrap:on；旧记录缺项只回退true，显式false保留。IPC生产schema与LocalStore直接入口严格拒绝非布尔值；读取明确损坏的显式值也拒绝，不把字符串false或数字0强转为开关，不增加数据库迁移。

按钮事件每次从最新useWorkspace.getState()取当前值，再仅updateSettings({editorWordWrap:!current})，随后复用flushSettings立即保存当前完整工作区。旧按钮闭包不会捕获过时开关或settings；保存回包为void，不回写SQL、标签或其它偏好。保存失败沿既有notice呈现，不冒充已落盘，也不回滚后来的选择。

## Monaco行为

所有SqlEditor（含只读SQL预览）读取同一偏好。稳定optionsRef初始化明确on/off；换行layout effect只调用原widget.updateOptions({wordWrap})，不包含字号/行高、字体族、readonly、model、正文、undo、选区或会话字段，也不更改补全effect依赖。迟到挂载通过原attachContent读取最后提交的optionsRef；Suspense恢复时在原widget生命周期恢复后应用当前值。原正文桥接继续负责readonly和就绪门。

## 本轮窄验证

- 新增存储RAM2项：旧缺项默认且读取不写盘；false/true经原IPC/LocalStore原子字节保存后可重读；显式非法值在IPC/直接存储/读取拒绝，混入的SQL和字号不写入。
- 新增真实React5项：正式App命令栏准确组件表达式与aria-pressed、全部实例和只读、renderer旧记录初始化、迟到loader、Suspense恢复、单字段合并及延迟回包。原锁定@monaco-editor/react组件/effect实际运行，Monaco及worker为RAM端口；稳定model、版本、原文、撤销写入口、选区、字号/行高/字体族、onReady与补全provider均核对。
- 单独选取既有字号热更新共存对照1项通过，7项明确未选。未重跑原字号套件。
- 本轮实际选中的8项均通过；新增7项无跳过，字号对照1项通过/7未选。TypeScript类型检查退出码0。

存储使用真实LocalStore方法，底层单settings表与文件原子操作仅RAM端口，不初始化SQLite或外部数据库。App只提取其正式命令栏组件表达式，未完整运行App布局。原生视觉换行、滚动/焦点/撤销体验以及真实落盘重启由Root统一验收，本片不将RAM端口当作实际平台验收。

```powershell
node D:/svn/DBArk/node_modules/vitest/vitest.mjs run tests/unit/editor-wrap-preference-storage.test.ts --maxWorkers=1 --reporter=json --outputFile=.cache/editor-wrap-preference/storage.json
node D:/svn/DBArk/node_modules/vitest/vitest.mjs run tests/unit/editor-wrap-preference-ui.test.tsx --maxWorkers=1 --reporter=json --outputFile=.cache/editor-wrap-preference/ui-initial.json
node D:/svn/DBArk/node_modules/vitest/vitest.mjs run tests/unit/editor-font-preferences-ui.test.tsx --testNamePattern='实际App字号入口与真实编辑器库热更新所有可写' --maxWorkers=1 --reporter=json --outputFile=.cache/editor-wrap-preference/font-coexistence.json
node D:/svn/DBArk/node_modules/typescript/bin/tsc --noEmit
```

没有full/build、实际OS业务进程、DB、GUI、系统clipboard、原生文件导出、私料读取、SSH或Docker；没有生产部署。
