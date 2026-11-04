# SQLite 多页草稿统一事务底层（2026-11-05）

## 当前交付与下一步

本批补齐SQLite同一物理表的多个原页统一预览及一次事务提交，为跨页保留草稿提供必要底层。尚未接通多页草稿界面；现有记录窗口仍保留“未暂存输入或整页草稿存在时不能跨页”的规则。本批不是完整跨页编辑交付，不增加完整D04／R02工作包或发行计数，暂不发布。

后续继续同一跨页工作流：保留各页Editor及准确快照、页间返回原草稿、统一dirty及关闭确认、完整字段输入的暂存／取消交接、组合预览中的原页身份复核、明确一次apply、回滚保留全部草稿和未知结果锁定全组。多页持久恢复和批量表单仍另需实现，不能仅删除现有翻页拦截或用旧页row编号改写新页。

## 协议与来源

沿用sqlite.tableEdit.preview／apply／release命令，单页输入保持原snapshotId、taskId和changes。预览新增可选additionalPages，按原页提供snapshotId及该页changes；主快照及附加快照不得重复，最多16页。每页原row仍为0至999的准确页内位置，同一页同一row只能出现一次，新增不带row。

所有页共用原整批500条变化、10000个字段格和2MiB输入代码单元预算，不按页放大。先核页数，再核全部原始变化数，再核累计字段数及原文，最后深解析typed值；超限不返回部分计划，不能用额外组夹带旧值、定位或私有回调。单字段仍沿原65536代码单元和BLOB等typed预算。

多页输出在原预览上增加按请求顺序的snapshotIds，snapshotId仍为主快照。Main在首个await前逐一解析准确窗口／主文档签发的原页能力，核同一连接、main表、schemaKey、配置修订与连接epoch；派发前再次核所有页。回包须精确回显整组及原schemaKey，期限不能超过任何来源页；漏页、换序、夹额外页和迟到回包均拒绝并准确释放原预览。

Runtime仅使用自己持有的原页、完整原行及定位，进一步要求目标、可信profile、真实文件身份、完整目录／列、schema_version、可靠定位／collation和固定关联范围相同；不同表、结构或关联父键不能混批。用户筛选不是写入定位依据。不同页重叠到同一私有可靠键时，在预览阶段拒绝，不能靠不同snapshotId重复修改。NOCASE只折ASCII，RTRIM只去末尾空格，BINARY保持原文，存储类型同时参与定位身份；实际写入仍由原定位及完整旧值再次裁决。

统一计划只持有各页的引用和每条语句的来源序号，不合成伪页、不复制整组原值，不把多页原行编号拼成超出原合同的大编号。原页继续计入64份／64MiB快照预算；预览仍沿原内存预算。

## 原子性与能力寿命

一次claim消费一份预览，同时占用全部来源页，任何页正在被claim时不能重叠领取。原执行器仍用一条BEGIN IMMEDIATE包住整个有序计划，在每条DML前按该语句所属页的原可靠定位及完整原行比较；生成列、类型原文及固定关联范围保持。每条顶层changes必须为1；后继页冲突、trigger改行或数据库约束失败会回滚此前所有页的写入及trigger副作用。

只有一次COMMIT，原私有写入事实继续仅记录目标、数量、阶段和ACK，不保存SQL、路径或值。取消使用原准确任务，COMMIT边界及回执丢失仍按原driver ACK判定。确认提交或unknown撤销全部参与页和各页兄弟预览；确认回滚／not-sent保留未被外部撤销的来源，但原预览已消费，必须明确重新预览。

Main在任一页释放／失效后撤整组预览，准确操作租约会失效并按原规则取消自己的任务。Runtime单独释放能力不取消已claim的准确事务，也不提前清空活动页原值；每页active引用在真实终态结算后才回收。两层职责分别验证，不把“释放能力”当作强停已发送SQL。

## 验证

实际macOS arm64、Node.js24.17.0及项目Electron。WIN11-TEST只读检查不可达且未派发，按仓库约定回退Mac。全部使用独占合成SQLite，不使用Docker、SSH、业务库或系统剪贴板。

最终9份相关套件240项通过、0失败／跳过，覆盖原单页Editor、追加／填充、回调和跨页导航，以及新增协议预算、Main所有原页能力、Runtime真实worker事务。新测试证明：两个row=0独立来源、一次BEGIN／COMMIT、全部页撤权、第二页外部冲突发生时第一页已执行1条仍整体回滚、trigger后继行冲突、NOT NULL失败、同批增删改、来源释放、不同DDL、取消、COMMIT真实完成后分别有／无statementEnd的ACK裁决、活动次页不会提前清值，以及NOCASE／RTRIM重叠键、BINARY复合键与不同关联范围。

严格类型检查退出0，构建13.78秒通过，保留原第三方PURE及大分块提示。完整单元1293份文件全部通过，26936项通过、10项既有Windows tar平台条件跳过、0失败，486.62秒，退出0；以full.json独立统计，不累加逐轮结果。

新增真实Electron多页协议专项1670毫秒首轮通过，原120秒、1worker、0重试、trace／自动截图／视频关闭：

1. 原连接表单通过唯一chooser选本例文件，保存readOnly false。只有这一张subject表、四次limit 1原页读取、最多三次双页预览和两次明确apply被允许，未知请求永久停链。
2. 从原renderer受限IPC请求前两页，每页row=0；真实Main签能力、Runtime／worker统一提交两条修改，单一事实requestedRows和appliedRows均为2。独立只读连接核全部行、int64和BLOB原文。
3. 读取后两页并统一预览，独立连接只改第四行；第二次明确apply先执行第三行候选，再因第四行原值冲突确认整批回滚，appliedRows为1且rollbackAcknowledged true。第三行恢复原文，第四行保外部值，前两行已确认提交保持。
4. 回滚后明确重新预览能使用两份原来源，但不自动apply；精确释放该预览和来源。原任务中心记录committed／rolled-back两份真实事实，不含候选值；history为空，零页面错误、越界和待处理。
5. 原owner PID94486正常退出0，准确目录经fixture删除后再独立核不存在。该专项直接调用原renderer IPC验证协议链，不冒称已经用跨页草稿控件完成编辑。

原单页编辑完整窗口32566毫秒通过，原记录跨页完整窗口6056毫秒通过；继续保持原断言、期限、明确提交及脏稿阻止跨页规则。三个专项串行，所有原owner准确正常退出0及三套目录删除均已核对；原生回归包含正常重启，不把同一例的多次App启动重复计为多个业务用例。

## 失败记录与未验

初始原路径5份套件67项通过；新增真实用例首轮6份97过／7失败，原因均为新夹具将原页排序枚举误写为大写ASC，正式协议要求asc／desc；失败发生在页请求解析、尚未取得新worker读页。只改夹具为asc，业务断言保持，后续107项通过；再加ACK／活动释放、collation及关联范围与原回归后最终240项通过。各轮报告保留，不相加。

原夹具保留七份失败合成种子；按失败测试文件的准确运行时段、独占前缀及source.sqlite名称定位，独立只读回读固定两行种子相同，复制附件并核SHA-256。来源说明明确不能逐个映射到具体失败标题，不伪称每个目录的精确用例归属。原目录未强删。新原生专项首轮成功，未更改产品、业务断言、时限或增加自动重试。

Windows本增量、Mac Intel、安装包、跨页草稿UI、实体输入法及人工辅助技术未验。故障／ACK丢失等由真实Node worker专项验证，不泛化为逐项Electron故障注入；原生chooser仅定向本例文件，未验OS对话框键鼠。现有UI仍只发送单页变化，不以底层协议通过代替用户跨页编辑验收。

## 接续实施要点

renderer当前在src/renderer/components/SqliteTableTab.tsx的moveRecordPage拒绝inputDirty或editor.changes，dropEditor会dispose并释放原快照；SqliteTableEditor的预览端口绑定单页。接续需按最多16份准确页建立内存工作区，活跃页切换不误释放旧dirty页，按原tab／profile／version／refresh／已应用条件维持来源。旧输入／预览回调须核工作区代次和各页原值数组；后续预览将首个dirty页作为主组，其它dirty页组成additionalPages，严格核回包snapshotIds。提交成功后清全组并重新读取，回滚保留全部输入，unknown锁定全组且禁止自动重放。后台分页不是结果快照，重叠记录由底层明确拒绝，不能自动覆盖或合并原行。

## 命令与交付

实际将.tools/node/node-v24.17.0-darwin-arm64/bin置于PATH首位。相关／完整：DBARK_INTEGRATION_ENABLED=0 node node_modules/vitest/vitest.mjs run --maxWorkers=1 --reporter=json --outputFile=对应JSON；相关明确文件，完整不筛选。NODE_OPTIONS=--max-old-space-size=2048 node scripts/typecheck.mjs；同2GiB堆 node scripts/build.mjs；node scripts/sqlite-workspace-ci.mjs multipage-edit、edit、record-pages串行；新专项默认--list仅列1例，不启动窗口；git diff --check。没有持续服务需要停止。

原始证据在.cache/sqlite-multipage-edit-20261105/及test-results/sqlite-multipage-edit/、test-results/sqlite-table-edit/、test-results/sqlite-record-pages/。项目归档.local/交付/2026-11-05-SQLite多页统一事务底层-v1/；自动备份/Users/zhaoyuchen/同步空间/codex重要文件备份/tabrelio/交付文件/2026-11-05-SQLite多页统一事务底层-v1/。

保留可编辑Markdown、源码／patch、逐轮JSON／日志、原生完整报告／回包、失败合成种子及交付ZIP；原件到归档、归档到备份逐件核SHA-256，ZIP另核CRC。独立版本不覆盖历史，无PDF、正式安装包或发行，源码推送不代表发布。
