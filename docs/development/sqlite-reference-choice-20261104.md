# SQLite 外键选择至本地草稿（2026-11-04）

## 本轮范围与使用

在现有父记录只读浏览基础上，为SQLite main物理表的准确可编辑行增加“更多 → 显示 → 选择 SQLite 外键值”。先读取外键目录，再明确读取父键候选；打开、切换声明和修改搜索草稿均不隐式读业务行。候选每页50行，支持上一页／下一页。首次读出父列后可选搜索列，输入字面子串并点击“读取父键候选”应用；分页沿用已应用条件，重新读取从第一页开始。ASCII不区分大小写，BLOB按完整HEX字节搜索；通配符、引号和SQL片段均作为普通参数文本。

选择当前候选页一行后，固定页脚“使用所选键值”会重新只读核对父键，确认其严格typed元组仍存在，才将对应子列整组暂存。其它字段草稿不丢，一次暂存形成一步撤销，可重做；新行尚未填写子键也可先选择候选。父键中有NULL时不建立关联；大BLOB继续遵守32768字节完整输入门，不截断写回。

当这组子列全部可空且非生成列时，可勾选“确认将这组可空外键全部暂存为 NULL”，再点击“清空关联至草稿”。清空重新核对源目录，不查询父表，所有子列同时变为NULL。非空约束／生成列不开放整组清空；包含生成列的映射不提供选择暂存。

以上都只改本地草稿。最终必须在原源页预览SQL，再勾选确认并明确集中提交；原冲突检测、独立写事务和整批回滚保持。候选窗口不承诺父声明有效或键唯一，数据库在真正提交时判断约束。原“浏览 SQLite 父记录”继续支持只读和可写源页，源值含已暂存草稿。

## 实现与边界

- 共享`sqlite.referencePage`增加严格`candidates`分支，只接收源页定位／schemaKey、外键ordinal、分页和可选搜索；不接收路径、SQL或子值。沿原Main窗口／连接代次晚发布保护、只读worker及任务账本。仍为最多2个活动读取、每页最多200行、16MiB回包预算，候选UI每页50行。
- Main在单独BEGIN／ROLLBACK快照内复核源hash、真实外键、父表及显式／隐式主键映射。候选搜索列只从真实目录取出并逐一引用，文本通过位置参数绑定；64位整数、TEXT精确投影和BLOB storageTypes合同保持。源查询标签事务不被借用。
- 确认复用原父键匹配SELECT，保留父列亲和性／collation；随后对复读结果做严格typed整组比对。即使NOCASE将Alpha匹配到已变化的ALPHA，也拒绝原选择。父结构指纹强绑候选页；缺失、父结构改变、截断或错请求回包不能暂存。复读最多200条；大量collation等价但typed不同的重复声明可能保守拒绝，须重新核对，不宣称唯一性。
- 选择令牌绑定准确候选页、行、外键和父hash。读取／换声明／修改搜索草稿撤销选择，旧活动行与按钮回调不能借新渲染恢复资格。搜索控件在失败后保留，可修正后明确重读。
- 源owner绑定页／schema、准确Editor、rows／row／values，以及Editor.generation。undo／redo即使恢复同一数组也不能复活旧选择。读取自有busy租约不撤权；外来租约、连接／标签／刷新或原值变化永久撤权。
- 读取Promise和取消ACK都终态、原busy租约归还后，才再次CAS核对来源并调用一次正式Editor.save。同步释放引发来源变化也不暂存；关闭中的迟到成功结果不写回。成功save主动撤销原来源后，按准确owner身份关闭本窗口。未新增直接数据库写入端口。

## 实际验证

实际为macOS arm64、Node.js24.17.0及项目Electron。WIN11-TEST只读核对不可达，未派发远端任务；按仓库约定回退本机。不使用Docker、SSH、业务数据库或系统剪贴板。

相关8份套件148项通过，覆盖真实Node SQLite worker候选／精确复合键／NULL／BLOB HEX／字面搜索、引号与注入文本、父hash变化、严格NOCASE后置比对、准确退出；包括原父浏览、Main晚发布、原关系图、任务隐私、reader取消ACK双序与来源ABA。真实父入口＋正式Editor的RAM测试证明租约释放前拒写、释放后单次暂存、undo恢复先前草稿、只读源拒绝选择，以及generation ABA撤权。组件用真实React／reader／ResultsGrid控制路径，网格DOM为RAM替代，验证确认复读、父键消失、关闭迟到、释放重入和搜索撤选；不冒称OS原生输入。

最终完整单元：1282份文件全部通过，26722项通过／10项既有Windows平台条件跳过／0失败，退出码0，459.38秒；独立解析full.json核对统计，未将各轮结果相加。

最终类型检查退出码0；最终构建13.08秒通过，保留既有第三方PURE注释和大分块提示。默认`--list`仅列举原1项窗口用例，不启动应用或数据库。

最终构建的真实Electron整例通过，7536毫秒，120秒固定期限、1worker、0自动重试、trace／自动截图／视频关闭。原关系图两主题／本地显示和只读父浏览全部原断言保持；新增同一owner下第二个准确可写profile与合成复合外键表：

1. 原只读subject的TEXT001匹配父INTEGER1，仍为明确目录／父页两读，源页没有新增重读。
2. 可写child_pair先通过真实整行表单暂存note“保留本地草稿”，再打开外键选择；打开零读取，明确目录和候选，精确展示9223372036854775807。
3. 搜索label中的“乙”，修改控件零读取，明确读取后选Beta；确认复读后整组暂存a／b，note保留。独立只读观察器核源磁盘保持。
4. 一步undo恢复Alpha／MAX_INT64，note仍在；redo恢复Beta／2。明确整组清空只多读源目录，a／b同时NULL；undo恢复Beta／2，磁盘仍不变。
5. 选Gamma后，本例外部观察者删除未引用的Gamma；确认复读为空，窗口报告已删除／变化且不暂存。关闭后源仍为Beta／2及原note草稿。观察者恢复Gamma，不自动重试。
6. 原预览打开再取消，磁盘不变；再次预览，勾选现有确认复选框后唯一一次apply，独立读回Beta／2及note。控制行仍NULL／NULL／控制，原subject／parent不变。
7. 观察器限定本例两profile、两次准确文件chooser、固定源表、已登记snapshot／preview及唯一一次apply。11次父引用请求，零拒绝，零页面错误；正常owner退出码0，原fixture确认独占目录删除。

已查看最终真实候选截图：父声明、搜索控件、父记录、分页和固定页脚确认按钮可见。清空确认在可滚动内容区，经真实checkbox交互验证。chooser仅定向本例合成文件，不代表系统文件对话框键鼠验收。

## 失败记录与未验

首轮类型因TypeScript目标lib不含String.isWellFormed失败，改用项目既有Unicode代理项规则。新增RAM测试初轮误把源editable能力复制到只读父页、父列名与结果列名不一致，以及memoryDOM checkbox属性读取不当；修正测试夹具，保留原产品严格回包门。106项相关通过后扩为148项。

原生首轮因全局last数据库节点随连接排序指向旧连接，未进入选择流程，改为准确连接容器定位。第二轮完整通过暂存／undo／clear／父键删除／预览取消后，测试将既有提交checkbox误作文本fill，修正为明确check。两轮runner均终止后分别用准确PID94800／95867的只读ps确认已不存在，才新开本例；无强杀或自动重试，失败合成目录与原日志／JSON保留。最终第三轮通过，无放宽断言或期限。

Windows本增量、Mac Intel、安装包、实体输入法和人工辅助技术未验；取消／复合BLOB证据主要来自真实Node worker及RAM控制路径，不冒称逐项原生故障注入。反向子记录、关联树及更多数据库的后续对标仍待推进，D05／R02继续部分。暂不正式发布。

实际命令（固定项目Node24.17.0置于PATH首位）：`node scripts/check-node-runtime.mjs`、`DBARK_INTEGRATION_ENABLED=0 node node_modules/vitest/vitest.mjs run --maxWorkers=1`、`node scripts/typecheck.mjs`、`NODE_OPTIONS=--max-old-space-size=2048 node scripts/build.mjs`、`node scripts/sqlite-workspace-ci.mjs relationships`、`node node_modules/@playwright/test/cli.js test tests/e2e/sqlite-relationships-native.spec.ts --list`、`git diff --check`。原始记录位于`.cache/sqlite-reference-choice-20261104/`和`test-results/sqlite-relationships/`，不将多轮计数相加。

## 交付归档

项目`.local/交付/2026-11-04-SQLite外键选择-v1/`，自动备份`/Users/zhaoyuchen/同步空间/codex重要文件备份/tabrelio/交付文件/2026-11-04-SQLite外键选择-v1/`。保留可编辑Markdown、源码／patch、各轮日志／JSON、完整原生报告及PNG、交付ZIP；原件到归档及归档到备份逐文件SHA-256核对，ZIP另核CRC。保留历史版本；本轮未生成PDF、正式安装包或发行。
