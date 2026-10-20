# 已返回结果文本通配筛选验收

## 准确源码与交付边界

产品及测试提交 `63fb0f6de6527ca29aed55b32992ad00d5c1cb4c`，源码树 `675ffa2320aba0f55e21ccef2b2eee349531ff9c`。开发普通副本沿用 `.cache/snippet-transfer-20261020`，无工作树。本机只静态审阅、档案读取和 `git diff --check`；Windows 测试由独立 WIN11-TEST 的“dbark测试”执行。

可靠文本列新增独立的“文本通配匹配／文本不通配匹配”。`%` 为任意长度，`_` 为一个 Unicode 码点，固定反斜杠转义，整段匹配；否定也排除 NULL。保持原字面比较、精度、结果租约与导出映射，不发额外 SQL。无用户正则或回溯，状态转移共用原工作预算。完整语义见[开发记录](../../docs/development/query-result-wildcard-filter-20261021.md)。

## 已确认检查

| 检查 | 原始结果 |
| --- | --- |
| [Linux CI39461498265](https://github.com/zhao-yc/DBArk/actions/runs/39461498265) | job118761826846，类型／585文件11229通过、10平台跳过／构建成功，单元135.95秒 |
| Windows 修前相关检查320b88e | 类型通过，七文件314通过／1失败；新增通配控制器24/24通过，原构建未执行 |
| Windows 修正后63类型／UI文件／构建 | 89/89通过，退出0、100.891秒，PID16640；类型38.39秒、测试阶段10.43秒、构建51.97秒 |
| 修正准备后的独立实库 GUI | PID15304，退出0、23.933秒；用例22.894598秒，1通过、0跳过／失败／flaky，原120秒、零自动重试 |
| Python标准库独立文件读回v3 | PID13556，退出0、0.138秒；人工原行1/3、六列顺序及全部原内容断言通过，Node前后身份和摘要一致 |
| Windows完整单元 | PID15084，退出0、250.052秒；585文件11238通过、0失败、1项POSIX mode跳过，stderr为空 |

Windows 修正后574源码和109构建完整哈希匹配，原进程及已记后代身份缺席、Git净，21份定向封存文件校验通过。该阶段报告SHA256来自 VM 元数据：`1aa6c5ef759c385079bc2ad3a7359f0c7aeeb66de29e392284c92acd8d1123b0`；开发机已读取原命令输出，未下载复算原文件。

## 真实入口与范围

沿用准确 Server-200／MySQL8.4／13384 原整例，只追加原三行常量的通配正反、单码点、文字转义、空文本及非法模式修正，不改变原 SQL、目标、文件期望或期限。GUI 使用本轮独占输出子目录，真实表头排序、条件面板、复制和 CSV／JSON 导出共用同一投影；原 strict owner 正常退出、observer 同流关闭及任务终态检查通过。

GUI原JSON SHA256 `fdbbb14ee91ad26105794015903a360c4c8779de81b5b4416ef0ac70aad7f6a5`，stderr为空。原runner→worker→Electron链记录PID15304、14100、18004、17896、16440、15508、13904、6936、17572，末次观察均缺席。摘要及身份记录来自VM原件，Root已读原命令输出；不把数字PID单独当作永久身份。

独立后继输出位于测试机 `outputs/query-result-wildcard-gui-63fb0f6-recovery-20261021`，准确导出子目录 `dbark-query-columns-8f4ed22938984b13a0cfa85b655482a6`。复制沿原合成 ClipboardEvent／DataTransfer，不是系统剪贴板。未创建库、用户、表或写业务数据。

## 保留的准备及用例失败

- 320b88e新增RAM用例未先勾整行，单格复制只含ID，第三列期待bark得到undefined；后序导出断言未到达。63只补原公开选择事件，原值期待不变，产品源码相同。
- 首次GUI准备提前创建了用例要独占创建的输出目录，第30行mkdir EEXIST，退出1、5.408秒、0通过／1失败，PID16068；observer／App查询及导出未开始。原进程及后代已缺席，原profile `dbark-e2e-AN2ge5` 保留，正常退出未确认，不追认原strict收尾。
- Root第二次字面exports路径规划不符合原helper固定目录名合同，在启动前阻止，未新增GUI；更正为上面的固定格式子目录及原两个文件名，原helper、mkdir及断言不变，未删除或复用旧目录。
- 后继为Root审阅后明确授权的独立运行，按新路径原ENOENT及父目录身份准入；Playwright重试仍为0。总共两次实际GUI运行，不能将全流程写成只尝试一次或所有旧profile清理。

## 独立读回与原失败

Python标准库首次独立读回退出1、0.608秒，PID14516；第13行路径lstat与原句柄fstat的身份／时间戳元组比较失败，CSV／JSON内容断言未到达。原stderr摘要 `8739360492cabf99d1a4964ecf2d48cd99050fdc71fd1f59a9f04a1cdb039630`。原脚本及失败保持，具体差异字段尚未确认，未推断文件变化或平台原因；已仅派发原字段、Python版本、原字节摘要和Node句柄的只读诊断，未批准更改断言直接转绿。

远端恢复后，Root已读取原只读诊断命令的完整输出：Python3.12.14，CSV／JSON的路径lstat与句柄fstat仅ctime_ns不同；各API自身前后完全稳定，dev／ino／nlink／size／mtime_ns／birthtime_ns一致。CSV路径ctime为1792517766941435500，句柄为1792517766948992700；JSON分别为1792517767895922300和1792517767898862600。Node24.19.0的路径和句柄四检查点全部字段一致，其ctime等于Python句柄值，birthtime等于Python路径ctime；不将两个API的不同ctime表示误报为内容变化。

两文件原摘要也一致：CSV177字节，SHA256 `a8d7e0d2949aec1d5ba342b1cd6bb9c30d98901c1edacbb17fc021c5a8cf9048`；JSON321字节，SHA256 `fd0979ab54e513de5b565d11a2dfa1174cccc4b18393a8d338b813c26aeb4678`。比较基准是首次Python失败后封存的export-file-identities.json，原GUI没有输出字节摘要；这次诊断没有解码或验证内容，不能代替独立内容读回。

Root据此批准另存v2验证脚本，原脚本及失败不改：ctime改为各自同API的前后严格核对，跨API继续逐字段核身份、大小、修改及创建时间；另核原inode和封存摘要，原CSV／JSON字面期待及内容断言逐字保持。原Node前置实现额外比较所有BigInt字段，失败时未先保存具体差异，原触发字段仍未知。修正为指定dev／ino／nlink／size／mtimeNs／ctimeNs／birthtimeNs七字段，并先保存全部原值；后继采集只有访问时间atimeMs／Ns变化，七字段和原摘要稳定，不能据后继值追认旧失败字段。

v2验证器PID4764退出1、0.063秒，第17行IndentationError：生成时把原一空格的for体直接拼入新两空格体，内容尚未执行。原脚本及stderr摘要 `4dcf26ab7a0ae2565584f08cc7092c5645011f43703c4f3015d609f1728eeee3` 保留。v3只修这些拼入行的缩进，原定义及末尾全部内容断言逐字保持；先用ast.parse检查通过（PID12956，退出0、0.116秒，不读目标文件），才启动一次v3读回。

v3 PID13556于2026-10-20T18:32:37.527Z启动，退出0、0.138秒，stdout摘要 `f26f4b3170823efab794455c651348c39028bdc1b7c7cd689fbe7c0c8030d141`，stderr为空。两个原文件严格核对行1/3、六列顺序、完整整数／小数字符串、NULL／空串、00ff／空BLOB及隐藏列排除；使用Python标准库和人工字面期待，没有产品解码。Node前后七字段及封存inode、dev、字节数和SHA均一致。v1／v2／v3验证器分别保留，不能写成首轮通过；元数据诊断和ast检查不算内容验收。

## Windows完整终态与源码交付

原GUI及v3、原进程及后代身份缺席、Git净、574源码和109构建终核全部通过后，仅启动一次 `node node_modules/vitest/vitest.mjs run --reporter=json`。准确63fb0f6，全部DBARK变量移除，原配置、worker、期限及断言未覆盖；输出独占 `outputs/query-result-wildcard-full-63fb0f6-vm-20261021`。

PID15084于2026-10-20T18:35:03.681Z启动、18:39:13.764Z结束，退出0、250.052秒。原JSON为585文件、11238通过／0失败／1跳过，唯一跳过是 `query-file-source-mode-posix.test.ts` 的0664权限场景。stdout摘要 `a1d92cdfa4f5ed86039a7daade4ab479843493d1da00ac9a816608645d38c1ca`，stderr为空；1328是嵌套suite计数，不作文件数。

Root已读取原命令计数和源码／构建终核输出，测试会话最终报告确认原进程及子进程身份均缺席、Git干净、574源码及109构建哈希不变。原AN2ge5仍保留且身份一致，正常退出仍未确认；后继通过不追认旧资源收尾。原错误、原生JSON和摘要留在VM，本机没有运行替代测试。

本批按main交付已验源码，b5c54e3相对63fb0f6仅增加文档，产品树保持675ffa2320aba0f55e21ccef2b2eee349531ff9c。NULL排序位置另属后继开发分支，未混入本批。

## 剩余范围

新安装包、macOS通配实库、其他数据库基线与系统输入未验。基线main0ee5886三平台CI及ARM原件静态审计[另行记录](acceptance-main-0ee5886-ci-20261021.md)，不能替代本候选的新能力验收。Q07仍为部分，暂不发布。
