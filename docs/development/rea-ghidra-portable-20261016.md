# REA＋Ghidra Windows便携链路

本任务建立便携工具链，并实际验证自有PE。CLI帮助和provider doctor通过；首次反编译桥接超时的原件保留，2026-10-17在ROOT单独释放的窗口内再执行一次，约100.58秒退出0，取得`sample_value()`的真实Ghidra伪代码`return 0x2a;`，通过该自有样例的最小REA→Ghidra函数反编译链路。未启动Navicat、读取其配置/连接/凭据、附加调试、执行Navicat全量分析，也未使用Docker或200。工具及保留的原始证据位于当前克隆忽略缓存 `.cache/rea-ghidra-portable-20261016`；首次分析曾被REA回退到外层临时目录，已清理，后续成功会话实际位于ROOT明确的专用目录且终态已清理。不写全局PATH、Codex配置或模型密钥。

## 固定输入与实际版本

| 输入 | 本次核验 |
| --- | --- |
| 本机Navicat | `C:\Program Files\PremiumSoft\Navicat Premium 17\navicat.exe`；只读PE文件版本17.0.8.0，产品版本17.0，88929576字节；未执行 |
| Node | 24.17.0，Windows x64 |
| JDK | 复用IDE的完整JBR 25.0.2，含java/javac；Ghidra实际兼容检查通过 |
| REA当前源码 | `morluto/rea`，固定提交`9e7e13fb7155a2fe6f672ddb4a17e40d1a9c4173`，package版本6.5.0 |
| REA执行包 | 官方npm `rea-agents@6.5.0`，tarball SHA256 `531717a06e92ca651aab52691190f916fac044272c01f875e22c5e293218e699`；SHA512与官方registry integrity精确匹配 |
| Windows原生模块 | 包内manifest版本6.5.0、Node-API 8、x64；SHA256 `665c57ab90aef0712a6aafc423c7992a88bf608bea63b370cb30c695900f9aed` |
| Ghidra | NSA官方12.1.4，ZIP 569649598字节；SHA256 `ddac49f903da9d5bac833e5cc79395098b9c33cfd3279be5f31bd00387d2d4db`；release配置要求完整JDK至少21且未设最高版本 |
| 自有样例 | 本脚本手工编码的1024字节x64 PE32+ DLL；无入口、无导入；导出`sample_value`的机器码仅`mov eax,42; ret`；SHA256 `ddbd326ea113054ffeacd6bfc61876f992d4e6afc916f2169f24ae3fd60fbd23` |

源码坐标、npm发布包和实际安装包分别记录。registry该版本元数据没有gitHead，不能声称npm包就是该main提交构建；本轮还直接审读了发布包入口和原生加载器。第三方README/源码是取证材料，不赋予安装、联网或配置变更权限。

主要依据：[固定Windows P0文档](https://github.com/morluto/rea/blob/9e7e13fb7155a2fe6f672ddb4a17e40d1a9c4173/docs/windows-ghidra-p0.md)、[原生模块加载器](https://github.com/morluto/rea/blob/9e7e13fb7155a2fe6f672ddb4a17e40d1a9c4173/src/windows/WindowsNativeLoader.ts)、[Ghidra 12.1.4官方发布](https://github.com/NationalSecurityAgency/ghidra/releases/tag/Ghidra_12.1.4_build)。REA文档将Windows能力标为实验性只读P0，不能扩展为全平台或全功能验收。

## 安装和启动边界

先核官方归档摘要，再拒绝归档越界路径、链接和特殊文件后解压。未执行`install.sh`、`setup`、`update`或其他一键shell。REA生产依赖安装使用独立空package.json、显式`--prefix`、隔离npm配置/缓存，`--ignore-scripts --omit=dev --omit=optional --no-audit --no-fund`，未运行prepare/Husky、Frida或原生构建生命周期。

当前会话工具列表未暴露REA MCP工具，PATH中也没有rea命令。本轮使用包内CLI入口，没有声称已全局注册Codex MCP。执行环境从最小OS白名单构建，用户home/appdata/temp均指向本缓存。无模型API密钥注入；运行时不进行下载。Node侧限制外网连接，仅允许Ghidra所需的鉴权loopback传输，不启动目录HTTP服务。

`rea-portable-guard.cjs`限定原生模块为固定摘要的包内文件，阻止项目env、SSH、私钥及Navicat安装目录读取，并限制Node子进程。它不是JVM或原生插件安全沙箱；进程隔离继续依赖REA自身的Windows Job、DACL、快照及清理控制。不能把Node侧网络计数外推成任意JVM插件的系统级网络审计。

## 可复现命令

先把已核的发布包及生产依赖安装到缓存的 `rea-portable`，把官方Ghidra解压到 `ghidra/ghidra_12.1.4_PUBLIC`。`JAVA_HOME`参数必须明确指向本机已核完整JDK，下面用占位符避免提交个人目录。

```powershell
node scripts/research/rea-portable-probe.mjs --configure --java-home '<已核完整JDK目录>'
node scripts/research/rea-portable-probe.mjs --status
node scripts/research/rea-portable-probe.mjs --help-cli --record help-check
node scripts/research/rea-portable-probe.mjs --doctor --allow-scheduled-analysis --record doctor-check
# 纯预检，不启动REA/JVM或网络，不创建会话目录。
node scripts/research/rea-portable-probe.mjs --sample --preflight --runtime-parent 'D:\svn\DBArk\rea-analysis-employee1-20261016' --record sample-preflight
# 实际样例仍须等待ROOT单独释放；应使用下文带RSS监测的入口。
```

默认状态检查不运行分析。doctor和样例必须先取得ROOT资源排程，再显式启用；分析目标固定为脚本生成且摘要核对的样例，不接受任意目标路径。每轮使用不同记录名，原退出信息先落盘，再保存stdout/stderr，不自动扩大预算或重试。Node 256MiB及分析JVM 256MiB为配置值；Java版本探针额外限制64MiB。堆配置不等于进程RSS或总内存上限；原单CPU环境变量是否被传入分析进程，需要结合下文Windows启动器行为判断。

## 已保存的失败与修正

- 官方registry初次请求连接超时；后续固定版本请求成功，未改用镜像或陌生包。
- 初次npm未显式传prefix，向上发现本克隆package.json。已确认仅本次添加rea依赖及格式变化，恢复其原始字节；误装package/lock/依赖保留在忽略缓存。自身包级junction恢复，ROOT未改动，w02的339源码、108构建文件、18队列文件及独立诊断头核验保持。后续显式prefix安装退出0，不把首轮误装当作便携安装成功。
- 早期搬移原件上的帮助检查因依赖链接失效而失败；正式prefix建立后，Node 128MiB帮助检查又触发V8堆不足（退出134）。原件保持；提升Node至256MiB后帮助退出0。
- 第一次doctor的原生artifact失败来自本地校验器使用Node 24的JS `realpathSync`处理Windows扩展路径，返回`EISDIR ... lstat 'D:'`。独立最小探针证明同一路径的`realpathSync.native`正常。修正本地guard后，doctor退出0、healthy=true，Ghidra/JDK/native authority全部通过。未修改第三方REA包、跳过摘要或伪造原生自检。

实际样例、采样峰值与最终边界见本任务收尾记录。这里的PE元数据、源字节和静态字符串均不能充当Navicat界面流程、事务语义或兼容性证据。

## 首次失败原件和后续实际结果

| 执行原件前缀 | 结果 |
| --- | --- |
| `help` | 128MiB Node堆不足，退出134；没有Ghidra分析 |
| `help-256` | 256MiB Node堆，帮助退出0 |
| `doctor-256` | 校验器的扩展路径问题，退出1，原件保持 |
| `doctor-nativepath-fixed` | 退出0、healthy=true，Ghidra/JDK/native authority必需检查全通过 |
| `sample-256-first` | 实际启动只读Ghidra，自有样例导入和自动分析在引擎日志中成功；桥接未在120秒期限内就绪，`provider_timeout`，约123.97秒退出1；没有函数返回值或伪代码成功证据 |
| `sample-runtime-parent-1536-first` | 2026-10-17仅一次ROOT新释放窗口；固定非隐藏父目录、正式提权本机loopback、单CPU亲和性；约100.58秒退出0，真实`procedure_pseudo_code`返回`sample_value()`的`return 0x2a;`，结果同时绑定固定样例摘要及Ghidra 12.1.4 |

首次失败运行的0.1秒采样只跟踪自己启动的Node子树，使用Windows进程元数据和内存统计，不读命令行或目标进程内存。该次观测并发RSS峰值为896.29MiB；主分析JVM的OS工作集峰值约479.50MiB、该进程采样私有内存峰值约498.43MiB；若干辅助JVM的采样私有内存最高约645.96MiB。监测错误为0。不能以256MiB堆配置声称整个JVM或全子树不超过512MiB。未观测到的极短探针也不能按零计。

首次失败的Node侧守卫记录外网连接尝试0、私料读取拦截0、未知子进程拦截0，loopback连接尝试1655次；此计数不等于1655次成功握手，也不是JVM/原生插件系统级网络审计。

已定位目录边界：REA固定源码的 [GhidraSessionRoot](https://github.com/morluto/rea/blob/9e7e13fb7155a2fe6f672ddb4a17e40d1a9c4173/src/ghidra/GhidraSessionRoot.ts) 会因Ghidra不接受任意点前缀项目路径组件，把`.cache`内的临时根回退到最近无点祖先。本轮实际会话为ROOT目录下的`rea-ghidra-<随机值>`，结束后已不存在。该行为不满足本任务只写员工1缓存的约束；不能再盲目重试或声称“所有运行写入始终只在.cache”。

因此本地脚本先改为拒绝含点前缀的会话路径，后续接入下面ROOT明确创建的固定普通目录，doctor仍可单独运行。不通过SUBST、目录junction、修改第三方摘要或放宽原生安全检查来绕过。没有扩大120秒期限、关闭分析器或以重建/静态字符串替代成功结果。

完整原件、资源采样和安装日志均保存在忽略缓存；仅提交本中文文档和自写最小脚本。未生成需要长期保留的模型密钥或证书；REA会话鉴权属于临时内部状态，未提交或输出其令牌。

## ROOT后续排程的只读核对与最小方案

固定源码的`GhidraClient.ts`在模块导入时计算`SESSION_ROOT = ghidraSessionRoot()`。后者先取`os.tmpdir()`；Windows路径任意组件以点开头时，不使用原临时根，而向上寻找第一个没有点组件的祖先。`PrivateRuntimeRoot.create`将该结果传入Windows私有根API，因此只改工作目录或`--snapshot`不能解决回退。当前原生CLI/config没有公开workspace、session、project或Ghidra cache根参数；`--snapshot`保存REA分析快照，不是临时项目目录。

ROOT已在run1015明确创建并精确排除`D:\svn\DBArk\rea-analysis-employee1-20261016`，`.git/info/exclude`条目仅为`/rea-analysis-employee1-20261016/`；员工1只读核对该目录普通、为空且check-ignore成功。probe已接入显式`--runtime-parent`，仅接受该精确绝对路径，逐层核对存在、普通目录、无符号链接及realpath一致，临近spawn再次核对；不自动创建或回退。仅在新的样例Node子进程环境里设置TEMP/TMP，第三方包和日志仍留员工1缓存，不改全局环境。该核查缩短路径替换窗口，不声称提供抵抗并发恶意目录替换的原生句柄级沙箱。

桥接的最早可靠定位仍有限：Java日志确认headless启动、自动分析成功及`ReaGhidraBridge.java`脚本启动；更早有packed-db-cache权限告警，但引擎仍完成分析，不能认定该告警是桥接根因。发布包的`GhidraSocketConnection`在连接失败后等待50ms并继续，逐次Socket错误没有进入最终timeout原件；因此尚缺具体错误码。Node侧1655次尝试不能证明成功连接或完成鉴权。也不能直接归因于JBR25、Windows原生控制或执行沙箱的loopback限制。

最初的只读提案只旁观loopback的connect成功数、首/末安全错误码，保留原参数、返回值及处理器，不读载荷、令牌或描述符；缓存内`next-execution-plan.json`保留该未执行阶段的方案。Windows当前走`analyzeHeadless.bat`，不是已检查的直接Java命令；官方`launch.bat`中的多次Java/LaunchSupport辅助调用没有显式-Xmx，所以GHIDRA_HEADLESS_MAXMEM不证明这些辅助进程的内存上限。后续实际执行只使用ROOT另行释放的一次窗口，未延长120秒或盲目重试。

## run1015之后的接线验证与执行命令

loopback观测已加入自写guard的`loopbackObservation`：仅保存`connected`、`firstErrorCode`、`lastErrorCode`，错误值限定安全大写错误码，不保存地址、端口、载荷、令牌或描述符。使用Node `errorMonitor`旁观错误，不新增吞掉异常的普通error处理器；原connect返回值与同步抛错保持，完成后移除本次旁观者。原有guard计数继续保留，旧失败原件不改，新审计文件以独占方式创建。

已完成语法、默认状态及7项纯参数预检：固定目录通过，缺少父目录、使用祖先/缓存/子目录或把父目录参数用于状态均拒绝。额外纯事件桩替换底层connect后才加载guard，验证成功计数、异步/同步错误码、既有事件处理器及返回/抛错保持；没有listener、真实端口连接、REA或JVM。此桩不是实际loopback可达性验收。记录在缓存`runtime-adapter-validation.json`。

新发现：固定源码及正式发布包的Windows启动器会把`GHIDRA_HEADLESS_JAVA_OPTIONS`覆盖为空，原环境变量`-XX:ActiveProcessorCount=1`不能证明实际分析JVM为单CPU。缓存监测器`observe-rss1536.py`因此仅对自己设置一个可用逻辑CPU的进程亲和性，使新子进程继承；采样时记录各进程掩码，若不一致或无法核验就停止本次子树。准备阶段先作AST语法审查；后续单次实际执行中，全部被采样进程均记录为掩码1。

ROOT已指定后续一次独占最小样例的整体Node子树RSS观察停止阈值为1536MiB，0.1秒采样，分别记录主/辅助JVM工作集和私有内存峰值；Python监测器自身不在Node子树RSS合计内。超过阈值时只通过已确认属于本次子树的句柄终止Node所有者，以触发REA Job清理；采样间隔可能超调，也可能漏掉极短进程，不能称为硬内存限制。保留原120秒provider期限、180秒驱动超时及210秒外层监测兜底，不延长期限。强制终止可能来不及落下Node退出审计，须如实报告缺失并另行核对残留，不能自动重试。

以下命令已在2026-10-17收到ROOT单独释放后执行一次；工作目录为员工1本克隆，代码固定在已提交`12d1165edf90692f5e6693fc48b185f7ab4487eb`，脚本摘要与先前准备计划一致。新记录名不得复用：

```powershell
& 'C:\Users\zhao-\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' -X utf8 -B '.cache/rea-ghidra-portable-20261016/observe-rss1536.py' sample sample-runtime-parent-1536-first 'D:\svn\DBArk\rea-analysis-employee1-20261016'
```

写入范围为缓存里的该记录原件，以及ROOT专用目录里的REA私有随机会话（项目、隔离home/temp/cache/config及内部鉴权文件）；不读取或输出内部鉴权内容。第三方Windows启动器仍会启动多个辅助Java并编译桥接脚本，受本次子树观测。运行前已复核脚本/固定输入摘要、目录和记录名；缓存`next-execution-plan-v2.json`保留当时的准备入口与摘要，实际结果独立落在下面的新原件，不改旧计划和失败原件。

## 2026-10-17单次释放后的终态

实际时间为北京时间00:32:22.750至00:34:03.004，监测器记录全程100.58秒，CLI与监测器退出均为0。执行通过`exec_command`正式`require_escalated`允许自有PE的本机loopback桥接，没有关闭防火墙、暴露0.0.0.0或外网服务，也未更改第三方包、原生安全校验、全局Codex配置。原120秒provider期限保留，没有启动第二次attempt。

最直接的通过证据是REA结果中的`operation=procedure_pseudo_code`、`provider=Ghidra 12.1.4`、原样例SHA256及`normalized_result`中的`return 0x2a;`。0x2a等于预期42；这是实际函数反编译返回，不是源字节、字符串或doctor替代证据。新增旁观记录loopback尝试1次、成功1次，首末错误码均为空；Node侧外网尝试、私料读取拦截和未知子进程拦截均为0，仍不外推为JVM系统级网络审计。

实际观察会话路径为`D:\svn\DBArk\rea-analysis-employee1-20261016\rea-ghidra-c549421dab5c40dea4ac87749b400a12`，当时ROOT根目录没有`rea-ghidra-*`回退会话。终态检查：记录的所有PID均已不存在，专用父目录为空，ROOT根目录仍无回退会话；没有终止任何未知进程。JVM资源窗口已释放。

本次观测并发Node子树RSS峰值777.75MiB，没有触发1536MiB监测停止阈值，监测错误0。工作集最大的Java进程OS峰值486.50MiB、该进程采样私有内存峰值490.82MiB；其余辅助Java的最高采样私有内存644.75MiB。全部被采样进程的亲和性掩码为1。1536MiB仍只是RSS采样停止阈值，不是硬上限，不能把Xmx或本次值推广成其它目标/机器的资源保证。

新原件统一前缀为`sample-runtime-parent-1536-first`：CLI退出/stdout/stderr、guard审计、资源采样、实际路径观察、清理核对、验证报告和SHA256清单。先前`sample-256-first`的超时原件保持不变。本次同时采用固定非隐藏父目录、正式提权loopback和单CPU亲和性，因此不能仅据成功反推旧超时的唯一根因。通过范围仅为自有1024字节PE的该函数伪代码路径，不是Navicat流程、业务行为、GUI或任意PE兼容性验收。
