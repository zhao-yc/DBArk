# Intel执行计划点击超时：原件与诊断

## 已确认事实

固定8e41972的原生CI 39395258185，Intel job 118536307560在legacy源码阶段失败：79通过、314跳过、1失败。`explain-view.spec.ts:32` 已定位“计划结果表格”按钮，但等待visible／enabled／stable超过原30秒。原45秒用例和零重试未修改，不将ARM或Windows的通过替代该结果。

开发会话已完成原artifact 12252865232的下载并独立复算：5116936字节，SHA256 `7db1d4853e7f1df2dea03fdd12259f7f438803fb191851c7a64f1f8ecced2164`。此前下载失败未生成可用原件，本次原件仅在忽略缓存。只读检查原error-context和嵌套trace；其中trace只有testRunner事件和源文件，没有次级Electron窗口的DOM、截图或native状态。因此目前不能确定布局、可见性、帧交付或原生窗口状态的具体原因。

## 本候选做什么

复用既有`SnippetsNativeDiagnostics`有界记录器，不新增测试框架或主机控制程序。执行计划使用独立`DBARK_EXPLAIN_NATIVE_DIAGNOSTICS=1`，同时匹配真实spec和完整标题，尊重实际解析的trace选项；拒绝实库／SSH／mTLS配置，配置键检查不读取密码。当前只接入CI的legacy源码阶段，不传入安装或实库流程。

原用例保存自身次级窗口ID，只采样这个窗口的可见／焦点／尺寸、webContents ID和真实节流开关；renderer仅投影固定按钮的矩形、禁用和少量样式及中心命中标签，不保存输入或计划内容。原context先核独占trace，再记录该真实BrowserContext；不覆盖或停止其它记录器。仍使用原128样本、500毫秒间隔、单个待交付rAF和单通道一条在途请求，退出前有界封存，按实际trace失败保留策略处理。

不修改产品、原点击、断言、窗口焦点／节流、SQL或超时，不使用force点击。诊断会影响调度，新增记录器下单次通过不能证明原偶发原因已修复；须按原记录中的实际状态继续定位。

## 验证状态

新增纯RAM检查覆盖入口隔离、私网拒绝、原trace策略、原窗口ID、节流值和目标投影／rAF上限；原片段诊断用例保留。下列独立CI及WIN11-TEST结果按固定SHA记录；旧失败保留，不重跑，暂不发布。

首个5f0a470的[CI39402623180](https://github.com/zhao-yc/DBArk/actions/runs/39402623180)在类型阶段失败，未运行单元／构建／桌面。实际错误为新阶段名未在mark联合类型中，以及采样函数参数不兼容Playwright的void／推宽string签名。后继显式补入两个固定阶段名、允许原无参数采样及显式字面参数，并补真实记录器阶段测试，不用any绕过。首次失败保留，修后须新固定SHA验证。

向WIN11-TEST发送5f0a470的工具请求未返回，停止等待后保留“送达未知”，没有重复原请求。后续原消息迟到，已另发明确撤销旧SHA、指定唯一4917d0a的更新。测试机在同一回合 `01a158b9-2992-7362-a288-c7efb81e6497` 确认：5f仅fetch／快进／只读准备，没有类型、构建或GUI；核进程后切到4917d0a，不执行旧候选。保留原准备记录，不把工具等待中止视为取消了远端请求。

固定后继 `4917d0a1f085b7e36206629f933e5b77b8f785f4` 的[CI39403583333首次push](https://github.com/zhao-yc/DBArk/actions/runs/39403583333)通过，原日志为Ubuntu类型／577文件／11083通过／10原win32条件跳过／构建成功，223.63秒；诊断文件50项通过。随后复核分支和成功run均绑定该SHA，2026-10-20 09:57:23–09:57:26 UTC单次请求原ci.yml（HTTP204），[原生CI39404469208](https://github.com/zhao-yc/DBArk/actions/runs/39404469208)已实际运行、首次attempt；剪贴板选项维持默认false，未发布，不继承旧通过数。

另已读回main43c8bf6的39400232119：ARM job成功，Intel原源码／安装legacy各80通过、314跳过，未复现旧点击超时；这不是根因已修的证据。该次Windows原legacy为79通过／314跳过／1失败，在`page-find-replace-offline.spec.ts:26`初始化时未找到“当前页查找替换”按钮。开发会话已独立下载artifact12254704372：2674072字节、SHA256 `78455c094b39c4ad3a6537c1f6d45c1112aeaee7093bf91f3a7e3d9a201f716b`，原嵌套trace同样只有testRunner和源文件，没有浏览器上下文，原因未确认，不将整轮视为通过。

诊断原生CI39404469208的Windows job118566924212在进入UI前即停于既有`check-backup-windows-helper.mjs`。原日志约60秒后仅报告“C#编译或原进程关闭未确认”，没有terminal code／signal／流状态，不直接归因为C#源码编译错误；test-results尚不存在，未上传原artifact。该检查脚本和产品helper本候选未改，原45秒执行计划场景并未运行。ARM和Intel源码／安装legacy均各80通过、314跳过；整轮仍失败、发布跳过。Intel执行计划源码6.9秒、安装5.7秒，未复现旧超时，不将其作为根因修复证明。

WIN11-TEST已完成4917d0a的78项定向／类型／新构建、单次原GUI及完整11092通过／1平台跳过；另一次独立trace=on正向采集通过，原ZIP有127个实际BrowserContext帧，详见[固定源码验收](../../tests/integration/acceptance-explain-diagnostics-4917d0a-20261020.md)。这只确认诊断链路有效，不确认Intel旧偶发根因已修复。
