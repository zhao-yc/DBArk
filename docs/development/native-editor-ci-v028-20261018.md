# 0.28严格原生CI的窄适配

父提交固定为 `98dd084c93c3d7538f17f22e1c1218f264fc2337`。严格runner及身份链复用已验R7 `3125cb2a0b06e427a1a32774bf8bae7c133c7184`，只适配0.28现有consumer和终态footer，不迁移R5/R6启动观察层。

## 原缺口与执行顺序

原workflow的legacy E2E和安装回归不设置缩进／分栏专项的批准门；绿色legacy步骤不能证明这两个专项执行过。新链在每个现有原生矩阵job内严格执行：

1. 同次 `tsc --noEmit` 和 `scripts/build.mjs` 成功后，固定完整dist集合、Electron入口／资源和端口脚本摘要，生成同head／run／attempt／job的源码批准。
2. 源码缩进、源码分栏各启动一次独立Playwright子进程，各自manifest；固定单worker、零重试、无trace，先失败即停。
3. legacy源码回归使用 `test-results/legacy-source`；直接调用原electron-builder，避免再次build覆盖批准字节。
4. 安装之前封存同job安装器输入和固定未安装app参考。真实安装之后逐项比较实际可执行文件及完整resources相对字节，再生成installed批准；安装器自身不能冒充app入口。
5. 实际安装缩进、分栏各一次，然后才运行 `test-results/legacy-installed` 中的legacy安装回归。全部原正常退出证明及legacy均成功后才走原限定目录清理；失败或未知退出不卸载、不分离、不删除安装现场，不重试或强停。
6. 成功后保留候选上传；测试原件始终上传，并以run／attempt命名。并发组按run／attempt隔离，新push不取消正在采集的现场。

## 原合同与精确receipt

- Root28原runtime、owner、gate、identity、已有诊断、全部产品src、版本／schema、依赖和真实凭据E2E逐字不变。runtime仍为37个await、52个guard调用；不采用R7的55个guard或Main 30–33标记。
- 原TestInfo期限120秒、全局45秒、will-quit／close／PID及限定目录门保持。runner只消费原用例生成的footer，不在期限结束后补查PID或补造退出证明。
- 0.28分栏原footer的schema是9，明确拒绝R7的schema 8；缩进仍要求原sqliteChecked。两位owner都必须confirmed／willQuit／closed且有正整数PID计数。
- 每份 `accepted.json` 精确绑定phase、specialty、spec、批准SHA和原报告SHA。报告必须恰好一项、单次passed、retry=0且无错误；skipped、未知子进程退出或绿色步骤都不能代替该receipt。
- 专项环境只由runner为各自子进程构造，不修改父环境；workflow和安装包装器不直接持有专项开关。legacy继续采用原普通门，输出与批准／专项原件隔离。
- 模块导入及默认／list CLI参数不启动GUI、端口或数据库；不新增SDKcollector、wire、progress或四项模块加载回归。原显式 `test:packaged` 的安装用途保持。
- desktop、可选剪贴板及开发预览发布的触发条件保持；本任务不触发三平台检查点，交由Root独审整合后统一安排。

## 本地验证边界

本地仅运行新增CI纯合同及既有native gate／owner／runtime的RAM用例、受限缓存文件验证和类型检查。输出清理测试只消费锁定SDK的原清理函数及合成缓存文件，没有运行Playwright命令或实际Electron。逐字保护证明和原验证日志保存在本任务独有 `.cache/native-ci-adaptation-evidence`，不提交缓存、日志、依赖或构建产物。

10个相关文件148项通过、0失败／跳过，完整 `tsc --noEmit` 退出0。已有离线预检纯测试只把旧命令定位改为新的legacy命令，并增加“预检→源码专项→legacy”顺序断言；原预检和双处离线门检查保持。原缩进门测试未修改。

本地证据不能证明实际Windows／macOS安装、原生缩进／分栏或系统加密已通过，也不继承0.23 R7的验收范围。真实三平台检查点尚未执行。
