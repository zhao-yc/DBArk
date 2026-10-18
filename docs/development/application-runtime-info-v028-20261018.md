# 0.28启动元信息与显式凭据检测分离

基线为Root28已推送提交 `452850ab472c028377339c53331e451b949be180`，普通独立clone分支 `codex/employee4-runtime-info-v028-20261018`。移植源为已独审的 `50dda8d39fc1b1471c98b454a2f08e939cde6637`；没有整文件覆盖Root23的App或Main。已核远端并尝试fetch，但GitHub连接失败；使用Root明确指定且本地完整SHA已核对的固定基线，不声称远端刷新成功。

## 最小适配

- 新增 `app.runtimeInfo`，严格空对象、固定白名单，Main只返回version/platform/dataPath，零safeStorage。原0.28 `app.info` 单行返回逐字不变，原布尔、同步求值顺序及错误保持；没有加入R6的30–33标记、原生SDK接线或工作流。
- 复用固定50dda的 `useApplicationInfo` 和 `EncryptionStatus`。唯一hook适配是把无效应答错误文案移入 `zh.app.encryptionCheckInvalid`，其余状态机原文相同；新增文案集中在原中文语言包。
- 启动只读元信息，偏好初始unknown且打开不自动检测，明确点击才调用原app.info。同步双击锁、挂载scope、StrictMode旧回包/错误/finally、卸载和重试行为保持。偏好关闭不卸载App，明确请求仍可在同一App内完成；不伪造原生取消或超时。
- App只改两个import、启动状态/请求及原凭据状态展示；不改0.28 SQL格式偏好、文件来源、退出草稿及其它功能。UI unknown不控制LocalStore保护器。

## 452850a独立保护证据

修改前从452850a Git对象生成 `tests/fixtures/application-info-v028-baseline.json`，冻结原Main/App规范化AST、原单行app.info、33份存储/真实凭据E2E/原生夹具/依赖/工作流文件，以及desktop完整文件与真实凭据场景尾部摘要。没有使用Root23的marker hash、版本号或保护清单冒充0.28证据。

原0.28 app.info SHA256：`b0749da27ba11a266bc61bcee5805ab322f37bf7723123a804bcca8d955e6425`。真实凭据场景尾部重新采得 `4f7da6a5151a3fe0447fbaced575b0604d8992e2a6e24e2caccdf9a1f14e3235`；它恰与旧分支相同，但本次采集和比对来源都是452850a。

私有 `.cache/runtime-info-v028/verify-preservation.cjs` 已验证：

- 33份冻结文件逐字不变，含整个LocalStore、preload、store初始化、连接配置/转移、全部命中凭据合同的真实E2E、table-grid密码恢复、原生夹具及版本/lock/工作流。
- Main仅剥离新runtimeInfo分支后，整个AST与452850a相同；原保护器注入及Main文档授权路径未改。
- App仅逆向还原本次明确接线后，整个AST与452850a相同；SQL格式偏好、文件来源及退出草稿等其余分支和调用顺序保持。
- desktop完整文件仅第一处纯版本请求换路由；149起真实加密、密文和重启恢复正文逐字保持。table-grid仍用原app.info判断密码恢复。
- 原0.28 runtime实际是37 await / 52 guard，文件字节保持；原120秒/45秒及退出/PID/目录策略未改，不套用R23的37/55事实。

这些是本次移植的一次性保护证据，后续产品演进须重新审查相应合同，不能依据修改后字节偷偷重签本固定基线。

## 验证及未验边界

窄RAM/组件检查包含：Root28真实Main新旧分支、严格输入/白名单、原同步错误/布尔、实际preload透传、12项真实ReactDOM hook/组件状态、18项原存储方法RAM合同、原SQL格式偏好组件及validation。另运行 `tsc --noEmit`。精确计数、命令、日志及保护摘要在 `.cache/runtime-info-v028/handoff.json`。

存储验证只用SQLite/磁盘/系统保护器的RAM端口，不执行LocalStore.open或真实系统加密。没有GUI、Electron、实际Playwright（含list）、数据库、SSH、Keychain、CI、依赖安装或构建；没有删密码断言、加unknown跳过或替换真实安全后端。

只创建本地中文 `[skip ci]` 提交，暂不推送。本提交不能继承Root23 R7的源码或安装结论，更不能宣称Mac真正加解密已解决；明确检测及真实凭据操作仍可能等待Keychain授权。Root独审整合后统一构建、CI及源/安装入口原生验收。
