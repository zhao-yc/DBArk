# 0.28 Windows x64 源码、真实安装与归档闭环

## 固定身份与结论

本记录核准原 [run39244695054/job118033672863](https://github.com/zhao-yc/DBArk/actions/runs/39244695054/job/118033672863)，attempt1、准确测试头 `4a2bcd423a26f5fe6fe094ee30656a58fb7d3035`。原 job 已结束成功；真实安装步骤结束于 `2026-10-19T11:50:17Z`（北京时间19:50:17）。运行环境为 GitHub-hosted Windows Server 2025 x64、Node24.21.0、Electron44.7.0、Playwright1.64.0。

产品仍冻结于 `bf08645a28fceb5d1d40ba16f013bb78e7a7c0a2`，版本0.28.0：src tree `20ff372f4cbc5c466e79d847afda2cb57f55426e`、package.json blob `3ff5c4d3b652bb0cc8de0e2584c26119869792da`、锁文件 blob `f4e286fab9eb730c5f4880d6cb08fead0bf8e608`。接班与本次回读提交均未改变这三项。锁文件字节 SHA256 为 `d66b7a695028dd27ef2610a526dfbabcf5a366fea423b25b17f518bad67c15ce`。

原源码和真实安装分别完成缩进1例、分栏1例、LF/CRLF×按钮/格式化快捷键4例，各6例零失败、零跳过、零重试；两阶段共24个原 owner 正常退出。普通 legacy 回归源码和安装各76通过、313条件跳过，包含组件层。关键字大小写、系统保存快捷键及实库缺项仍按下述边界记录。本版尚未公开发行。

## 独立归档接收与资产

本机 Node 下载遇 DNS 失败，未声称本机 ZIP 校验成功。沿既有只读 CI 通道，[回读run39250949911/job118054308810](https://github.com/zhao-yc/DBArk/actions/runs/39250949911/job/118054308810) 在固定回读头 `f30c2aaad0cc49cfdfe7e0cf7aa4d1f3fedb3e23` 独立接收原两个 ZIP：实际字节数、SHA256及全部成员 CRC 逐一通过。校验宿主是 GitHub-hosted Ubuntu；没有访问旧 VM、启动归档程序或清理旧资源。

| 原artifact | 字节 | 独立接收ZIP SHA256 | 成员CRC |
| --- | --- | --- | --- |
| [12184037042 测试证据](https://github.com/zhao-yc/DBArk/actions/runs/39244695054/artifacts/12184037042) | 5340007 | `d7eb06a765753b584d8e77a21dd4a42a40439338fc65892fafe95d3bfb435176` | 137个文件全部匹配 |
| [12184231827 未签名候选](https://github.com/zhao-yc/DBArk/actions/runs/39244695054/artifacts/12184231827) | 142818435 | `066ec0ed921c59168800161d85d3e0cf6c0bcbe814069d1cf9d3df315b88746f` | 2个文件全部匹配 |

| 候选原文件 | 字节 | SHA256 |
| --- | --- | --- |
| DBArk-0.28.0-win-x64-unsigned.exe | 142664620 | `9b98642db34cee99453e671e23f78af11821ae6314e51fbd39ffc718754d62fe` |
| DBArk-0.28.0-win-x64-unsigned.exe.blockmap | 149494 | `ba3f6dd08518c65085a49e0fb7ac3b21ed87defcc65cca30d4429a5b8ea9a5b4` |

回读副本 [artifact12186075522](https://github.com/zhao-yc/DBArk/actions/runs/39250949911/artifacts/12186075522) 留存原ZIP、解包文件与接收回执：296343560字节，上传API digest `2c337818eb077ca1a7be1f13d0bcfd5e91ba959dc8f70ba58fb2a6727d592c0a`。此副本本身仅有上传摘要，不冒称再次独立下载验证。原候选及证据14天保留期，原件到期为2026-11-02约11:50 UTC；副本约12:18 UTC，不是公开Release的永久资产。

结构化可审资产清单见 [Windows资产清单](../../docs/releases/v0.28.0-windows-assets.json)。API digest与独立下载摘要在清单中分别记录。

## 批准、安装输入与原专项报告

源码批准 SHA256 `76f18838b0269daf103e9d3d40f718575f029bc751c23ed413082c2de6dc9385`；两个源码manifest同字节，SHA256 `8bed67d2069fa4a2f64ff3dcd32e7b9ac424e9c45ee3f3428f1f2463e85157a5`，各113文件。安装批准 SHA256 `486a3828ea9753a7cb2a3b6a3d60e7c82c3366aa3686311a0fa5a0dafd798e45`；两个安装manifest同字节，SHA256 `37dc01fa8a68bce958d67789356765bfe09932c05d3eaef09d00d90de548a2d6`，各119文件。

安装前 `package-input.json` SHA256 `1f5276b9a59fff70479a3ee9838a7ce857babe964abb872e2e57cbcb3ff66bf9`，明确引用同次源码批准，封存原安装器摘要及win-unpacked参考。解包候选EXE摘要与其artifactHash一致，installed provenance继续绑定该摘要和源码批准。实际安装manifest与原未安装参考按应用内相对路径逐文件摘要一致；独立端口脚本单列。原实际入口为 `C:\\Users\\runneradmin\\AppData\\Local\\Temp\\dbark-package-e2e-AKXq6a\\Applications\\DBArk.exe`，并非安装器本身。

下表摘要全部取原归档字节；accepted分别绑定阶段、专项/四例、同次批准及准确report，原proof由现有严格校验函数完整消费。

| 原报告 | 通过/跳过 | report SHA256 | accepted SHA256 |
| --- | --- | --- | --- |
| source/indent | 1/0 | `ca3a62addde6cee3ff31276e3f41ca5bb4f21a6136bc3b32d726efb1011fea09` | `95bc5d3fb661af83bde849504cb8813e3d41f2e7823f29c1430bfcb75bb5e548` |
| source/layout | 1/0 | `64a43e6f5bf048b7f7b8fe8d2434e7f9cb6c836998fb80ce0d71e5e247d87500` | `65ba150ab87c92de6cf285dcdc7dda0c6c9c748252d860c3104233bddbdf9d86` |
| source/首次文件四例 | 4/0 | `fce7a2574df09864dcac5cbf42d6400585e050625ecbd659544ca4f2f32bc096` | `72b0ef5f4bbd58c1888f2e7e04f0c03f4b2c4074ea47c9e7e98e12a84ca27d1e` |
| installed/indent | 1/0 | `36e39a8b6f143befd742ee37a38d09b923e7322309fdbfeec360994c9485bedd` | `117272e4b316cbee5e35a1a78cc95ef8b775185c9a67a185f96f33737f56ced7` |
| installed/layout | 1/0 | `3ed898b5868afe347109e44086d0edd1b14aefaec2ee791f1d9239ec55d295ec` | `6259569801f6ae32cf10bfe0b1c4d5301ef17c0957d6cda27ca225759a601ce3` |
| installed/首次文件四例 | 4/0 | `daf2fa25290fb98a88736a2736cf92f7f1e28b0606cab13dde7430358659aa4a` | `d790cb008cdb983db49e623f8e0126b1d2f44cab3c5916549cb49bb08fa362b6` |

缩进原用例在首个实例退出后只读核schema9、偏好与活动标签，再独立重启核Monaco选项、正文和原模型；分栏核真实鼠标/键盘、缩窗不改偏好、schema9与独立重启。原1400×1000/480、稳定、最大值与退出断言保持，Windows不再执行仅适用于darwin的居中修正。

四例各消费八个原模型见证、原文件创建链、普通编辑一次Undo clean、格式化Undo/Redo及独立重启clean，LF/CRLF和原文件身份/字节均绑定。每个专项/四例身份均有两个 `confirmed/willQuit/closed=true` owner，记录PID数分别6、5；原fixture退出/PID门通过，资料目录删除完成。没有在回读阶段补读SQLite、调用SDK或重新枚举旧PID，也不把这些PID数量写成独立整机进程审计。专项SQL执行和系统剪贴板均为0。

## 普通回归与未验边界

原命令依次为 `node scripts/native-editor-ci.mjs source`、`node scripts/native-file-first-model-ci.mjs source`、`pnpm exec playwright test --output=test-results/legacy-source`、`pnpm exec electron-builder --win --x64 --publish never`、`pnpm test:packaged`。installed两专项和首次文件四例由原test-packaged入口执行，沿同一installed批准。

原legacy源码76通过/313跳过（7.3分钟），installed76通过/313跳过（6.9分钟）。两阶段389个登记用例的文件、行号、序号与状态逐项一致。下表覆盖全部129个spec，每格是**每一阶段**的实际计数；111个spec存在条件跳过。不能将76项称作76条安装产品路径；也不能把legacy中跳过的缩进/分栏/四例替换成通过。它们的实际通过身份来自上面的独立专项报告。

- 本轮关键字大小写两项均跳过；旧Windows源码检查点不代替本冻结候选，当前源码/安装专项及macOS仍待补。
- 系统Ctrl+S一项、页面Ctrl+S一项及原生文件相关门均条件跳过。Windows源码系统输入的已有单独实证继续有效；**本轮不证明安装版系统Ctrl+S**，格式化快捷键不代表系统保存。
- 宏观通过不证明实库、TLS/SSH、完整INSERT/CSV GUI、其它数据库版本或百万行；这些门在本轮仍有跳过。
- macOS arm64安装、x64源码/安装及真实系统Cmd+S均不由Windows证明。
- 本机CIM权限受限，只接受原fixture与原安装清理日志的证明，不声称已独立审计整机进程。

<details>
<summary>原legacy全部spec计数（源码与安装各自相同）</summary>

| spec | 通过 | 条件跳过 |
| --- | --- | --- |
| `binary-cell-live.spec.ts` | 0 | 6 |
| `binary-cell-offline.spec.ts` | 7 | 0 |
| `c02-mtls-live.spec.ts` | 0 | 2 |
| `c02-ssh-live.spec.ts` | 0 | 1 |
| `column-collation-installed.spec.ts` | 0 | 1 |
| `connection-replacement.spec.ts` | 0 | 3 |
| `connection-transfer.spec.ts` | 6 | 1 |
| `copy-insert-sql.spec.ts` | 0 | 1 |
| `csv-export-fields.spec.ts` | 0 | 1 |
| `data-search.spec.ts` | 1 | 6 |
| `data-type-colors.spec.ts` | 0 | 2 |
| `database-create.spec.ts` | 0 | 1 |
| `definition-navigation.spec.ts` | 0 | 1 |
| `definition-search.spec.ts` | 1 | 2 |
| `desktop.spec.ts` | 7 | 0 |
| `draft-history.spec.ts` | 0 | 2 |
| `editor-font-preferences.spec.ts` | 1 | 0 |
| `editor-indentation-native.spec.ts` | 0 | 1 |
| `excel-transfer-live.spec.ts` | 0 | 1 |
| `excel-transfer.spec.ts` | 1 | 0 |
| `explain-plan-state-live.spec.ts` | 0 | 1 |
| `explain-plan-state.spec.ts` | 0 | 1 |
| `explain-view.spec.ts` | 1 | 0 |
| `history-pages.spec.ts` | 4 | 0 |
| `history-time-filter.spec.ts` | 0 | 1 |
| `live-database.spec.ts` | 0 | 2 |
| `live-objects.spec.ts` | 0 | 1 |
| `live-table-scale.spec.ts` | 0 | 2 |
| `page-capture-live.spec.ts` | 0 | 3 |
| `page-find-replace-live.spec.ts` | 0 | 2 |
| `page-find-replace-native-late.spec.ts` | 0 | 8 |
| `page-find-replace-offline.spec.ts` | 5 | 0 |
| `page-find-worker-built.spec.ts` | 1 | 0 |
| `paste-insert.spec.ts` | 0 | 3 |
| `query-binary-types-offline.spec.ts` | 0 | 2 |
| `query-binding-live.spec.ts` | 0 | 2 |
| `query-binding.spec.ts` | 2 | 0 |
| `query-close-others-native.spec.ts` | 2 | 0 |
| `query-context-durability.spec.ts` | 0 | 1 |
| `query-context.spec.ts` | 0 | 3 |
| `query-current-statement.spec.ts` | 0 | 5 |
| `query-duplicate-native.spec.ts` | 1 | 0 |
| `query-explain.spec.ts` | 0 | 1 |
| `query-file-first-model-native.spec.ts` | 0 | 4 |
| `query-file-shortcut-native.spec.ts` | 0 | 1 |
| `query-file-system-shortcut-native.spec.ts` | 0 | 1 |
| `query-files-native.spec.ts` | 0 | 2 |
| `query-files.spec.ts` | 4 | 0 |
| `query-format-eol-native.spec.ts` | 0 | 2 |
| `query-format-selection.spec.ts` | 0 | 4 |
| `query-insert-ui.spec.ts` | 0 | 2 |
| `query-layout-native.spec.ts` | 0 | 1 |
| `query-parameters.spec.ts` | 0 | 4 |
| `query-result-columns.spec.ts` | 0 | 1 |
| `query-result-types-live.spec.ts` | 0 | 1 |
| `query-results-export.spec.ts` | 0 | 4 |
| `query-row-details.spec.ts` | 0 | 1 |
| `query-save-close.spec.ts` | 0 | 4 |
| `query-selected-results-export.spec.ts` | 0 | 2 |
| `query-stream-export.spec.ts` | 0 | 9 |
| `query-stream-million.spec.ts` | 0 | 2 |
| `record-cross-page.spec.ts` | 0 | 10 |
| `record-input-guards-offline.spec.ts` | 0 | 10 |
| `references.spec.ts` | 0 | 5 |
| `saved-query-navigation.spec.ts` | 4 | 0 |
| `saved-query-pages.spec.ts` | 4 | 1 |
| `saved-query-search.spec.ts` | 5 | 1 |
| `schema-compare.spec.ts` | 6 | 0 |
| `schemaCompareResults.spec.ts` | 0 | 1 |
| `server-monitor.spec.ts` | 0 | 1 |
| `session-objects.spec.ts` | 0 | 7 |
| `sidebar-async-state.spec.ts` | 0 | 5 |
| `snippets.spec.ts` | 1 | 0 |
| `sql-completion-call-routines.spec.ts` | 0 | 2 |
| `sql-completion-insert-row-alias.spec.ts` | 0 | 1 |
| `sql-completion-lateral.spec.ts` | 0 | 1 |
| `sql-completion-named-window.spec.ts` | 0 | 2 |
| `sql-completion-window-inheritance.spec.ts` | 0 | 5 |
| `sql-completion-window.spec.ts` | 3 | 1 |
| `sql-completion.spec.ts` | 2 | 7 |
| `sql-keyword-case-native.spec.ts` | 0 | 2 |
| `structure-search.spec.ts` | 1 | 3 |
| `table-apply-receipts-live.spec.ts` | 0 | 2 |
| `table-apply-receipts-offline.spec.ts` | 0 | 2 |
| `table-auto-increment-legacy-019.spec.ts` | 0 | 3 |
| `table-auto-increment.spec.ts` | 0 | 3 |
| `table-batch-fill.spec.ts` | 0 | 2 |
| `table-column-add-on-update.spec.ts` | 0 | 3 |
| `table-column-on-update.spec.ts` | 0 | 3 |
| `table-column-patches.spec.ts` | 0 | 7 |
| `table-comment.spec.ts` | 0 | 2 |
| `table-copy-data.spec.ts` | 0 | 1 |
| `table-copy-generated.spec.ts` | 0 | 1 |
| `table-copy-structure-mysql80.spec.ts` | 0 | 1 |
| `table-copy-structure.spec.ts` | 0 | 1 |
| `table-create-column-order.spec.ts` | 0 | 1 |
| `table-create-empty-default.spec.ts` | 0 | 1 |
| `table-create-encoding.spec.ts` | 0 | 1 |
| `table-create-foreign-keys.spec.ts` | 0 | 1 |
| `table-create-mariadb1011.spec.ts` | 0 | 1 |
| `table-create-mariadb114.spec.ts` | 0 | 1 |
| `table-create-mysql57.spec.ts` | 0 | 1 |
| `table-create-mysql80.spec.ts` | 0 | 1 |
| `table-create-prefix.spec.ts` | 0 | 1 |
| `table-create.spec.ts` | 0 | 1 |
| `table-default-encoding.spec.ts` | 0 | 2 |
| `table-drop.spec.ts` | 0 | 1 |
| `table-foreign-key-patches.spec.ts` | 0 | 7 |
| `table-grid-preferences.spec.ts` | 0 | 7 |
| `table-index-patches.spec.ts` | 0 | 1 |
| `table-object-member-move-live.spec.ts` | 0 | 3 |
| `table-preferences.spec.ts` | 4 | 0 |
| `table-record-duplicate-batch.spec.ts` | 0 | 3 |
| `table-record-duplicate.spec.ts` | 0 | 5 |
| `table-record-input.spec.ts` | 0 | 9 |
| `table-record-node-input.spec.ts` | 0 | 8 |
| `table-record-projection-lifecycle.spec.ts` | 0 | 2 |
| `table-record-projections.spec.ts` | 0 | 7 |
| `table-record-structure-input.spec.ts` | 0 | 10 |
| `table-record-view-guards.spec.ts` | 0 | 6 |
| `table-record-views.spec.ts` | 0 | 7 |
| `table-rename.spec.ts` | 0 | 3 |
| `table-special-index-live.spec.ts` | 0 | 2 |
| `table-truncate.spec.ts` | 0 | 1 |
| `workbench-live.spec.ts` | 0 | 1 |
| `workbench-navigation.spec.ts` | 1 | 0 |
| `workbench-query-intent-live.spec.ts` | 0 | 1 |
| `workbench-query-intent.spec.ts` | 0 | 6 |
| `workbench.spec.ts` | 1 | 0 |
| 合计 | 76 | 313 |

</details>

完整389项原标题/状态已从原job日志逐行提取，本机归档为 `.cache/serial-evidence/windows-4a2-legacy-case-inventory.json`，SHA256 `18fe3467b3f084c12fe6af65df32a4f938b6ba6e082a91d176b22164d2a4a923`。它是解码日志的提取清单，不是另一次测试。

## 资源终态与失败保留

原安装脚本确认无既有DBArk后在独立临时根安装；全部专项和legacy成功后规范卸载、安装注册归零、临时根删除，原日志11:50:16.927Z明确“本次测试安装及临时目录已清理”。源码与installed各6例资料目录均由原footer确认清理。不因VM结束推断未知owner正常退出。

旧Windows失败run39242374243、原报告及未知owner边界继续保留，原分栏客户区1008×655失败不改判。本次仅新4a2成功运行的归档核准；没有重试或补清旧场景。新增回读首轮run39250731147在下载前因未建.cache父目录失败，原日志保留；修正输出目录后新job成功，不属于Windows原生重跑。

本机已接收回读摘要 `.cache/serial-evidence/windows-4a2-accepted.json` SHA256 `493e455ae7116e3e8593d63d3387cef3aad2105da3fb28739180ccf9f256e266`，归档成员清单 `72512ff720dd9884cba1c0eec589237ab0596c2ba41a49b5e62e7647c469d292`。本机保存的原job解码日志做了BOM/换行归一，SHA256 `94e94dd5cc8bb293f08795ca15fe4c4b3a39087af372681787ddc33722ec7cc0`；不称为GitHub原始日志下载字节摘要。

本轮交付只完成Windows已成功运行的证据落盘；后续按[固定验收矩阵](acceptance-v028-release-matrix-20261019.md)串行补缺，tag、Release与main仍由原统筹最终审核决定。
