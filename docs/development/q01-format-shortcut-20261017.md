# Q01：编辑器内快捷格式化

在 future 基线 `968628d22ea55faed705710e440ce859f4a22996` 上组合正文桥接 `953c444b94617bf33a2cd0d0d1b3737a591e345d` 与布局恢复 `2dcc51fe34ceb049470204a05d9f9762032f9307` 后追加本片。普通 clone、独立任务分支；Root 已 stage 两桥接，只需移入本片新增提交，不重复移入前置桥接。

编辑器内使用 `Alt+Shift+F`，macOS 对应 `Option+Shift+F`。`Ctrl/Cmd+Shift+F` 继续由 App 的结构搜索处理；没有改 App 原监听器、执行键、版本或依赖。按钮文字保持“格式化”，动作名、按钮文字与提示集中在 `sqlFormatting.zh-CN.ts`。

QueryTab 仅把已有 `formatQuery` 作为 `onFormat` 传入 SqlEditor；按钮和快捷键共用同一个忙碌、活动标签、模态、模型正文同步及单次编辑事务守卫，不另建执行通道。其他编辑器未传回调时不注册，显式只读时也不注册；实际原生 readonly 或桥接未就绪仍拒绝回调。

动作持有所属 widget 和注册代次，回调只读取 layout effect 已提交的最新 props。改变回调不重复注册；移除回调、切入只读、widget 销毁或组件卸载会释放动作，旧回调不能在以后重新启用时复活。Suspense 布局隐藏期间停用回调，恢复仍存活 widget 时复用原动作，不重复发布动作或 onReady；已销毁 widget 不复活。键绑定的上下文要求真实编辑器正文焦点且非只读。

验证仅限代码与纯端口：

- 92 项定向测试通过、0失败、0跳过：22项格式化原文安全、22项真实QueryTab按钮/快捷回调共同守卫、13项正文桥接、13项真实锁定库/ReactDOM生命周期、19项原执行当前语句合同、3项执行App实际监听的结构搜索键位合同。
- 生命周期测试覆盖最新已提交回调、取消的并发渲染、显式只读/未传回调、解除后旧动作不复活、卸载以及布局隐藏/恢复或隐藏中销毁。这里的 Monaco 模型/动作仍为RAM端口，不计原生按键验收。
- 类型检查退出0。四种 `DBARK_E2E` / `DBARK_Q01_FORMAT_UI` 开关组合的 `--list` 全部退出0，均为原4项skip定义，所有结果数组为空。保留默认关闭、列表先短路以及原60000ms/0 retry预算。

现有4项 E2E 身份不变，不新增重复定义。两项正向定义各经过快捷键与按钮：用真实 Space 按键先产生独立用户输入，逐码点按键取得准确选区，通过只读 Monaco API核边界和焦点，逐入口要求一次撤销恢复含空格的原文、一次重做及选区外原文不变；任务、历史、来源和会话保持。两项拒绝定义也各经过快捷键与按钮，要求模型正文及版本不变。没有通过设置模型或选区替代实际键盘路径。

本片没有运行这些 E2E，没有启动GUI、访问200、读写系统剪贴板、构建安装包或手动派发CI。Windows/macOS真实焦点、Option键解释、Monaco撤销及安装产品行为仍由Root冻结同源产品/产物后独立验收，不能由纯测或list推定通过。

本员工忽略证据位于 `.cache/format-shortcut-evidence/`，包括92项JSON、类型输出、四门list与交接绑定。定向命令为：

```powershell
node D:/svn/DBArk/node_modules/vitest/vitest.mjs run --config .cache/format-shortcut-evidence/vitest.config.mts --reporter=json --outputFile=.cache/format-shortcut-evidence/pure.json
node D:/svn/DBArk/node_modules/typescript/bin/tsc --noEmit
node .cache/format-shortcut-evidence/list-check.cjs
```
