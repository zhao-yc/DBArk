# 单条筛选启停的 Windows 实库续验

## 准确范围

产品 `c4495066f4f570fbff69769ea377f442c66a0aea`，src 树 `0eb5a6922e7ecc8ff75b0bdddc1c6e597d25c6d2`。WIN11-TEST 的 dbark测试会话在回合 `01a15cbc-93a9-77b0-9a11-2a5ef0d26d1c` 完成本单条件链，随后才接续新批量按钮任务。固定旧产品没有“全部启用／全部停用”，本结果不能计入 `b61b192` 新按钮的 GUI 验收。

原首轮准备四文件144项、类型及构建已通过。随后外层 Node 直接加载 TS 参数属性报错，正式 GUI 和读回尚未启动；原错误及80份封存保持。续验仅按[操作单](../../docs/testing/query-result-filter-enabled-control-resume-20261021.md)将原合同用既有 esbuild 编译为独立 CJS，不改产品、合同、用例或运行上限，不重跑旧准备。

## 实际结果

| 阶段 | 原生记录 | 结果 |
| --- | --- | --- |
| 正式 Electron 整例 | Node PID9268，北京时间12:49:07.040933创建，12:49:27.574110完成 | exit0，20.556秒；1通过、0失败、0跳过、retry0，stderr为空 |
| 独立文件读回 | Python PID12352 | exit0，0.517秒，stderr为空；4行8列、18字符串／11NULL／3二进制、stableRead=true |
| 收尾 | 原15个角色均exit0，30个PID候选终核零匹配 | profile已不存在，准确输入图及新旧文件、十一套旧封存不变 |

正式整例在200／13384准确MySQL8.4目标上完成原多列排序、Unicode／NULL／精度比较、筛选复制及单条启停：停用副本、OR省略停用项、全部单条停用、仅重启副本、恢复AND交集，再移除副本导出原四行。62个真实网格几何／顺序附件已原字节封存，最后ID为 `1,3,6,7`；所有原断言保持，只有一条常量查询和CSV／JSON两导出，pending0／revision0、历史不变。

GUI严格正常退出并确认观察连接 native／stream关闭后，先封存新文件身份、长度和SHA checkpoint，再执行独立读回；CSV383字节、JSON827字节。读回脚本按准确Git原始Buffer提取，为已验39版本的8589字节原件，不导入产品；命令期望摘要取自之前冻结的checkpoint。读回前后新文件身份、长度及SHA保持。

## 封存与限制

VM目录：`C:\Users\tester\Documents\Codex\2026-10-20\hi\outputs\result-filter-enabled-c449506-control-resume-vm-20261021`。

- `result-filter-enabled-resume-report.json`：SHA256 `1ab966f39737704964cb73f8955fa68fe9b6cf5e3e20445256d71572a8ce3768`。
- `SHA256SUMS.txt`：SHA256 `88b8b6a750c5aa8ad66ab2afdd223468aae0a78cea2b228fb3017b312ab38173`。
- 测试会话终核249个文件的逐项SHA通过。Root已读取回报及阶段记录，未将VM原件下载至本机复算；本条与Root独立归档审计分开。

仅本页合成DataTransfer，不访问系统剪贴板；无SSH／Docker、库表或用户创建、权限变更和凭据轮换。本轮未重跑完整回归、安装、macOS或其它数据库基线；[c449完整CI](acceptance-main-c449506-ci-20261021.md)为独立证据，不能替代本单或扩大范围。此前凭据RAM对象误输出事件的完整暴露范围和用途仍未知，新证据通过不代表事件处置完成。不改旧失败或unknown，不发布。
