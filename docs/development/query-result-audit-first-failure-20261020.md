# 真实结果验收：保留首次审计拒绝原因

## 实际失败

WIN11-TEST固定 `5b1c468b9183f45971eb37397637e1f8fa67201f`，原 `query-result-organize.spec.ts` 单次执行、零重试，原120秒门槛未改。进程退出1／55.18秒；用例正文6368毫秒，报告总54382.969毫秒。点击执行后的 `query-result-organize-live.ts:45` 触发下一次审计检查，报“结果列原目标／修订／IPC已变化，永久停链”。它是后续 `state.check` 的泛化错误，不能据此判定首次拒绝的是哪条请求，亦不能认定排序、筛选已执行。

原报告位于VM私有 `outputs\query-result-organize-live-vm-20261020`，`native-original.json` SHA256为 `e5362c407a29cd81ca3c78a8a927c87ac54d123802aedbabbe92d1165887c837`，`live-gui-result.json` 为 `4da4da53e4b8260e6825d5451ddaecd93851eba82779212892e9738d3ecc2062`。开发会话读回原始堆栈及VM校验输出，未取回复算。

原构建109文件哈希未变、Git干净，后序76449f9未fetch、未快进、未类型检查或运行。CSV／JSON不存在，独立读回未通过；原owner正常退出和观察流关闭未得到用例确认。最终进程采样无所属进程，不等于原严格退出通过。保留 `dbark-e2e-hbXe0o` 和本轮原件，不重新挂接或清理。身份与认证准备已完成不代表业务查询或文件验收通过。

## 诊断候选

只改既有 `tests/helpers/queryResultColumnsUi.ts`：首次拒绝保存固定原因类别，后续检查保持原原因；已许可处理器失败只附既有协议名称，未许可请求仅固定已知协议名称可见，任意请求字符串、输入、配置、SQL、路径及服务端错误正文均不进入诊断。原处理器抛出的错误仍按原引用抛出，之后只显示固定分类。

不增加允许命令、不改目标／修订／一次会话／一次查询／两导出／120秒／零重试或退出守卫；原始失败及其现场不重写。既有RAM文件增加六项，验证首次原因保持、版本错误、失败回包、异常原引用以及未知字符串不回显；原断言保留。尚未在VM类型检查或执行，不宣称已修复产品或找到首次失败根因。

## 固定977c536实际诊断

WIN11-TEST类型与三文件49项定向通过，入口56.348秒；109份构建哈希与5b1一致。新窗口单次退出1／51.849秒，用例正文4104毫秒；首次拒绝类别为“未许可命令：metadata.databases”，后续检查保持该类别。另有45000毫秒worker收尾超时，CSV／JSON仍未生成，正常退出和观察流关闭未确认；最终准确PID及所属进程采样为0，两个候选目录保留，不等于严格收尾通过。

VM `outputs\query-result-organize-diagnostic-977c536-vm-20261020` 的 `diagnostic-result.json` SHA256为 `49c3b0a082a34ed486d5ec75a0e2493f9afc9aaa4c7687679008b3e97f53a39c`，`diagnostic-native/native-original.json` 为 `aeb1202350b54b633ba9813f0cc34f9ee478425c1efcf624ac9efcfc0330b00c`；22份本轮原件及17份原失败文件经VM复核，开发会话只读回校验输出，未取回复算。此轮分类不能反推5b1原首拒命令。

源码发现新建查询effect关闭后仍可追加库目录读取的独立缺陷，转入[生命周期反例及修复](new-query-directory-lifetime-20261020.md)，不开放metadata.databases来绕过审计。尚无修后GUI通过证据，不合入main或发布。
