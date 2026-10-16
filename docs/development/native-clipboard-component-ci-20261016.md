# 可选的离线开发组件原生剪贴板 CI

初版 `9205de93b4d707b1d0810cc89a92c9c7afcf70a4` 基于 `c07939a` 增加可选入口。本次修正从9205另建普通分支，保留其源码及首次CI失败记录，只修reporter参数引用、两个fixture的空壳比较和安全诊断，并增加纯回归。原 `c07939a` 产品验收头、0.18版本、产品、测试正文、依赖、安装脚本、权限和发布门保持。

`.github/workflows/ci.yml` 的 `workflow_dispatch` 新增布尔输入 `native_clipboard_components`，默认 `false`。只有手动运行且明确勾选时，独立 `native-clipboard-components` job 才运行。三个 runner 与现有原生矩阵相同：Windows x64、macOS arm64、macOS x64；没有 self-hosted runner，不使用管理员工作站或用户当前电脑。

ROOT 审核固定提交后，可在原“客户端检查与构建”工作流选择此分支，勾选该输入并手动运行。本员工不触发 CI。`workflow_dispatch` 需要工作流在默认分支注册；可以选择其他 ref 运行，参见 [GitHub 官方手动工作流说明](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)。使用保留布尔类型的 `inputs` 条件，参见 [GitHub 官方工作流语法](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onworkflow_dispatchinputs)。

每个平台仅执行现有两文件：

| 文件 | 数量 | 身份 |
| --- | ---: | --- |
| `tests/e2e/query-binary-types-offline.spec.ts` | 2 | 独立开发 Electron 中的查询结果类型组件 |
| `tests/e2e/record-input-guards-offline.spec.ts` | 10 | 独立开发 Electron 中的记录输入组件 |

公开离线命令：

```text
pnpm exec playwright test tests/e2e/query-binary-types-offline.spec.ts tests/e2e/record-input-guards-offline.spec.ts --workers=1 --retries=0 --reporter="list,json"
```

补充 job 始终设置 `DBARK_INTEGRATION_ENABLED=0`。仅上述测试步骤显式设置 `DBARK_QUERY_BINARY_NATIVE_ENABLED=1` 与 `DBARK_RECORD_INPUT_NATIVE_ENABLED=1`；每个平台使用一个 worker、零重试，job 上限30分钟，原用例期限不变。两夹具自行建立回环 Vite、独立临时用户目录和开发 Electron 沙箱窗口，不加载产品主进程或数据库，因而无需新增构建/打包/安装步骤。

两个文件都硬编码启动自己的 fixture `.cjs`，不会因 `DBARK_EXECUTABLE_PATH` 而改为安装产品。因此这12项始终计为“开发 Electron 组件”；即使未来在源码或 installed-host 阶段启用，也不能计成12项安装产品。三个平台各有12项结果，不把它们当作36个不同功能。现有 packaged 脚本只固定私网门为0，本次不改其生命周期、私网策略或环境；新开关不注入原 desktop 的源码或安装阶段。

默认 push、PR、tag、未勾选的手动运行仍沿用原行为。原 `checks`、`desktop`、`release` job、权限、并发和发布依赖不变。勾选时只额外增加三个补充 job，原任务仍按既有条件运行；“仅12项”指补充 job，不把两个开关注入原全套 E2E。补充记录使用独立 artifact 名 `开发组件原生剪贴板-<平台>`，只上传 `test-results/`，JSON报告位于 `test-results/native-clipboard-components/report.json`；不匹配原发行下载的 `DBArk-*` artifact，也不加入发行依赖。原测试失败不会因上传记录而变成成功，没有 continue-on-error。

本分支修改了 CI 文件，因此不冒充此前要求构建与CI也逐blob等于原80的产品桥接快照。ROOT 对补充 CI 结果按本分支实际 SHA 和 workflow run 归档，原 `c07939a` 的正式安装结果另行保留。

ROOT首次实际运行 [CI 38873542572](https://github.com/zhao-yc/DBArk/actions/runs/38873542572)：Windows在测试启动前因未引用逗号参数收到 `list json`，没有UI结果；两台Mac各12项失败，可见恢复断言为false。原记录保持；false没有携带比较分支，不能据此认定空壳是实际Mac失败的唯一根因，也不能先认定产品输入故障。

Windows PowerShell5.1和PowerShell7经真实pnpm12.11.2调用假CLI，均复现未引用时 `--reporter=list json`，引用后严格收到单个 `--reporter=list,json`。Git Bash的argv-only假CLI验证新旧命令均保留逗号。参数验证没有启动Playwright/GUI，不冒充三平台实际验收；初始Corepack缓存/临时假工程配置问题保留在ignored记录，最终复用已有运行时完成，没有下载新工具。

两个正式fixture现在前后都只忽略 `types.length===0` 的无可读类型空壳。有类型零字节、多item、完整类型集合、逐字节、书签及独立纯文本仍严格核对；额外新增类型也拒绝。原 `expect(restored).toBe(true)`、操作回调、API异常和finally清理路径不删不弱化；没有根据失败结果清空、只备份text或重试。恢复原本确实为空的状态仍沿用原clear分支。

新增恢复附件只含布尔与数量：捕获/读回的原始、可读及空壳item数、类型总数、item数及类型集合是否匹配、独立文本是否相等、缺失/新增类型数、载荷不符数。没有MIME原名、正文、路径、hash或密码。API异常仍沿原失败路径，不把原生错误message复制进新诊断。比较完成后仍执行原关闭及目录守卫；关闭失败不继续删目录，清理失败保持失败。任意可读格式仍不保证经Electron无损回写，保留严格失败语义，实际新CI分支由这些数量确认。

本轮40项纯回归在VM里执行两个完整正式fixture及其真实before/after回调，仅替换UI、OS与传输边界。覆盖空数组/单壳/多壳、全部格式及有类型零字节、多item、类型和字节/书签/text变化、操作失败后恢复、API异常、关闭/目录异常和越界删除守卫；操作与收尾分别失败时保留各自回调原因。额外2项固定9205旧回调与新回调的同输入反例证实：空壳分支旧严格失败、新严格通过，不代替原CI根因证据。类型检查通过。

7组YAML/源/argv检查通过。关闭开关时两文件收集12项、均声明跳过；启用时收集2+10=12项、均声明可执行；两次实际结果均为0。仅收集的预加载守卫禁止子进程、网络和私有配置读取；依赖平台探测被拦截，没有启动Electron。没有运行真实GUI、系统剪贴板、200、Docker或手动CI，实际三平台结果仍待ROOT触发和核定。失败、跳过、重试、缺少实际结果都不作为验收通过。
