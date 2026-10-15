# W02 收藏、虚拟分组、专注模式与应用内对象链接

## 实际入口

- 顶部「收藏与虚拟分组」或 `Ctrl / ⌘ Shift B`：新增、移除、重命名、上移/下移收藏，创建、重命名、排序、删除虚拟分组。
- 对象树数据库和对象行的星标：添加或移除该完整身份的收藏。侧栏「对象收藏」按独立虚拟分组打开对象。
- 顶部「进入/退出专注模式」或 `Ctrl / ⌘ Shift L`：隐藏/恢复侧栏及拖动分隔条，保留标签、编辑状态、顶部恢复按钮和原侧栏宽度。状态保存后重启恢复。
- 收藏管理中「复制对象链接」，顶部「粘贴对象链接」或 `Ctrl / ⌘ Shift O`：手动粘贴完整链接后打开。仅实现应用内入口，**未注册操作系统协议**。

## 数据契约及边界

收藏身份是连接标识、数据库名、明确对象种类，以及数据库以外对象的完整对象名。名称中的点、斜杠、反引号、百分号、原型成员名和有效 Unicode 不作路径或限定名拆分。控制字符、无效 Unicode、空名称和超长名称被拒绝。手动添加可保存尚不可连接的目标；打开时才读取数据库核验。

独立 SQLite `workbench` 单行表存储版本 1 文档及修订号，由既有幂等配置迁移创建；保留现有全库 schema 版本 5，不修改原连接、真实数据库、连接分组、查询正文或标签快照。旧库无记录时使用空文档。已有损坏文档显式报错，不静默清空。删除原连接保留收藏，以便明确显示失效；删除虚拟分组仅将其收藏转入未分组。限制最多 100 个虚拟分组、1000 个收藏、2 MiB UTF-8 文档。

收藏和专注状态每次原子保存，成功后更新界面。保存期间阻止第二次修改；失败保持原快照，磁盘失败使用现有事务与内存回退。过期修订拒绝覆盖，可点击「重新读取」恢复。

自主链接格式：`dbark://object/v1/<连接标识>/<种类>/<数据库名>[/<对象名>]`。每段独立百分号编码，最多 8192 字符；只解码一次并重新编码核验规范形式，拒绝额外段、查询、片段、凭据、未知类型和外部 URL。不包含密码、主机、用户名或 SQL，不执行 URI 提供的语句。链接跨配置目录使用时须有相同连接标识，不按连接名称猜测或回退。

共享 IPC 为 `workbench.get`、`workbench.save`、`workbench.resolve`、`workbench.copyUri`，均进入原有白名单及严格参数校验。复制命令仅将经过校验的对象身份生成为 URI 写入剪贴板，不提供剪贴板读取或任意文本写入接口；等待当前 Electron 44 的异步写入完成后显示成功。依据：[Electron 主进程 Clipboard 文档](https://www.electronjs.org/docs/latest/api/clipboard)。

打开时按原连接只读核验数据库列表、对象完整名称及类型；连接变更后拒绝迟到结果。未知连接、连接失败、库/对象删除、类型变化和权限不足均给出明确错误。表/视图进入现有数据页，其它类型进入只读定义页，数据库收藏仅新建绑定该库的空查询。元数据核验与实际页面读取之间仍可能发生服务器对象变化，实际页会继续报告读取错误，不能保证原子快照。

## 验证命令及统筹验收

在本独立克隆执行：

```powershell
pnpm install --frozen-lockfile --offline
node node_modules/electron/install.js
node node_modules/typescript/bin/tsc --noEmit
node scripts/build.mjs
node node_modules/vitest/vitest.mjs run tests/unit/workbench.test.ts tests/unit/workbench-storage.test.ts tests/unit/ui-workbench.test.ts tests/unit/storage.test.ts tests/unit/ui-store.test.ts tests/unit/validation.test.ts
node node_modules/@playwright/test/cli.js test tests/e2e/workbench.spec.ts
```

本任务使用克隆自己的依赖及 Electron 程序。Playwright 夹具每例创建独立临时配置并验证进程清理；不需要持续运行服务。源码构建有现有 Vite 大块提示及依赖注释提示，构建成功。

实际结果：原切片相关 6 文件共 30 项单元测试通过，TypeScript 检查通过，完整源码构建通过；离线 Electron 界面用例通过（6.6 秒），实库用例未启用并跳过。离线用例覆盖真实界面增删改序、类型区分、特殊名称、复制、连接失败、删除连接、非法链接、持久化与恢复、最小窗口快捷入口，并核对连接配置、任务和历史没有因虚拟操作改变。已检查收藏管理和最小窗口专注模式截图；截图位于本克隆忽略的 `test-results`，不提交。

200 服务器及安装产物由主对话统一验收。本任务尚未连接服务器、未使用 Docker、未读取主目录测试秘密。所需隔离资源：一个临时独立 MySQL/MariaDB 测试库，表 `__proto__`、带空格与反引号的表/视图、与表同名的过程；一个仅授予该隔离库部分对象权限的临时账号。由统筹先核验实际服务器身份为 Server-200 / 192.168.31.200，再安排资源，不能接入业务库。

实库待验步骤：对象树星标；收藏表/视图成功打开；数据库收藏打开绑定库的空查询；过程/函数等只读定义；观察端前后比较 `SHOW CREATE TABLE` 与 `SHOW GRANTS`；删除隔离对象/撤销对象权限后验证明确失败；相同名称不同连接与类型不混用。只使用该隔离库创建/删除测试对象。安装验收继续覆盖 Windows/macOS 原生剪贴板、系统协议注册和已安装产物重启恢复，未执行前不宣称通过。

已提供 `tests/e2e/workbench-live.spec.ts`，默认跳过；统筹在确认上述隔离资源和权限后，注入测试环境变量，设置 `$env:DBARK_INTEGRATION_ENABLED='1'`，执行 `node node_modules/@playwright/test/cli.js test tests/e2e/workbench-live.spec.ts`。该用例复用项目已有随机隔离库夹具，会创建并清理唯一 `dbark_e2e_*` 测试库，关闭追踪以免记录临时凭据；覆盖星标、表数据页、同名过程只读定义、删除视图后的链接失败和前后表定义一致。受限账号撤权组合仍需统筹单独验收。

## 公共接线文件

`src/main/index.ts`（四个 IPC 分发）、`src/main/storage.ts`（独立配置表和读写）、`src/shared/contracts.ts`、`src/shared/commands.ts`、`src/shared/validation.ts`（契约、白名单、校验）、`src/renderer/App.tsx`（入口、快捷键、专注显示、核验后打开）、`src/renderer/components/Sidebar.tsx`（收藏侧栏及星标）。其余文件为 W02 独立模块与针对性测试。未调整版本、覆盖表、发行说明、CI 或依赖锁文件。

## 交叉复审修复：连接辨识与最新导航意图

侧栏每个收藏持续展示连接分组、连接名和颜色，不再只显示相同对象名称；两个连接的名称与分组重复时，再显示原连接标识。失效连接持续展示「原连接已失效」及原标识。按钮提示及可访问名称含收藏名称、连接名称/标识、对象种类、完整数据库和对象名；不展示主机、账号或凭据，不靠颜色单独传达环境。长连接名允许换行。

`src/renderer/workbenchNavigation.ts` 承担 App 中所有收藏/链接入口的生产导航逻辑。每个显式请求在 await 前取得递增代次，仅最新代次允许改变连接选择、标签或只读定义；迟到成功及迟到失败返回「未打开」，不会关闭新窗口或覆盖当前错误。打开/关闭导航表单立即撤销旧意图。每个入口另持有仅在渲染进程使用的中止信号，关闭/卸载时同步清理其结果归属；App 卸载时同步废弃所有旧代次。连接修订校验仍由主进程负责，不能代替这里的请求顺序保护。

这项修复只废弃界面上的迟到结果，不声称已取消或释放底层元数据读取。数据库目标仍依照已有连接超时和清理策略结束；未新增取消协议、数据库写入或秘密文件。

修复验证：8 个相关单元文件共 40 项测试通过，包含调用生产导航代码的两个可控倒序完成请求、空查询/表页/只读定义、过期错误、关闭、卸载和重新挂接，以及实际侧栏组件的跨连接同名、同显示名称和失效连接辨识。TypeScript 检查与完整源码构建通过。

补充 Electron 真实组件协议用例：`tests/e2e/workbench-navigation.spec.ts` 在独立沙箱窗口挂载实际收藏/链接组件及生产导航代码，只控制对象核验的返回顺序，工作区选择和标签更新仍使用真实 store。覆盖侧栏 A 慢、链接 B 快、B 后 A 返回，管理窗口关闭、URI 窗口取消、单独组件卸载、应用卸载。该用例验证前端协议及界面生命周期，不代表实库 IPC 或数据库取消验收；默认离线完整工作台用例继续验证正式 App 与真实本地 IPC。

```powershell
node node_modules/vitest/vitest.mjs run tests/unit/workbench.test.ts tests/unit/workbench-storage.test.ts tests/unit/ui-workbench.test.ts tests/unit/storage.test.ts tests/unit/ui-store.test.ts tests/unit/validation.test.ts tests/unit/ui-workbench-navigation.test.ts tests/unit/workbench-shelf.test.tsx
node node_modules/@playwright/test/cli.js test tests/e2e/workbench.spec.ts tests/e2e/workbench-navigation.spec.ts tests/e2e/workbench-live.spec.ts
```

本轮实际结果：真实组件协议用例通过（2.9 秒），正式 App 离线完整用例通过（9.7 秒）；合计 2 项通过、1 项实库用例跳过。已检查连接辨识截图。200 服务器、安装包及 macOS 验收仍交由统筹。
