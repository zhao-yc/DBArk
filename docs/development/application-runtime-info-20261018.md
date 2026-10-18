# 启动元信息与显式系统凭据检测分离

基线 `2f6e22a230d176908eecfbbdddf353f83fb62055`，实际依赖 **Electron 44.7.0**。R6原观察已到达app.info同步能力调用前的31，未观察到32，后续Main RPC未完成；这只定位调用边界，不证明具体Keychain锁、ACL或弹窗。本补丁移除启动元信息对该同步探测的依赖，不宣称修复真实Mac凭据访问。

## 最小行为变更

- 新增 `app.runtimeInfo`：严格空对象输入，预加载固定白名单，Main直接返回version/platform/dataPath，不读取safeStorage，也不输出加密标记。
- App挂载经 `useApplicationInfo` 只请求元信息。偏好设置初始为unknown，显示“尚未检测”；打开偏好设置不自动检测。明确点击检测按钮才调用原 `app.info`。
- 显式检测先同步锁定，避免React状态尚未提交时重复投递。重试清除旧结论，busy结束后只发布真实boolean；异常或无效应答保持unknown并显示错误，不伪装成不可用或可用。
- 每次hook挂载拥有独立scope；卸载/StrictMode清理永久撤销原scope，旧元信息、旧检测的成功/失败/finally不能覆盖新状态或释放新锁。偏好窗口关闭时App仍在，原明确请求继续属于同一App；没有新增后台探测、取消或原生超时。
- 元信息失败单独展示原错误，既不触发加密检测也不影响真实凭据保护器。

## 保持的合同

原 `app.info` 分支逐字保持：基线标准换行SHA-256为 `2eabce9226f4a6b8bb21e3aa06f439341deeda5a1703fc18209c4095fdab40aa`。原同步布尔、异常、求值顺序和30..33标记保持；原IPC错误仍透传。

`storage.ts`、保护器注入和真实秘密调用链未改。unknown只存在于界面状态，永远不传入LocalStore的available/encrypt/decrypt。四类秘密的原密文读取、加密保存、真实不可用时仅内存、空串清除、undefined保留及同步事务/写盘失败回滚保持。

只将desktop.spec第一个基础启动场景中纯读取version的请求改为元信息路由，原版本、隔离、设置及错误断言全部保留。其真实系统加密/重启场景起至文件末尾的标准换行SHA为 `4f7da6a5151a3fe0447fbaced575b0604d8992e2a6e24e2caccdf9a1f14e3235`，与基线相同。connection-transfer、C02 SSH/mTLS、live-database和表格偏好密码恢复测试逐字保持，继续原native能力判断，没有unknown跳过或删改凭据断言。

原37await/55guard、120秒/45秒期限、固定标记预算、身份及生命周期文件未改。依赖、版本、工作流及原生验收入口也未改。

## 本轮验证

11个窄RAM/VM文件 **196项通过**，其中新增43项：

- 13项Main/共享/预加载/接线：严格参数拒绝；三平台重复元信息零safeStorage及marker读取；Main getter原错保留；原app.info分支摘要、true/false及原错误/标记；真实预加载白名单透传；App与hook仅显式检测。
- 12项真实ReactDOM+memory-dom：未知/可用/不可用文案、元信息旧结果、双点击同步锁、原错误、重试、无效应答、卸载与StrictMode旧成功/失败/finally、新scope锁不被释放。IPC是RAM端口，不模拟产品hook或组件状态机。
- 18项原LocalStore方法VM：实际抽取readSecret/putSecret/mutate，SQLite、磁盘和保护器端口为RAM；覆盖四类秘密和加密/写盘错误回滚。没有执行LocalStore.open、SQL.js或系统加密。
- 既有153项观察、原runtime、权限门、分栏及校验回归通过。门测试里的list是VM声明模拟，没有实际调用Playwright。

```powershell
node D:\svn\DBArk\node_modules\vitest\vitest.mjs run tests/unit/application-runtime-info.test.ts tests/unit/application-info-ui.test.tsx tests/unit/application-credential-preservation.test.ts tests/unit/native-startup-wire-equivalence.test.ts tests/unit/editor-native-startup-wire.test.ts tests/unit/editor-native-startup-diagnostics.test.ts tests/unit/editor-indentation-native-runtime.test.ts tests/unit/editor-indentation-native-gate.test.ts tests/unit/query-layout-native-runtime.test.ts tests/unit/query-layout-native-gate.test.ts tests/unit/validation.test.ts
node D:\svn\DBArk\node_modules\typescript\bin\tsc --noEmit
```

类型检查退出码0。没有启动GUI、Electron、实际Playwright（含list）、数据库、SSH、Keychain或CI，没有安装依赖，也没有使用mock/plaintext改变产品加密。

## 独立审查建议与剩余边界

优先独审：Main新路由严格输入及零native访问；预加载白名单无扩权；hook同步锁和scope墓碑，尤其旧finally不能解开新锁；App偏好窗口只绑定显式按钮；原app.info/LocalStore及全部真实凭据E2E字节证据；原观察和身份合同未变。

Root整合后另行授权准确安装专项，仍以原完整身份、准备、生命周期和正常退出证明通过，不能以“没有32/33”取代验收。之后真实凭据用例仍可能暴露原生Keychain前提；本补丁不会隐藏该问题，也不证明其已修复。

## Root整合与独立复核

作者固定 `50dda8d39fc1b1471c98b454a2f08e939cde6637` 从 `2f6e22a` 整合为 `f34f926f583e6f6e44cbe3613eb7f744016abafd`；两者完整工作树无差异。直接本地clone传输未成功，改用已验证增量bundle接纳同一固定提交，未改作者、重写历史或使用worktree。

Root `node .cache/run1836-check-runtime-info-root.mjs` 的11文件／196项通过，0失败／跳过，类型退出0，unit.log SHA-256 `77a1fe36a46ae607b7b19664457c5b3d8babd08af9d16c4586b1d68143f99e2d`。未重建旧dist、未运行原生或系统加密；这些是新补丁的RAM／VM证据，不继承R6安装通过范围。

独审固定同一作者头，原196项与5项独立React对照通过、类型通过；20份保护文件及7份关键真实E2E断言摘要保持，Main去掉新元信息分支后AST等价。独立调用新Main分支75次，safeStorage属性读取0；原37await／55guard、120s／45s和所有观察预算不变。独审交接SHA-256 `70d0be03d65e6f0c1381541dad12075a28a54421b58afbec8d2aa067542099fd`，未发现阻断项。计数有重叠，不加总为完整套件或原生验收。

下一检查点仅把该修复带入新的三平台原生／实际安装运行；真实凭据测试保留，R6原超时及其证据不修改。R6只能确认执行到同步native调用前路径、预算内未确认正常返回；Main标记上限与上游早期日志可能不完整，不能据缺少32/33断言native永不返回或具体Keychain／签名原因。Electron实际版本44.7.0，依赖未变。
