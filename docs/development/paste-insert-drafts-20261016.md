# D02 从粘贴数据批量新增草稿

基点为 `6b8753ac4e60bdb354569175230bfe221ce43774`，任务分支为 `codex/employee1-d02-paste-new-records-20261016`。员工1在普通独立克隆完成，不使用工作树，不合并ROOT分支。

## 使用行为

表格工具栏增加“粘贴为新增记录”。对话框只接受用户的本次 `paste` 事件数据或手工输入的制表符文本；不调用系统剪贴板读取或写入接口。

1. 初始字段映射按当前可见可写字段顺序，省略自增列和生成列；多出的源列默认忽略。用户可以显式映射自增列，不能映射生成列或重复目标字段。
2. “预览新增草稿”先整批解码、检查矩形和字段映射，显示总行数、源列数；最多展示前10行，每组10个目标字段。字段映射也按每组10个源列翻页。
3. “暂存全部新增草稿”才分配草稿UUID，一次发布全部新增行。原有修改、新增、删除草稿及其原始快照保持。关闭对话框不改变原页草稿。
4. 用户仍需从原入口集中预览并确认提交。对话框本身不执行SQL，不连接数据库，不增加IPC、后台命令或持久化记录。

每批上限为1000行、50000单元格、1000万字符。超限、矩阵缺列、映射无效或UUID冲突整批拒绝，不暂存部分行。输入或映射变化同步撤销旧预览；点击暂存时同步消费票据，双击及迟到回调不能重复追加。

## 值与权限边界

- 复用原 `decodeClipboard`。内部类型数据保留实际NULL、二进制字节及DEFAULT；未映射字段和DEFAULT都省略键。外部文本 `NULL` 保持字符串，预览用“文本”前缀与实际SQL NULL区分。
- BIGINT、DECIMAL、带微秒日期、JSON字符串保持原字符串，不转为JavaScript数字或重新解析JSON。未知、损坏或空的DBArk类型数据明确拒绝，不自动退回普通文本。
- 复用原 `recordReadonlyReason`、可靠键、表/视图及忙态规则。标签关闭、切换目标、连接版本、元数据、页面、布局或草稿变化后旧票据失效；观察过上下文变化后即使恢复原值也不复活。暂存前还同步核对当前工作区、表单输入和网格输入。
- 新增ID加入原 `copiedDraftIds` 集合，显式键值沿用原主键/唯一键本页冲突保护。最终INSERT权限、页外冲突及事务保护仍由原集中预览/提交链负责；本地预览不宣称已获数据库写入许可。

## 文件归属与集成说明

| 文件 | 本任务职责 |
| --- | --- |
| `src/renderer/pasteInsert.ts` | 有界解码、默认映射、不可变预览计划、一次性上下文票据 |
| `src/renderer/components/PasteInsertDialog.tsx` | 独立输入、字段映射、有界预览与暂存按钮 |
| `src/renderer/locales/pasteInsert.zh-CN.ts` | 集中维护新增功能中文文案 |
| `src/renderer/components/TableTab.tsx` | 新入口、独立状态/四个处理器及生命周期核对；单行新增改用同形共用工厂 |
| `src/renderer/dataChanges.ts` | 提取 `newDraftRow`，保持原单行草稿结构 |
| `src/renderer/gridClipboard.ts` | 仅导出原字符/单元格上限常量 |
| `src/renderer/locales/recordDuplicate.zh-CN.ts` | 原冲突及提交提示改为适用所有新增草稿的措辞 |
| `tests/unit/paste-insert*.test.*` | 纯逻辑、真实对话框回调及生产TableTab处理器回放 |
| `tests/e2e/paste-insert.spec.ts` | 默认关闭的3项界面专项准备 |

不修改 `ResultsGrid`，该文件留给员工2的D08工作。未改引擎、主进程、共享IPC契约、依赖/锁文件、版本、构建配置。AST对照基点确认38个原函数正文保持，其中TableTab的33个原处理器正文保持；单行 `addRow` 仅替换同形工厂调用。原 `parseTabularText`、`decodeClipboard`、`encodeClipboard`、`pasteCells`、`collectChanges`、`makePreview`、`apply`、`load`、`setRows` 和复制处理器均保持。

## 验证证据

以下命令均在任务克隆运行，Node为 `C:\Users\zhao-\.fnm\node-versions\v24.17.0\installation\node.exe`。验证使用本克隆缓存中的守卫：阻止产品进程、联网、私有配置/密钥读取和密钥生成，仅放行esbuild编译器及Rollup解析器；Vite的系统网络盘探测按失败回调处理，不实际执行。

| 验证 | 结果 |
| --- | --- |
| `node node_modules/vitest/vitest.mjs run record- paste-insert ui-clipboard table-cell-keyboard --configLoader runner --pool threads --maxWorkers 1 --minWorkers 1 --no-file-parallelism --reporter=json --outputFile=.cache/d02-paste-inserts/related-final.json` | 586通过，失败/跳过均0 |
| `node node_modules/typescript/bin/tsc --noEmit` | 通过 |
| `node scripts/build.mjs` | 源码构建成功；保留原资源体积及依赖纯注释位置提示 |
| 关闭全部36个专项门后，正式Playwright配置执行 `test --list --trace=off`，自定义报告器记录完整文件/标题路径/项目身份 | 320项；基准317项完整保留，新增3项；静态跳过247项；实际执行0 |
| `git diff --check` | 通过 |

测试覆盖实际对话框的粘贴/输入/预览/暂存回调，使用合成React状态、Modal外壳及状态/IPC端口；生产处理器从实际TSX提取后运行。它们不能替代原生窗口验收。首轮处理器回放为158/159，失败原因是测试端口遗漏原有 `blockedRef`；仅补齐测试端口后159/159通过，失败报告保留，产品没有为通过测试绕过保护。

本克隆缓存保存 `related-final.json`、`targeted-handlers.json`、`targeted-final.json`、`build.log`、`list-identities.json`、`list-verification.json`、`preservation.json`、`freeze-verification.json` 和守卫日志；缓存、依赖及构建产物不提交。

冻结核验：w02的339个源码、108个构建文件、18个队列文件逐一保持既有SHA256；独立诊断克隆仍为 `9940cd3990d3f8189dfd93304b5fcb928d66e566` 且受控文件干净。未写入这些目录，也未改变ROOT正在执行的旧验收队列。

## 尚未验收

本轮没有启动实际GUI、连接200/数据库、运行SSH/Docker、读写系统剪贴板、执行原生或私网CI。3项新增专项只完成默认关闭收集；其中的粘贴准备使用合成 `ClipboardEvent`，不能计为系统原生粘贴通过。真实窗口布局、原生跨程序粘贴、真实INSERT权限和并发冲突仍需ROOT另行分配环境验收。

正常推送触发的标准自动Linux CI按仓库原配置保留，不取消，不加跳过标记；未手动dispatch/retry原生或私网CI。推送不代表生产部署授权。
