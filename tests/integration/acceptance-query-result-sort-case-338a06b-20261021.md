# 排序筛选338源码交付与Windows封存

## 准确来源

本检查点交付每列文本大小写排序、同组复制筛选条件和小数简写输入，保留精确原值、NULL、日期微秒、负TIME及只处理已返回结果的边界。任意SQL结果仍只读，不重发查询扩大结果。

WIN11-TEST准确产品提交为 `338a06b0366248cac93dd7c0d5cbe680e908b2e4`，`src`树为 `585875a1c1dc39062cf65969a6f063342809536c`。main从9793a2d快进到固定交付检查点4bd2fd3，仅另拣入本任务GUI记录及读回器修正：5fd0b46→4445454、39e9b24→f345c7f、bcff0f2→82a1644。Root静态复核整合后的完整产品树与338一致，两份Python文件与准确39一致；未混入后继Q01窗口补全。

读回脚本原Git blob为 `0912a2271330d84d6fe1bb315165e907cfbfc8d6`，8589字节，SHA256为 `7b927e233725cb6a1be4c7bd81813df1f169c17a661176116c35488a32f0b7a0`；反例文件blob为 `521c55e8d3ee5349c9b20ea1cea5e17431af748c`，16430字节，SHA256为 `466dd2dad8dfb953d859555d8b77c18d55c8d05a34e6c06105e2dcbcb32dc82a`。VM只提取这两个原始Buffer，不切换产品源码。

## Windows实际结果

| 阶段 | 原结果 |
| --- | --- |
| 固定338准备 | 类型通过；八文件363项通过／0失败／0跳过，新构建成功；CLI13552 exit0、111.659秒，66份封存通过 |
| 独立GUI | CLI16440 exit0、17.183秒；1通过／0失败／0跳过／零重试，原120秒；52个布局／行序附件、原一查询两导出三完成任务和正常owner／观察流收尾通过，112份封存通过 |
| 准确39的Windows合成反例 | Python10404 exit0，实际21项中20通过／0失败／1跳过；唯一跳过为原符号链接创建权限用例，不改门槛 |
| 原四行独立读回 | Python13820 exit0、0.358072秒；4行8列、JSON18字符串／11NULL／3二进制，stableRead=true，383／827字节及原两SHA准确 |
| 固定338完整Vitest | Node12760 exit0、305.3707793秒；实际591文件11389通过／0失败／1跳过，stderr为空 |

完整回归唯一跳过为 `query-file-source-mode-posix.test.ts` 的“POSIX真实自有文件在严格umask下关联替换后逐位保留0664”。实际命令为 `node node_modules/vitest/vitest.mjs run --reporter=json`，原worker、配置和超时未改；所有检查子进程移除全部大小写形式的DBARK环境变量，父RAM保持。

full原CLI创建于北京时间2026-10-21 09:38:37.9715616，来自退出前保留的原.NET句柄；原控制器14940、launcher3472、观察器9132、监督器13080，ready及首CIM先于正式CLI启动。原CLI stdout为4250252字节，SHA256 `548679454d44cab8551e80671354faaccd74c25e56e7804d3d0093c5e33e8a4f`；独立stderr为0字节，SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`。

原读回／full目录为 `C:\Users\tester\Documents\Codex\2026-10-20\hi\outputs\query-result-sort-case-readback-v2-39e9b24-vm-20261021`；full原字节文件为其 `full/full-original.json`、`full/full-stderr.log`。Root读取了VM原监督记录及阶段回报，没有下载复算这些VM原件。GUI和准备的各原件摘要见[窗口记录](../../docs/testing/query-result-sort-case-grid.md)。

## 已核收尾与最终封存

VM最终只读核对已回报通过：source574／tests1306／dist109、Git、七套旧封存及原两文件七字段／长度／SHA均未变；本例已记录的192个PID候选按原身份终核零匹配，所有阶段角色exit0，RAM目标／凭据／准确UUID三项保留。旧封存数量分别为24／17／31／64／66／112／63。

main交付时VM正在汇总封存且远程连接不可用，当时只确认阶段及资源终核通过。恢复后Root续读原回合 `01a15c0b-2072-7652-b387-95cb6878758f` 的completed终态：209份封存逐项SHA校验通过、无不匹配；解释器为Python3.12.14，20个阶段角色的原身份／退出记录已保存。本轮全部按授权各执行一次，没有重跑、清洗通道或转回开发机测试。

以下原件位于同一新代次根目录，摘要来自VM终态回报，Root未下载复算或重签：

| 原件 | SHA256 |
| --- | --- |
| readback-v2-full-report.json | `e4ac263bddca3a684f680291e4a7602b980f8fe1a6d139a0fa02d9783f17eb93` |
| SHA256SUMS.txt | `7317a4c41983af4ea63f64b740a2f37067a014577b1d5181c1c31a7a479dbcb0` |
| reader/python-stdout.json | `035dc9789e6ca5cfe3898bf93a5b18c5e1f181c91e349f2c1d8196c97e181257` |
| all-stage-role-identities-and-exits.json | `2b6c5f3350a855914207b8180bfe1161f0f0d2c4b9f72e180d4aea05b020ab4f` |

版本进程13696、合成10404、回读13820和full12760均原生exit0；完整角色身份及时间以原封存为准，不将当前PID反查或展示时间舍入回填为历史精度。原两文件仍为383／827字节及原摘要，既有失败和unknown不改判。

## 旧失败及范围

- 准确49脚本首次Windows读回exit1，具体lstat／fstat差异字段未知；混入VoidTaskResult的通道及误标executable字段原样保留，不能用新成功回填。该轮63份封存及摘要见[读回记录](../../docs/testing/query-result-sort-case-readback.md)。
- 原7f视口254小于264失败、最初1f8排序规则冲突与资源unknown均保留；后继使用完整虚拟滚动读取，不将可见子集当全七行。
- 本批是Windows源码及200／13384常量SELECT、原CSV／JSON的证据，不是安装包、macOS私网或系统剪贴板验收。main新CI另行跟踪；原历史平台结果不外推。
- Q01后继代码另留开发分支。Navicat完整工作包及公开发行计数不增加，暂不创建标签或发布版本。
