# 复制查询后等待正文可交互再准备关闭流程

## 原失败与有界修正

CI39551052101的Windows job119060095139在`threeDrafts`准备第二份正文时失败：预期草稿B，实际持久化仍为草稿A，尚未执行“关闭其他查询”的业务断言。原失败ZIP2675444字节，SHA256 `81db86b668fb9beccc2d8eb6965fd7abdb0c9ccd042f5e28dd2f663194138260`，本机独立下载复算及CRC通过。不能据此宣称关闭流程数据丢失，也不能用后继CI通过追认原根因。

原准备只等待settings中的标签数量；该持久化事实不足以证明新Monaco已挂载并完成正文桥接。本轮只调整原生spec的键盘准备：固定预期标签ID与对应实际pane，确认活动ID、pane可见、正式编辑器`aria-busy=false`、文本框可见可编辑后输入；持久化正文断言同时核准确活动ID。第二、第三份草稿显式传入新标签ID，不能误写仍活动的旧标签。仍用真实键盘，不调用store或Monaco模型接口，不改产品、原期望、120秒、零重试、录制关闭或严格owner退出。

这是明确的准备前置条件修正。当前证据尚未完整证明原CI偶发根因；不增加重试、任意等待或辅助诊断工程。

## 实际验证

第一次检查因我误指定不存在的`query-duplicate-native-gate.test.ts`在启动类型检查前退出1，PID46480、0.1044168秒，原件保留。修正文件清单后执行`node scripts/check-local.mjs tests/unit/query-close-others-native-gate.test.ts`，PID64240、UTC07:56:28.1080195Z至07:56:56.3399411Z，退出0、28.244878秒，类型25.84秒、原门测试5项通过。产品src树未变，未重复构建。

准确main `1ca76d465107b96bebaee5457775ce9c61c37d1e`，src树仍`e0b2eff968994ebd74558dac27bbd2ee5adc5b6c`。WIN11-TEST继续不可达，按已授权回退本机。先执行原`node scripts/check-offline-query-port.mjs`，唯一127.0.0.1:1实际ECONNREFUSED且原socket关闭通过；子环境移除全部DBARK_*及ELECTRON_RUN_AS_NODE，只显式开启integration=0和本专项开关。

原命令`node node_modules/@playwright/test/cli.js test tests/e2e/query-close-others-native.spec.ts --reporter=json`，仅另指本轮输出目录。PID71852、UTC08:06:53.0203920Z至08:07:11.5526777Z，退出0、18.5527988秒；两例分别8.694／8.580秒，2通过、0失败／跳过／重试、report.errors为空、stderr为空。实际验证取消保留全文、首个直接关闭后推进第二个、第二个取消、来源CAS冲突、原弹窗另存及后续不自动推进。原afterAll两份accepted均确认正常退出和所属目录移除，Root另行只读检查两准确目录均不存在。

原字节记录`.cache/close-others-ready-live-20261021/`：stdout SHA256 `d4035dffec376efc8598d7c60283a3db99bc5641f6d2dad8a6a2e9291a23ec11`，stderr `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`，result `36a828ec2162b14b6c54148253056db02332f04b6614fc35745753d0d4a42091`。Git及产品源码未变；不提交原始日志或profile。

本轮无SQL执行、实库、SSH、Docker或系统剪贴板。仅证明本机源码宿主两个既有流程，新安装和macOS另验，原CI失败保留，不改变完整工作包计数，暂不发布。
