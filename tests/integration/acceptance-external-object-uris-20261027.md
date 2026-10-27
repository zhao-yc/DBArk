# 系统对象链接开发验收（2026-10-27）

## 候选与范围

基线 `b523f7612bca58836c48b408039a008cd2ed67cc`，在现有 `main` 实施 W02 系统对象链接；暂不发布。测试平台为独立 WIN11-TEST，Node 24.19.0、pnpm 12.11.2。本机仅开发、Git 和固定快照检查，未在本机执行产品测试。

固定快照 `object-uri-green01.zip`（SHA256 `78420b40af9b869bce25012caf559fa204ffde93d9c3ee1e4aa89455b42e3cc2`）含23个源码/测试路径及嵌入清单；后续补丁只覆盖已声明路径，另增加原内部导航夹具，当前共24个相关路径。原件保存在测试机 `outputs/object-uri-green01-vm-20261027`、`object-uri-green02-vm-20261027` 等独立目录；本机中转原件在 `.cache/object-uri-transfer-20261027`，均不入库。原1392草稿数据库现场不受本轮操作影响。

## 原失败及窄修

1. 前置控制器曾将23路径加清单的ZIP总条目误判为23，修改源码前停止。另发现外置清单因Windows文本写入为CRLF，ZIP嵌入清单为LF；保留错误及两份原件，逐字证明只差CR，再提供与ZIP逐字一致的LF清单（3940字节，SHA256 `389919d5b2f8822e25f219bc71e09589ffddb80e990c292453beaf061be1ea82`）。未放宽源码哈希门。
2. green01 类型检查 PID15760，exit2：旧 `workbench-navigation.fixture.tsx` 缺少新增必需的 `onObjectUri`；冷启动单元夹具修订变量被推断为number。分别补完整API空订阅和显式 `number | undefined` 类型；未知命令拒绝及原断言不变。此轮未运行单元、build或App。
3. green02 类型检查 PID15836，exit0；指定8个单元文件 PID17668，exit1，122通过/1失败。失败为hook卸载例第199行期望无notice，却收到前一例的“已有任务进度提示”；Zustand浅merge不会删除初始快照中缺失的可选字段。仅在每例初始化补 `notice: undefined`，保留原断言。PID17668已确认终态，build及GUI未启动。

green02另含离线spec02：副实例spawn后即时保留PID、可执行文件、参数、userData及有界控制台输出，正常退出再保存原退出码；避免超时只留主实例线索。此修正不改变产品或用例判据。

## 后续复验

green03仅更新hook夹具（SHA256 `b099619bd2ce33252d53d2bb891aa04a7ba3535c6a888a154f808779b6618748`）。同8文件的123项单元全部通过（PID13012，exit0）；构建含类型检查通过（PID6572，exit0），固定24源码/测试路径及109份新build。下载控制器一处PowerShell括号语法错误在运行前被解析器拦截，原件保留；修正控制器后按原哈希应用，未修改产品或放宽测试。

离线spec02默认关闭恰1skip（PID1624，exit0）、列表恰1例（PID6992，exit0）；显式用例1通过（PID3644，exit0）。原fixture完成主实例正常退出及准确profile清理；真实副实例PID13204，exit0/signal=null，结束后准确PID及profile均不存在。Main原件记录5次协议IPC：两次领取、两次完成、一次未知连接核验拒绝；pending0、fork0，没有commit，工作区不变。旁观恢复在正常退出前完成；主进程及指标PID集合由原未修改fixture严格检查，未额外导出逐PID附件。未运行实库、原生文件输入或剪贴板操作。

Root已回读50项结果包（114904字节，SHA256 `4375d915e8dfef2de69a04e4f1462775cfb63f67aa80e61c4830b7210c42b4ea`），核49份条目哈希及两份历史嵌套包，递归150项CRC、路径及私钥标记检查通过。24源码/测试路径与本机候选逐字一致，109份新build有完整记录；未把本机旧dist当作已验产物。

Windows真实 `electron-builder 26.15.3 --win nsis --x64 --publish never` 编译通过（PID14496，exit0）；复用已验dist，未再次构建产品源码，原24源码/109build保持。产物 `DBArk-0.28.0-win-x64-unsigned.exe` 为143269657字节，SHA256 `56ec27b7d76ff710df29419164158d54ec00037e94501a1f9d4d32466ce9ff3e`，仅测试机本轮输出目录留存。尚未安装、注册或发布；编译不证明Windows注册表与启动行为，asar逐条绑定与既有安装/handler盘点另行核验。

提交前逐条比对Git暂存内容：24条中仅 `App.tsx` 由仓库属性将CRLF规范为LF（75049→74566字节），移除CR后逐字一致，其余23条无字节变化。本轮VM证据绑定规范化前工作区，不把它声称为尚未运行的提交CI；后续提交CI须单独记录。

## 首次提交CI与夹具复验

`0dc8d7b2` 已推送main；[CI 40528682535](https://github.com/zhao-yc/DBArk/actions/runs/40528682535) 四个主要job均失败，原红保留。Linux完整单元为18694通过/39失败/10跳过（881文件）；Windows、macOS arm64/x64各自源码legacy为81通过/1失败/375跳过，未进入各自安装验收，不能标为原生CI通过。

39项单元失败定位于旧Main夹具：字符串截取使用已不存在的锁语句边界，误含启动代码或先触发位置门；共用owner夹具及退出夹具缺少真实URI队列。仅补测试：AST提取唯一顶层 `engineExited`，共用夹具初始化真实Main队列和resolver，退出夹具使用真实空队列并增加store关闭→队列close→quit次序断言，既有Main行为断言保持。

三平台相同源码失败来自隔离接口精确白名单仍预期三方法。按本次正式API改为 `invoke/onMenu/onObjectUri/onTask` 精确四项，并增加四函数均冻结的要求；Node暴露、原IPC暴露和sandbox判据不变。

WIN11-TEST green04：14个测试夹具补丁后类型检查PID15696 exit0；原受影响16文件加原入口8文件共24文件262项全部通过（PID13956 exit0）。262已包含此前123项，不能相加。随后单独补desktop断言，list恰1、实际只执行该隔离接口例1通过（PID248 exit0），无数据库/剪贴板/原生文件输入。此次完整type先于desktop单行断言补丁，新增提交完整type仍待CI。

Root已核对15个测试路径与VM一致，回读边界原件包（27项、55251字节、SHA256 `e3b0ac80b9dd0478d7a8c64ace3a6de66d08de9b8e7073d3390fd339e757c744`）及其独立green04包（31项、30255字节、SHA256 `c5a067356c88ad526548300c24292ed2c1627fac770827e3fc67a05f3922b68f`），递归58项哈希/CRC/路径/私钥标记检查通过。产品、109份dist及NSIS/asar均未修改或重建；新提交和新完整CI须另记，不能把旧CI原红改为绿。

Windows只读asar验证在按真实API使用本机路径分隔符后通过（PID15756 exit0）：109个dist文件逐哈希一致，Main入口存在，asar为209370220字节、SHA256 `3524530f7e28622f57ebfac07a74a042117998610a5ff59ce67d4ede50a68e4c`。初次只读工具的模块入口/路径查找错误保留，未重打包或执行包代码。安装前盘点HKCU/HKLM 32/64协议、UserChoice、AppPaths及精确DBArk卸载记录均不存在，Windows关联API返回1155；后续原生安装/注册另验。

## 验收边界

### 2026-10-28补充：完整CI、旧安装收尾及分隔符候选

`e62dd658` 的[CI 40533833206](https://github.com/zhao-yc/DBArk/actions/runs/40533833206)四个主要job均success：Linux 881文件18733通过/10跳过，类型和构建通过；Windows x64及macOS arm64/x64各自源码、安装产物legacy均82通过/375跳过。签名、公证、实库及本功能OS URI流程不因此视为通过；开发预览发布job跳过。四份原始job日志保存在本机中转缓存，旧40528682535原红仍保留。

原Windows候选的registration01在非提权WMI事件订阅被拒后、安装前停止。registration02使用无GUI父子探针验证 `Start-Process -Wait -PassThru`：父13596 exit0，子7388晚5.76秒exit0，等待在子结束后返回；与[PowerShell官方进程树等待](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.management/start-process#-wait)语义一致。随后原安装器15772 tree-wait exit0/13.94秒；附加runspace观察器HadErrors导致控制器停链，原子错误流未保存，原因未确认，不能把当前空快照倒推成历史全过程证明。

registration03只读确认旧完整owner及Windows有效关联匹配 `"exe" "%1"`，asar109一致，当前本例进程0。发现原前置检查只保存DisplayName精确等于DBArk的项，会漏掉 `DBArk 0.28.0`；没有固定GUID或完整根键清单的原始空证据，故安装前GUID `3adbf054-c5e2-5ff2-a5b2-a395f736b37d` 不存在未确认。原两份空数组及筛选代码均保留，未补签fresh安装验收。

registration04在当前父目录fileId/volume/SID、旧完整owner、实际卸载器路径/hash及进程0均复核后，只调用原 `Uninstall DBArk.exe`。PID8020真实tree-wait exit0，一次卸载，无重试或手工删注册表/目录；当前自有协议、固定卸载项、安装目录及进程已清，父目录和空profile保留作原件。这只证明当前owned资源清理，不修补旧前置证据缺口。Root已回读01–04与原NSIS记录包（125项，188895字节，SHA256 `f931b84167b593ab218e3c182d1dd077850d3c6b58d12f5950a3d9538b315244`），递归174项哈希/CRC/路径及私钥块检查通过；未主动启动系统URI、App、DB或剪贴板操作，原1392现场保持。

后续5文件候选加入注册命令的固定 `--`、严格旧own迁移、接收器固定前缀及反例、真实副实例spawn参数断言。来源及静态/原生边界见[开发说明](../../docs/development/external-object-uris-20261027.md)。新原生安装前必须同时记录固定GUID、带版本名称及完整目标键清单，旧精确名称筛选不得再作为空状态门。

green05最初SSH6456 exit255/10秒超时，在下载前停止，未测试或写入。一次明确授权的只读身份/哈希重试3764及SCP14936均exit0，未改网络/hosts/key配置，测试仍在WIN11-TEST，本机未接续。新5文件核哈希后，24文件274项全部通过（PID15872 exit0，包含此前262项）；build含完整类型通过（18404 exit0），新109份构建固定。默认16520恰1skip、list6340恰1；新offline512 exit0/1通过，副实例16464 exit0/signal=null、profile正常清理、pending0/fork0，固定分隔符spawn输入与正式Main事件通过，不作为原生最早argv或Shell结果。

新NSIS一次编译15140 exit0/198.66秒，使用green05独立输出路径，未重建第二次dist；新EXE143270562字节、SHA256 `312bb580676351fd4e8bdb6596da8688e209a2a8b6cfab0e18046da80ed5dd14`，新asar209370661字节、SHA256 `8f3aaf2efd3e823477c674923f1a9d5cd32648fe14b95048441588fd569f32f9`，109条逐哈希一致，旧green03包未改。Root回读118项原件包（157559字节，SHA256 `c00f0134f5424cb7a1956649ab1ead61e9723a4545926c22536970283e836d28`），与本机5文件逐字匹配，递归124条哈希/CRC/路径/私钥块检查通过。

green05构建阶段未执行新包原生安装、系统URI/端口探针或实库；未借用e62旧完整CI。后续registration06独立记录严格前置的旧包→新包同版升级及新原卸载器清理，结果如下。

registration06重新记录固定GUID、带版本DisplayName和四份完整Uninstall根键清单的空状态。旧包安装17064 tree-wait exit0/12.411秒后，控制器468因自定义集合名 `$matches` 被PowerShell自动变量 `$Matches` 覆盖而exit1，原脚本和错误保留。仅在函数副本更名集合的3处引用，反向替换逐字一致；原17064终态、旧完整owner、关联、asar、父目录身份及当前进程0逐项通过后，从旧安装后的checkpoint继续，未重放旧安装器。

新包同版升级13160 tree-wait exit0/17.423秒，新原卸载器1196 tree-wait exit0/3.926秒，均仅执行一次。完整owner及Windows有效命令从 `"exe" "%1"` 更新为 `"exe" -- "%1"`，旧、新asar各109/109匹配。这证明原生升级终态，不推断自定义legacy分支已实际执行。卸载后准确scope及四份根键清单与本轮06前置完全一致，安装目录、快捷方式和本例进程无残留；父目录和空profile留证。无提权、kill、重试或手写注册表/文件删除；原02的GUID前置缺口仍未确认。

Root已回读registration06原件包（118项、179913字节，SHA256 `ad6b0db79c6e72d456706960a6a13be4eebb6d92e60163b6a22078d53ebacdaf`），含原停链包，递归168项哈希/CRC/路径及私钥块检查通过。上述动作未启动系统URI、App、端口探针、DB或剪贴板，原1392数据库现场保持。

`380ca008` 的[CI 40549363185](https://github.com/zhao-yc/DBArk/actions/runs/40549363185)四个主要job均success：Linux类型、构建及881文件18745项单元通过/10跳过；Windows x64、macOS arm64/x64各自源码与安装产物legacy均82通过/375跳过。四份原始job日志与e62旧日志分别保存；发布开发预览及额外剪贴板job跳过。此CI覆盖分隔符和迁移修改，不证明本功能OS冷热入口或实库组合。

### 正向只读实库入口（live07）

仅新增 `tests/e2e/external-object-uris-live.spec.ts`（SHA256 `ffd16af9fc91c5dbcf3dc5d7b4da82add4ab4c38e9270b2a832aec3da063b7dc`），原39路径及green05的109份dist保持不变，未重复build、单元或安装。WIN11-TEST完整类型3224 exit0，双门关闭默认7560 exit0/恰1skip，list17632 exit0/恰1例，默认和列表均未读取实库配置或启动App/DB。

显式双门后的唯一实库用例10348 exit0、1通过/0跳过/0重试，实际为200的13384、MySQL8.4.11。正式连接、目录及表元数据预检后，用真实对象kind生成URI，正式Main `open-url`→React consumer→`information_schema.CHARACTER_SETS` 显示真实表头和非空数据，未知基本表类型提示只读、添加禁用、错误为零。14次原IPC全部成功，Resolve/Commit/Finish各一次，pending0；未绕过consumer直接领取或提交请求。

原fixture严格正常退出、已记录PID消失及本地profile清理通过，当前App/runner均不存在。无DDL/DML、创建删除库用户、DB cleanup、剪贴板、系统Shell或端口探针；未使用1392草稿库。实库原私密日志仅留VM，本机回读脱敏包（50项、54951字节，SHA256 `a85f779aec998df55a0499213f3a93e32829b5e0e51358d8e8504ce045e2d132`），逐项哈希/CRC/路径/私钥块及本机spec哈希核对通过。此例不证明OS Shell、冷启动、macOS或其它数据库组合。

单元涵盖规范URI、参数预算及拆参、文档/连接/导航ABA、真实Promise收尾、提交线性化、模态、卸载、React StrictMode与安装脚本归属判断。安装脚本解释器不证明NSIS原生编译或注册表行为。

离线Electron用例仅覆盖正式Main `open-url`事件、真实副实例、正式preload/IPC及未知连接拒绝；正向实库例和Windows实际升级/卸载在上述独立记录中通过。不将这些结果泛化到OS Shell/冷热入口、macOS协议行为或完整驱动矩阵，不借用旧草稿功能的验收结果。W02保持“部分”，不增加完整工作包或发行计数。
