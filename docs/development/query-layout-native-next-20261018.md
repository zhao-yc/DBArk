# 0.23 查询分栏离线原生专项准备

本片从Root固定 `ddd9a8fde08f458964313a7677158b0647802860` 的普通独立clone开发，分支 `codex/employee2-query-layout-native-20261018`，不使用worktree，不改Root或0.22候选。先取得员工1原提交 `ae800bdf0ebcd62d66416f376aafc6460066bf22` 和 `557344a4011592b23d013fd90c8444c986d07eed`，仅在本clone重放Windows launcher与实际主进程关系、窗口准备及PID线索保留修复；它们不等于本轮重新执行原生验收。

## 复用范围与独立门

复用原 `EditorIndentNativeRun`、原TestInfo/_startWallTime/120000毫秒期限和afterEach墓碑、正常will-quit/close/已记录PID确认、Root批准文件清单及原固定端口脚本。没有新owner、launcher、强停策略或自动重试。原目录前缀及实例退出标志也沿用该controller。

公共runtime在依赖修复之后只增加 `createEditorIndentNativeRun(binding, approval?)` 的可选第二参数，形状 `{manifestPath:string, approvedHash:string}`。显式输入在构造时复制冻结，交给同一原身份验证器；未传第二参数继续读取原 `DBARK_EDITOR_INDENT_MANIFEST` 与SHA环境项，不改变原调用路径。新片不调用旧环境门，也不伪造旧门=1。

新增独立门 `DBARK_QUERY_LAYOUT_NATIVE_TEST` 默认关闭。Root未来显式授权运行时须精确为1、`DBARK_INTEGRATION_ENABLED=0`，旧缩进门缺省或精确0；不能同时带旧manifest项。独立输入为Root批准的绝对路径 `DBARK_QUERY_LAYOUT_MANIFEST` 及原字节小写SHA256 `DBARK_QUERY_LAYOUT_MANIFEST_SHA256`，直接传可选第二参数。清单schema、文件集合/字节校验和实际app/page/launcher/main/renderer来源认证仍采用原实现，清单不能由用例依据当时字节自行重新批准。

独立门保留原危险env/大小写别名/外部renderer和用户目录/预加载/实库或认证参数/CLI配置和录制覆盖的拒绝规则；安装入口只允许正式绝对路径及准确同值的C02别名。实际trace、screenshot、video须off。默认和RAM模拟list短路只登记一例，不加载runtime、创建目录或预检Socket。没有改CI或安装运行器来自动打开本门。

## 单例计划覆盖

`query-layout-native.spec.ts` 只新增一个高价值真实Playwright case：

- 通过正式表单创建无密码/无SSH的127.0.0.1:1概要，两个新查询都保留原ECONNREFUSED提示再打开，不点击连接测试或任何执行入口。
- 真实键盘输入无前导缩进的简单多行SELECT种子，没有复制旧复杂Tab种子的run1627假设。真实增量输入、Undo/Redo建立基线，再用Shift方向键建立非空选区。
- 第一查询实际拖动60、键盘10，Escape取消后完整settings越过防抖窗口仍保持；独立恢复按钮显式保存300。第二查询实际拖动40、Shift方向键50，保存390。两者互不覆盖。
- 每个布局动作前后以官方Monaco getter只读观察同一editor/model、SQL、版本与非空选区，随后实际Undo/Redo验证原正文历史。没有调用setValue/setModel/updateOptions/executeEdits/选区setter，没有注入store或改布局DOM值。官方globalAPI只读观察入口沿原基架启用；几何和aria只读取真实DOM。分栏改变可视高度时不要求滚动位置绝对不动。
- 使用所属BrowserWindow公开API固定1400×1000内容区并缩小至1400×480；短窗口只视觉夹取，越过400毫秒防抖窗口后完整settings不变，恢复窗口后回到原偏好。设置最小窗口大小只服务本例，不改产品设置或common controller。
- 第一个owner严格正常退出后才读取同一本例真实SQLite，明确schema8、两个tabs/SQL/高度和active。第二次独立启动复用同目录，恢复两个标签、活动标签、正文与300/390高度；所有owner正常退出/PID确认后原controller才删除目录。任何未知错误保留现场及数字PID诊断，不强停、不重试退出、不自动清理未知资源。
- settings/tasks/history/queries仅走原只读IPC；任务、历史和保存查询保持空，系统剪贴板不使用。取消/窗口变化的“未保存”观测指越过防抖后完整主进程settings不变，不冒称另有IPC调用次数审计。

## 本轮执行证据与未验边界

本轮只跑新gate/spec声明及可选manifest输入的纯RAM测试，14个不同参数用例逐项通过。首次13绿1红是模拟darwin时误用Windows manifest输入被新门正确拒绝；只修正该测试的目标平台清单路径及宿主VFS别名，复核该1项通过，原报告保留，产品未为此放宽规则。旧未传第二参数、新显式参数两组均走真实原controller和identity，OS/Electron/文件/端口/PID为RAM端口。跨平台RAM进程关系不能代表两平台原生成功。

另核默认关闭/RAM list模拟只声明一个回调且不加载runtime、危险env和录制覆盖拒绝、独立manifest漂移不可复活、原期限/afterEach停链、只读IPC白名单、简单多行种子及无产品setter。重放依赖后的owner/gate/identity/原端口脚本逐字未改，公共runtime差异严格限于可选清单输入。

允许的实际命令仅新两文件Vitest（专属envDir=false配置及RAM守卫）和一次tsc --noEmit；原44/其它旧回归、full/build/CI未跑。没有执行Playwright、实际list/skip、GUI、Socket/端口、SQLite/DB、网络、.env、认证材料或剪贴板，没有创建密钥/证书。源代码定义一个case不等于已取得一次原生结果。

剩余工作由Root在批准清单和独占授权窗口安排：Windows/macOS源码及安装入口的实际启动、拒连、正常退出/PID/目录证明、真实鼠标捕获/焦点/键盘、Monaco布局/选区/历史、SQLite及独立重启恢复。准备代码、RAM通过和类型检查均不能代替这些验收。本片只本地提交，不推送或部署。
