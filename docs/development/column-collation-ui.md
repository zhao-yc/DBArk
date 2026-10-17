# 列排序规则前端接线

固定共享合同基线：`988ca7b868b9c4faa527edb8ce9e3f00ce889e8d`。本片只修改 `ColumnPatchDialog.tsx`、`columnPatches.ts`、中文文案及独立 RAM 测试；共享合同、Engine、Tasks、App 和 RPC 适配器不变。

真实字段差异窗口显示服务器给出的当前 charset/collation。只有 `column.collation.access.editable === true` 且本次 get 顶层完整目录有效、名称唯一时才能勾选；选择框只展示同 charset 的真实配对。缺项、只读、非法或重复目录均关闭入口，不自由输入、不猜默认、不按前端版本名单推断服务器能力。目录随一次 get 返回，不逐列请求。

保存和预览均校验整批只能有一个 alter，changes 只能有一个 collation 键。已有其它草稿时明确拒绝混合，保留草稿供用户撤销；恢复原配对消除补丁。普通字段及自动更新时间路径保留。

从 get 接收时捕获快照、原列引用/原值及完整目录；编辑选择、保存、预览响应、风险勾选和 apply 均核对各自身份。已观察到的字段、目录、原定义或连接版本变化永久撤销旧意图；恢复原值不能复活。新读取后旧行按钮、旧选择、旧保存、旧预览和旧风险勾选仍拒绝。执行前同步消费排序规则预览，即使首次执行已经返回，原React闭包也不能再次投递。继续使用现有四个 schema.columns RPC、任务取消、一次性预览令牌、释放及未知结果处理，不发送客户端 SQL。

预览必须包含冻结的两项确认：`column-collation-semantics` 与 `column-collation-default-algorithm`。文案覆盖比较、排序、分组、连接及外部视图/程序潜在冲突，以及默认 ALTER 可能重建和锁等待；不宣称定义核验能证明全局无影响或无锁执行。未知确认仍禁止 apply。

定向验证使用独立内存 DOM、真实组件/草稿助手/确认映射，仅服务边界为 RAM。实际命令为 `node .cache/employee5-column-collation-ui-v6/run.cjs` 和 `node .cache/employee5-column-collation-ui-v6/typecheck.cjs`：本片独立测试39项，原普通属性12项、自动更新时间4项、表页入口保护6项，共61项通过；`tsc --noEmit`退出0。原始版本日志在 ignored 同名目录，前序版本及测试夹具类型推断失败原件保留。本片不运行 GUI、认证、数据库、SQL、系统剪贴板、full/build、安装或部署；Root负责后端接入及真实目标验收。
