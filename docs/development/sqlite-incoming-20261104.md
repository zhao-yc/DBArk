# SQLite 反向关联子记录（2026-11-04）

## 使用与范围

SQLite main物理表选择准确已保存行后，从“更多 → 显示 → 浏览 SQLite 子记录”打开。先明确“读取反向外键目录”，再选择子表外键声明并“读取关联子记录”。目录读取不携带父值，不扫描业务行；打开和切换声明均不隐式读取子页。每页50行，可上一页／下一页，分页为独立快照。

关联按源页读取时已保存的父键进行。可写源行已有草稿时，原草稿和undo／redo保留，取值仍来自原已保存页；未保存的新行没有入口。字段表单须先暂存或取消，再打开关联窗口。父行删除或父键变化可能无匹配，用户可明确关闭后核对、刷新源页。NULL不建立关联；不使用显示片段、亲和性猜值或数据库默认值替代缺失原值。

仅支持main用户物理表，含复合／隐式父键、自引用和引号标识符。目录最多500张物理表、总20000列、300条入站引用，单表还受原共享目录预算限制。虚拟／影子表和视图不参与扫描；超限整份失败，不发布看似完整的部分列表。声明父列不存在或隐式主键不完整时，目录保留该条并标为无法解析，禁止读取，不猜rowid。

子页只读，不更改源草稿或借用查询标签事务，不提供子页直接编辑、关联树或跨库遍历。原父记录浏览和父键选择至草稿保持。完整D05／R02及Navicat对标继续部分，暂不正式发布。

## 实现与正确性

- 新增中央白名单／共享合同／输入校验`sqlite.incomingPage`，区分catalog／page。只接受准确源表／schemaKey、taskId；page另接收真实子表／childSchemaKey、外键ordinal、完整typed父元组和分页。拒绝SQL、路径和其它命令字段。
- Main在独立BEGIN／ROLLBACK只读快照内复核父hash；目录使用pragma_table_list的main普通表，再读取真实外键声明。只有所选子页读取业务行，复核其目录hash、准确外键和真实父列映射；父表或子表结构变化后拒绝续读。缺父列声明不被悄悄排除。
- 子页通过EXISTS匹配真实父列。父列位于比较左侧，子列使用一元+去掉自身亲和性，保留SQLite外键的父亲和性和父collation。父TEXT0042不会被NUMERIC子42反向转换后误匹配；父INTEGER1可匹配TEXT子001，父NOCASE可匹配不同大小写子值。EXISTS避免父声明非唯一时重复子行，不宣称声明有效或父唯一。
- 精确TEXT投影、INTEGER／REAL／BLOB存储码及原值合同复用原实现，回包无editable能力。分页最多200行、UI50行、总16MiB；用于父元组的BLOB继续最多32768字节，不扩大原输入预算。所有标识符来自真实目录并逐个引用，业务值和页码通过位置参数绑定。
- Runtime沿原只读资源账本及准确exit确认，每类最多2个活动读取，排队和未退出任务也占槽。取消／目录／SELECT／ROLLBACK边界均核对原任务；原Promise和取消ACK都终态前，reader不释放父标签busy，不把迟到子页交给新窗口。
- Main复用原窗口／连接配置代次发布门，成功和迟到错误均校验原owner。来源绑定页／结构、准确已保存行原值及当前Editor／rows／row／values／generation；父键草稿保留，任何已观察到的来源变化和undo／redo ABA永久撤权。
- 窗口旧按钮和旧选择回调绑定已提交渲染；切换声明或读取先撤下旧子页。关闭／卸载／失效只取消准确原任务。任务概要采用固定中文，不持久化父值、子记录或错误原文，关联读取不添加SQL历史。

## 实际验证

实际macOS arm64、Node.js24.17.0及项目Electron。WIN11-TEST只读核对不可达，未派发任务，按仓库规则回退本机。只使用本例合成SQLite和准确worker／Electron owner，不使用Docker、SSH、真实业务库或系统剪贴板。

初轮真实worker／Main／父入口／隐私109项通过；新reader／组件／Main／父入口40项通过。最终相关9份套件161项通过，包括新子记录边界及原父浏览／选择回归。真实Node SQLite worker覆盖：

- 显式／隐式复合映射、ASCII大小写目标、自引用、NULL、父NOCASE和INTEGER亲和性；未解析声明保留，指定已消失外键拒绝。
- TEXT父0042与NUMERIC子42区别；非唯一父不重复子行；引号子表名、BLOB完整字节和9223372036854775807保持。
- 子表／父表旧hash、501张表目录预算拒绝；正常读取worker退出0、零kill。
- 目录／子SELECT／ROLLBACK三个阶段取消后原查询事务仍打开、状态已知且可独立回滚，准确任务最终cancelled。

正式Main入口和晚发布测试覆盖原窗口、配置变更、销毁、保存屏障，以及缺配置／错误方言／退出／额外路径的投递前拒绝；不调用SQL历史端口。reader测试覆盖ACK双向顺序、未发送停止、来源ABA、不完整父键和错目标／hash／offset／truncated／storage／request／mapping／duplicate回包。真实React组件与正式reader验证显式读取、旧回调和关闭双序，网格DOM为RAM替代。正式父方法＋Editor验证可写源草稿002保持而关联值为原001，只读源可用，未保存新行拒绝。

最终完整单元：1285份测试文件全部通过，26761项通过、10项既有Windows平台tar条件跳过、0失败，退出码0，451.54秒；独立解析full.json核对，未把各轮计数相加。

最终类型检查退出码0，构建14.62秒通过，保留既有第三方PURE注释及大分块提示。默认--list仅列举原1项窗口整例，不启动桌面或数据库。

真实Electron最终整例9076毫秒通过，原固定120秒、1worker、0自动重试、trace／自动截图／视频关闭；原关系图两主题、只读父记录及完整可写父键选择／清空／撤销／预览取消／一次提交断言全部保持，新增：

1. 默认只读profile从真实parent行打开子窗口，零读取；明确读取目录，不带values。发现related_child及subject两条引用。
2. 首次50行、下一页2行、上一页50行，分页边界按钮核对；切换声明零读取并撤下旧网格，再明确读取subject返回1行。
3. 本例外部观察者临时删除parent id1，明确读取返回0行；恢复parent不自动读取。反向流程没有重读源sqlite.tablePage。
4. 原可写child_pair完成既有一次提交后，本地暂存id=99；反向窗口原始Main请求仍传INTEGER1，读取child_note的完整BLOB00ff。关闭后草稿99仍在，可一步undo；磁盘保持已明确提交的Beta／2／note和原控制行。
5. 8次反向请求、11次原父引用请求、唯一一次既有apply，零Main越界、零页面错误。准确owner正常退出0，原fixture确认独占目录删除，另核文件系统不存在。

独立解析最终正式Main原回包：子页行数为50／2／50／1／0／1，前两页ID精确等于1–52，无遗漏或重复；最后父值为INTEGER1。原subject／parent磁盘断言保持。已查看最终窗口PNG，声明、映射、读取／分页、BLOB和关闭操作可见。系统chooser仅定向本例合成文件，不代表系统文件选择对话框键鼠验收。

## 失败及未验

原生首轮在上一页仍busy时过早记录切换前计数，收到上一页迟到完成后计数从3变4，使“切换零读取”使用了旧基线。失败日志／JSON和目录保留；原runner终止后用准确PID12817的只读ps核对已不存在，再补齐下一页按钮恢复可用的终态等待。第二轮通过，没有放宽零读取断言／期限，没有强杀或自动重试。所有相关单元与类型初轮通过。

Windows本增量、Mac Intel、安装包、实体输入法及人工辅助技术未验；单元里的真实Node worker取消和RAM来源测试不冒称逐项原生故障注入。尚未支持反向子页编辑、从子页继续关联树或跨库反向目录。

实际命令（项目Node24.17.0置于PATH首位）：node scripts/check-node-runtime.mjs；DBARK_INTEGRATION_ENABLED=0 node node_modules/vitest/vitest.mjs run --maxWorkers=1；node scripts/typecheck.mjs；NODE_OPTIONS=--max-old-space-size=2048 node scripts/build.mjs；node scripts/sqlite-workspace-ci.mjs relationships；node node_modules/@playwright/test/cli.js test tests/e2e/sqlite-relationships-native.spec.ts --list；git diff --check。逐轮原件位于.cache/sqlite-incoming-20261104/，最终完整原生报告位于test-results/sqlite-relationships/，不将各轮计数相加。

## 交付

项目.local/交付/2026-11-04-SQLite关联子记录-v1/；自动备份/Users/zhaoyuchen/同步空间/codex重要文件备份/tabrelio/交付文件/2026-11-04-SQLite关联子记录-v1/。保留可编辑Markdown、共享合同／Main／Renderer／测试源码及patch、各轮原始结果、完整原生JSON和PNG、交付ZIP。源文件到归档和归档到备份逐文件核SHA-256，ZIP另核CRC；独立新版本不覆盖历史。本轮未生成PDF、安装包或正式发行。
