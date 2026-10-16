# D08独立切片：可选数据类型颜色

基点为ROOT固定 `8b5c99c2b0ebb19b2ab8249733fc9867402731cb`，普通独立克隆为 `d08-type-colors-employee2-20261016`，任务分支为 `codex/employee2-d08-type-colors-20261016`。不修改ROOT目录、C03冻结目录、版本号或已有发布/验收记录。本切片只覆盖类型颜色；D08的编辑会话历史没有实现，不能据此宣称D08整体完成。

## 入口和分类

应用设置增加“数据类型颜色（默认关闭）”，可显式开启、恢复及单项重置。沿既有 `settings.get/save` 只增加一个布尔字段 `dataTypeColors`，默认false；图例用文字明确列出文本、数字、日期时间、JSON、二进制和NULL。没有新依赖、新命令、数据库权限或新历史记录。

表格和只读SQL结果共用 `DataTypeColor` 展示组件、同一分类函数和两套暗/亮配色。目录类型与协议类型区分处理：

- NULL和正式 `{type:'binary',base64:string}` 标记优先；DEFAULT保持原默认值标记。
- 表格使用唯一、精确匹配内部列键的现有ColumnInfo；缺失或重复目录不借另一列猜测。
- 数值/时间/JSON/文本等只接受已知的完整类型。精确大数、十进制和日期字符串不转换，也不解析字符串内容猜数字、日期、JSON或NULL。
- SQL协议的BLOB家族可能实际承载TEXT，原始字符串一律沿默认样式；有显式字节包装时才认二进制。GEOMETRY、未知协议码和未支持的复杂类型同样保守回退。MariaDB将JSON暴露为LONGTEXT时，不会猜成JSON。

因此“两种网格一致”指共用类别、规则和配色，不凭空给缺少可靠元数据的SQL结果补出目录语义。比如已知目录TEXT可染文本，而协议BLOB字符串不可靠时不染。

## 原状态和数据边界

只给原span增加可选字色类，原文本、title和NULL/DEFAULT标记透传；不改原复制、编辑、提交、排序、二进制查看或事件入口。

本仓库RDG的RenderCellProps活动状态通过 `tabIndex=0` 传递，不使用其他版本的isCellSelected属性。活动单元格和勾选行不附加语义颜色，错误/焦点规则继续使用原前景，不设置背景、边框或outline。开关关闭时不增加目录查找，颜色专用选择状态也不会导致新列对象。

配色针对既有暗/亮普通、表面和悬停底色做独立WCAG相对亮度计算，六种前景均至少4.5对比度。该数值检查不是Windows/macOS/Linux实屏、字体、缩放或高对比模式验收。

旧本地配置缺字段或损坏的真值读取为false，不增加SQLite版本迁移。IPC与直接存储入口拒绝字符串、数值、对象等非布尔输入；重置只写此字段false，保留原布局。既有布局正文的保存语义不扩张，不新增编辑内容历史、行数据、秘密或敏感日志。

## 验证与实际边界

必要纯验证为11文件147个注册实例：95个新分类/组件/正式网格回调/真实SQLite偏好实例，以及52个旧复制、值、二进制、存储、布局和边界回归。最终以固定交付证据为准，不把参数矩阵或对比度循环重复计数。

验证包括元数据缺失/歧义、看似数字/日期的字符串、精确大数、JSON、NULL/DEFAULT/字节标记、活动/勾选/错误状态、两个真实renderCell回调、原复制协议、旧schema5缺字段/损坏标志、持久化恢复/重置、失败回滚及不新增历史。纯组件用React服务端渲染，不能代替真实网格焦点/选择验收。

静态证据另核17个原函数/JSX事件（复制、粘贴、编辑、追加草稿、完整补取、选择及二进制入口）逐字保持；12个引擎、主进程、原值/剪贴板、编辑器、表偏好和依赖文件逐blob保持。C03仍在原4429546且工作区干净，未向冻结目录写入。

正式UI准备为 `tests/e2e/data-type-colors.spec.ts`，双门 `DBARK_E2E=1` 与 `DBARK_D08_TYPE_COLORS_UI=1` 默认关闭。两项定义覆盖设置/图例/主题/实际重启/重置，以及真实表格与只读SQL元数据、选择和原值保持。后者还须在测试体内通过 `DBARK_INTEGRATION_ENABLED=1` 第三道门，才动态导入既有实库夹具。四组UI开关仅采集列表，每组2项、错误0、实际执行0；trace/video/screenshot配置关闭。

本地验证依赖从相同锁文件的既有运行依赖独立复制到新克隆，连接均重建到新克隆内部，无硬链接，也未改C03。Corepack联网初始化不可用，未新增依赖；未复制依赖中的环境/认证样例及Electron原生运行包。因此本克隆用于纯/类型/列表验证，实际GUI必须由ROOT在完整原生环境另行执行。

证据放在本克隆ignored `.cache/d08-type-colors-20261016/`：运行环境复制摘要、纯JSON、类型结果、四组UI列表、静态保持证明及最终提交摘要。最初类型检查识别出本仓库RDG接口差异，已按安装版本的声明和生产实现改用tabIndex，并同步更正真实回调测试端口；原工具输出不冒称通过。

实际命令：

```powershell
$env:TEMP = Convert-Path -LiteralPath '.cache/d08-type-colors-20261016/tmp'
$env:TMP = $env:TEMP
node node_modules/vitest/vitest.mjs run --config .cache/d08-type-colors-20261016/vitest.config.mjs --reporter=json --outputFile=<最终纯JSON绝对路径>
node node_modules/typescript/bin/tsc --noEmit
node .cache/d08-type-colors-20261016/proof.cjs
node .cache/d08-type-colors-20261016/list-ui.cjs
git diff --check
```

没有运行真实env、数据库、GUI、系统剪贴板、SSH、Docker或手动CI，没有构建安装包/部署。ROOT后续需在固定SHA上独审并验证真实暗/亮、活动/勾选、编辑与错误、重启恢复和各平台显示；编辑会话历史仍明确待做。
