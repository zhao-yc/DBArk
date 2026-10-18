# 新安装检查点的路径窄修及Mac未验边界

基于Root布局分支 `040e0c45b31b17ea23af55762a240ec32b42f932` 的独立普通clone。诊断原工作流 `39094458615`、原源码 `d4fb6e4c18c6a0f8d6bf6b77e4d27ad0aee4a776`；没有重跑原工作流。

## Windows：从生成源消除短路径，不放宽身份门

原安装清单root/executable/resources/appPath均含 `C:\Users\RUNNER~1\AppData\Local\Temp`。原进度只有header和scan.begin，owners/PID均0，原栈在identity.regular→assertCurrent→seal→preflight，尚未启动app。

只读本机公共目录验证：Node的 `realpathSync('C:/PROGRA~1')` 返回 `C:\PROGRA~1`，`realpathSync.native` 和 `fs.promises.realpath` 都返回 `C:\Program Files`。这复现了发布者同步JS路径与runtime异步原生路径的差异；未读取用户文件或改系统配置。原runner实际长用户名未被原件记录，代码不猜测或硬编码用户名。

修复位于scripts/test-packaged.mjs：先用原生realpath规范化OS提供的tmpdir，再创建本次独立安装根；原归属检查也用同一原生语义。scripts/native-editor-ci-identity.mjs的规范谓词同步采用native，拒绝未规范别名。原runtime identity、regular、完整文件集合、hash、来源绑定、期限和退出/PID/清理许可全部不改。原短清单仍被拒绝；新job从新规范根生成批准，不改写旧批准，不作忽略、大小写折叠或别名容错。

7个新纯RAM对照通过：实际临时根表达式调用native；原短清单继续拒绝；新完整长路径清单通过原seal/实际来源绑定且拒绝外部app；发布者拒绝短别名；原归属门继续拒绝外部、链接和短别名逃逸；链接/字节漂移仍拒绝。另选2个受影响旧例通过：Windows安装实际参数接线、发布者正常封存由原seal消费。没有实际build、安装或GUI；其中发布者旧例仅合成临时文件及RAM编译端口。初次旧例选择器漏掉Vitest插入的引号，0执行/17跳过，改正选择器后仅选1例通过，没有改原期待。

## arm64：只确认到前置记录点，当前不足以修产品

原installed-indent为120秒用例/45秒teardown超时，最后prepare.statusbar，owners1、已登记4个PID。之前scan.done、launch.returned、prepare.hook/window均已记录，说明该次launch已返回并取得页面句柄；没有prepare.metrics/done或close记录，没有完整renderer来源/状态栏/正常退出证明。前置标记不能证明其后的等待调用已经完成，更不能视作业务功能失效。源两项原终态均accepted且双owner闭合，只证明同job源码侧。

| 比较点 | 既有desktop-fixture | 新source专项 | 新installed专项 |
| --- | --- | --- | --- |
| executable/args | installed用环境实际app/[]；source默认Electron/['.'] | 批准Electron/[manifest.root] | 批准实际app/[] |
| cwd | 未显式传，保持项目cwd | manifest.root即项目 | manifest.root即实际安装根/.app |
| 环境 | 继承parent，设置独立userData，移除ELECTRON_RUN_AS_NODE | 经白名单，独立userData | 同source白名单，实际app路径 |
| sandbox | true | true | true |
| 主进程准备 | will-quit监听→firstWindow→pageerror监听 | 同类准备前另核身份/主PID | 同类准备前另核身份/主PID |
| 状态栏 | 原expect可见，显式15000ms | 原15000ms | 原15000ms，本次未返回完成记录 |

src/main/index.ts的rendererURL取__dirname相对dist路径，packaged WASM取process.resourcesPath；src/main/broker.ts的worker也取__dirname。静态启动路径没有发现可直接归因于cwd差异的相对资源查找。两侧app.setName与userData入口相同；这并不能证明实际preload、renderer或IPC已经完成。

本片不把继承环境差异、cwd、签名/系统安全或凭据访问当成已证实原因，不改变这些行为或增加诊断、等待、超时、重试。缺少的是这个原owner的实际页面/加载/崩溃错误，原stdout/stderr及阶段记录没有这些文本。先由Root消费x64同工作流原件；当前没有足够证据修Mac产品，Mac安装验收仍未通过。

## 本片范围

只有Windows规范路径生成/归属谓词窄修及定向离线验证；没有产品src、版本、锁、原spec/gate/identity/runtime、consumer或环境白名单变化，不扩展退出许可与清理目标范围。原Windows/arm64日志SHA已逐一核对；原报告/进度/清单及源终态按原字节保存于本人ignored证据目录。Root独审后才决定新检查点；本片不推送、不触发CI、不运行端口/实库/安装/GUI/200，不修改Root或原作者活动目录。

## Root 整合验证

Root 接纳为 `56c057c0887f00e0295ba0a74d377c732dfdc7f9`。六份实际脚本消费者一次67项通过、零跳过，完整类型检查退出0；无产品变化，不重复源码构建。忽略记录 `run1720-installed-native-paths-fixed/unit.log` SHA256 `2681631faccaf3a9287f1c44f687890ffe1c819cd347ad3b04ecd4da4d04f34e`。

这只证明本机规范路径现象及有限离线合同，修后 Windows 安装专项尚未实跑，Mac 产品未改。第二检查点三平台安装失败和现场仍按[原结果](../../tests/integration/acceptance-native-editor-progress-r2-20261018.md)保留。x64 原 job 日志已读取，原 ZIP 下载失败，具体等待阶段尚未独立提取，不能借 arm64 作结论。
