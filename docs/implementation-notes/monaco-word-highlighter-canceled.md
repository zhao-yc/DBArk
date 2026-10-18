# Monaco词语高亮的局部取消Promise修复

分支基线：`9057178829b892b6e820337e1b8341ba6e548758`。原提交 `2222cdd38b0450a55d7dc74d65d0bb8a36e8ffd3` 先覆盖focus/cursor；追加提交按Root复核补齐restore。现在处理Monaco 0.55.1同一 `WordHighlighter` 文件的全部三处 `runDelayer.trigger()` 返回Promise，没有关闭只读、编辑或恢复高亮，没有设置全局错误过滤、修改pageerror断言或延长原生期限。

## 证据及定位边界

员工2原交接SHA256为 `16ed86d743df0a0fe522acdcfee98c8f60eede238d3ac02fccc53e1ad732a983`。独立复制其原9项RAM脚本到本任务证据目录运行，9项检查通过，并复现实际Delayer取消产生的两条未处理拒绝；没有修改原脚本或旧证据。

Root另提供并核验的 `run1774-r4-windows-asset-map.json` 记录：R4 `index-Dxokct1G.js` 为5367170字节，SHA256 `292c2828dbfc0fd7d1a6130c1487975df1d3f4d3a2a53a174c15519b0ae4966f` 与原source-indent manifest一致。六个原栈帧对应Delayer.cancel创建CancellationError、dispose、DisposableStore和WordHighlighter.dispose。这里引用的是已核验映射，不再只依赖同名资产；仍不能确定精确UI子动作发生时刻，也不能据此认定新修复原生通过。

上游focus/cursor事件将延时任务排队后丢弃返回Promise。模型解除时实际Contribution处置WordHighlighter，DisposableStore处置Delayer，Delayer.cancel拒绝该Promise。项目SqlEditor只读分支未注册项目补全provider，原项目worker/provider取消仍解析为空结果；本片不改这些代码。

## 最小修复和异常归属

正式pnpm补丁只改 `esm/vs/editor/contrib/wordHighlighter/browser/wordHighlighter.js`：从原官方errors模块额外导入 `CancellationError` 和 `errorHandler`，在focus、cursor及restore三处返回Promise各就地附加catch。

- 只有该Promise拒绝值是同一官方 `CancellationError` 类的实例时，作为本地取消消费。
- 其它拒绝值原样交给官方 `errorHandler.onUnexpectedError`，保留正式异步抛错与错误监听器路径，不转为空建议或成功值。
- 没有直接使用宽泛的 `.catch(onUnexpectedError)`：0.55.1官方 `isCancellationError` 还兼容name/message均为Canceled的普通Error；本片要求更窄，不能把同名产品错误一并隐藏。
- 不改变高亮选项、Delayer原50毫秒延时、排队顺序、取消动作、provider请求、装饰算法、模型处置或原错误断言。

Root后续指出：`restoreViewState` 调用 `restore(250)`，后者先cancel旧延时任务，再trigger新任务并丢弃其Promise。新Promise同样会被上述dispose链拒绝。原R4六栈帧只定位disposer，不能证明入口来自focus/cursor而非restore，因此只补前两处不足以覆盖同族缺陷。这一步补齐相同root cause，保留原cancel→trigger顺序和250毫秒恢复延时，不是新增功能或其它模块扫描。仍不声称修复Monaco其它取消Promise或所有异步_run错误。

## 正式依赖、精确字节和许可

应用版本保持0.23.0，仅将Monaco依赖由范围锁为精确 `0.55.1`。`pnpm-workspace.yaml` 注册 `patches/monaco-editor@0.55.1.patch`，pnpm 12.11.2正式生成锁文件；冻结离线核验退出码0。其它包版本、现有mysql2补丁及其哈希保持。

| 项目 | SHA256 |
| --- | --- |
| 上游原始wordHighlighter.js | `507b02c2395b05aedcc3d512c6f7653bcf0e8205d4bc7af92398eafd61b31c89` |
| 正式补丁文件 | `b9abd5505107b0934040c6ac1a3813d8b2af80e7f4ca849a496871a21ac5d095` |
| 应用补丁后的wordHighlighter.js | `b20417e61b8e71253ce6434e3568ec8c4d5d40ecdf945d419fda91d12a0e9420` |

Vite开发及生产构建都先检查精确版本、MIT声明、补丁SHA和安装后整文件SHA。缺失补丁、版本变化或错误字节时直接拒绝，不回退未修复代码。沿用仓库既有 `.gitattributes` 的LF约束，避免Windows自动换行改变补丁哈希；没有修改原属性规则或全局Git配置。

上游版权属于Microsoft Corporation，保留原文件MIT版权头及包中 `LICENSE`。本补丁没有删除、替换或冒充上游归属。

## 本地依赖隔离和验证

本片没有写共享主目录的node_modules、Junction或全局依赖。先核对已有缓存中的pnpm-native.exe确为12.11.2，直接调用该版本；pnpm home/cache/config/store/state均明确设为本clone的忽略目录，禁用生命周期脚本及全局认证文件。只运行lockfile-only，不安装、下载或启动Electron。首次空私有缓存的离线解析失败；随后仅生成锁文件并完成冻结离线核验，最终锁文件由pnpm正式生成。

运行补丁与构建验证时，将已锁定的Monaco及其dompurify/marked依赖复制为本clone内独立普通目录，对复制的Monaco运行 `git apply --check` 和正式补丁。所有测试只读该私有安装副本，共享原文件保持上游SHA。未把私有目录或构建产物提交。

窄验证为7个文件63项通过，包含23项补丁检查：实际类/Delayer/DisposableStore/Emitter/provider/高亮装饰链19项RAM，以及构建版本/字节门4项。只读和编辑模式的focus/cursor/restore正常执行均产生两处实际装饰；restore通过实际Contribution入口，仍按原参数250恢复。解除模型或直接cancel均无未处理拒绝；普通、伪同名Canceled、字符串拒绝仍送官方报告与监听器。另回归原补全worker、缩进模型、字体、换行及片段测试40项。原9项证据保留并单独列示，不重复累计。

追加的独立RAM子进程使用同一个实际类端口，不给被测Promise添加测试catch：父提交2222的restore模型解除、直接cancel、focus→restore→dispose三场景各覆盖只读/编辑，共6条真实未处理CancellationError；追加修复后同一6场景为0条。原2222提交、原9RAM及前次交接证据不改写，追加证据单独放在 `.cache/native-canceled-restore-evidence`。该原红/修后绿证明同族取消入口，不代替原生复现或精确UI定时归因。

类型检查 `tsc --noEmit` 和 `node scripts/build.mjs` 均退出0；生产构建的大chunk提示是既有体积边界，本片未调告警阈值。精确测试、构建、冻结锁文件和副本身份记录见本任务本地交接及SHA清单。

未运行GUI、Electron、Playwright/list、数据库、SSH、Docker、端口/实际进程探测、剪贴板、服务、新CI或1556材料。本片仍需Root交叉审查与后续明确授权的原生验收，未修改版本、工作流、覆盖总表或原pageerror/原生等待断言。
