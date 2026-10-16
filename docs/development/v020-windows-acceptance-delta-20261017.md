# 0.20 Windows安装验收差异清单（只读准备）

2026-10-17。观察源码及ROOT当前0.20构建候选为 `5abf435ff0af6136c31508bb72ac52ceedfa93ec`；最终发行范围仍待审定。本页是差异审阅材料，没有执行器、候选binding或安装命令，没有产生任何新的安装通过数。本轮没有运行list、单元、GUI、200、Docker、剪贴板或手动CI，也没有读取env、认证、密钥或数据库。

## 当前候选：已构建，未安装

以下由ROOT本次通报提供；员工4本轮未独立读取安装包、复算摘要或执行安装。固定候选身份不能外推为安装通过，也不能代表尚未合入的CALL范围。

| 项目 | ROOT通报 |
| --- | --- |
| 源码/版本 | `5abf435ff0af6136c31508bb72ac52ceedfa93ec` / 0.20 |
| 源码验证 | 完整5073项单元通过，unit/type/build退出0；run1065核1243源码、108 dist |
| Windows构建 | run1066真实构建退出0；NSIS **142040272字节** |
| NSIS SHA256 | `d19c6d461782a33a944c8da2187c6400a6b10eec32ec18527192e914ae281ad7` |
| ASAR SHA256 | `a243151791c752fbe8cfb1450ed03ec6ac0d5987565b6e5e0a576da01fe15cf0` |
| EXE SHA256 | `1ca10470599af83b2d68eb0fc73fb9c64b523b503b332dfadecc1478ddbd3cfc` |
| 当前安装验收 | **未安装，安装通过0项** |
| CALL范围 | 员工2作者提交 `94083d9` 正在推送，尚未ROOT合入；两项不属于本表5ab候选 |

## 原317项逻辑覆盖必须保留

以[0.19 Windows候选原件](../../tests/integration/acceptance-v019-windows-candidate-20261016.md)、[原生组件收尾](../../tests/integration/acceptance-v019-native-components-20261016.md)和[覆盖边界](../navicat-coverage.md)为来源。只读解析ROOT的 `.cache/parallel-integration/run912-v019-final-controls/root-bindings.json` 所指旧队列与证明，并核对各文件SHA：原303身份加单列14身份，去重后严格317；剩余261与同候选42并集等于原303。没有执行或改写这些控制。

| 原层级/固定profile | 不同身份 | 0.20保留要求 |
| --- | ---: | --- |
| 安装产品：离线 `installed_product_offline` | 69 | 保留全部逻辑覆盖及原断言，更名项显式映射；重新绑定最终安装身份 |
| 安装产品：13384 `installed_product_cp_13384` | 209 | 保留原版本、权限、事务和零资源边界 |
| 安装产品：D05限权 `installed_d05_permission_13384_only` | 1 | 原专门授权与临时账号/对象清理单列 |
| 安装产品：C02双向TLS / SSH | 2 / 1 | 仍沿原专门运行时、私料仅内存，不混入普通13384批 |
| 开发Electron组件 `development_fixture_offline` | 32 | 7字节编辑、8迟到替换、5离线替换、2查询字节、10记录输入；不改称安装产品 |
| 安装宿主源码组件 `installed_host_source_component` | 3 | `explain-plan-state`、`explain-view`、`workbench-navigation`各1；只证明安装宿主中的源码组件 |
| 合计 | **317 = 282安装产品 + 32开发 + 3宿主** | 旧通过仍归0.19；0.20逐层重新取证 |

原12组件的三平台重复不计36个功能；原Windows两项原生复制的覆盖授权已用完，本轮不能沿用。组件CI的原始空壳恢复也不证明当前本机或非空剪贴板可恢复。[公开0.19六项](../../tests/integration/acceptance-v019-public-20261016.md)与原317重叠，不另加6项。

已发现一个需要明确保留原逻辑覆盖的合法更名：`table-preferences.spec.ts` 的schema2→5旧迁移用例，在 `8256fee` 整合后为schema2→6并创建空回执表。旧完整caseKey仍保存在原317账本，0.20使用下表旧→新实际caseKey映射；**这一个caseKey确已改变，不声称字节相同，也不把旧、新标题各算一项**。原数据全字段断言保持，新增缺表迁移、回执表结构和空记录断言。其它循环/参数化标题需最终冻结后由授权的真实list逐项核对；源码里没有完整字面标题，不能据此判定用例已删除。

| 映射 | 完整caseKey |
| --- | --- |
| 原317保留身份 | `["tests/e2e/table-preferences.spec.ts",["table-preferences.spec.ts","真实 schema2 配置启动迁移至 schema5，既有查询片段设置原样保留"],""]` |
| 0.20已审实际标题 | `["tests/e2e/table-preferences.spec.ts",["table-preferences.spec.ts","真实 schema2 配置启动迁移至 schema6，既有查询片段设置原样保留并创建空回执表"],""]` |

## 已存在的20条新增定义

下表层级来自真实启动路径，不来自文件名。除回执离线文件外，均复用 `desktop-fixture.ts:52` 的 `DBARK_EXECUTABLE_PATH`，具备后续绑定真实安装EXE的路径。该事实目前只支持安装候选分层，不代表实际安装通过。完整静态caseKey见文末；20条与原317的caseKey交集为0，但**20不是最终安装增量，当前不确认337总计划**。CALL两项的作者提交94083d9尚未ROOT合入5ab，未纳入本次固定源码及完整caseKey核对，本页不虚构或计入。

| 范围及真实文件（tests/e2e/） | 条数 / 建议层级 | 200组合 | 系统剪贴板实际路径 | 门及既有证据 |
| --- | --- | --- | --- | --- |
| C03 `connection-replacement.spec.ts` | 3 / 安装产品候选 | 无；仅合成 `.invalid` 概要 | 读0 / 写0 | `DBARK_E2E`、`DBARK_C03_REPLACE_UI`；120秒。源码run990已过3，未连接合成目标 |
| D08 `data-type-colors.spec.ts` | 2 / 安装产品候选 | 第一例离线；第二例建议原13384批 | 读0 / 写0 | `DBARK_E2E`、`DBARK_D08_TYPE_COLORS_UI`；第二例另需integration；150秒。源码run990已过2 |
| D02 `paste-insert.spec.ts` | 3 / 安装产品候选 | 明确限定200/13384 | 读0 / 写0；手填或合成DataTransfer/ClipboardEvent | integration、`DBARK_D02_PASTE_INSERT_UI`；120秒。源码run990已过3，不能称原生系统paste |
| Q03 `query-save-close.spec.ts` | 4 / 安装产品候选 | 无；离线来源及CAS | 读0 / 写0；键盘insertText | `DBARK_E2E`、`DBARK_Q03_SAVE_CLOSE_UI`；原默认45秒。源码run1044已过4 |
| D02 `draft-history.spec.ts` | 2 / 安装产品候选 | 明确限定200/13384 | 读0 / 写0；仅手填批量草稿入口，不调用系统剪贴板 | integration、`DBARK_D02_DRAFT_HISTORY_UI`；120秒。源码run1044已过2 |
| D08 `table-apply-receipts-offline.spec.ts` | 2 / **开发Electron暂列** | 无 | 读0 / 写0 | `DBARK_TABLE_APPLY_RECEIPTS_UI`；45秒。源码run1051已过2；文件直接require Electron并启动dist，**不读取安装EXE入口** |
| D08 `table-apply-receipts-live.spec.ts` | 2 / 安装产品候选 | **仅200/13384明文MySQL8.4**，前置及种子前核新鲜UUID | 读0 / 写0 | integration、`DBARK_D08_RECEIPT_LIVE_UI`、本轮独占run及UUID；180秒、零retry。源码run1051已过2，含真实提交/重启/冲突回滚 |
| Q01 `sql-completion-named-window.spec.ts` | 2 / 安装产品候选 | 定义支持原六组合；5.7走能力否定断言，不能当skip | **读实际系统全部可读格式及纯文本 / 写0** | integration、`DBARK_Q01_NAMED_WINDOW_UI`；150秒。正式专项尚无实际GUI验收证据；旧窗口字段CI不能替代此两项 |

命名窗口调用 `monaco-caret.ts:89`、`:125` 的光标助手：前后物化、比较实际系统剪贴板，只在内存保存且不写回。它不是零剪贴板访问，也不是新的原生paste/write授权。其余表内用例及所用live查询输入助手没有调用该路径。

六组合沿既有[Q01矩阵](../../tests/integration/acceptance-q01-release-candidate-20261015.md)：200的13357/MySQL5.7.44、13380/MySQL8.0.46、13384/MySQL8.4.11、13310/MariaDB10.11.19、13311/MariaDB11.4.13及13484/MySQL8.4.11严格TLS；这些是旧证据里的版本，未来实跑须重新核主机、实例、版本及TLS身份，不能当作当前已探测事实。两条caseKey跑六组合是12个执行组合，不能变成12条新case。颜色、粘贴、Undo和回执本批已验仅13384，不能自动扩到其它五组合；回执文件还明确拒绝TLS目标。

当前20条中，18条可进入后续真实安装产品候选层，另2条回执离线暂留开发层，新增宿主组件0条。如果要把离线回执两条计入安装产品，需要先审阅其启动入口的最小适配并重做真实安装取证；此处没有修改夹具。即便未来通过，也不能把开发启动结果重新标成安装结果。

## 建议执行次序与授权边界

1. **先冻结再排队。** ROOT审定最终0.20范围；若仍采用本页5ab候选，须沿run1065/1066核对构建输入、dist、依赖解析、NSIS/EXE/ASAR及资源归属；若合入CALL后重建，则使用新头和新构建身份，不能沿用5ab包摘要。审阅CALL实际交付与上述迁移更名映射，再确认最终完整caseKey集合及层级。不要按317+20生成队列，也不要将尚未纳入候选的源码绑定给旧包。
2. **复用原控制的可审逻辑。** 保留单worker、原期限、零重试、先list后实际、完整file/titlePath/projectName核对、每例单次passed、原退出先落盘、失败不自动重跑、安装前后摘要/输入/依赖核对、归属临时目录及卸载/六实例核零。run912固定了0.19头、版本、摘要、261/65批及旧候选，不能原样执行或只改版本字符串；未来仅在已审骨架上做新版本的显式窄适配。
3. **先安排无剪贴板的离线安装批。** 在本轮安装/独占窗口及临时用户目录操作获准后，复用原离线产品队列，插入C03三条、颜色离线一条、Q03四条；保留原317中的迁移覆盖。不要把原42/261历史passed从0.20计划扣除。回执离线两条先按开发层保留，或在完成上述启动适配后再由ROOT决定产品层归属。
4. **再做13384普通实库及写入闭环。** 本轮ROOT核200主机、实例、只限随机隔离对象的认证与清理后，复用原13384运行时安排颜色实库、paste和Undo；再单列回执两条，明确实际CUD、并发改第二行及真实退出重启授权，保持run/UUID硬门。库表种子和清理不等于额外业务权限或Docker授权。ACK丢失、ROLLBACK回应丢失、最终回执写盘失败仍是未验故障，不混入这两条。
5. **Q01与特殊权限单列。** 命名窗口先经本轮系统剪贴板只读采集许可及独占窗口安排，建议先13384正例，再13357否定，最后其余组合和严格TLS；保留版本能力事实及零自动执行断言。原C02、D05仍沿专用权限/材料运行时，不读取或复制私料到新框架。
6. **开发/宿主和原生剪贴板分层收尾。** 原32开发、3宿主及暂列的回执离线用例分别留账。原两项原生复制、32开发组件内实际系统剪贴板读写/恢复的项目，须重新核本轮覆盖或严格恢复授权与可验证的恢复范围，不能凭旧run970/CI空壳事实启动。任何未授权项保留完整身份和待验原因，不能删项、条件跳过冒充通过或降低集合要求。

授权开关只是代码门，不自行构成运行许可。本轮仅获得只读准备授权，所有后续安装、GUI、200、系统剪贴板读/写、特殊权限和故障实际均未在此执行或扩权。

## 旧控制指纹与本轮核对

只读来源为ROOT `.cache/parallel-integration/run912-v019-final-controls/`，六份文件前后SHA保持。核心三项如下；不复制或提交可执行控制、bindings、私有报告或认证。

| 旧控制 | SHA256 |
| --- | --- |
| `run-v019-remaining-root.mjs` | `8f83ce976137d7b443e3d5b398742662d98eb847a30bb2876b93f4d002ce84be` |
| `v019-install-queue-adapter.mjs` | `833048b565546e7a136f4a49dd4d91b7f79e847e7b2332c50b5555bf786d7229` |
| `v019-install-runtime-adapter.mjs` | `4448b79384f0899ccec89a281bf383de30b0d23865497e6d0c4dfe0b2d4a6c1f` |

本轮只读核对材料保存在员工4克隆 `.cache/v020-windows-plan-diff-20261017/`：`original317-readonly.json`保留全部原身份，`new20-static-casekeys.json`记录真实文件/行号/源码SHA与静态身份，`inventory-proof.json`记录旧控制和来源摘要。静态抽取不替代最终真实list，更不证明安装通过；没有读取私有env/密钥/认证或当前系统剪贴板。

## 新增完整caseKey（静态审阅，非执行绑定）

格式严格为 `[file,[文件suite标题,完整用例标题],projectName]`，此八文件均为顶层test、无额外describe，原配置项目名为空。以下只记录已存在20条；最终真实list仍须复核文件/titlePath/projectName，CALL不得填占位身份。

```jsonl
["tests/e2e/connection-replacement.spec.ts",["connection-replacement.spec.ts","C03明确选择旧→新目标、风险未齐不可提交，替换后保留ID而清凭据且不连接"],""]
["tests/e2e/connection-replacement.spec.ts",["connection-replacement.spec.ts","C03目标A→B→A重新选择清除全部确认，不复活旧审阅"],""]
["tests/e2e/connection-replacement.spec.ts",["connection-replacement.spec.ts","C03确认后主进程配置修订变化令CAS失败，旧目标和合成凭据保持且不重试"],""]
["tests/e2e/data-type-colors.spec.ts",["data-type-colors.spec.ts","D08默认关闭、六类图例、暗亮切换和重启恢复及单项重置"],""]
["tests/e2e/data-type-colors.spec.ts",["data-type-colors.spec.ts","D08真实表格与只读SQL的可靠类别一致，文本不猜类型，选择和原值保持"],""]
["tests/e2e/paste-insert.spec.ts",["paste-insert.spec.ts","批量新增：空表手工文本先有界预览再暂存，外部NULL为文字且零自动写入"],""]
["tests/e2e/paste-insert.spec.ts",["paste-insert.spec.ts","批量新增：合成paste事件保留typed NULL/字节/JSON原文，未声称系统原生剪贴板验收"],""]
["tests/e2e/paste-insert.spec.ts",["paste-insert.spec.ts","批量新增：1001行整批拒绝，关闭及未知typed不复用旧预览，既有草稿保留"],""]
["tests/e2e/query-save-close.spec.ts",["query-save-close.spec.ts","关闭三选取消保留完整草稿，直接关闭零查询写入"],""]
["tests/e2e/query-save-close.spec.ts",["query-save-close.spec.ts","绑定来源保存后关闭保持ID，完整精度正文落库"],""]
["tests/e2e/query-save-close.spec.ts",["query-save-close.spec.ts","关闭保存遇到旧摘要保留草稿，明确另存后才关闭且不覆盖来源"],""]
["tests/e2e/query-save-close.spec.ts",["query-save-close.spec.ts","未绑定草稿从新建查询进入，另存后仅关闭该标签"],""]
["tests/e2e/draft-history.spec.ts",["draft-history.spec.ts","本页草稿：一次单格编辑可撤销重做，编辑输入期间禁用页面历史"],""]
["tests/e2e/draft-history.spec.ts",["draft-history.spec.ts","本页草稿：单行与批量新增各为一步，重做不提交数据库"],""]
["tests/e2e/table-apply-receipts-offline.spec.ts",["table-apply-receipts-offline.spec.ts","离线任务中心可打开空提交记录及返回任务，页面明确隐私和范围"],""]
["tests/e2e/table-apply-receipts-offline.spec.ts",["table-apply-receipts-offline.spec.ts","renderer不能借只读详情接口注入已提交标签，不产生任务或记录"],""]
["tests/e2e/table-apply-receipts-live.spec.ts",["table-apply-receipts-live.spec.ts","网格CUD精确值与匹配行单次提交，关闭表及真实重启后任务中心保留同一回执"],""]
["tests/e2e/table-apply-receipts-live.spec.ts",["table-apply-receipts-live.spec.ts","第二行原值冲突使第一条修改真实回滚，回执保留确认事实且Undo不能重做重放"],""]
["tests/e2e/sql-completion-named-window.spec.ts",["sql-completion-named-window.spec.ts","窗口名称完整插入和撤销零自动执行，MySQL5.7明确能力阻断"],""]
["tests/e2e/sql-completion-named-window.spec.ts",["sql-completion-named-window.spec.ts","内层与UNION不借父或兄弟窗口，重复循环和不完整定义真实阻断"],""]
```
