# 原生失败的第四轮观察准备

本记录属于 0.23 的独立诊断分支 `codex/p0-query-layout-v023-20261018`，不代表 0.28 产品验收。第三轮运行 [39100233953](https://github.com/zhao-yc/DBArk/actions/runs/39100233953) 的失败和原平台 ZIP 保留；新观察不能解释成旧运行已经修复，也不重新执行旧运行。

## 新增观察及独立核对

Mac 等待阶段作者 `ea8dbd3ae8000269f0c248705d965ccc4c41ac2e` 整合为 `91e54773ff9677a7bd17c1617e395ea175ac09a4`。只在既有扫描、source、evaluate 和 assertActual 调用前后采集缓存的相对时间，全局最多 64 个枚举元组；在原 guard 之后才能写返回点，收尾后停止写入。允许在 prepare 前只有等待点、尚无 owner 的附件。原 37 个 await、55 处 guard 的顺序与参数保持，扫描、期限及 owner 收尾没有修改。

独立三项静态／RAM 检查通过，包括迟到 assertActual 被原 guard 拒绝后零补写；双 owner 加满 64 点最坏为 8106/8192 字节，原正文完整。独立交接 SHA-256 为 `30b3489d1a9093dbede148ea4fe550b906bbb44e494666b7a04e239ee1e03a14`。这不是本轮原生运行。

Windows 原历史分页目标的退出观察作者 `cae47894bd7a566bcae10f723e9fa45659648a3a` 整合为 `d039259`。独立审查发现：旧默认 seed 等待后无 TestInfo 进入启动，可能借用新记录器；正式接线 RAM 已复现，真实 Playwright 可达性未证明，不能归因为第三轮 Windows 首败。独立交接 SHA-256 为 `63d4ccdb6e7a23d6a934083c9e4f7f4b5401d9915913d5a75fcd89015cf22514`。

追加 `817a1d61e4852c1440f58f7a815381ac0c51c759` 整合为 `244006ae09f82893df23362de74b3b90f6fe4829`：无显式 TestInfo 入口不读取全局记录器；原 fixture 和目标用例逐字不变。独立原四组对照保留原件、适配同一输入后复验通过，53 条原历史断言链不变。修复交接 SHA-256 为 `f4e3982a7f4d90e16f68396b44b51c9111b8a1d51cb490a4d9ec10f3f0b8690b`。

退出观察最多 96 个事件、8 个应用，记录固定类别和有界时间；原 requestQuit、12 秒等待、race／close 顺序、默认回答及清理权不变。附件在原收尾之后有独立一秒预算，不延长主体期限。phase 仅表示收到事件的阶段；保存请求及 ACK 仍未覆盖，缺失记录不能当成产品事件没有发生。

## Root 组合验证

固定 `244006ae09f82893df23362de74b3b90f6fe4829` 的 12 个相关文件、168 项通过、0 失败、0 跳过，全项目类型检查退出码 0。命令为 `node .cache/run1754-verify-native-observations-root.mjs`，原 unit.log SHA-256 为 `80d1791774343d7a332bf8ea66ea5373c8315dfdec39724cb4a63b4eb3b4e147`。关闭环境文件、使用私有 TEMP/TMP；未启动本机 Electron、GUI、数据库、Docker、服务、端口或剪贴板。

相对 `09c33b2` 的产品 src、构建脚本、版本、锁文件与工作流逐字不变。后续使用新普通克隆、新检查点分支和新绑定开展第四轮；旧第三轮读取器、绑定、解包数据与错误保持。第四轮证据读取器先离线验证新 waits 与退出附件合同，再接收新运行产物；当前本记录尚无第四轮运行结果。

## 新检查点已经启动

新普通克隆 `native-checkpoint-v023-waits-20261018` 固定头 `9057178829b892b6e820337e1b8341ba6e548758`，源 `11969a9ff5da5ab5147efd1303dcc95b1b21f21a`；唯一新增文件为检查点 JSON。新 [运行 39106267172](https://github.com/zhao-yc/DBArk/actions/runs/39106267172) 已开始，Windows x64、macOS arm64／x64 按原工作流独立执行。没有重跑旧运行、访问本机界面、私网数据库或剪贴板，也不发布产品；尚未得到终态或平台附件。

读取器 SHA-256 `b957a49b5757d8659df533a99143b84faaf2bc1834565397f752523fb68edb63` 已通读接收，Root 两个手工 R4 对照通过：零 owner 的等待点可读，坏 Base64 拒绝但原超时及错误摘要保留。明确标记 R3 的真实 arm 原已验归档兼容读取成功，21 个 JSON、3 个观察附件，原失败保留；没有将旧 head／run 作为 R4。Root 接收 JSON 摘要为 `5c26fa79584a6d43dfc745c2aa4b88983cafa2bfa2f60f366cad92b1aee788aa`。读取器接收不代表原生验收通过，新平台附件仍须各自下载、摘要、CRC 和固定绑定后读取。

## 第四轮终态与原始数据

本轮已经终止为失败，发行跳过，没有重跑旧运行。Linux 类型通过，完整单元为 499 文件／9119 通过／52 失败／10 条件跳过；失败位于 batch-record-duplicate-gate、batch-record-duplicate-prepared-launch、column-collation-installed-launch-gate、truncate-exit-preserve 四个原单元文件，包含新增观察 helper 未注入旧 VM 引起的 ReferenceError 及旧源码锁差异，修复与复验继续。原 job `117612660943` 日志为 222720 字节，SHA-256 `b47e24716252dab57277ae67586ab1bd56c11b8c113f55893c03bbf3c5c8fa53`，不能将窄回归通过写成本次完整通过。

Windows job `117612660939` 在源码缩进专项失败；单例 9754ms，owner1 已准备，firstWindow 为 3240ms。预览后的 noExecution 检查发现累计 pageerror 的名称为 `Canceled`，原空错误断言保留；该位置不能独立证明错误的精确触发时刻。后续第二 owner、分栏、legacy 和安装均未运行。原日志 19444 字节，SHA-256 `e86b370930cd3cffb01e8d4e2d8ff106215b80ddadfc68d662e1593d6a5fd111`。Root 冻结 `index-Dxokct1G.js` 为 5367170 字节，SHA-256 `292c2828dbfc0fd7d1a6130c1487975df1d3f4d3a2a53a174c15519b0ae4966f`，与原运行清单完全相同；六个栈帧映射至 Delayer.cancel／dispose、DisposableStore 和 WordHighlighter.dispose。取消链已有实际函数 RAM 证据，保持高亮能力的最小修复及原生复验继续，未过滤原 pageerror。

两个 Mac 的源码缩进／分栏专项和 legacy 均通过（各 76 通过／297 条件跳过），各自打包成功，安装缩进单例均 120 秒超时并有原 45 秒 worker 收尾超时；这不是本版安装通过。arm64 的两个来源 evaluate／assertActual 在 4254ms 前均返回，进度最后到 prepare.hook，未到 prepare.window；该 hook 的 RPC 在有效期限内没有后续完成证据。x64 最后一条等待点为首个来源 evaluate 进入（12688ms），有效期限内无返回点。两个实例均尚未调用 firstWindow，不能再将它们笼统称为“等待窗口”；阻塞原因尚未确认，也不能把缺少返回点解释为超时后永不返回。

三份 ZIP 已各自核 GitHub 摘要、落盘复读与逐项 CRC，只提取文本，不执行附件。Windows 15 条目／15 文本；两 Mac 各 81 条目／35 文本。固定归档如下：

| 平台 | Artifact | 字节 | SHA-256 |
| --- | --- | --- | --- |
| Windows | 12128557786 | 31105 | 338b6cc7c4c66dda0f8492d71ee3ffd4f264797cfe04513dbf70935c017843c7 |
| macOS arm64 | 12129135975 | 3952505 | 177072409084954cb1240901d5ee1610491bb0dd5ea6f9a451e46e5bc91579e1 |
| macOS x64 | 12128862408 | 5281337 | 7c33961abf35088f1cef0314154e4138f7322464a6efde50efa79bd67723bbf8 |

新读取器三个固定绑定均接收数据合同并保留原失败；这只表示解析与完整性通过。Root 的 read.json 摘要依次为 Windows `6255c002cbe1b049f8eaf1072df0256542de2635e9e71c815789e55324c073ca`、arm64 `1d243d6b618f32841ba41177059ab3f29a6dcd4cabfa03c7ead8968525fa06bb`、x64 `294e1d24699d41968c00bed7daa6c26bbbf9f842b506da508fd72ebf30d8ba44`。

x64 首次下载在 0 字节时以 TypeError 终止；Root 曾在下载仍运行时提前触发提取，仅因收据未产生而退出，未写提取目录。确认原下载终态后，以无凭据 HEAD 核对两个文件主机可达，重新向连接器获取引用，在全新 run1773 目录下载同一固定归档成功；原失败目录与记录保留，没有自动覆盖或重启原 CI。所有临时地址均只走无回显 stdin，未写文件、参数或环境。完整终态封存在 `.cache/parallel-integration/run1775-native-r4-terminal.json`。

本轮属于 0.23 独立诊断，不作为 0.28 或其它候选的原生通过证明。本机 GUI、实库及剪贴板均未操作，目标继续进行。

## 四个旧 VM 的兼容修正

作者 `696d51209d4c06c771d781b9d73c15b4ca2cefed` 整合为 `58e3413137d05d04607d3ad1d94705d16c339e97`。四个 VM 注入真实观察 helper，保留原默认 false 路径；新增精确去观察 AST 对照，逐项只撤销已经核对的观察语句后与旧基线比较，再锁已审新代码原文。旧哈希保留，八项退出／期限／身份／清理行为漂移反例必须拒绝，不能以替换 golden 哈希掩盖行为变化。

作者交接 SHA-256 为 `c5b8359cff2701a4b801bbc38a89f53ff5f29170623688929b8b944b8061c244`。Root 通读精确替换、片段集合及实际 helper 接线，六个原失败／直接相关文件共 90 项通过、0 失败／跳过，unit.log SHA-256 `fd67f243a805eee76345d382b843c3baa87019c25e7e6c18b8478bbd67b2214f`。类型沿用固定作者退出码 0，Root 另证明 src／tests／scripts／package／锁文件／tsconfig 与该已类型检查作者相同，未重复运行同一类型检查；正式 e2e 夹具及产品没有变化。

原 R4 完整失败保持；本次兼容修正另开仅 Linux 的完整检查，不提前称为全部通过，也不重跑 R4。Windows 取消链和 Mac 安装的阻塞仍分别处理，三平台下一轮尚未开启。

## 旧 VM 完整复验及第五轮准备

固定 `793a990ede7e8fecce05977c21a077df745c92a1` 的[新 Linux 完整检查](https://github.com/zhao-yc/DBArk/actions/runs/39110305743)已成功：500 文件／9180 通过／10 条件跳过，类型及构建成功，原生和发行跳过。原 job `117624819099` 日志 142042 字节，SHA-256 `74522057c57d9e4e445135300459e58d9e3cefa065ef7f24b4779772c135d6ef`。原 R4 的 52 失败不改写为通过。

Monaco `2222cdd`／`5aff078` 整合为 `989a8a0`／`cea75d4`，同一 WordHighlighter 的 focus、cursor 和 restore 三处延时 Promise 只消费官方 CancellationError 实例，其余错误保留正式报告；高亮及恢复行为不关闭，未过滤 pageerror。正式补丁、精确版本及锁文件、开发／构建字节门均已接入，独审三组通过。交接／独审 SHA-256 分别为 `6dff81fe3af4cfa4b89086bdacc4d0e9cd15f920821828481b31f6018d75ac61`／`57ade8816fbf310e4108813e83cc641517aa4426cbb57918ca35d6258a74ad2a`，实际原生错误是否消失尚未证明。Root 先用私有副本复验八文件 113 项通过；首控制器误把私有 Monaco 副本当作完整工具目录，测试没有启动，原错误保留，随后只修 CLI 入口。

三层观察作者 `98b3418f3467c0e7c1958ad937f506cd1557874e` 整合为 `d3c92a16b4d05dd434d205ad44c3e14c031e59f5`：只重放固定 Playwright1.64 原日志缓存、旁观原 child 流／既有 console；两个原 evaluate 内加有限枚举；显式开关下 Main app.info 在原 getVersion／platform／safeStorage／getPath 边界发固定标记。原 API 求值顺序、次数、返回和异常不变，不新增 RPC 或加密调用。旧 8KiB 正文最坏 8106 字节逐字保留；新附件独占 2KiB，双 owner／每 owner64事件，最坏 1192 字节。缺标记不能推出未调用，日志不签发 PID／退出／清理权限，也不能据此归因 Keychain。详见[观察合同](native-startup-wire-observation-20261018.md)。

作者交接 SHA-256 `4c4073fcb02d4701141d9f2b484cbd05118b6bf4e9f20a5298b99750aabefcb9`，独审十五组 RAM／AST 通过，SHA-256 `5bba3e8053d178db19d62637d95dffc41547c18b878755312daee560f76d4140`。Root 组合 `node .cache/run1792-check-native-wire-root.mjs` 为 17 文件／285 项通过、0 失败／跳过，类型检查退出 0；unit.log SHA-256 `8169b6b841b92d45711f8c834664ca629c469933136e3365eb2c079cfe53a9ae`。原 37 个 await／55 次 guard、120 秒及 45 秒 worker 收尾不变，未运行本机 GUI、数据库或剪贴板。Root 本地旧 R4 构建保留，第五轮须从新源重新构建及打包。

新 R5 数据读取器 SHA-256 `602098da2938bd0b260e80662df556f16bd95a3359ba9e848975d282c946bf84`，固定生产器 schema SHA-256 `700608c4b03b900442469a338cead77d35487c9746661cceb31ed5366d423f8d`。Root 通读增量并接收六个手工对照，坏枚举／Base64／重复键仍保留原超时与错误哈希；显式 R4 的真实 Windows 归档读取结果与旧输出完全相同，没有重标旧归档。接收证据 SHA-256 `13866e20c432694835a9005dd6460206ae8629dd3da7abaf8c57f8d1c1e8d69e`。读取合同接纳仍不等于原生通过，下一轮用新分支、新 run／head／artifact 绑定，不重跑旧 R4、不发布产品。
