# SQLite 多页草稿文件保存与显式恢复（2026-11-05）

## 当前行为

接续[SQLite跨页草稿工作区](sqlite-multipage-workspace-20261105.md)和[逐页放弃](sqlite-workspace-page-discard-20261105.md)，新增“保存 SQLite 草稿文件”和“恢复 SQLite 草稿文件”。保存捕获所有保留页已暂存的新增、修改和删除，保留每条完整旧行与可靠定位；不会提交数据库或清除标签dirty。文件未加密，界面明确提示原始数据与定位风险，用户勾选确认后才打开保存选择器。

关闭后重新启动不会自动恢复或重放。只有在当前表没有草稿或撤销／重做历史时，才可明确选择.sqlite-draft文件。显示增改删统计，单独确认仅核验／恢复后，使用独立物理只读连接检查原文件、结构、定位及全部旧行。任一行已变、被删、文件被替换或来源失效时整份拒绝，不覆盖当前页或返回部分草稿。

通过后显示独立恢复草稿视图，只显示保存文件涉及的原记录及本地新增，不能当作服务器第一页或原分页布局。原行在新快照内连续编号，旧页的row=0不会跨页套用。整个文件暂存形成一步undo／redo；保存时的历史、未暂存表单输入、页位置和选择不恢复。返回服务器数据、刷新或应用其它读取仍走明确丢稿确认。恢复本身零数据库写入，仍须原SQL预览及明确一次提交；原完整旧值冲突／事务回滚／unknown门保持。

这是SQLite显式文件恢复的一个完整工作流，不是自动崩溃恢复、原窗口／历史恢复或跨文件重基。其它驱动的同等多页工作区、批量表单和完整持久恢复继续，D04／R02与整体Navicat目标仍部分，暂不正式发布。

## 文件格式与边界

独立kind为tabrelio.sqlite-table-draft，version=1，不与MySQL／MariaDB的dbark.table-draft互相解释。保存目标只含连接ID、main及表名；Main绑定当前端点摘要，Runtime保存真实canonical路径／dev／inode的摘要、schemaKey、schema_version、完整列事实、可靠定位及可选固定关联范围。文件没有执行SQL、数据库路径、密码、证书或旧snapshot／preview能力；用户数据本身按原文保留。

所有原值显式区分INTEGER／REAL／TEXT／NULL／BLOB。int64不经过Number，原REAL无穷与负零保留，TEXT中的重复JSON键／指数／控制值不解析，空BLOB不变NULL；新增省略字段保持DEFAULT。用户新输入仍沿原有限REAL及字段预算，不因允许原值无穷而放宽。

文件最高8MiB，最多500条变化、200000个原值／定位／赋值格；新赋值共用原10000格、2MiB及单值限制。先有界复制自有data再解析，拒绝getter、toJSON、稀疏数组、未知字段／版本、坏Unicode／Hex、坏整数、缺列、生成列赋值和重复字段。可靠键按原NOCASE／RTRIM规则去重，重复原记录整份拒绝。任何预算超限不保存或恢复部分文件。

文件IO复用已有表格草稿的单句柄、严格UTF-8、lstat／fstat前后身份比较、独占同目录临时文件、0600权限、sync及原子rename。原锁覆盖选择器、磁盘操作和清理；取消或窗口失效不提前释放原资源。已投递rename后结果无法确认按unknown保存事实处理，不诱导自动重试。

SQLite保存额外复用现有数据库导出目标保护：选择后和原子替换前两次核对全部已保存SQLite库与WAL／SHM／Journal，包括硬链接／别名；不得把草稿文件覆盖到数据库或日志。旧MySQL格式API和格式保持，只有共享磁盘状态机增加可选目的地验证。

## 信任与恢复核验

Main先核每个原页属于准确主窗口／主文档、配置修订和连接epoch，再从Runtime私有快照捕获完整原值；Renderer只能给出原已签snapshot和变化，不提供旧行、定位SQL或路径。sqlite.tableDraft.capture／restore是Main内部命令，不在公共命令白名单，公开文件IPC只有保存、选择和恢复三项。恢复文件的端点和目标在Main再次核对，文件本身不是写入授权。

Runtime在独立物理只读BEGIN／ROLLBACK中读真实表目录及schema_version，重新选择实际rowid／主键／唯一键及collation。逐条以可靠键、存储类型和固定关联范围查最多两行，要求恰好一行且所有字段完整等于保存前值。即使显示值完全相同，旧隐藏rowid被删除后插入的新行也不能领取旧候选。

全部核验及只读回滚完成后才capture一份全新编辑快照；真正driver关闭和准确进程exit确认之后Runtime才返回。Main最后签原文档的新页能力。中途取消、连接或文档ABA、关闭失败、晚到回包均拒绝发布，并精确释放未采用的新snapshot。取消绑定原任务租约，不靠取消ACK提前解锁。

Renderer沿Browser.publishRestored→正常adopt→Workspace／Editor交接，恢复输入在构造时只映射到新基线，统一计算dirty。恢复视图的分页和表头排序回调撤权，不能仅靠按钮disabled；明确返回服务器才读取原条件。文件操作自己的busy租约在释放前先从票据摘下，避免同步store通知把自身正常归还误判为外部失效。恢复失败或取消不清现有草稿，也不自动apply。

## 验证

本批实际macOS arm64／Node24.17.0及项目Electron。开始时WIN11-TEST只读核不可达且未派发，按仓库约定回退Mac。全部使用独占合成SQLite／文件，零Docker、SSH、业务库、系统剪贴板或持续服务操作。

最终相关17份文件340项通过、0失败／跳过，覆盖原文件29项、精度／原子格式、新SQLite文件及目标保护、Main真实IPC／文件／文档能力、真实worker、原单页／跨页／筛选／排序／回调和完整React父组件。类型退出0，最终构建13.80秒通过，第三方PURE及大分块提示保留。最终完整单元1298份文件27020项通过、0失败、10项既有Windows tar平台条件跳过，470.21秒，退出0；逐项核跳过仅query-csv-native-check.test.ts中的win32条件，不计作通过。新草稿文件窗口4245毫秒、原跨页工作区完整回归10664毫秒均通过；两例共四个准确owner均正常退出0（71119→71185、71213→71369），两套fixture目录删除已独立核不存在。已核最终源码与冻结SHA一致，查看保存后两页草稿及恢复独立视图PNG；默认--list仅列一例且不启动窗口。

真实worker覆盖两个原页row=0合成新快照、跨Runtime重启、混合增改删、零DML核验后明确提交、后行冲突整份拒绝、同路径新inode拒绝、隐藏rowid替换拒绝、WITHOUT ROWID复合NOCASE键、原REAL无穷／空BLOB、纯新增DEFAULT，以及目录／定位／只读／Main存活变化。保存捕获不新开数据库进程，任务概要不含候选。

Main专项通过生产IPC／dispatch、实际原子文件和真实文档能力，只有Runtime物理边界受控：未签页不弹选择器，内部命令不可公共调用，当前端点绑定，原窗口迟到及准确取消后的新快照释放，恢复只签一份新能力。完整React覆盖所有保留页保存后dirty保持、明确清稿再恢复、恢复dirty及独立banner、一步undo／redo、仍需一次明确apply、核验失败保原页、取消等待准确回包并释放新能力。

新Electron实际保存两份跨页草稿为本例文件，正常退出并同profile重启；未自动恢复。先制造后行外部冲突，明确恢复时整份拒绝且外部值保持；本例独立连接恢复种子后重新选择文件及确认，才完整只读核验并进入独立草稿视图。undo／redo保持，预览阶段磁盘不变，最后明确一次apply提交两行；独立读回四行、int64、BLOB和生成列，源文件原字节保持，任务／settings不含候选，history为空。原跨页窗口仍回归缓存／逐页放弃、统一提交、后继冲突整批回滚和重启不恢复。

## 失败与未验

前置格式及原文件51项、加入worker后95项通过；新SQLite文件6项及Main6项分别首轮通过。前置相关148过／8失败，是原VM夹具未提供新pendingRestored依赖，补真实依赖保持原业务断言。加入三个新UI用例后55过／11失败，包含上述8项和新文件选择后租约被误判失效；修正产品先摘票据租约再release，第二轮22项通过。中间类型检查发现新增命令未填白名单和未知结果类型，补齐后通过。全部逐轮JSON／日志保留，不累加。

新原生首轮业务已全部通过，停在提交后自动刷新仍有1个pending的取证断言（3740毫秒）。保存原报告、PNG、Main回包、原草稿文件、已提交合成库及SHA；独立只读确认两行已明确提交及其它两行／int64／BLOB保持。准确失败PID61826经ps核不存在才修正测试等待原pending归零并复验，未强停、不冒称失败owner退出0、不重放原写入。随后前置完整窗口4059毫秒通过；之后追加目的地保护与导航门，最终冻结构建另行完整验收，前置成功不代替最终源码范围。原120秒、1worker、0重试、trace关闭保持。

前置完整单元运行期间追加目的地／导航保护，最终27009通过／10失败／10既有条件跳过；其中8项候选窗口VM使用了移门前的restoredDraftRef，另2项新增保护断言遇到运行前已缓存的旧模块。该轮混合了运行期间修改，不作为最终冻结源码验收；保留全部报告及按失败文件时段、独占前缀和固定硬链接种子定位的一份合成文件目录，源与副本SHA一致，该标记文件不是SQLite数据库或业务数据，原目录未强删。原句柄终态后，在最终冻结源码上85项定向复验全部通过，再开始最终完整回归。Windows本增量、Mac Intel、安装包、实体输入法、OS chooser实际键鼠及人工辅助技术未验；原生chooser只定向本例数据库／草稿文件，未验任意OS路径输入。完整崩溃恢复、旧撤销栈／未暂存输入恢复、跨文件／跨连接重绑定仍未实现。

## 命令与交付

使用.tools/node/node-v24.17.0-darwin-arm64/bin置于PATH首位。NODE_OPTIONS=--max-old-space-size=2048 node scripts/typecheck.mjs；同堆配置node scripts/build.mjs。DBARK_INTEGRATION_ENABLED=0 node node_modules/vitest/vitest.mjs run 指定相关文件 --maxWorkers=1 --reporter=json --outputFile=对应JSON；最终完整不筛选文件。原生串行node scripts/sqlite-workspace-ci.mjs draft-files及multipage-workspace，新例默认--list只列一例，不启动；git diff --check。

原件.cache/sqlite-draft-persistence-20261105/、test-results/sqlite-draft-files/及test-results/sqlite-multipage-workspace/。项目归档.local/交付/2026-11-05-SQLite草稿文件保存与恢复-v1/；自动备份/Users/zhaoyuchen/同步空间/codex重要文件备份/tabrelio/交付文件/2026-11-05-SQLite草稿文件保存与恢复-v1/。保留可编辑Markdown、源码／patch、逐轮JSON／日志、原生完整回包／PNG、原草稿文件及失败合成库和ZIP；原件到归档及归档到备份逐件SHA-256，ZIP另核CRC。独立版本不覆盖历史，无PDF、安装包、凭据或密钥，源码推送不代表发行。
