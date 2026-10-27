# 系统对象链接入口（开发中）

## 使用与边界

对象链接沿用 `dbark://object/v1/...`，从应用内“复制对象链接”取得。链接仅保存本地连接编号、数据库及对象身份，不携带凭据，不执行 SQL。接收方必须已有原连接；未知连接、缺失对象或权限不足均拒绝，不回退到其它连接。

新源码接入系统启动入口。Windows 安装脚本配置 `dbark` 协议；macOS 配置应用包 `CFBundleURLTypes`。开发启动不修改系统关联。注册已有外来处理程序时，Windows 安装与卸载均保留它；仅本安装拥有且完整匹配的注册可以更新或清除。注册失败可能保留部分写入，不能当作已安装成功。原生注册、冷热启动、卸载及各架构的验收必须单独记录。

表和视图沿原工作区打开数据页；数据库打开查询页；其它对象打开只读定义。已有标签和草稿保留。模态或查询关闭协商期间等待，手动导航使原请求失效。系统 URI 为本机配置中的名称定位，不证明重建或外部重命名后的物理对象身份。

## 进程与协议

- `src/main/externalObjectUriLaunch.ts` 在副实例解析原始 `process.argv`，通过 `requestSingleInstanceLock(additionalData)` 传递有界结果。主实例不解析 Chromium 可能重排、追加的 `second-instance` 参数。协议参数必须完整且唯一，额外参数、非规范编码及超限输入均拒绝；普通无链接启动仅聚焦窗口。
- macOS `open-url` 在 `whenReady` 前同步订阅。冷输入等待存储与工作区握手，热输入复用原窗口。
- `ExternalObjectUris` 仅持有一个真实在途请求和一个最新待处理请求。文档、连接修订和新系统意图废弃提交前的旧结果；`commit` 是打开对象的线性化点。卸载、提前 `finish` 和新页面握手均不能提前释放仍未结束的元数据操作。
- preload 只发空唤醒。五个 `workbench.protocol*` 命令分别负责 ready、take、resolve、commit、finish；参数仅为空对象或 UUID。Main 捕获真实主文档归属，回包前再核验。
- 渲染 consumer 串行调用原导航，单调意图代次阻止切走再切回的 ABA；DOM/React 唤醒代替轮询。失败不自动重放。错误使用固定中文，不回显地址或原始启动参数。

## 验证入口

`external-object-uri-launch`、`external-object-uris-{main,consumer,hook,boundary}`、`object-uri-installer` 单元文件覆盖边界与并发；`ui-workbench-navigation` 保留原导航断言。安装脚本解释测试不证明 NSIS 编译、注册表或操作系统行为。

`DBARK_OBJECT_URI_OFFLINE=1 pnpm exec playwright test tests/e2e/external-object-uris-offline.spec.ts --workers=1 --retries=0` 验证正式 Main `open-url` 事件及真实副实例的离线拒绝，不访问数据库、原生文件输入或剪贴板。默认关闭；该用例不证明系统注册、冷启动或实库成功导航。

本轮 WIN11-TEST 类型、123项相关单元、构建、1个离线整例及Windows NSIS编译通过，尚未安装或注册；原失败及未验范围见[验收记录](../../tests/integration/acceptance-external-object-uris-20261027.md)。暂不发布；不得把源码接线或其它功能的旧 CI 当作本功能原生验收。
