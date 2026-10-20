# Intel执行计划点击超时：原件与诊断

## 已确认事实

固定8e41972的原生CI 39395258185，Intel job 118536307560在legacy源码阶段失败：79通过、314跳过、1失败。`explain-view.spec.ts:32` 已定位“计划结果表格”按钮，但等待visible／enabled／stable超过原30秒。原45秒用例和零重试未修改，不将ARM或Windows的通过替代该结果。

开发会话已完成原artifact 12252865232的下载并独立复算：5116936字节，SHA256 `7db1d4853e7f1df2dea03fdd12259f7f438803fb191851c7a64f1f8ecced2164`。此前下载失败未生成可用原件，本次原件仅在忽略缓存。只读检查原error-context和嵌套trace；其中trace只有testRunner事件和源文件，没有次级Electron窗口的DOM、截图或native状态。因此目前不能确定布局、可见性、帧交付或原生窗口状态的具体原因。

## 本候选做什么

复用既有`SnippetsNativeDiagnostics`有界记录器，不新增测试框架或主机控制程序。执行计划使用独立`DBARK_EXPLAIN_NATIVE_DIAGNOSTICS=1`，同时匹配真实spec和完整标题，尊重实际解析的trace选项；拒绝实库／SSH／mTLS配置，配置键检查不读取密码。当前只接入CI的legacy源码阶段，不传入安装或实库流程。

原用例保存自身次级窗口ID，只采样这个窗口的可见／焦点／尺寸、webContents ID和真实节流开关；renderer仅投影固定按钮的矩形、禁用和少量样式及中心命中标签，不保存输入或计划内容。原context先核独占trace，再记录该真实BrowserContext；不覆盖或停止其它记录器。仍使用原128样本、500毫秒间隔、单个待交付rAF和单通道一条在途请求，退出前有界封存，按实际trace失败保留策略处理。

不修改产品、原点击、断言、窗口焦点／节流、SQL或超时，不使用force点击。诊断会影响调度，新增记录器下单次通过不能证明原偶发原因已修复；须按原记录中的实际状态继续定位。

## 验证状态

新增纯RAM检查覆盖入口隔离、私网拒绝、原trace策略、原窗口ID、节流值和目标投影／rAF上限；原片段诊断用例保留。当前仅静态审查及`git diff --check`，新候选尚待独立CI、WIN11-TEST离线控制例及准确Intel原生回合。main当前43c8bf6的CI39400232119仍按原回合观察，不重跑；暂不发布。
