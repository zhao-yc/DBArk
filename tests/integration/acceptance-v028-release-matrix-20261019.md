# 0.28 固定产品候选与整合验收矩阵

当前由Root唯一串行执行，普通独立clone为 D:\svn\DBArk\.cache\v028-serial-closeout-20261019；Mac定位clone为 D:\svn\DBArk\.cache\v028-macos-serial-20261019。原员工1的 D:\svn\DBArk\.cache\employee1-v028-release-20261019 和分支 codex/v028-release-acceptance-20261019 为已封存交接，不再执行；五员工停止接单。不得使用worktree、修改主目录或旧失败场景。

## 固定范围

产品候选固定 bf08645a28fceb5d1d40ba16f013bb78e7a7c0a2，版本0.28.0。已核 src、package.json、pnpm-lock.yaml 与 f27c85ad98bca8232360de595440fe1cd5e3bd29 无差异。结果排序、含列名复制和后续新增备份/片段功能明确排除，进入0.29独立线。

产品Git对象：src tree 20ff372f4cbc5c466e79d847afda2cb57f55426e；package.json blob 3ff5c4d3b652bb0cc8de0e2584c26119869792da；pnpm-lock.yaml blob f4e286fab9eb730c5f4880d6cb08fead0bf8e608。这些是Git SHA1标识，实际字节SHA256另由候选清单封存。

验收分支仅接有原反例的测试/脚本阻断修复。系统CtrlS准备12e0acc/96385c2迁入为c71ddcc/422c796；不改变产品范围。SYS-1先在原四例中复现601字节先写后拒绝，再增加取得句柄后的首写前目录/名称/句柄检查，修后同反例0写0sync只close。不宣称消除所有FS并发竞态；原DOM/Main双观察门、原120秒与5秒断言、schema9和37await/52guard保持。

后续每次执行必须另记准确验收HEAD、编译/源或安装批准摘要、run/job/artifact及原报告摘要；不能以产品相同跳过该核对，不能把文档HEAD变化写成新增产品版本。

## 当前矩阵（推进中）

| 验收项 | 已有准确证据 | 本候选待完成的闭环 |
| --- | --- | --- |
| 完整Linux类型/单测/构建 | 固定4d41e1b的CI39237855605/job118011213539：561文件、10643通过、10条件跳过，类型及构建成功 | 后续脚本修正按准确HEAD检查；桌面、安装、发行跳过不能转为通过 |
| Windows源码缩进/分栏 | 固定4a2bcd4/run39244695054/job118033672863两专项通过；回读39250949911核同次批准、原footer/报告摘要及4个正常owner，原尺寸断言保持 | 本项已闭环；旧df03281分栏1008×655失败及未知退出仍保留，不由新成功改判 |
| Windows源码首次模型/格式化四例 | 同一4a2/run源码批准，LF/CRLF×按钮/格式化快捷键4通过、8正常owner；原文件身份、schema9、独立重启及目录均核 | 本项已闭环；不计作系统保存快捷键通过 |
| Windows真实安装 | 原NSIS DBArk-0.28.0-win-x64-unsigned.exe实际安装，installed批准绑定同次源码及安装前参考；缩进/分栏/四例6通过、12正常owner；legacy76通过/313跳过；规范卸载及临时根清理 | 本范围已闭环，详见[Windows准确记录](acceptance-v028-windows-success-20261019.md)；系统CtrlS安装、关键字及其余条件门仍未验 |
| macOS arm64源码/安装 | 689b352/run39240838841源码六项与12正常owner已核；本轮复核交接摘要一致。新安装首轮39252503731在Swift旧分支门前拒绝，未启动应用；修正5a4ca1b的新39253421880待终态，见[安装缺项记录](../../docs/development/v028-macos-installed-20261019.md) | 实际安装及legacy、驱动仍需对应原证据；不重复源码六项，也不转为安装或系统CmdS通过；旧a697及首轮新失败均保留 |
| macOS x64源码/安装 | 旧R9与未知/失败保持 | 同上，必须以本架构原报告确认，不借arm64替代 |
| SQL文件系统CtrlS保存 | 固定ddeed3c的Windows源码新nonce18c06a58单次实测通过：系统输入一次、原字节/revision/任务/SQLite9/重启及两正常owner闭合；原run1929和首轮控制标签错误失败分别保留 | 对应真实安装场景仍待执行，不以源码代替；详见本轮源码实测记录 |
| macOS真实系统CmdS | 新系统输入门仅Windows；源码机制研究不算实测 | 未验，不把CDP或Windows系统输入计为Mac通过；发布决策须明确该边界 |
| 原源码与安装legacy专项 | Windows4a2原job源码/安装各76通过、313条件跳过，389项状态逐项一致；导航、字体、查询复制、关闭其它查询及片段等原门实际运行，完整129spec计数已落盘 | 包含组件层，不称76条安装产品路径；缩进/分栏/四例在legacy中的skip仍保留，其通过另看独立专项；macOS另验 |
| 关键字大小写当前候选专项 | 本Windows源码与安装legacy两项均跳过；旧Windows源码两项是旧检查点 | 当前冻结候选源码/安装及macOS须补对应批准与原报告，不能由整体绿色替代 |
| 离线开发组件剪贴板 | 独立开发夹具与安装产品不同 | 如执行手动CI组件门，单列12项；不能计安装/系统保存验收 |
| 安装候选与公开源码资产 | Windows原artifact12184231827/12184037042已在只读回读job独立核ZIP字节/SHA及139文件CRC；安装器SHA与package-input一致，见[资产清单](../../docs/releases/v0.28.0-windows-assets.json) | 校验宿主GitHub-hosted Ubuntu，本机未核ZIP；macOS候选与最终公开源码/安装资产仍待核，API digest与下载校验分记 |
| 发布准备/最终发布 | 当前仅候选与计划 | 先形成可审资产清单和发行说明；不自动创建发行tag、发布release或合并main，交Root最终决定 |

## 资源与证据规则

只启动新隔离资源，固定头、原期限、零自动重试。不重跑旧失败，不强停、不补晚SDK/SQLite/退出证据，不把清理当正常退出。显示keeper的已知CG/NSScreen过渡与forSession失败保留需先独审；实际编译、切换、窗口、恢复和artifact上传必须分别有证据。

Docker仅允许核实际连接身份后的server-200；本接班尚未执行Docker或数据库。新密钥/证书如确需生成，须按通用约定备份；当前没有生成。

代码push允许用于新隔离CI，不代表主分支整合、发布或生产部署授权。验收脚本修复与本矩阵的更新不授权增加产品功能。
