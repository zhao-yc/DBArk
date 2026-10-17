# SQL编辑器自动换行偏好

固定基线`7d0cc767c7b371250176b0302be78b288197b519`，独立普通clone分支`codex/employee2-editor-wrap-preference-20261017`。不使用worktree。

## 完整产品路径

工作台命令栏新增独立“自动换行”按钮，以aria-pressed表示当前状态，中文tooltip解释开关。字号入口、字号弹窗和文案均未修改；不添加系统快捷键。

`AppSettings.editorWordWrap?:boolean`沿现有settings.save保存。新默认true保持既有wordWrap:on；旧记录缺项或开关损坏时只局部回退true，显式布尔false保留。IPC生产schema与LocalStore直接写入口严格拒绝非布尔值；读取不把字符串false或数字0强转为开关，也不因单个偏好损坏丢弃其它SQL/标签，不增加数据库迁移。

按钮事件每次从最新useWorkspace.getState()取当前值，再仅updateSettings({editorWordWrap:!current})，随后复用flushSettings立即保存当前完整工作区。旧按钮闭包不会捕获过时开关或settings；保存回包为void，不回写SQL、标签或其它偏好。保存失败沿既有notice呈现，不冒充已落盘，也不回滚后来的选择。

## Monaco行为

所有SqlEditor（含只读SQL预览）读取同一偏好。稳定optionsRef初始化明确on/off；换行layout effect只调用原widget.updateOptions({wordWrap})，不包含字号/行高、字体族、readonly、model、正文、undo、选区或会话字段，也不更改补全effect依赖。迟到挂载通过原attachContent读取最后提交的optionsRef；Suspense恢复时在原widget生命周期恢复后应用当前值。原正文桥接继续负责readonly和就绪门。

## 本轮窄验证

- 新增存储RAM2项：旧缺项默认且读取不写盘；false/true经原IPC/LocalStore原子字节保存后可重读；非法显式写入仍在IPC/直接存储拒绝，混入的SQL和字号不写入；读取期望已随本次修复改为局部回退。
- 新增真实React5项：正式App命令栏准确组件表达式与aria-pressed、全部实例和只读、renderer旧记录初始化、迟到loader、Suspense恢复、单字段合并及延迟回包。原锁定@monaco-editor/react组件/effect实际运行，Monaco及worker为RAM端口；稳定model、版本、原文、撤销写入口、选区、字号/行高/字体族、onReady与补全provider均核对。
- 单独选取既有字号热更新共存对照1项通过，7项明确未选。未重跑原字号套件。
- 初版042固定来源：当时实际选中的8项通过，新增7项无跳过，字号对照1项通过/7未选；当时类型检查退出码0。本次读取修复未重跑这8项。

存储使用真实LocalStore方法，底层单settings表与文件原子操作仅RAM端口，不初始化SQLite或外部数据库。App只提取其正式命令栏组件表达式，未完整运行App布局。原生视觉换行、滚动/焦点/撤销体验以及真实落盘重启由Root统一验收，本片不将RAM端口当作实际平台验收。

```powershell
node D:/svn/DBArk/node_modules/vitest/vitest.mjs run tests/unit/editor-wrap-preference-storage.test.ts --maxWorkers=1 --reporter=json --outputFile=.cache/editor-wrap-preference/storage.json
node D:/svn/DBArk/node_modules/vitest/vitest.mjs run tests/unit/editor-wrap-preference-ui.test.tsx --maxWorkers=1 --reporter=json --outputFile=.cache/editor-wrap-preference/ui-initial.json
node D:/svn/DBArk/node_modules/vitest/vitest.mjs run tests/unit/editor-font-preferences-ui.test.tsx --testNamePattern='实际App字号入口与真实编辑器库热更新所有可写' --maxWorkers=1 --reporter=json --outputFile=.cache/editor-wrap-preference/font-coexistence.json
node D:/svn/DBArk/node_modules/typescript/bin/tsc --noEmit
```

没有full/build、实际OS业务进程、DB、GUI、系统clipboard、原生文件导出、私料读取、SSH或Docker；没有生产部署。


## 042异常记录局部恢复修复

本次独立普通clone分支`codex/employee2-editor-wrap-read-fix-20261017`，基线`042e67a7f774a30ce070b818190edf4bba4caf14`。员工5原handoff SHA256为`6847bab68896f3437a9f3b50ad6a9e36941a9350d1d1f6a59c4cf6c9c6d1d7a3`。Root明确“非法显式值拒绝”属于写入口；既存异常记录的读取必须像字号损坏一样局部恢复。

原readEditorWordWrap在坏字段上抛错，导致整个settings.get失败；renderer只剩默认空tabs，下一次普通偏好保存覆盖既有SQL。现在只在typeof value为boolean时接纳原值，其余值（缺项或坏值）只将本字段回退true。assertEditorWordWrap及IPC/直接存储写入口均未放宽。其余settings逐字段沿原对象保留，读取不写盘，不更改App/按钮/SqlEditor/Store/Main或schema逻辑。

原恢复v2测试SHA256`d1b3994a67249181a749a7940811f672b41123bd46e37fe15ad550089a9d51ce`、正常组合测试SHA256`12817dc45d6932e97822d8809bf6c014afe100972fc6680fe97d513c0b5561a0`保持同字节。原042实际2绿1红，已封存。修复后的原字节恢复用例因其“初始化notice.error必须true”的旧故障态期望失败：成功恢复应没有加载错误，不能令产品继续报错来迁就该断言。

因此新增派生回归，仅把这一旧故障态期望改为不报错，并加强loaded/persisted完整对象相等断言；原SQL、tabs、字号及侧栏的原断言全部保留。派生恢复用例与上述两个同字节正常对照实际3/3通过，0失败0跳过。原字节的修后故障态差异也单独保存，不冒称原字节全绿。原红、原件、派生来源和修后日志位于.cache/editor-wrap-read-fix。原存储测试已同步读写分离的正确期望，但本次不重复原8项。

```powershell
node D:/svn/DBArk/node_modules/vitest/vitest.mjs run --config .cache/editor-wrap-read-fix/vitest-fixed.config.ts --reporter=json --outputFile=.cache/editor-wrap-read-fix/fixed-three.json
node D:/svn/DBArk/node_modules/typescript/bin/tsc --noEmit
```

本次只修读取函数、相关测试和本文；不full/build、不运行实际OS/DB/GUI/clipboard或读取私料，实际落盘重启与原生Monaco仍交Root统一验收。

本次读取修复TypeScript类型检查实际退出码0。
