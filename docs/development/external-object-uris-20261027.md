# 系统对象链接入口（开发中）

## 使用与边界

对象链接沿用 `dbark://object/v1/...`，从应用内“复制对象链接”取得。链接仅保存本地连接编号、数据库及对象身份，不携带凭据，不接受或执行URI携带的SQL。接收方必须已有原连接；未知连接、缺失对象或权限不足均拒绝，不回退到其它连接。

新源码接入系统启动入口。Windows 安装脚本配置 `dbark` 协议；macOS 配置应用包 `CFBundleURLTypes`。开发启动不修改系统关联。注册已有外来处理程序时，Windows 安装与卸载均保留它；仅本安装拥有且完整匹配的注册可以更新或清除。注册失败可能保留部分写入，不能当作已安装成功。原生注册、冷热启动、卸载及各架构的验收必须单独记录。

表和视图沿原工作区打开数据页；数据库打开查询页；其它对象打开只读定义。已有标签和草稿保留。模态或查询关闭协商期间等待，手动导航使原请求失效。系统 URI 为本机配置中的名称定位，不证明重建或外部重命名后的物理对象身份。

## 进程与协议

- `src/main/externalObjectUriLaunch.ts` 在副实例解析原始 `process.argv`，通过 `requestSingleInstanceLock(additionalData)` 传递有界结果。主实例不解析 Chromium 可能重排、追加的 `second-instance` 参数。协议参数必须完整且唯一，额外参数、非规范编码及超限输入均拒绝；普通无链接启动仅聚焦窗口。
- macOS `open-url` 在 `whenReady` 前同步订阅。冷输入等待存储与工作区握手，热输入复用原窗口。
- `ExternalObjectUris` 仅持有一个真实在途请求和一个最新待处理请求。文档、连接修订和新系统意图废弃提交前的旧结果；`commit` 是打开对象的线性化点。卸载、提前 `finish` 和新页面握手均不能提前释放仍未结束的元数据操作。
- preload 只发空唤醒。五个 `workbench.protocol*` 命令分别负责 ready、take、resolve、commit、finish；参数仅为空对象或 UUID。Main 捕获真实主文档归属，回包前再核验。
- 渲染 consumer 串行调用原导航，单调意图代次阻止切走再切回的 ABA；DOM/React 唤醒代替轮询。失败不自动重放。错误使用固定中文，不回显地址或原始启动参数。

## 验证入口

Windows协议命令现补充固定 `"exe" -- "%1"`；接收器只额外接受固定位置的单个 `--`，其后仍须恰好一个规范URI。旧自有注册只有完整标记、路径、描述、图标、协议值及树形均匹配时才迁移，先读取命令选择已知格式，再完整验证一次；任一读取失败保持原值。卸载仅处理完整当前格式。

这是原生参数边界：[Electron在加载应用JS前初始化Node参数](https://github.com/electron/electron/blob/v44.7.0/shell/common/node_bindings.cc#L573)，[Chromium选项解析](https://github.com/chromium/chromium/blob/152.0.7977.130/base/command_line.cc#L588)及[Node选项解析](https://github.com/nodejs/node/blob/v24.21.0/src/node_options-inl.h#L309)均以 `--` 终止选项。后置JS拒绝不代表此前未处理过原生选项。本次为静态源码推导，未做Shell/端口重现；Playwright会整理自身启动参数，不能拿其内部argv作为最早原生参数的完整证据。未为测试更换产品或翻转fuse。补充5文件后，WIN11-TEST的274项相关、含类型构建、新离线整例、NSIS编译及asar109条核对通过；完整CI和原生升级仍另验，不沿用旧提交结论。

`external-object-uri-launch`、`external-object-uris-{main,consumer,hook,boundary}`、`object-uri-installer` 单元文件覆盖边界与并发；`ui-workbench-navigation` 保留原导航断言。安装脚本解释测试不证明 NSIS 编译、注册表或操作系统行为。

`DBARK_OBJECT_URI_OFFLINE=1 pnpm exec playwright test tests/e2e/external-object-uris-offline.spec.ts --workers=1 --retries=0` 验证正式 Main `open-url` 事件及真实副实例的离线拒绝，不访问数据库、原生文件输入或剪贴板。默认关闭；该用例不证明系统注册、冷启动或实库成功导航。

正向用例为 `tests/e2e/external-object-uris-live.spec.ts`：仅同时显式设置 `DBARK_INTEGRATION_ENABLED=1`、`DBARK_OBJECT_URI_LIVE=1` 才加载实库配置。使用已有私密环境的200主机、显式13384端口，实际版本必须为MySQL8.4；读取 `information_schema.CHARACTER_SETS`，经正式Main事件及React consumer打开只读页，不创建或删除库、用户和表。用 `pnpm exec playwright test tests/e2e/external-object-uris-live.spec.ts --workers=1 --retries=0` 运行；不支持本例的TLS配置会拒绝，不降级。保持trace/video/screenshot关闭，失败保留原实例，不自动重跑；默认与list不读取实库配置。实际结果另记，不能把用例存在视为通过。

本轮各阶段证据分别绑定：e62及380完整CI四个主要job均通过；分隔符补充版另经274项相关、构建、离线整例、NSIS与asar核验。Windows旧包到新包的实际同版升级、完整协议命令更新及新原卸载器清理也已通过；控制器错误和不重放旧安装的checkpoint分别保留。新增live07在MySQL8.4.11/13384通过正式Main事件打开真实只读系统表；类型、默认关闭及列表也通过，无数据库对象写入。首次CI原红及旧安装前置证据缺口仍保留。OS冷热入口、Shell及其它实库组合另验，详见[验收记录](../../tests/integration/acceptance-external-object-uris-20261027.md)。暂不发布，不将部分子能力计为完整W02。
