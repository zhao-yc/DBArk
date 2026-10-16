# REA＋Ghidra Windows便携链路

本任务建立便携工具链，并实际尝试自有PE。CLI帮助和provider doctor通过，首次反编译在桥接启动阶段超时，未取得函数伪代码，因此完整REA→Ghidra函数链路仍未验收。未启动Navicat、读取其配置/连接/凭据、附加调试、执行Navicat全量分析，也未使用Docker或200。工具及保留的原始证据位于当前克隆忽略缓存 `.cache/rea-ghidra-portable-20261016`；首次分析曾被REA回退到外层临时目录，已清理，具体边界见下文。不写全局PATH、Codex配置或模型密钥。

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
# 当前.cache约束下会在启动前拒绝；须先由ROOT解决下面的会话目录和资源边界。
node scripts/research/rea-portable-probe.mjs --sample --allow-scheduled-analysis --record sample-check
```

默认状态检查不运行分析。doctor和样例必须先取得ROOT资源排程，再显式启用；分析目标固定为脚本生成且摘要核对的样例，不接受任意目标路径。每轮使用不同记录名，原退出信息先落盘，再保存stdout/stderr，不自动扩大预算或重试。配置为Node 256MiB、分析JVM 256MiB、单逻辑CPU；Java版本探针额外限制64MiB。堆配置不等于进程RSS或总内存上限。

## 已保存的失败与修正

- 官方registry初次请求连接超时；后续固定版本请求成功，未改用镜像或陌生包。
- 初次npm未显式传prefix，向上发现本克隆package.json。已确认仅本次添加rea依赖及格式变化，恢复其原始字节；误装package/lock/依赖保留在忽略缓存。自身包级junction恢复，ROOT未改动，w02的339源码、108构建文件、18队列文件及独立诊断头核验保持。后续显式prefix安装退出0，不把首轮误装当作便携安装成功。
- 早期搬移原件上的帮助检查因依赖链接失效而失败；正式prefix建立后，Node 128MiB帮助检查又触发V8堆不足（退出134）。原件保持；提升Node至256MiB后帮助退出0。
- 第一次doctor的原生artifact失败来自本地校验器使用Node 24的JS `realpathSync`处理Windows扩展路径，返回`EISDIR ... lstat 'D:'`。独立最小探针证明同一路径的`realpathSync.native`正常。修正本地guard后，doctor退出0、healthy=true，Ghidra/JDK/native authority全部通过。未修改第三方REA包、跳过摘要或伪造原生自检。

实际样例、采样峰值与最终边界见本任务收尾记录。这里的PE元数据、源字节和静态字符串均不能充当Navicat界面流程、事务语义或兼容性证据。

## 实际结果和剩余阻断

| 执行原件前缀 | 结果 |
| --- | --- |
| `help` | 128MiB Node堆不足，退出134；没有Ghidra分析 |
| `help-256` | 256MiB Node堆，帮助退出0 |
| `doctor-256` | 校验器的扩展路径问题，退出1，原件保持 |
| `doctor-nativepath-fixed` | 退出0、healthy=true，Ghidra/JDK/native authority必需检查全通过 |
| `sample-256-first` | 实际启动只读Ghidra，自有样例导入和自动分析在引擎日志中成功；桥接未在120秒期限内就绪，`provider_timeout`，约123.97秒退出1；没有函数返回值或伪代码成功证据 |

本次0.1秒采样只跟踪自己启动的Node子树，使用Windows进程元数据和内存统计，不读命令行或目标进程内存。样例运行的观测并发RSS峰值为896.29MiB；主分析JVM的OS工作集峰值约479.50MiB、该进程采样私有内存峰值约498.43MiB；若干辅助JVM的采样私有内存最高约645.96MiB。监测错误为0。不能以256MiB堆配置声称整个JVM或全子树不超过512MiB。未观测到的极短探针也不能按零计。

Node侧守卫记录本轮外网连接尝试0、私料读取拦截0、未知子进程拦截0，loopback连接尝试1655次；此计数不等于1655次成功握手，也不是JVM/原生插件系统级网络审计。

已定位目录边界：REA固定源码的 [GhidraSessionRoot](https://github.com/morluto/rea/blob/9e7e13fb7155a2fe6f672ddb4a17e40d1a9c4173/src/ghidra/GhidraSessionRoot.ts) 会因Ghidra不接受任意点前缀项目路径组件，把`.cache`内的临时根回退到最近无点祖先。本轮实际会话为ROOT目录下的`rea-ghidra-<随机值>`，结束后已不存在。该行为不满足本任务只写员工1缓存的约束；不能再盲目重试或声称“所有运行写入始终只在.cache”。

因此本地脚本现在在启动分析前拒绝包含点前缀组件的会话路径，doctor仍可单独运行。后续需要ROOT明确安排不含点的专用临时目录及实际内存预算，再检查桥接就绪问题；不通过SUBST、目录junction、修改第三方摘要或放宽原生安全检查来绕过。没有扩大120秒期限、关闭分析器或以重建/静态字符串替代成功结果。

完整原件、资源采样和安装日志均保存在忽略缓存；仅提交本中文文档和自写最小脚本。未生成需要长期保留的模型密钥或证书；REA会话鉴权属于临时内部状态，未提交或输出其令牌。

## ROOT后续排程的只读核对与最小方案

固定源码的`GhidraClient.ts`在模块导入时计算`SESSION_ROOT = ghidraSessionRoot()`。后者先取`os.tmpdir()`；Windows路径任意组件以点开头时，不使用原临时根，而向上寻找第一个没有点组件的祖先。`PrivateRuntimeRoot.create`将该结果传入Windows私有根API，因此只改工作目录或`--snapshot`不能解决回退。当前原生CLI/config没有公开workspace、session、project或Ghidra cache根参数；`--snapshot`保存REA分析快照，不是临时项目目录。

建议ROOT明确创建并精确排除`D:\svn\DBArk\rea-analysis-employee1-20261016`，`.git/info/exclude`条目仅为`/rea-analysis-employee1-20261016/`。必须在启动新的Node进程之前，把该子进程的TEMP/TMP指向该无点普通目录。第三方包和日志仍留员工1忽略缓存；不改源码树、不使用SUBST/junction、不让provider自行退到未知祖先。自写probe所需最小适配是增加显式`--runtime-parent`，核对其精确路径、存在及非链接后，仅给样例子进程使用；本轮只给方案，未应用或执行。

桥接的最早可靠定位仍有限：Java日志确认headless启动、自动分析成功及`ReaGhidraBridge.java`脚本启动；更早有packed-db-cache权限告警，但引擎仍完成分析，不能认定该告警是桥接根因。发布包的`GhidraSocketConnection`在连接失败后等待50ms并继续，逐次Socket错误没有进入最终timeout原件；因此尚缺具体错误码。Node侧1655次尝试不能证明成功连接或完成鉴权。也不能直接归因于JBR25、Windows原生控制或执行沙箱的loopback限制。

下一轮可只旁观loopback的connect成功数、首/末安全错误码，保留原参数、返回值及处理器，不读载荷、令牌或描述符；必要时由ROOT先安排一个独立loopback原语检查。缓存内`next-execution-plan.json`给出可审参数和诊断提案，未运行新listener、JVM或Ghidra。Windows当前走`analyzeHeadless.bat`，不是已检查的直接Java命令；官方`launch.bat`中的多次Java/LaunchSupport辅助调用没有显式-Xmx，所以GHIDRA_HEADLESS_MAXMEM不证明这些辅助进程的内存上限。新预算与run1012后的资源窗口由ROOT决定，未延长120秒或盲目重试。
