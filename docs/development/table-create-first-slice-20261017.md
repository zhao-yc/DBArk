# 复用现有设计器的新表准确目标确认与一次性创建

本片从已推送的 `38ea97e35dcf91935f09781eb06f49f66410d4e8` 建立独立普通克隆与 `codex/employee4-table-create-20261017` 分支。不使用worktree，不修改Root、future或其他员工目录，不合并整合分支。它属于下一批功能，不进入当前冻结的copy/TRUNCATE或0.21交付。

## 行为

原 SchemaDialog 的字段、类型/精度文本、主键、唯一索引及外键草稿保留。新表点击生成预览后进入独立确认阶段，不再经过可编辑SQL的通用 `schema.apply`；已有表原预览和修改路径保持。通用SQL工作区仍是独立显式SQL能力，不携带新建表令牌。默认值四态、类型目录与显式排序规则选择没有混入本片。

新增 `schema.tableCreate.get/preview/apply/release` 四个严格协议。get从独立短会话读取实际服务器、会话SQL模式与准确数据库目录；主进程只从已存连接取得profile，并注入可信连接修订。预览持有经严格校验并复制的结构化设计、准确连接/库/表、服务器/目录摘要、SQL模式和生成SQL；renderer不能提供profile、修订、originalName、已有列来源或替换SQL。生成仍调用原 `buildDesign`，只生成一条 `CREATE TABLE`，不加IF NOT EXISTS、不覆盖、不自动改名、不ALTER或DROP补救。

设计序列化最多2MiB，复用总计32快照/32预览、16MiB、120秒缓存额度，不另开无限缓存。字段/索引/FK各最多1000项；名称采用1～64个BMP字符、拒绝控制字符和尾空白。专用高频确认不在mysql/information_schema/performance_schema/sys系统库创建对象；系统管理及不能表达的设计仍走原显式SQL工作区，不把该限制说成数据库不支持。

预览区只读，用户必须输入原样的准确“库.表名”并确认DDL隐式提交、同名拒绝和未知不重放。两层执行端在第一次await前消费能力，UI也以同步围栏/消费标记拒绝双击。目标锁覆盖实际host任务和严格连接收尾。准备、释放、取消控制和真正运行的taskId分开追踪，取消响应不提前解除忙态。

## 事实与并发边界

- get/preview只读目录，目标同名检查不承诺消除外部并发窗口。最终CREATE仍依靠服务器拒绝同名；既有表、视图或外部刚创建的同名对象均不覆盖。
- 主进程及引擎分别核对修订/用途。main等待中修订变化时，迟到能力先释放，不绑定新来源。UI从设计草稿阶段观察连接修订；连续ABA、props目标/设计变化、StrictMode旧代次和迟到响应都不能复活旧预览。
- ACK前断线/取消/异常显示“结果未知”，旧能力不能再用。只读看到同名表，甚至同名且相同定义，都不会触发自动标成功、重试或删除。
- 收到CREATE成功响应后，`ddlCompleted=true`不会因后核、事件回调或关闭失败倒退成未执行。结果分别报告 `definitionVerified` 与 `resourcesReleased`。后核失败保留ACK并提示；关闭/收尾拒绝时保留ACK及原核验事实，资源标记未确认。原任务事件仍保留DDL进度，持久概要不保存默认值、注释、SQL或驱动错误原文。
- 目标互斥按服务器指纹和保守折叠的库/表名称绑定；并以既有结构执行锁保护本连接的精确目标。host拒绝后无法区分动作错误与收尾错误时，本片保守保留该目标锁，最多32项；release只撤销能力，不能解锁未知执行。需由Root先核现场和所属资源，再重启独立执行进程恢复，不能通过重开窗口或等TTL自动解除未知锁。这是明确的保守限制。
- 服务器/数据库目录摘要与配置修订不是对外部DROP/重建同配置数据库的物理身份保证。再次读取和最终CREATE不能构成全局CAS；并发及维护条件仍由操作者核对，不声称消除外部DDL窗口。

## 核验与兼容性

普通结构成功后，独立只读核实际服务器/数据库、SHOW CREATE、表引擎/默认字符集/注释、列类型/可空/默认/自增/注释、主键及唯一/普通索引。SHOW CREATE与目录都必须支持所请求设计；字段未知属性、额外约束或不完整目录不报核验成功。BIGINT/DECIMAL默认值始终用原字符串，不转JS Number；列类型显示宽度与有限时间表达式只做已证明的保守规范化。

没有按8.4.11硬封普通MySQL/Maria版本。原生成器仍生成已有普通能力；RAM覆盖5.7.44/8.0.46/8.4.11及10.11.19/11.4.13仅证明没有误加版本路由封锁，**不等于各版本真实数据库验收**。

外键仍按原生成器生成、投递，不撤掉原设计器能力；本片没有逐项实现外键及自动索引目录等价证明，带FK时明确提示并保留ACK、`definitionVerified=false`。SQL模式省略SHOW CREATE属性、utf8别名、数值默认值规范化或其它无法保守对齐的情况同样显示ACK后未完整核验，不伪报通过。实际字符集排序规则仅核当前可表达内容，不宣称已实现显式COLLATE选择。

## 文件边界

- `src/shared/tableCreate.ts`：专用结构化设计、目标、预览/执行协议、风险确认与后端说明。
- `src/engine/tableCreateTasks.ts`：有界快照、预览与一次性创建，复用原生成器和结构短会话；SQL生成器本身未改。
- `src/renderer/components/TableCreateConfirmation.tsx`、`tableCreateServices.ts`及`locales/tableCreate.zh-CN.ts`：只新增确认阶段、同步围栏、资源释放和中文文案。
- `SchemaDialog.tsx`只分流新表、观察新表草稿来源并上报脏态；没有复制字段/索引/FK设计器。`App.tsx`完成新表脏态与准确目标回调：只刷新原连接/库对象树、标记精确表页失效，不自动打开、重绑或关闭其他表/新模态。
- contracts/commands/validation、engine/main分发、taskPrivacy和结构purpose联合只作最小接线。复制结构模块、共享desktop-fixture/live-helpers、默认false/else及quitDesktop均未改。

## 纯验证

独立ignored配置 `.cache/table-create/vitest.config.mjs` 禁用envDir，测试worker加载拒绝真实网络、子进程、私有配置读取和密钥生成的守卫；仅复用现有依赖junction，没有安装依赖。

定向矩阵共379项：本片60项（Engine21、main5、真实ReactDOM14、生产App/正式终态接线8、双门/list12）及既有319项。既有回归包含普通结构SQL、新建库、字段/索引专用任务、copyStructure、TRUNCATE及严格退出，不用同实现伪造单纯绿色状态。核心反例覆盖：

- 一次准确CREATE、精度原文、PK/unique；不同版本路由不硬封；外键ACK后保守未核验。
- 身份/模式/修订/同名变化、错误准确确认、重复令牌、不同预览争用同目标、真实close Promise等待、TTL和释放中止、输入与返回目标不可替换引擎设计、未知不重放/不DROP。
- main可信目标、私有修订注入、首次等待前消费、跨用途拒绝、迟到能力释放、进程退出保留ACK和概要隐私。
- 实际React事件的只读预览、尾空格拒绝、双击、取消、ACK后核/关闭失败、原进度ACK与RPC拒绝、连接ABA、目标变化、StrictMode旧能力、释放失败、卸载迟到ACK、原SchemaDialog表单到专用确认、释放期间目标变化不关闭新草稿。

TypeScript `--noEmit`通过。双门打开时，在守卫下只运行指定入口的 `--list --workers=1 --retries=0 --trace=off --reporter=json`，仍只得到默认关闭身份和 `results=[]`，不加载live/桌面/认证模块。列表不是正式UI通过。

## 未来正式验证与交接

`tests/e2e/table-create.spec.ts` 默认双门关闭，list先于任何环境读取短路；只有 `DBARK_INTEGRATION_ENABLED=1` 与 `DBARK_TABLE_CREATE_TEST=1` 且非list才加载live定义。未来正式UI只安排一例，使用现有设计器建立自增PK、唯一索引和精确DECIMAL默认值，经准确确认后观察目录；要求Root绑定实际MySQL8.4服务器UUID。保留原默认45000毫秒、单worker/0retry调度，未加超时延长。

正式定义沿既有严格TestInfo owner，每次页面取得和关键await后重核，观察SQL未知即retain；body返回共享收尾链前再核新用途apply成功终态。本例afterEach也有同一新用途终态门，防止超时后直接进入自动清理；不修改共享fixture的默认分支。实际close、PID与资源归属仍由Root既有严格退出证据核定，不能以本例afterEach或列表替代。

本轮实际GUI、DB、Server-200、认证读取、clipboard、Docker、安装、CI操作和发布均为0。Root后续单独核代码、整合并安排真实执行；本片不自动合并，不触碰冻结产物。
