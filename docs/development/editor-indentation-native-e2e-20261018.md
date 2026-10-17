# SQL编辑器缩进：独审后的窄修，仍待Root授权执行

本轮在原 `cb8b80c8d1d8258082fd1ca3afd04fe70d9f4554` 克隆及分支修复员工2的3项P2归属问题、员工3的2项验收断言缺口；不改产品、Root、CI、通用夹具、原端口脚本或安装运行器。只修改本片原文件，并增加一个通过注入端口读取的纯身份模块。原报告、反例、红结果及原82交付报告均保留；下方“cb8历史记录”中的44项和列表结果仅属旧版本，本轮不复跑或追认。

完整授权现在包含同一个原TestInfo、框架当前TestInfo身份、原120000毫秒timeout、不可延长的原期限、环境绑定和sticky停链状态。锁定Playwright 1.64.0的真实TestInfo不公开startTime，源码中原起点为 `_startWallTime`；本片只读捕获该值，不改框架对象，缺失或变化则停链。纯RAM独审端口可显式提供原Date作等价输入，绝不以回调到达的now补造起点。`afterEach` 无条件消费该TestInfo权限；超时、状态变化、原期限届满、延长timeout或换Info都不能复活预检中的旧Promise。

runtime每个资源await后及launch/rm等副作用前均调用同一完整run授权门，不再只查环境。被controller并发拒绝后已sticky retained的旧内部Promise也会停在副作用之前。mkdtemp/Electron返回后的原目录、应用和主PID先登记，再判断期限；失效只能保留，不强退或清理已取得资源。SQLite内部await、退出动作、PID观察也共用该门。

运行入口必须由Root提供下列环境项，原独立门仍默认关闭，CI不自动配置：

| 项 | 含义 |
| --- | --- |
| `DBARK_EDITOR_INDENT_MANIFEST` | Root批准的绝对JSON清单路径，不能是链接替换 |
| `DBARK_EDITOR_INDENT_MANIFEST_SHA256` | Root批准的清单原字节小写SHA256，不从当前文件自动签发 |
| 清单 `version/kind` | `1`，以及 `source` 或 `installed` |
| 清单 `root/executable/appPath/resources` | 实际规范路径；源码root须等于本spec所属项目，appPath=root；安装exe/resources须在批准root内，appPath为resources/app.asar |
| 清单 `files` | 严格 `{path,sha256}` 数组，逐文件固定字节，拒绝重复、缺失、多出文件和链接 |

源码清单的完整集合为package.json、dist整个编译树（必须含main/index.cjs、renderer/index.html）、Electron可执行文件、批准resources/default_app.asar及原固定端口脚本。安装集合为可执行文件、resources完整树（含app.asar/外置资源）及同一固定端口脚本；安装.app的root/实际appPath也须吻合。清单路径/原字节、集合及每个SHA256在首次、每次launch前及返回后复核；同路径EXE、asar或编译资源变化不能被当成同一候选。源码launch使用批准的绝对cwd/root参数，不使用可变cwd的 `args=['.']`。

返回应用还须核实际process.execPath、app.getAppPath、resourcesPath、isPackaged和主PID；BrowserWindow(page)的窗口/WebContents身份、renderer PID、主进程窗口列表及file URL须共同对应批准renderer。原应用/page/ChildProcess引用或主PID改变都会停链；合法reload的新renderer PID只追加记录，不把renderer重建误当旧PID仍在用。以上不是OS内核装载映像取证或签名验证，实际源码/安装执行仍待Root授权。

UI新增真实断言：新查询及重启两个查询都要求detectIndentation=false；8列Tab切换前另建真实增量Undo/Redo基线和非空选区，切换后、全文替换前再真实按键Undo/Redo并比对原结果。不注入store、正文、选区或伪造原生返回。

本轮仅运行“修复复核”命名的24项窄RAM例及正对照，11项同文件旧例未选，原44不复跑。六个原红边界逐项派生复核（期限1、内部await4、相同安装路径字节1），另核afterEach/原Info/原timeout、实际app/page/PID、源root和新增UI断言。独审原脚本及期望不改；期限原脚本仍期待RAM准备端口stop，与正确提前拒绝不兼容，因此本片按原资源零副作用合同派生，不能声称原13脚本原样全绿。UI oracle只检验原断言会拒绝错误观测，不冒充原生执行。

本轮命令只包含定向Vitest（`envDir:false`、`--testNamePattern=修复复核`）及类型检查。首次类型检查发现目录由登记方法赋值后TS无法收窄，已改成核验后的固定局部路径并复验；两次原始日志均保留，不冒称只跑一次。禁止的Playwright/list/真实端口、GUI、安装替换、网络、.env、凭据、剪贴板、full/build均未执行。验证结果和固定哈希见本片新的忽略证据目录；待原审复核后再由Root决定整合及原生窗口。

## cb8历史记录（保持历史边界，不是本轮验收）

本片从固定 `f2bcde30b777d73d42366b0cf7c9f1dc2bc47178` 的普通独立克隆开发，分支 `codex/employee1-editor-indent-native-e2e-20261018`。原 `82c3cbf` 源码提交及其证据不修改。本片只新增测试、专属支持模块和本文，不改产品逻辑、原通用桌面夹具、端口脚本、CI或安装运行器。

已核对的原基架文件是 `tests/e2e/editor-font-preferences.spec.ts`（同例覆盖字号/换行与重启）、`desktop-fixture.ts`、`monaco-caret.ts` 及 `scripts/check-offline-query-port.mjs`。通用默认夹具带强停兜底；其严格owner绑定不能直接复用于本例的第二次独立启动。因此新增仅服务本用例的owner控制器与原生适配器，参照原正常握手/PID证明路径，不接默认强停分支。

`editor-indentation-native.spec.ts` 只定义1个高价值用例。`DBARK_EDITOR_INDENT_NATIVE_TEST` 默认关闭，`--list` 在脏环境及启用门之前短路，不加载runtime、创建目录、探测端口或启动Electron。实际启用须独立门精确为1、integration精确为0，拒绝环境大小写别名、外部renderer/用户数据目录、实库/SSH/认证或预加载参数，以及CLI替换配置/开启trace。实际解析的trace、screenshot、video也须先为off，随后才领取任何资源。

每次应用启动前都以本Node执行原固定端口脚本，唯一参数为脚本路径，没有外置host/port参数。必须由原脚本完成 `127.0.0.1:1` 的ECONNREFUSED与原socket close并正常退出后才能分配/启动；没有复制或放宽原socket判定逻辑。前次owner未确认正常退出，不得重启或读SQLite。两个owner分别捕获自己的应用句柄、随机will-quit标志、close、页面错误和只增不减的有效PID集合。空metrics、PID权限错误、无握手或意外关闭均永久停链，保留原实例和目录，不强停、不重试退出。

所有UI动作和异步观察两侧核同一owner，动作未完成时禁止并发退出。应用句柄一到手即登记，随后窗口准备失败也保留已捕获owner/PID。只有两个owner各自完成正常握手、close及全部已记录PID明确不存在后，才验证本例真实目录无链接/越界并删除；删除后须实际ENOENT，失败不能标记成功。

原生用例计划通过正式App界面创建固定回环、无密码/SSH的离线概要及查询，保留新建查询表单原拒连事实。真实键盘输入合成SQL，使用Monaco官方公开getter与独立WeakMap观察身份，不注入store、不替换模型或正文。依次验证默认2空格、4空格热更新、真实Tab键插入4空格、新查询model继承、8列Tab热更新及真实Tab字符；正文、模型/编辑器身份、版本、Undo/Redo、非空选区及滚动必须保持。

只读验收使用现有内置片段预览，检查最新8列Tab选项、原readonly及真实输入不能改正文。产品模态门禁止在片段弹窗内再打开缩进弹窗，测试不绕过此门，也不把“新建只读预览继承偏好”冒称同窗口同时热更新。首次owner严格退出后，只读本例真实 `dbark.sqlite` 的settings及当前schema7（版本7来自Root命名方案，本功能不升schema），随后第二次独立启动复核偏好/两个原查询正文/活动标签、新模型及只读预览。任务、历史、保存查询始终必须为空。

本轮仅执行5个定向纯测试文件，共44项通过：24项新门/owner/适配器合同和20项原端口/CI接线回归，所有Electron、Socket、文件和PID端口均在RAM。真实Playwright声明检查得到：默认列表1定义0结果；启用门且脏环境的列表仍1定义0结果；默认关闭执行1个skipped、0个原生结果。类型检查通过；收尾运行时守卫补强后再次复核。未跑全套、build、实际GUI、安装、业务实库、真实端口预检或系统剪贴板。

实际验证命令：

- `node D:/svn/DBArk/node_modules/vitest/vitest.mjs run tests/unit/editor-indentation-native-gate.test.ts tests/unit/editor-indentation-native-owner.test.ts tests/unit/editor-indentation-native-runtime.test.ts tests/unit/offline-query-port.test.ts tests/unit/offline-query-port-ci.test.ts`
- `node D:/svn/DBArk/node_modules/@playwright/test/cli.js test tests/e2e/editor-indentation-native.spec.ts --list --trace off --reporter=json`（最小OS环境；分别默认关闭、启用门且带脏环境哨兵）
- 同一Playwright命令去掉 `--list`、保持新门关闭，仅核skipped短路。
- `node D:/svn/DBArk/node_modules/typescript/bin/tsc --noEmit`

现有源码CI和 `scripts/test-packaged.mjs` 都扫描离线spec；安装入口继承本次 `DBARK_EXECUTABLE_PATH` 及同值C02别名，本片门兼容此接线。本片不自动开启新门，也不调用安装运行器。真实Windows/macOS源码及安装后的用例执行、端口/进程/目录闭合证据，均待Root审查后在授权窗口验证；44项RAM合同及列表不能代替原生通过结论。
