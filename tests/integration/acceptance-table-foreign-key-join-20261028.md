# 外键 JOIN 查询草稿验收（2026-10-28）

## 候选与范围

基线 `3796e5ae3488efb53d43bad90ecce7b13d87bc60`，新增按一条真实外键生成LEFT／INNER SELECT及双方选列。预览只读取结构，打开为独立查询前重新核对双方相关元数据；数据页草稿不提交或清空。完整O04仍未完成，当前暂不发布。[实现说明](../../docs/development/table-foreign-key-join-20261028.md)。

十文件快照 `foreign-key-join-green01.zip` 为74244字节，SHA256 `7dcb158b4cfb604c6069fac44bc08841c7983e42b2b6e9a5d0c92866ee4bdfac`，十一条目含manifest及十源码/测试路径。独立WIN11-TEST沿原b523加已核overlay，仅覆盖本次路径，实际一旧文件备份、九新增文件原先不存在，原109份dist保留；本机仅开发、Git及原件校验，未运行产品测试。

## 原失败与接续

green01类型检查原15676 exit2：动态defineProperty添加getter的负向输入直接断言为ForeignKeyJoinOptions，TS2352指出静态类型缺childColumns。仅改为经unknown转换，保留访问器拒绝及reads=0原断言，产品无变化；新unit SHA256 `246f892e6d33255085d82652196b2fa78003615a70ad286110911641d629ef7b`。单元、build、默认门和list均未启动，不记为通过。

Root回读首轮原件（152228字节，SHA256 `1edee517054a3cc4336bc2947b754cb2f518a4d2e7b91128154fee05c0085a37`），含输入包，递归46项哈希/CRC/路径及私钥块核对通过。green02仅替换该unit后按原顺序接续，任一步失败停链，不由测试会话改源或断言。

green02五门通过：类型12844 exit0；九文件156项单元11952 exit0；build含类型14912 exit0，新dist109份；双门关闭默认16788 exit0/恰一skip，list13568 exit0/恰一占位例。默认/list不加载live模块、不访问实库，不当作正式窗口验证。Root回读48项原件包（65231字节，SHA256 `22bfd6bccddc92e13b98490b3cb114fc7a8b002e880f8fbbe812d22879f03c16`），逐项哈希/CRC/路径/私钥块及五份原退出码、156项原日志核对通过。

原封包上传前SSH17140 exit255/10秒超时，SCP和数据库均未开始；本机只读确认200可达，授权一次同目标只读重试后，身份16036、SCP8640、远端哈希12656均exit0。未改hosts、VPN、主机记录或密钥，不重跑检查、不重封包；传输原错误与重试记录独立留VM，不算作产品测试失败。

## 最终源码候选

独立审查发现重复预览会重选全部父字段。delta03仅修对话框及组件测试：同一外键且相关结构未变时，保留精简字段、顺序和空侧选择；父结构变化则永久失效，不自动换签SQL。新候选类型15536 exit0，三文件55项单元5044 exit0，build含类型9048 exit0，新dist109份；既有来源合同17692 exit0，准确113份文件。此前六个未受影响专项文件不重复运行，不能把两轮数量简单相加为唯一测试数。

Root回读green03原件55项（96981字节，SHA256 `0f586e3d23289746863798c7874a8ecf5be17f301eea1f4b5ee5885bfd0a72e6`），逐项哈希、CRC、路径及私钥块检查通过，十个源码路径与本机候选字节一致。新source manifest SHA256 `686f7159e424cc32f86ddacc3e6c8d9ecc812b9dcaa997d5a64a8511c7c2d491`；旧build来源清单保留，不用于当前GUI。

## 实库预置、关闭失败与只读复核

已只读确认200/13384为MySQL8.4.11、UUID及容器身份匹配，P_S明确关闭，原观察连接正常及物理stream关闭。按唯一批准计划（3705字节，SHA256 `aad5759b2966b5b78738e84123beb1fd701b6a9e97da0a8b05676426de16bed5`）创建随机库、两表及七条合成记录；20条主命令零告警，两表owner、DDL、行值和三条控制SELECT语义均符合计划。无新用户或GRANT，不触碰遗留草稿库。

原预置PID14444 exit1，控制器同步关闭stream触发ERR_STREAM_WRITE_AFTER_END，原native end回调已到、stream end及transport close未确认。保留原50项原件（60684字节，SHA256 `9f67d3a8b763b2ab481d47f5e045349e6fc47841d2465c08c8b97bf88fde5d1c`），Root已完整校验；没有重放写入、强制销毁、KILL或重建。生产连接代码已有正确queueMicrotask时序，本次仅修测试控制器关闭顺序。

独立只读复核PID12240 exit0：新连接45971自身可见、旧45970当前不存在、本例库排除观察连接后为零；两表owner、原DDL哈希及5+2行值完全未变。新连接native end→queueMicrotask→stream end→transport close真实完成，无强制销毁。当前线程不存在不能倒签原14444关闭成功。resource manifest SHA256 `e4dd79525f5c4fd834e674b3335a354ddf38780ce3b930a0a954577849552ae2`，独立原件41项（47197字节，SHA256 `b03d0345cd19f0b1b51ec3347c900886d90081b400f8dee230d5e55358691a56`）经Root完整校验；数据保持原样，三条控制SELECT未重复。

## 正式GUI安排与未验边界

live01原SSH5360 exit0；pnpm启动6736 exit1，仅2.80秒，在收集时拒绝额外环境键，注册0例、App0、JOIN0。原启动边界恰为批准的13键，NODE_OPTIONS／NODE_PATH／ELECTRON_RUN_AS_NODE均不存在，但原断言未记录收集进程的具体额外键，不能仅凭此错误认定来源。原36项脱敏记录（49927字节，SHA256 `4bd499de188e1cc58f9ed27472cdd03f3ba386bd34c3cf10212c72f8bb1efe5e`）已由Root完整核验；原封包8712因GBK解码UTF-8报告失败，保留原脚本及错误，仅显式编码修复后的3900封包通过，不重跑SUT。

独立最小诊断的直接Node2568与pnpm exec node5532均exit0、相同13键，未加载仓库／Playwright／mysql或访问数据库。此结果仅排除该两个启动边界增加禁用键，不能排除专用playwright命令包装层；后续只读核实际shim并接续原CLI的记录另列。

VM只读核实原playwright.cmd第2–5行、playwright.ps1第17／19行会加入NODE_PATH，且6736原参数为exec playwright。改用实际Node24直接运行同一node_modules/@playwright/test/cli.js，默认配置、1worker／retries0／trace off及120秒原TestInfo不变，不修改测试断言、产品或两份manifest。live02原SSH13612 exit0，原11776 exit0，正式1通过／0跳过／0重试，约26.76秒；仅忽略颜色环境提示，不忽略用例失败。

正式附件核对唯一LEFT执行、两行结果及十个唯一输出列：大整数9007199254740993和小数12.3400保持字符串，含NULL外键的子行不匹配可空父键。回原表页仍有本地草稿；INNER与自关联仅预览／打开，无额外SQL执行。8个独立metadata.table任务均completed、无running。四阶段来源身份、原App exit0、观察连接正常关闭和本例线程零已通过；未清理数据库，待独立精确清理记录，不泛化到旧草稿库或整个200。

正向例只明确执行一次精确生成的LEFT SELECT，独立核复合映射、BIGINT／DECIMAL、可空被引用键及唯一结果列；INNER和self仅检预览与打开。来源、资源归属、实际退出及本例清理另有记录前，不视为已验。原生取消、权限拒绝、跨库、其它数据库版本、macOS及新安装组合仍待验，不借用单元或旧CI结论。

## 精确资源清理与提交边界

cleanup01原16748 exit1：新写的ORDER BY BINARY TABLE_NAME触发MySQL1287弃用警告，零告警门拒绝继续；DROP意图及执行均为零，45992观察连接正常关闭。Root完整回读38项原件（53996字节，SHA256 `013f51d12f0ce0876e592edf19c234b028096ea2217dd76c3b5eb75d590db97a`），保留原失败。仅将该排序改回已验的ORDER BY TABLE_NAME，不忽略警告。

cleanup02原12428 exit0：重核实例、准确两表owner／原DDL及5+2行值哈希，无额外视图／触发器／例程／事件或其它库反向外键，自身可见且本例其它线程零后，唯一nonce库DROP恰一次、零告警；准确schema不存在，观察连接45993的native end、stream end、transport close均确认。未调用KILL、SET FOREIGN_KEY_CHECKS或GRANT，未触碰1392等旧范围，不能将本例核零泛化为整个200。

Root完整回读live02的35项原件（52967字节，SHA256 `4e0868bb0212970099de5d3c7c7a36dfedd400d0836298e3e67bbe30553d7f04`）与cleanup02的43项原件（58930字节，SHA256 `34fb1f57b6b778810a12883ce6b5b6dc5b8af8cc2348db60776f43fe7d72a575`），逐项哈希／CRC／路径／私钥块通过，并读取正式报告及原附件、清理原回执。十条源码／测试路径的暂存字节与VM最终候选完全一致，无行尾差异；公开仓库仅保存代码和脱敏结论，原始日志／合成资源原件留忽略目录。精确提交CI另行跟进，暂不发布。
