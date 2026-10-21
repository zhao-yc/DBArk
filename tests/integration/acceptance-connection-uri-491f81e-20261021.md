# 连接URI：Windows源码实库验收

## 准确来源与原始执行

本机`D:\svn\DBArk`、`main`准确提交`491f81e30072eca2ac5e11c8ba7db99cce0d8804`，src树`cddadd7061d8b7c11fbc1cf8a9544624c1b192fc`。完整单元11664通过／1个POSIX跳过、最终类型／63定向及构建、区分区域与输入名称后的39项／类型／新构建均通过，见[实现记录](../../docs/development/connection-uri-20261021.md)。本轮未修改产品或放宽原用例。

WIN11-TEST此前新准备已确认被策略拒绝且未启动／不补跑，继续按授权本机回退，不接续旧c54现场。执行前只读核实没有同文件原Playwright进程。实际SSH同会话先核Server-200／root／IP及socket，移除Docker目标覆盖并显式固定`unix:///var/run/docker.sock`，只读核唯一DBArk/13384容器。认证及其URI编码均仅RAM；本轮错误输出同时脱敏原密码和编码密码，原日志留忽略目录。

用例再核准确MySQL8.4.11／Linux／lower_case_table_names=0／server UUID，只创建本轮随机`dbark_querytemplate_*`隔离库，不改业务资源或权限。命令`node node_modules/@playwright/test/cli.js test tests/e2e/table-query-template.spec.ts --reporter=json --output=<本轮独占目录>/results`，原120秒／retry0／录制关闭和失败保留保持。

CLI PID70704，2026-10-21 UTC15:09:38.9606639Z～15:09:46.0468026Z，exit0，外层7.1131827秒；报告1 passed、0 skipped／unexpected／flaky、retry0，用例5794毫秒。原件`.cache/connection-uri-ui-local-20261021/`：stdout SHA256为`ed72f9065b9df37bb152d6a1561b4074325133074d16d3601dd8d43e2ce65e10`，空stderr为`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`；执行spec SHA256为`2560c6bc4c4c2b3b8a69dca4c802a5d3af2f8b088ac175f3c5302be207ba2ba7`。

## 实际行为与资源

正式新连接入口先输入含`ssl=true`的合成URI，固定错误明确拒绝，原主机仍为127.0.0.1，保存禁用。再填入本轮真实目标URI并点击填入，原输入消失；主机／端口／用户／解码密码／库逐项与原目标一致，记住密码未勾选，连接列表仍为空。之后明确保存才创建一个新连接，概要不返回密码。附件`connectionUriVerified=true`。

随后原字段悬停及模板整例完整通过：类型／NULL／精确默认值／备注无图片链接；四类模板预览，明确SELECT61行及原空串，UPDATE4参数识别后取消，原表草稿保持和恢复。最终audit为pages2、selects1、parameters1、hoverReads1、writes0、pending0、confirmations1、rows61、note空串。

App正常退出及原严格资源结算通过。完整数据／定义摘要保持、库仅含subject且无额外程序对象，精确删本轮库后独立复核库及准备／清理线程缺席。prepare、cleanup、verify-absence三个辅助连接normal和streamClosed均true。原草稿恢复确认采用一次受限接口回答，不作为系统键鼠验收；系统剪贴板操作为0。

## 未验边界

这是本机Windows开发Electron／MySQL8.4单例，不能转作安装版、VM、macOS、MariaDB或其它版本的实库证据。高级URI参数尚不支持，C01／C03仍部分；旧失败不追认，暂不发布。
