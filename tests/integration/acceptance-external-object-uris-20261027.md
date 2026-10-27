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

单元涵盖规范URI、参数预算及拆参、文档/连接/导航ABA、真实Promise收尾、提交线性化、模态、卸载、React StrictMode与安装脚本归属判断。安装脚本解释器不证明NSIS原生编译或注册表行为。

离线Electron用例仅覆盖正式Main `open-url`事件、真实副实例、正式preload/IPC及未知连接拒绝；不替换产品结果、不访问数据库、不使用系统剪贴板或原生文件输入。它不能证明OS协议注册、冷启动或实库对象成功导航。Windows安装/卸载与冷热系统入口、macOS两个架构、实库正向导航、完整回归及新CI均需各自记录，不借用旧草稿功能的验收结果。W02保持“部分”，不增加完整工作包或发行计数。
