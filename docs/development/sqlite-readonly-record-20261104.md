# SQLite 只读记录树与完整 JSON（2026-11-04）

## 使用

从 SQLite main 物理表或视图的原“查看记录详情”入口打开当前行，可以切换“SQLite 只读字段”“SQLite 只读记录树”和“SQLite 只读整行 JSON”。字段方式保留原搜索、字段分页、展开、页内翻行和跨页导航。新方式只使用已加载的准确原页，不增加数据库读取，也不提供编辑、暂存或提交。

记录树按完整字段顺序显示实际类型、声明类型、生成列标记与值摘要，每组32个字段。字段搜索只筛树中的字段，换搜索会回到第一组并清除旧节点选择；网格隐藏列仍在完整记录内。BLOB显示原Base64及字节数，摘要截断会注明，不把二进制整块转为HEX或解码。TEXT须明确点击对应字段的“查看……的 JSON 结构”才解析；声明类型或文本外观不触发自动解析。

JSON结构使用共享有界词法树，保留重复成员及顺序、精确数字、原始token和路径，可以展开／收起；只读方式隐藏节点编辑与结构操作按钮。无效或超预算TEXT说明原因，不显示部分结构。沿用256KiB双预算、深度64、8192节点和2048容器项限制。

完整JSON总是包含当前记录全部字段，不受字段搜索、树的分页或网格隐藏列影响。页内翻行保留展示方式，但按新行重新捕获真实类型与完整原文，旧节点和旧JSON不能接管新行。跨页仍使用原明确分页入口，不提供跨页快照或草稿。

## 格式与来源

只读格式为 DBArk-SQLite-record-view、version 1、complete true，fields按原列序包含name、declaredType、generated和value。value明确区分null、text、integer、real、blob；INTEGER和REAL用原文字串表示，保留有符号64位整数、负零及Infinity／-Infinity；BLOB使用encoding base64、原值和bytes。INTEGER“1”与TEXT“1”保持不同。字段内TEXT保持CRLF、重复JSON成员及极大数字原文。该格式用于查看，不是导入、恢复或可写整行格式。

完整序列化同时限制UTF-16代码单元和UTF-8字节为2MiB，包含转义、元数据与缩进；先核原文总量，再核完整输出。超限不提供截断文档，仍可返回字段或树。输出不夹带SQL、连接、路径、schemaKey或行定位信息，不持久化记录值。

纯Renderer模型要求完整SqliteTablePage、相同result以及绑定context中准确的page和storageTypes引用；同结果的假页、缺类型事实或不匹配值均拒绝。捕获值和字段冻结，后续核当前控制器、原页、列元数据、目标、类型事实和行；观察失效后单向撤权，恢复旧引用不能复活。BLOB按原Base64核规范及字节数，不为当前性检查序列化大值。旧渲染事件还核准确提交票据，翻行／换搜索不能操作后来选择。

共享JsonLexicalTreeView新增readOnly参数，默认false保持原可写路径；只读时控件和回调两处都禁止编辑。普通查询结果只有简化来源时仍用原字段详情，本轮没有将SQLite任意SQL结果扩成完整记录树，也没有新增IPC或数据库任务。

## 验证

实际macOS arm64、Node.js24.17.0和项目Electron。WIN11-TEST检查不可达且未派发任务，按仓库约定回退Mac。全部原生例串行使用独占合成SQLite文件，没有Docker、SSH、业务库或系统剪贴板操作。

最终7份相关套件144项通过、0失败／跳过，覆盖类型精度、大BLOB不解码、完整JSON预算、旧来源／元数据／类型／同对象值变化、永久失效，以及真实React模式切换、搜索与分页、完整字段、翻行保模式和不显示编辑控件。严格类型检查通过；构建15.45秒通过，保留原第三方PURE及大分块提示。完整单元1291份文件全部通过，26861项通过、10项既有Windows tar平台条件跳过、0失败，464.93秒，退出0；以full.json独立统计，不累加逐轮结果。

真实Electron新只读专项3207毫秒通过，保持原120秒、1worker、0自动重试、trace／自动截图／视频关闭：

1. 创建只读profile，唯一chooser指向本例文件。分别打开物理表child和视图read_view，每个默认读取及明确id升序读取各一次，共4次tablePage。
2. 详情树明确解析TEXT，核重复n成员、9007199254740993和1e999原文，核节点编辑／结构操作按钮不存在；最终PNG已直接查看。
3. 字段搜索后切完整JSON仍含8字段，核int64两端、INTEGER／TEXT同文、40000字节BLOB／空BLOB、NULL、Infinity及原TEXT的CRLF。下一行保持JSON方式；上一行恢复完全相同的完整JSON。查看、搜索和翻行未增加tablePage。
4. Main允许集合拒绝所有query.*及sqlite.tableEdit.*，最终零写入、零拒绝越界、零待处理／页面错误，settings不保存记录格式；磁盘文件SHA-256前后相同。
5. 原owner PID66650正常退出0，fixture删除准确目录，再独立核文件系统不存在。

原表浏览完整回归24332毫秒通过，覆盖筛选、排序、只读详情跨页及同profile重启恢复；两次启动PID67891／68124均退出0。原可写记录树完整回归3721毫秒通过，保留节点／结构动作、取消、精确原文和唯一一次明确提交；PID68140退出0。三套准确目录清理均独立核对，原断言及时限保持。

## 失败记录与边界

新React用例首轮遗漏afterEach既有flushSettings所需window.dbark夹具，3项清理失败；只补RAM端口，允许settings.save且其它命令抛错，144项完整复验通过。

新原生首轮用JavaScript Number 1写入无亲和性列，SQLite实际为REAL“1.0”，测试误期待INTEGER；独立只读回读证实产品显示正确。保留失败报告、Main记录、PNG及合成库，PID61366精确检查不存在后，种子改为BigInt 1n并增加typeof(mixed)断言，保留原INTEGER业务断言。第二轮物理表断言已过，视图名称定位误包含“视图”徽标；核Sidebar源码及失败图后，精确定位名称.truncate元素，未放宽业务断言。保留第二轮全部原件及失败库，PID63191确认不存在后才复验。第三轮完整通过，未改变产品源码、期限、重试或验收门槛。失败目录未强删。

Windows本增量、Mac Intel、安装包、实体输入法、OS文件选择键鼠和人工辅助技术未验。共享MySQL模型／组件单元回归不等于MySQL实库原生界面。预算／旧回调／故障边界部分由正式控制路径单元证明，不泛化为逐项原生故障注入。只读任意SQL结果新树、跨页草稿、批量表单和持久恢复继续，D04／R02及完整Navicat目标仍部分覆盖，暂不正式发布。

## 命令与交付

实际将.tools/node/node-v24.17.0-darwin-arm64/bin置于PATH首位；相关与完整单元使用 DBARK_INTEGRATION_ENABLED=0 node node_modules/vitest/vitest.mjs run --maxWorkers=1 --reporter=json --outputFile=对应JSON，相关指定文件而完整不筛选；NODE_OPTIONS=--max-old-space-size=2048 node scripts/typecheck.mjs；同2GiB堆 node scripts/build.mjs；node scripts/sqlite-workspace-ci.mjs readonly-record；同runner的table及record-tree；默认Playwright --list仅列1项，不启动窗口；git diff --check。没有持续服务需要停止。

原始证据在.cache/sqlite-readonly-record-20261104/及test-results/sqlite-readonly-record/、test-results/sqlite-table-browse/、test-results/sqlite-record-tree/。项目归档.local/交付/2026-11-04-SQLite只读记录树与JSON-v1/；自动备份/Users/zhaoyuchen/同步空间/codex重要文件备份/tabrelio/交付文件/2026-11-04-SQLite只读记录树与JSON-v1/。

保留可编辑Markdown、源码／patch、逐轮JSON／日志、原生完整回包与PNG、失败合成库及交付ZIP。原件到归档、归档到备份逐件SHA-256核对，ZIP另核CRC；独立版本不覆盖历史。未生成PDF、正式安装包或发行，源码推送不代表发布。
