# 可选的离线开发组件原生剪贴板 CI

本分支直接基于 `c07939afa03f381fb0eaee5b0b0d8109194ddb6a`，只增加 CI 可选入口与本文档。原 `c07939a` 产品验收头保持，不修改产品、版本、fixture、原测试期望、依赖、安装脚本、权限或发布门。

`.github/workflows/ci.yml` 的 `workflow_dispatch` 新增布尔输入 `native_clipboard_components`，默认 `false`。只有手动运行且明确勾选时，独立 `native-clipboard-components` job 才运行。三个 runner 与现有原生矩阵相同：Windows x64、macOS arm64、macOS x64；没有 self-hosted runner，不使用管理员工作站或用户当前电脑。

ROOT 审核固定提交后，可在原“客户端检查与构建”工作流选择此分支，勾选该输入并手动运行。本员工不触发 CI。`workflow_dispatch` 需要工作流在默认分支注册；可以选择其他 ref 运行，参见 [GitHub 官方手动工作流说明](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)。使用保留布尔类型的 `inputs` 条件，参见 [GitHub 官方工作流语法](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onworkflow_dispatchinputs)。

每个平台仅执行现有两文件：

| 文件 | 数量 | 身份 |
| --- | ---: | --- |
| `tests/e2e/query-binary-types-offline.spec.ts` | 2 | 独立开发 Electron 中的查询结果类型组件 |
| `tests/e2e/record-input-guards-offline.spec.ts` | 10 | 独立开发 Electron 中的记录输入组件 |

公开离线命令：

```text
pnpm exec playwright test tests/e2e/query-binary-types-offline.spec.ts tests/e2e/record-input-guards-offline.spec.ts --workers=1 --retries=0 --reporter=list,json
```

补充 job 始终设置 `DBARK_INTEGRATION_ENABLED=0`。仅上述测试步骤显式设置 `DBARK_QUERY_BINARY_NATIVE_ENABLED=1` 与 `DBARK_RECORD_INPUT_NATIVE_ENABLED=1`；每个平台使用一个 worker、零重试，job 上限30分钟，原用例期限不变。两夹具自行建立回环 Vite、独立临时用户目录和开发 Electron 沙箱窗口，不加载产品主进程或数据库，因而无需新增构建/打包/安装步骤。

两个文件都硬编码启动自己的 fixture `.cjs`，不会因 `DBARK_EXECUTABLE_PATH` 而改为安装产品。因此这12项始终计为“开发 Electron 组件”；即使未来在源码或 installed-host 阶段启用，也不能计成12项安装产品。三个平台各有12项结果，不把它们当作36个不同功能。现有 packaged 脚本只固定私网门为0，本次不改其生命周期、私网策略或环境；新开关不注入原 desktop 的源码或安装阶段。

默认 push、PR、tag、未勾选的手动运行仍沿用原行为。原 `checks`、`desktop`、`release` job、权限、并发和发布依赖不变。勾选时只额外增加三个补充 job，原任务仍按既有条件运行；“仅12项”指补充 job，不把两个开关注入原全套 E2E。补充记录使用独立 artifact 名 `开发组件原生剪贴板-<平台>`，只上传 `test-results/`，JSON报告位于 `test-results/native-clipboard-components/report.json`；不匹配原发行下载的 `DBArk-*` artifact，也不加入发行依赖。原测试失败不会因上传记录而变成成功，没有 continue-on-error。

本分支修改了 CI 文件，因此不冒充此前要求构建与CI也逐blob等于原80的产品桥接快照。ROOT 对补充 CI 结果按本分支实际 SHA 和 workflow run 归档，原 `c07939a` 的正式安装结果另行保留。

现有两个夹具在保存时过滤无类型空条目，恢复后却直接比较 `clipboard.read()` 返回数组长度；空 `types` 壳可能造成严格恢复失败。另外，任意可读格式不保证经 Electron API 无损回写。这里仅标注静态疑问，不预先改空壳处理、备份格式、清理逻辑或原严格断言；实际 CI 失败后，由 ROOT 依据原报告安排最小修正。失败、跳过、重试、缺少实际结果都不作为验收通过。

本轮8组 YAML/条件/原工作流对象比对通过。关闭开关时两文件收集12项、均声明跳过；启用时收集2+10=12项、均声明可执行；两次实际结果均为0，不能据此称用例通过。预加载守卫禁止子进程、网络和私有配置读取；两次各拦截一次 Rollup 依赖平台探测的 spawnSync 尝试，实际子进程启动0、网络0、私有读取0。没有运行真实 GUI、系统剪贴板、200、Docker或手动 CI，实际三平台结果仍待 ROOT 触发和核定。
