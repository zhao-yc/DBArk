# 0.28 固定产品候选与整合验收矩阵

当前由Root唯一串行执行，普通独立clone为 D:\svn\DBArk\.cache\v028-serial-closeout-20261019；Mac定位clone为 D:\svn\DBArk\.cache\v028-macos-serial-20261019。原员工1的 D:\svn\DBArk\.cache\employee1-v028-release-20261019 和分支 codex/v028-release-acceptance-20261019 为已封存交接，不再执行；五员工停止接单。不得使用worktree、修改主目录或旧失败场景。

## 固定范围

产品候选固定 bf08645a28fceb5d1d40ba16f013bb78e7a7c0a2，版本0.28.0。已核 src、package.json、pnpm-lock.yaml 与 f27c85ad98bca8232360de595440fe1cd5e3bd29 无差异。查询结果新增排序/筛选、含列名复制和后续新增备份/片段功能明确排除，进入0.29独立线。命名表筛选/排序方案已在bf中，有旧局部证据但专用GUI/实库未完整交付，不能与后续查询结果筛选混淆。

产品Git对象：src tree 20ff372f4cbc5c466e79d847afda2cb57f55426e；package.json blob 3ff5c4d3b652bb0cc8de0e2584c26119869792da；pnpm-lock.yaml blob f4e286fab9eb730c5f4880d6cb08fead0bf8e608。这些是Git SHA1标识，实际字节SHA256另由候选清单封存。

验收分支仅接有原反例的测试/脚本阻断修复。系统CtrlS准备12e0acc/96385c2迁入为c71ddcc/422c796；不改变产品范围。SYS-1先在原四例中复现601字节先写后拒绝，再增加取得句柄后的首写前目录/名称/句柄检查，修后同反例0写0sync只close。不宣称消除所有FS并发竞态；原DOM/Main双观察门、原120秒与5秒断言、schema9和37await/52guard保持。

后续每次执行必须另记准确验收HEAD、编译/源或安装批准摘要、run/job/artifact及原报告摘要；不能以产品相同跳过该核对，不能把文档HEAD变化写成新增产品版本。

## 当前矩阵（审查材料已齐，仍有验收阻断）

2026-10-20仅补齐[最后发布阻断表与A/B方案](../../docs/releases/v0.28.0-final-decision-20261020.md)及[四层功能复核](../../docs/releases/v0.28.0-feature-delivery-audit-20261020.md)。两方案都未批准、未就绪，未新增验收结果：原完整范围继续阻断，A所列例外必须由人类明确接受，不能把失败改为通过。

| 验收项 | 已有准确证据 | 本候选待完成的闭环 |
| --- | --- | --- |
| 完整Linux类型/单测/构建 | 固定02e69f8的CI39267183318/job118109712128：563文件、10680通过、10条件跳过，类型及构建成功 | 桌面、安装、发行跳过不能转为通过；后续只读脚本检查按准确HEAD另记 |
| Windows源码缩进/分栏 | 固定4a2bcd4/run39244695054/job118033672863两专项通过；回读39250949911核同次批准、原footer/报告摘要及4个正常owner，原尺寸断言保持 | 本项已闭环；旧df03281分栏1008×655失败及未知退出仍保留，不由新成功改判 |
| Windows源码首次模型/格式化四例 | 同一4a2/run源码批准，LF/CRLF×按钮/格式化快捷键4通过、8正常owner；原文件身份、schema9、独立重启及目录均核 | 本项已闭环；不计作系统保存快捷键通过 |
| Windows真实安装 | 原NSIS DBArk-0.28.0-win-x64-unsigned.exe实际安装，installed批准绑定同次源码及安装前参考；缩进/分栏/四例6通过、12正常owner；legacy76通过/313跳过；规范卸载及临时根清理。新增关键字安装两例及四owner也已闭合 | 详见[Windows准确记录](acceptance-v028-windows-success-20261019.md)与[关键字记录](acceptance-v028-keyword-20261019.md)；安装系统CtrlS已完成本机原ZIP/CRC和119文件核对，但窗口绑定失败、Root输入0次，原120秒失败 |
| macOS arm64源码/安装 | 689源码六项/12正常owner；0f39cf6/run39258588418源码legacy76通过/313跳过；3fd87bb/run39256090941原安装六项/12正常owner、恢复、legacy76/313及规范清理均闭合。回读39258845618核安装资产ZIP/CRC及DMG绑定，39260328180核原六项与新source legacy的113运行字节完全相同，见[准确实证](acceptance-v028-macos-arm64-20261019.md) | 本行范围已闭环，不重跑已核六项。旧5a失败保持；系统CmdS和应用ZIP独立安装仍未验；新关键字另行失败见下行，不由本行外推 |
| macOS x64源码/安装 | 新6a4/run39261586810在macos-15-intel/26-intel原生x64顺序只读枚举，可见高970/959点，各3个重复模式均1920×1080；未切模式、创建产品窗口或安装 | 当前未找到满足原尺寸门的标准Intel环境；AppKit点非本轮实测Electron DIP，[准确环境阻断](acceptance-v028-x64-environment-20261019.md)。不借arm64/Rosetta替代，不改旧失败 |
| SQL文件系统CtrlS保存 | 固定ddeed3c的Windows源码新nonce18c06a58单次实测通过：系统输入一次、原字节/revision/任务/SQLite9/重启及两正常owner闭合；原run1929和首轮控制标签错误失败分别保留 | 用户授权后本机原ZIP/证据ZIP完整SHA与全部CRC、实际119文件对照通过。新nonce05033c30已生成ready，但Sky激活/恢复窗口失败，Root未发系统键、未写ack；原120秒及45秒worker收尾失败，退出未知和安装/数据现场保留，[准确失败记录](acceptance-v028-windows-system-installed-20261019.md) |
| macOS真实系统CmdS | 新系统输入门仅Windows；源码机制研究不算实测 | 未验，不把CDP或Windows系统输入计为Mac通过；发布决策须明确该边界 |
| 原源码与安装legacy专项 | Windows4a2源码/安装与Mac arm64 0f39源码/3fd安装，每阶段均76通过/313条件跳过；389项文件/行号/状态及129spec计数逐项一致，导航/字体/查询复制/关闭其它查询/片段等原门实际运行 | 包含组件层，不称76条安装产品路径；缩进/分栏/四例在legacy中的skip仍保留，其通过另看独立专项；x64仍待验 |
| 关键字大小写当前候选专项 | eb171c2/run39265643127：Windows源码/原NSIS实际安装各2通过、8正常owner，113/119字节完整对照，规范卸载。Mac源码upper在重启后再次格式化5秒断言失败，lower未运行、安装未执行；原失败目录和第二owner未知保持 | 整体run失败；独立回读39267183253核原ZIP/CRC、批准、全部报告及119参照。Mac根因尚未确认，不能改判或盲目重跑，[完整分层实证](acceptance-v028-keyword-20261019.md) |
| 离线开发组件剪贴板 | 独立开发夹具与安装产品不同 | 如执行手动CI组件门，单列12项；不能计安装/系统保存验收 |
| 安装候选与公开源码资产 | Windows两文件与Mac arm64 DMG/ZIP共4实际文件已在独立只读CI核ZIP长度/SHA/全部CRC，DMG/EXE绑定原安装输入；Mac ZIP内部741成员CRC通过但未单独安装 | 完整[可审矩阵](../../docs/releases/v0.28.0-release-review-assets.json)及[候选摘要](../../docs/releases/v0.28.0-candidate-SHA256SUMS.txt)已备；x64、最终源码/全量公开清单仍缺。Windows本机现已核两原ZIP；Mac本机仍未核，API digest与下载校验分记 |
| 功能清单 | 原80个唯一ID含AI01至AI04，195条子ID保持；命名表方案D06.4从C纠正为B后A51/B30/C114；A类25个入口均在公开0.21标签源码存在 | [可读清单](../../docs/releases/v0.28.0-feature-status.md)及JSON、四层复核均已备；B的候选已验切片不等于整行交付，代码纠错不新增验收；备份/Excel/内部SQLite/Web边界单列 |
| 发布准备/最终发布 | [发行说明](../../docs/releases/v0.28.0.md)、[最终审核材料与发布后计划](../../docs/releases/v0.28.0-release-review.md)及资产清单已备；当前releaseReady=false | Mac关键字、安装系统CtrlS、Intel及Mac系统输入等阻断尚在，不能认定0.28完成。最终tag/release/main交原统筹审核，本轮未执行；不开始0.29 |

## 资源与证据规则

只启动新隔离资源，固定头、原期限、零自动重试。不重跑旧失败，不强停、不补晚SDK/SQLite/退出证据，不把清理当正常退出。显示keeper的已知CG/NSScreen过渡与forSession失败保留需先独审；实际编译、切换、窗口、恢复和artifact上传必须分别有证据。

Docker仅允许核实际连接身份后的server-200；本接班尚未执行Docker或数据库。新密钥/证书如确需生成，须按通用约定备份；当前没有生成。

代码push允许用于新隔离CI，不代表主分支整合、发布或生产部署授权。验收脚本修复与本矩阵的更新不授权增加产品功能。

本轮停止点：仅文档提交推送；不启动测试/CI/构建/安装/系统输入/Docker，不新增工具或输入链，不处理旧失败现场，不执行tag/release/main。后续动作以最后决定表中的具体范围与授权为准。
