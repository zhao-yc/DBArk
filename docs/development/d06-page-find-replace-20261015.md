# D06 当前页单处及可取消正则替换

任务分支：`task/parallel-d06-find-replace-20261015`。固定起点：`712e511b86e768eb2fd81cc963e783978dfb8ef5`。首个完整字面切片：`a3c6e89`。

## 实际入口与行为

表数据标签的“当前页查找替换”，以及网格 `Ctrl/Cmd+F`、`Ctrl/Cmd+H` 入口。

- 上一处、下一处按行、可见列及格内原文顺序导航。同格多次出现分别计数，显示当前页行、列、格内序号、UTF-16 偏移及有界高亮片段。
- “仅替换当前一处”只改当前原文范围；“预览当前页替换”仍显示整批计划，确认后一次形成草稿。两者继续由已有“预览并提交”流程集中写库，保留可靠键、原值冲突检测与精度政策。
- 文字、SQL NULL、DEFAULT、二进制保持区别，只使用当前页完整自有原值。NULL、DEFAULT 可导航，只有非生成的可写文本列能替换。只读表仍能查找。
- 任意行编辑、翻页、排序、筛选、布局、加载代次、表结构及连接版本变化均使旧结果和预览失效。父组件在应用时同步复核页面代次及受影响整行快照，拒绝迟到计划覆盖新草稿。

## 正则与资源政策

正则为 JavaScript Unicode 模式，输入正文不带 `/` 分隔符。大小写由选项控制，不开放任意 flags，不启用多行或 dotAll。整格模式先包裹边界，再核对实际完整匹配，保留分支回溯语义。零宽命中按 Unicode 码点推进，在原文边界插入文字，空文本的 `^$` 也可匹配。

字面和正则的替换值均保持原字面政策：`$1`、`$&`、`$$` 等不展开；捕获组替换是明确后续项。正则修改后必须点击“查找当前页”，不在输入时自动执行。

所有实际匹配及预览在真实 Web Worker 执行。渲染线程同步查找入口拒绝用户正则。每个请求独立线程，握手前不发送原值；启动限时 8 秒，收到就绪后实际运行限时 1.5 秒。取消、超时、上下文变化和面板卸载先隔离回调，调用真实 `terminate()` 后才交付结果、释放占用或创建替代线程。客户端也支持异步终止端口，并有延迟终止确认测试。浏览器 Web Worker 没有独立的退出确认事件，使用其平台终止语义，未声称测得操作系统内存回收时刻。

输入模式最多 512 UTF-16 单元，替换值最多 4096 单元，匹配最多 50000 处；请求、扫描、输出和计划均按 16 MiB 预算明确拒绝，不能静默截断。结构化复制前逐字符估算整页 data/original、旁列 BLOB 和元数据，内存估算上限 128 MiB，包含文本副本及结果开销；这是估算预算，不是浏览器堆的硬限制。大 BLOB 即使不在查找列中也可能使整页快照被拒绝。

语义依据：[WHATWG Worker 终止模型](https://html.spec.whatwg.org/multipage/workers.html#dom-worker-terminate)、[ECMAScript RegExp 匹配迭代与零宽推进](https://tc39.es/ecma262/multipage/text-processing.html#sec-regexp-prototype-%symbol.matchall%)。

## 本次实际验证

仅使用本独立克隆的锁定依赖，未更改依赖或锁文件，未访问业务库，未运行 Docker。

```powershell
node node_modules/vitest/vitest.mjs run tests/unit/ui-page-find-replace.test.ts tests/unit/page-find-worker-client.test.ts tests/unit/ui-table-column-preferences.test.ts tests/unit/ui-table-filters.test.ts
node node_modules/vitest/vitest.mjs run tests/unit/ui-clipboard.test.ts tests/unit/record-views.test.ts
node node_modules/typescript/bin/tsc --noEmit
node scripts/build.mjs
node node_modules/@playwright/test/cli.js test tests/e2e/page-find-replace-offline.spec.ts --output .cache/d06-e2e
node node_modules/@playwright/test/cli.js test tests/e2e/page-find-worker-built.spec.ts --output .cache/d06-built-e2e
```

针对性及相邻回归共 99 项单元通过；5 项真实 Electron 离线组件用例通过；1 项生产构建 Worker 加载用例通过。构建生成约 7.72 kB 的独立 `pageFind.worker`，保留已有 Zod 注释和大分块提示，无新增构建错误。

最终将新增三个 Electron 文件合并运行，结果为 6 项通过、1 项实库默认跳过；最终类型检查与 `git diff --check` 均通过。

离线组件夹具只替代表输入和受控桥接数据，运行实际 TableTab、DataGrid、查找面板、草稿、预览及 Web Worker。它验证交互及无写库命令，不能代替真实数据库验收。另一个用例启动实际应用，在其 CSP、渲染沙箱和上下文隔离下加载构建产物并生成零宽替换预览。每例独立用户目录，用后关闭自己创建的进程并清理自己的目录。

覆盖同格第二处、Unicode 偏移、零宽、整格分支、美元符号字面值、非法模式、恶意回溯、真实取消、卸载、迟到响应、终止等待、旁列预算、快照变化、只读表、1024×680 原生窗口。截图在忽略目录 `.cache/d06-e2e`，不提交截图或跟踪文件。

## 主对话统一实库及安装验收

尚未执行 200 服务器实库、真实数据库并发冲突回归、安装包或 macOS/Linux 原生验收；不据此把 D06 标为已发布。

所需资源：主对话核对后的 Server-200 / 192.168.31.200 现有隔离 MySQL/MariaDB 实例、允许创建和删除唯一 `dbark_e2e_*` 测试库的已有临时账号；无需新建容器、修改业务库、扩权或生成长期密钥。`isolatedDatabase` 负责唯一库与表及清理。临时凭据只由主对话通过环境注入，不提交、不复制主目录密钥。

主对话在各已授权实例上注入 `DBARK_TEST_HOST`、`DBARK_TEST_PORT`、`DBARK_TEST_USER`、`DBARK_TEST_PASSWORD`，再执行：

```powershell
$env:DBARK_INTEGRATION_ENABLED = '1'
node node_modules/@playwright/test/cli.js test tests/e2e/page-find-replace-live.spec.ts tests/e2e/table-grid-preferences.spec.ts --output .cache/d06-live-e2e
Remove-Item Env:DBARK_INTEGRATION_ENABLED
```

新实库用例验证同格第二处、正则零宽、预览零写、集中提交及 BIGINT/DECIMAL/BLOB 原值保留；原有表格偏好用例保留整批替换和真实并发旧值冲突检查。数字列的预期已改为替换按钮禁用，与新界面资格提示一致。安装包由主对话统一生成后复验，不能只用源码测试宣称通过。

## 公共文件与集成边界

公共文件仅 `TableTab.tsx`（查找代次和只读接线）、`PageFindPanel.tsx`、`pageFindReplace.ts`、`tableGrid.zh-CN.ts`、`tableGrid.css`、原有 `table-grid-preferences.spec.ts` 数字列断言。新增 Worker、客户端、独立测试及本说明。没有修改主进程 IPC、统一存储、全局版本、覆盖表、发行策略或其它任务模块。
