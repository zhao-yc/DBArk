# 结果筛选文本条件：开发候选与虚拟机交接

## 固定身份与改动

- 仓库：`https://github.com/zhao-yc/DBArk.git`；普通克隆内分支 `codex/query-result-text-filter-20261020`，不用工作树。
- 基线：`915d3dcb3ee44731c1a703bdb04179754d027b45`；完整功能候选：`7c4b9daa29d9881c714131f307c3a139c1dea26f`，只改3份筛选源码／文案和2份原单元文件。
- 与片段JSON候选 `f173f41` 分开；不改QueryTab、ResultsGrid、IPC、驱动、依赖、锁文件、原生夹具或发布配置，不合并主分支，暂不发布。
- 新增不包含、开头／结尾及其否定、空文本／非空文本。正反文本条件均排除NULL；空格不等于空串，Unicode、大小写和通配符原样比较。详细规则见[功能说明](../query-result-filter.md)。
- 新增控制器语义、预算、漂移及真实QueryTab内存交互用例。固定7c4b9da已在WIN11-TEST完成类型、5文件201项定向测试及构建，入口退出0，总147.88秒（72.84／16.31／58.72秒）；原始输出含筛选64、排序36、多列19、含列名复制18、排序界面64项。同一候选的完整单元单次2-worker运行退出0，570文件全部通过、10905项通过、0失败、1平台跳过，400.89秒。新Electron／实库／安装尚未验收，基线的10869项和实库界面记录不能证明本增量。

## Windows测试迁移

仅由原开发会话编写产品和用例，WIN11-TEST串行执行Windows类型、单元、构建、GUI、安装和系统输入测试。原电脑不补跑；测试机不改产品、断言、依赖锁文件或新建helper／服务／框架。

协调会话在2026-10-20直接读取的最小接入终态：WIN11-TEST，普通克隆 `C:\Users\tester\Documents\Codex\2026-10-20\hi\work\DBArk`，分支 `codex/vm-test-setup-20261020`、基线915d3dc；Node24.19.0、pnpm12.11.2、Electron44.7.0。依赖572包安装退出0（115.98秒）；原 `check-local --build` 的 `local-check.test.ts` 和 `query-result-sort.test.ts` 为类型通过、2文件42项通过、构建通过，总143.45秒。原 `desktop.spec.ts` 的“桌面启动、存储、进程隔离与输入校验”实际1通过、零失败／跳过／重试、进程退出0，报告30149.447ms。首次带锚点grep未命中0项，修正选择并列表核1项后实际执行，原报告保留，未改spec、夹具、期限或门槛。

协调会话已独立读回最终报告并核准工作区干净、源码／锁文件／spec／fixture未改，原权限失败及未命中用例报告保留。原件目录 `C:\Users\tester\Documents\Codex\2026-10-20\hi\outputs\vm-test-setup-20261020`：

| 原件 | SHA256 |
| --- | --- |
| `vm-setup-resumed-result.json` | `4caefee4ffebcb85486785c803d36fe501e0db4773a7a79291db3f6d0cf1d6ff` |
| `desktop-playwright-corrected.json` | `30bde31d624242b6cf65d801be34754e793b1e4b1d604f6b51f08f317a6119ce` |
| `SHA256SUMS-resumed.txt` | `11c1e61ba244e4b44a245c4587aab755f048c25ffe6fcb496ef3ef46439b9dec` |

以上接入报告仅证明**最小基线**，本候选的定向结果另列于顶部，新原生步骤仍待验。远程会话现标题“dbark测试”，ID `01a156d5-b3bf-75f2-a9e8-1c8d1a55effc`，host为 `remote-control:env_e_6ad61bed56648326b45447a0681db5d0`；重连时若返回host切换或不可用，应重新核对同一任务实际位置，不能据此另起测试、重启进程或复制目录。须等当前接入任务与原报告收尾完成后再安排候选。实际Electron DIP尺寸未独立记录，不能由PNG像素推断；共享剪贴板隔离仍待确认。

## 顺序验证入口

先核远端、分支、工作区、当前运行任务及工具版本。只在干净且原验收已收尾后固定完整候选SHA；保留915和旧失败证据，不stash/reset、不覆盖dirty。复用本克隆已按原锁文件安装的依赖，不运行本机或虚拟机Docker，不复制原电脑凭据。

```powershell
node scripts/check-local.mjs --build tests/unit/query-result-filter.test.ts tests/unit/query-result-sort-ui.test.tsx tests/unit/query-result-header-copy-ui.test.tsx tests/unit/query-result-sort.test.ts tests/unit/query-result-multisort.test.ts
```

类型只执行一次；保留每阶段真实数量、退出码与耗时，不改断言、超时或并发来追求通过。定向通过后再运行同一完整集合，VM使用两个worker：

```powershell
node node_modules/vitest/vitest.mjs run --maxWorkers=2 --reporter=json --outputFile=.cache/query-result-text-filter-vm-full-unit.json
```

新增QueryTab用例仍使用RAM数据库端口和虚拟网格；证明边界只到真实组件与视图管线，不是原生窗口、真实数据库或系统剪贴板。新条件仍须实际Electron界面验收：同一查询返回非空、空串、NULL、空格、通配符文字和Unicode等不同原行；逐项选择新条件，核预览取消、AND／OR、空结果、输入禁用／恢复、随后多列排序及连续CSV／JSON原行顺序。须独立解析实际导出文件，确认未再次执行SQL或产生额外历史。沿用现有桌面／退出能力，不为测试增加宿主、helper或框架。

原生用例扩展另固定 `9e9812a1485d935d30674f6fe706d0a77c03c180`：只改原 `query-result-organize-live.ts`，新标题“准确13384真实App多列排序与七种文本筛选、空结果及CSV／JSON范围一致”。复用原SQL的CHAR编号和空文本列，逐项检查新增七条件、禁用的条件输入及清除，最后仍走原多列排序、连续CSV／JSON和独立文件核验。spec门、helper、常量SQL、目标、120秒期限、零重试、原退出夹具和文件期望不变；没有新helper／宿主／框架。该提交与7c4b9da的产品源码、单元、依赖、锁文件相同，已完成下述VM类型检查，live用例尚未运行；旧原生报告不能转记为新七条件通过。Unicode、空白和文本NULL等扩展原生组合仍单列待验。

本批不授予额外数据库权限或凭据迁移。若需要200实库，先确认VM可用的已授权专用连接；Docker只在核对实际服务器身份后使用200，绝不使用VM本机Docker。系统键盘、剪贴板及共享剪贴板隔离、安装包、macOS和真实性能均另列，不能由最小启动或本批内存测试替代。

测试机回报机器、克隆、分支／完整SHA、实际命令／数量／耗时／退出码、报告路径和SHA256、工作区及原生资源收尾。失败保留原报告和所属现场，交回唯一开发会话修复，不原样重试或强制清理。

## 本候选实际虚拟机证据

原开发会话已通过测试机聊天直接读回实际命令终态、Vitest原始结果及文件校验输出。执行账号为 `WIN11-TEST\tester`，分支 `codex/vm-query-result-text-filter-test-20261020`，HEAD严格等于7c4b9da。完整集合只含 `tests/unit`，总10906项包括上述1项Windows不适用的POSIX严格umask用例；未修改该跳过条件。原始结果中 `testResults` 为570个文件，不能把包含describe层级的 `numTotalTestSuites=1301` 当成文件数。

原件目录 `C:\Users\tester\Documents\Codex\2026-10-20\hi\outputs\query-result-text-filter-vm-20261020`；完整报告源路径为克隆内 `.cache/query-result-text-filter-vm-full-unit.json`，原字节副本及摘要如下：

| 原件 | SHA256 |
| --- | --- |
| `candidate-result.json` | `a138c30b9dcb29495b1c27faead3ae6532acf3cc5fe4d5bd90c5310364591916` |
| `targeted-check.log` | `c6223926f78313f66d4aa4f694a633fab219ac11f4e87fc9525277a4602ec09f` |
| `full-unit-original.json` | `2ea77fb6e7c16a71f8cd0e17fe96d5eefab5bbe9c88644d735eaa9a207ea5b61` |
| `SHA256SUMS.txt` | `e8e3aed9e0b6fa5da04eba4010af5b45382e7729cdb0c1420e446654425ce5ab` |

测试机已核12份证据文件、工作区干净，原任务匹配进程及观察过的PID均无残留。构建依赖注释／大chunk提示保留，原退出码仍为0。这是Windows虚拟机的源码类型、单元和普通构建证据，未启动本候选GUI或实库，不替代9e9812a的新原生步骤、安装、系统输入／剪贴板、macOS或性能验收。

## 原生增量类型与连接盘点（9e9812a）

开发会话已直接读取“dbark测试”的完成报告：同一 `WIN11-TEST\tester`、同一普通克隆，测试分支 `codex/vm-query-result-native-preflight-20261020`，完整HEAD为9e9812a。15项受保护路径的Git对象与7c4b9da相同；Node24.19.0、pnpm12.11.2、TypeScript5.9.3，单次 `node node_modules/typescript/bin/tsc --noEmit` 退出0，36.99秒。测试机报告工作区干净、任务进程结束，无提交／推送；本次没有重跑单元或构建。

只读盘点显示该VM的进程／用户／系统环境均未配置本用例连接及显式运行门，三个可缺省项也未设置。Windows OpenSSH9.5p2存在，但标准用户和系统SSH配置文件不存在，未发现明确的 `server-200` 别名。没有尝试SSH登录、数据库、Docker或GUI，也未复制凭据；因此下一步先补齐该VM的已授权专用连接，配置存在本身仍不能视为身份、权限或真实界面通过。仅配置缺失不阻塞不依赖数据库的片段库验收。

本批报告目录为 `C:\Users\tester\Documents\Codex\2026-10-20\hi\outputs\query-result-text-filter-native-preflight-20261020`。完成报告列出 `native-preflight-result.json`、`typecheck-result.json` 和 `SHA256SUMS.txt`；完整结果SHA256为 `e7776aef8fd414b5b34eaf1e586199f018d39f9beb0b90739e94e59012e83c78`。该摘要来源为测试会话最终报告，原件尚未独立取回复算，不扩展为原生或实库证据。此后所有占用电脑的测试仍固定在本“dbark测试”会话，不转交其它测试聊天。
