# CHECK 约束管理验收（2026-10-28）

## 候选与边界

Root 基线 dce4cd6dba839e9d14db5f68b35f640af1d1bdeb；源码01共32路径，11旧文件按LF基线核对，21新路径须原不存在。包256935字节／33项，SHA256 `46eabafa729b1053e99a55b2206da8d685752c30e18cd7c8c9c38f9e3f48a604`。只更新旧source58中的7个批准交集，其余51保持，合并source83；其他dirty及dist109备份保留，不切换或重置虚拟机HEAD。旧ibYVwq失败profile和1392资源不读不删。

本轮功能为已有表的真实get／preview／apply／release任务及实际界面入口，不以生成查询草稿替代。覆盖新增、删除、替换名称／表达式及MySQL逐条启停；旧MySQL和未证明能力明确只读。源码01已静态修正私有revision／profile剥离、冷引擎配置、closing纯释放及Main早期not-sent兜底；对应真实入口AST及严格合同反例一并测试。

## 源码验证

WIN11-TEST先确认旧7992／8468／9464已终态且无在途App／测试，source58和dist109一致。仅应用批准32文件后，按序typecheck、14文件定向Vitest（10新＋4通用解析／缓存）、一次完整unit和build，首错停链。每门记录原PID、stdout／stderr、退出码和source83字节；新dist单独清点。环境清除DBARK测试注入，不读取认证，不启动App、数据库、Docker或剪贴板。本机只开发、Git和原件审阅，未跑产品测试。实际通过／失败待原件回读追加。

源码01首门原typecheck728 exit2（63.98秒），TS2724位于新测试table-check-shared.test.ts(3,10)：误把Main内部名称validateMainCommand当作validation模块导出，实际导出validateCommand。后续定向、完整unit及build均未启动，原dist109未变。Root已修为真实导出的显式别名，原断言不变，不把原失败改记通过。

Root回读失败包1010657字节／144根项／177递归项，SHA256 `67685162c596521f2a6c42e5d8e62f4191ee6d005232bca32e79cf272d2f0251`，CRC、逐项哈希、路径、私钥块、原退出码及source83与原候选逐字核对通过。控制器封包命令的一次括号解析错误未执行文件操作或重跑测试，另保原记录。

源码01封包后另定位一处后核验布局边界：原最后一个表级CHECK在新增后成为中项，SHOW CREATE的首尾换行可能改变。计划器后核仅豁免表级片段首尾布局空白，内部注释／文字和列级范围仍原样；单独窄修及多行真实解析回归另封增量，不能把源码01结果当作新计划器已验证。

delta02共6路径（3旧变更＋3新正式测试），25164字节／7项，SHA256 `08955de211ca1aab762a3994b378c9fdc378f9432320eb96bc00eb2d104a165c`；其余source83的80路径保持，合并source86。完整候选共35个唯一代码／测试文件。按序重新typecheck、15文件定向、首次完整unit、build和正式spec默认／list关闭门；正式双门仍关闭，无认证读取或实库操作。实际结果待原件回读追加。

delta02 原 typecheck PID5308 exit0（62.07秒）；首次15文件定向 PID7160 exit0，257项通过。完整unit原PID8368 exit1（465.41秒），912文件为22失败／889通过／1跳过，19327项为175失败／19151通过／1跳过；build／默认门／list均未启动。失败分类仅为旧局部Main夹具未注入新增真实tableChecksMain，以及Sidebar固定图标mock缺ListChecks。原件769821字节／161项，SHA256 `004a7025ef7db5fb3d61fc1609e1b43c309a55e51ecbef13e5e78161c20ea21e`，Root已核CRC、逐项哈希、路径／私钥块及source86与原source83＋delta02完全一致，不能将这轮失败改记通过。

额外只读核对Root全部2784项运行源码／测试／脚本／构建配置：2749项raw相同、17项仅CRLF／LF、7项缺少且均为验收Markdown、11项实质差异且全部是上述Main／Sidebar夹具修复。比较包364162字节／22项，SHA256 `036d12516f6641d4b6df248d1746bd080eacdbe842caa9ace0e491478e136a1f`，Root已逐项审阅；比较两次读取稳定，Git状态未变，不能仅以候选35一致替代完整运行基线核对。

delta03仅11个既有测试夹具，48024字节／12项，SHA256 `28526aa397b142308ae645e0e6811d1b81d03dc341fbac0eed7d1fc685339978`；旧字节与HEAD／VM逐项核对，候选35产品及专项文件完全未变。补齐真实能力初始化与图标依赖，原业务断言和异常路径不改；result-insert夹具的AST初始化数量3→4反映新增真实依赖。source86与修复文件合并冻结96路径，按序类型、原失败22文件、完整unit、首次build、默认关闭门及list，实际结果待追加。

delta03修后原类型PID5532 exit0（61.99秒）。22文件定向原PID14108 exit1（14.71秒）：Tinypool未处理拒绝`ERR_IPC_CHANNEL_CLOSED`，无最终汇总，仅日志记录4文件96项通过，不能判整组通过。完整unit／build／默认／list未启动，不把这次中断当作业务断言失败或已修复。source96、候选35和旧dist109前后保持；原件1487249字节／190项，SHA256 `a775906ef38bdcefac2d54edb57d320c91d00292a344aa64b756dd5b85d6f53d`，Root核CRC、逐项哈希、路径／私钥块、完整source96与source86＋delta03及本地逐字一致。2784项复核变为2760 raw相同、17 LF-only、7验收md缺少、0实质差异；测试进程异常另行只读诊断，不改产品或断言消除原失败。

source03诊断另包23923字节／25项，SHA256 `19ae3eb77a6ce447c555ca7cb425352c4d1d74215469d27454c8ecb02747366b`，Root核逐项哈希、路径／私钥块及原日志。当前无原进程或Vitest链，事件窗口无匹配崩溃／资源／重启记录；未记录的历史worker终态及并跑无法补证。当前4核、8GiB总内存、约3GiB可用只属快照，不能据此归因。pnpm常规shim会给后代设置NODE_PATH，原父进程清理不能外推整条子进程链。未改依赖、pool、并发、超时、产品或业务断言。

独立source04保持原`pnpm exec vitest run`22文件参数与`pnpm test`，不改源码，复用原类型5532。定向原PID10904 exit0（33.27秒），22文件317项通过；完整原PID7640 exit0（459.29秒），911文件通过／1跳过，19326项通过／1跳过，唯一平台跳过是POSIX文件模式测试。首次build原PID2616 exit0（117.08秒），新dist109单独核对；默认原PID16076 exit0／恰1skip，list原PID12908 exit0／恰1占位。stderr中的原React act／Vitest弃用和构建提示保留，不宣称零警告。正式双门关闭，App／DB／新资源为0，认证未读。

Root回读source04原件1610238字节／228项，SHA256 `5136ef9b262feca0b4ecc85d4ebb251c1b7c38184004a13e1afffaa556e81ddb`，核CRC、逐项哈希、路径／私钥块、五门原stdout／stderr及退出码，source96与前轮及本地逐字一致。完整运行基线仍无新增实质差异；最终46个代码／测试交付文件均在冻结源码中。原728／8368／14108失败不追认为通过；旁路观察器的时间和属性错误、后挂采样缺证另保留，不冒充全部早期worker正常退出的证明。本机未跑产品测试，未安装或发布。

## 实库与原生计划

六端隔离验收SQL已在忽略目录准备，但尚未执行。仅拟使用200的13357／13380／13384／13310／13311／13484，各一个明确随机dbark_e2e_checks_*库、subject表与两条合成行；不建用户、授权或修改全局设置，不使用业务库和旧资源。已有列权限／外键授权不扩大为本轮资源授权，Root已单独发增补问题。

实际fixture须采集真实服务器身份、原DDL／数据摘要、旁约束及JSON_VALID清单；产品窗口只管理ck_amount／ck_amount_v2。验证精确UINT64／DECIMAL、NULL和JSON，所有真正DDL经Main／utility执行。负值探测仅在本subject的独立事务尝试id3／amount=-1，明确回滚并严格关闭，不提交探测行。严格TLS端不得降级。任何未知、取消或收尾失败停链保留，不自动重放；结束后按准确owner清单精确清理。

正式专项默认／list必须先短路，未授权不加载认证、驱动或桌面入口。后续真实矩阵、安装、macOS及原生取消故障组合分别记录，未执行项不计通过，暂不发布。
