# SQL文件捕获保留未编辑原草稿的EOL

固定基线为Root已推送的 `67eec19c2d352b19f66ce378d945aabf99d67f68`，在独立普通clone与 `codex/employee3-query-file-eol-capture-20261018` 分支开发。只修改正文桥和文件快照两个产品文件，新增专项RAM测试及本文；原准备分支 `07dacb9f47deb6bff2eb223c4cf8c7cb84a97875` 不变，不使用worktree。

## 原因与证据边界

run1874报告SHA256为 `16f4a69484b304822677c11798797a9bc2826421a28be5a83fc78f1f7899a8e8`。它实际证明：最近文件重开时，旧标签Main.sql从LF变成CRLF，导致原标签完整快照比较失败。不能将此描述为旧报告已经实测了dirty。

源码链为 `useQueryFileSource.open → capture → captureQueryFileSnapshot → flushEditorContent`。正文桥按模型getEOL将受控props显示为CRLF，但通用flush会发布实际模型全文；因此仅为文件操作捕获未编辑正文也会把LF回写成CRLF。`queryFileSourceHasChanges` 按原SQL摘要比较，随后可能误判dirty属于源码因果推论。本次RAM通过原来源摘要函数验证修复后的连续捕获仍clean，不伪造dirty状态。

## 显式捕获策略

通用 `flushEditorContent` 新增可选的 `preserve-equivalent-draft-eol` 策略，只由产品 `queryFileSnapshot` 显式选择；不传时保持原全文交付和返回值语义。

只有原owner/lease、就绪和readonly门有效，expected与当前props及原同步基线完全相同、没有原生发布状态，且当前模型版本同时等于原同步版本与原受控版本时，才比较模型全文是否只是原草稿按实际LF/CRLF规范化的结果。全部成立才返回原草稿SQL并跳过onChange；不设模型EOL、不换模型、不修改撤销栈或store，也不假置dirty。

仅字符串归一相同不能放行：原受控版本门防止未交付原生输入经过等价sync后被洗成“未编辑”。任何新模型版本，包括仅换行输入，仍走原flush交付。文件捕获额外拒绝未被桥同步或原生交付的外部新props，即使其恰与当前模型全文相同；通用flush默认合同保持。陈旧expected、外部新props未sync、旧桥、readonly、owner丢失和捕获过程中版本漂移继续拒绝。

文件快照原来的同文档逐字段核对不变，交付过程中title、connectionId或fileSourceBinding变代仍拒绝并保留新状态；原source lease、Main来源操作、物理文件版本和保存协议均不改。

新增成本为每个模型lease一个版本数字、每次同步一次公开版本getter；仅显式文件捕获满足候选门时增加一次按EOL的线性文本比较。没有新增轮询、磁盘、IPC或数据库请求，未以RAM验证声称原生性能通过。

## 验证与交付边界

修改产品前先运行16项新RAM反例，固定父提交6项失败、10项通过，日志原样保留；失败包括LF/CRLF两个方向的回声、等价外部props未sync和版本读取边界。之后追加“未交付原生版本经等价sync仍不能隐藏”的反例，共17项新增测试；与原桥/flush/快照/React接线及通用flush复制调用方102项回归合计119项通过。旧测试及共享RAM端口未修改，类型检查和精确证据见本clone `.cache/query-file-eol-capture/handoff.json`。

本轮未运行GUI、Electron、Playwright（含list）、端口、数据库、SSH、CI或安装依赖。仅执行必要无凭据Git fetch、本地代码/RAM/类型核验；默认MXC因无关H卷枚举失败时，经授权使用require_escalated完成本地步骤，没有接触H卷。真实原生最近重开/文件保存、来源dirty、重启、正常退出/PID和目录收尾仍待Root独审、整合、新构建后统一验收。本片只本地中文 `[skip ci]` 提交，不推送。
