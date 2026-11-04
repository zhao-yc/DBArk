# 查询结果记录树与完整 JSON（2026-11-04 开发，2026-11-05 交付）

## 使用

在查询结果网格选中一行，从“更多结果操作”的原“查看记录详情”入口打开侧栏，可以切换“查询记录字段”“查询记录树”和“查询整行 JSON”。当前结果、本地筛选／排序后的准确结果、内存固定副本和磁盘重开的结果快照使用同一入口。字段方式保留原字段搜索、分页、展开、页内前后行及跳转；查询详情只查看已返回行，不再次执行SQL。

树按原完整列序显示返回值类型、协议类型和摘要，每组32个字段；包含网格隐藏列，同名列按原序号区分，不按别名合并。字符串须明确点击对应字段的“查看……的 JSON 结构”才解析，保留重复成员、精确数字和原始token／路径。数值及二进制不自动按JSON解析。无效或超预算原文说明原因，不显示部分结构。沿用原256KiB双预算、深度64、8192节点和2048容器项限制；只读树没有节点编辑或结构操作按钮。

完整JSON包含当前行全部原结果列，独立于字段搜索、字段分页和网格隐藏列。翻行保持展示方式，每行重新捕获准确值和类型；旧渲染、旧节点、旧模式或旧详情关闭回调不能接管新行／新结果。搜索改变会清除旧节点选择并回到第一组字段，关闭侧栏仍清空搜索。JSON文本域只读，可以全选复制；本轮自动化未操作系统剪贴板。

## 格式与精度

格式为 DBArk-query-record-view、version 1、complete true；fields按原序包含唯一key、原name、protocolType和value。数组不以别名作为对象键，重复别名、空别名及原型同名结果键不会合并。resultTruncated记录原结果是否截断，complete只表示当前行完整，不代表完整结果集。输出不包含SQL、连接、文件路径或写入定位，也不用于导入、恢复或编辑。

有完整SQLite逐格存储事实时，sourceTypes为sqlite-storage；INTEGER／REAL用原文字串保持有符号64位整数、负零和Infinity／-Infinity，TEXT与同文数字保持不同类型。筛选／排序和版本2磁盘快照已有的类型投影继续作为准确来源，不按原SQL或旧行号重建事实。

其它返回结果以及没有类型事实的旧SQLite快照，sourceTypes为returned-values。字符串保text及原文；BIGINT／DECIMAL等协议类型同时保留，不将数字字串送入JavaScript Number，也不把协议名称当作逐格存储事实。真实返回的有限JavaScript number以number、representation javascript-number和原字串表示，保留负零；boolean保持布尔值，NULL单独表示。二进制保持blob、encoding base64、原字串和bytes；空BLOB与空文本分开，大BLOB不整块解码或转HEX。

完整JSON同时限制UTF-16代码单元和UTF-8字节为2MiB，计入转义、字段元数据及缩进。先核源文本总量，再核完整输出；超限不生成截断文档，仍能返回树／字段。记录值只在当前内存来源中，不持久化到settings或SQL草稿。

## 实现

- QueryReadonlyRecord复用原QueryRowDetails控制器的准确行／列／结果和外层作用域，冻结类型化字段及只读显示描述；不绑定数据库表，不借用可写Editor或伪造表页。
- SQLite类型由bindSqliteResultStorage严格校验并绑定原对象、原类型行及版本；无事实时也绑定“缺省”事实，后来添入不能让旧投影改义。值、元数据、行、列、类型对象／数组／标记或外层来源变化观察后永久撤权，恢复相同输入不能复活。
- SQLite原值映射仅导出原已有纯函数sqliteReadonlyValue，查询和表页分别保留独立来源模型；查询失败不会退回猜测SQLite类型的部分JSON。
- 提取ReadonlyRecordView为共用无编辑能力的呈现层，保留原分页、显式词法解析、完整JSON缓存、渲染提交票据和搜索同步撤下旧节点的逻辑。SQLite表页通过独立适配器提供显示描述和原格式，不改变其page／storageTypes强绑定或写入预算。
- 新查询方式只在没有sqlitePage的原查询详情中出现；旧简化SQLite页继续字段方式。可写记录树、MySQL表格草稿与原集中预览提交保持原路径。本批不新增IPC、任务或任何查询／写入入口。

## 验证

实际macOS arm64、Node.js24.17.0及项目Electron。WIN11-TEST只读检查不可达且未派发，按仓库约定回退Mac。使用独占合成SQLite，不用Docker、SSH或业务库。

最终8份相关套件342项通过、0失败／跳过；覆盖返回值／协议精度、SQLite真实类型、旧事实缺省、原型同名键、同名列、大BLOB不解码、完整JSON双预算、全部来源永久失效，以及本地排序后准确类型投影。真实React通过原QueryTab检查隐藏列、重复别名、显式树与只读控件、搜索不缩小完整JSON、翻行保模式、迟到模式／节点回调、固定副本来源和超限后回树。原SQLite表页、详情与共享词法模型同步回归。

严格类型检查退出0，构建15.46秒退出0，保留原第三方PURE／大分块提示。完整单元1292份文件全部通过，26889项通过、10项既有Windows tar平台条件跳过、0失败，463.89秒，退出0；以full.json独立统计，不累加逐轮结果。

原SQLite工作区完整真实窗口34961毫秒通过；保持原120秒、1worker、0自动重试、trace／自动截图／视频关闭，在原完整用例中增加两段：

1. 原精度查询执行后，从准确网格选中行，打开查询详情；显式解析note的9007199254740993，核原始数字及零编辑／结构按钮，截图已直接检查。
2. 搜索note后切完整JSON仍包含5个原列及唯一c0至c4键；核int64最大值、TEXT精确数字、NULL、原Base64字节和INTEGER“2”。下一行保持JSON模式，核int64最小值及TEXT“2”；上一行的完整JSON逐项相同。
3. 同profile正常重启后，原菜单从磁盘重开版本2快照，重复同一完整树／JSON验收；新owner持有原类型事实，未借用当前执行结果或原App内存。
4. 两段查看前后分别核执行次数不增加，独立只读磁盘回读相同。原完整工作区的四次明确SQL、回滚、明确提交、筛选／排序／方案／统计与快照逻辑全部保持；不能把整例的合成事务写入误称为整例零写入。最终两owner待处理0、拒绝越界空，PID76337／76590均正常退出0，准确目录已独立核不存在。

原SQLite只读表／视图完整专项3213毫秒通过，继续核4次原表读取、查看零新增查询、零写入、文件SHA-256不变、int64／同文TEXT／Infinity／40000字节BLOB及空BLOB；原可写记录树3803毫秒通过，继续核节点及结构动作、取消、逐字原文和唯一一次明确提交。两例原owner正常退出0，准确目录删除已独立核对；三个专项串行，未放宽任何原断言或期限。

## 失败记录与未验

首轮相关测试340项通过／1项失败：内存DOM没有原生textarea.readOnly属性镜像，误把缺少夹具属性当作只读状态；改查真实渲染的readonly属性，真实Electron仍严格检查readOnly为true。后续341项全过；再增加排序结果与类型事实组合用例，最终342项全过。保留各轮原始报告，不覆盖或相加。原生三个完整专项均首轮通过，没有强停、自动重试或放宽时限。

Windows本增量、Mac Intel、安装包、实体输入法、OS chooser键鼠和人工辅助技术未验。MySQL／MariaDB协议返回值和真实父页的RAM测试不等于本轮网络实库原生验收；既有平台和历史版本证据不迁移为本轮通过。多页草稿、批量表单、记录持久恢复和其它D04子能力继续，D04／R02及完整Navicat目标仍部分，暂不正式发布。

## 命令与交付

实际Node路径为.tools/node/node-v24.17.0-darwin-arm64/bin并置于PATH首位。相关／完整测试：DBARK_INTEGRATION_ENABLED=0 node node_modules/vitest/vitest.mjs run --maxWorkers=1 --reporter=json --outputFile=对应JSON；相关指定8份文件，完整不筛选。NODE_OPTIONS=--max-old-space-size=2048 node scripts/typecheck.mjs；同2GiB堆 node scripts/build.mjs；node scripts/sqlite-workspace-ci.mjs workspace、readonly-record、record-tree串行；原workspace默认--list只列1项，不启动桌面；git diff --check。没有持续服务需要停止。

原始证据在.cache/query-readonly-record-20261104/及test-results/sqlite-workspace/、test-results/sqlite-readonly-record/、test-results/sqlite-record-tree/。项目归档.local/交付/2026-11-05-查询记录树与完整JSON-v1/；自动备份/Users/zhaoyuchen/同步空间/codex重要文件备份/tabrelio/交付文件/2026-11-05-查询记录树与完整JSON-v1/。

保留可编辑Markdown、源码／patch、逐轮JSON／日志、原生完整报告、回包与PNG及交付ZIP；原件到归档、归档到备份逐件核SHA-256，ZIP另核CRC。独立版本不覆盖历史，未生成PDF、正式安装包或发行，源码推送不代表发布。
