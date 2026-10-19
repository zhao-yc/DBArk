# Windows原候选本机接收与安装系统CtrlS：输入控制失败

用户在本聊天明确回复“授权”后继续。冻结产品仍为`bf08645a28fceb5d1d40ba16f013bb78e7a7c0a2`，实际验收头`6d04d86c170b80332675b8f9ec746fc0b0c0e0da`。结论分为：本机原ZIP/CRC通过、实际NSIS安装119文件身份通过、系统CtrlS用例失败；不能把前两项变成系统保存通过。

## 原包已在本机核准

应用内浏览器授权后接收发生导航/下载等待超时，未取得文件路径。GitHub官方客户端未安装，仓库已有标准Git Credential Manager；本轮仅经既有认证访问固定GitHub官方artifact API，存储重定向去掉认证，未使用此前被拒的MCP签名地址终端通道。认证没有输出或写入文件，没有新建凭据、密钥或证书。

首次网络请求的60秒期限在7012352字节处终止，原部分文件保持。只增加网络传输预算，服务端HTTP206及Content-Range确认准确位置后续传；最终完整字节和落盘重读分别核原SHA256。这个网络调整没有改变正式用例的120秒期限。

| 原归档（run39244695054） | 本机字节 | 本机完整/重读SHA256与CRC |
| --- | ---: | --- |
| candidate artifact12184231827 | 142818435 | `066ec0ed921c59168800161d85d3e0cf6c0bcbe814069d1cf9d3df315b88746f`；全部CRC通过 |
| evidence artifact12184037042 | 5340007 | `d7eb06a765753b584d8e77a21dd4a42a40439338fc65892fafe95d3bfb435176`；全部CRC通过 |

只安全提取两个候选文件与四个原身份文件，全部固定摘要通过。实际安装器142664620字节，SHA256 `9b98642db34cee99453e671e23f78af11821ae6314e51fbd39ffc718754d62fe`。安装前核无既有DBArk注册/进程，原NSIS以`/S /currentuser /D=<本次Applications>`实际安装。

原119文件清单SHA256 `37dc01fa8a68bce958d67789356765bfe09932c05d3eaef09d00d90de548a2d6`；新实际安装清单SHA256 `d0889ec80cd5e959baebc6783ca5a0ac218065f888a24875e1de053c735e82bc`。所有119相对文件及内容摘要逐项一致，差别仅为本机安装绝对根；没有仅看版本号或src tree批准。

## 单次原用例与输入工具失败

新nonce `05033c30-fe74-4798-aaad-c34355056c4b`。原用例使用手工双批准门、integration=0、`DBARK_EXECUTABLE_PATH`指向本次安装，workers1/retries0/trace off，复用原TestInfo120秒及全部37 await/52 guard、schema9和正常退出门。执行与复核均为Root同一操作者，不冒称独立人工双审。

原ready为window1/contents1、Main32676/renderer63356/launcher32648，绑定新安装清单和UTF16LE原来源ref revision1。输入前原文件62字节/dev/ino/SHA完整一致。普通沙箱未返回所需进程路径，提升后的同次只读复核确认Main/renderer均为本次实际安装程序；未修改用例或重新启动。

Sky先返回本次独占安装路径的唯一窗口，HWND1905846。随后激活/状态读取阶段返回`foreground window did not report a process id`；按工具恢复规则重新枚举绑定时，对该精确安装路径的匹配数为0。该0窗口记录不能当作正常退出证明，根因也不能直接归为产品保存问题。

Root没有调用`sky.press_key`，没有写ack。ready中的externalInputRequests1及Root input-intent仅是计划预算；实际Root系统键请求为0，Page.keyboard保存请求也是0，物理硬件按键数未测。原Main/DOM“before”观察仍为唯一启用保存菜单、正确accelerator、pane1、编辑器/文档焦点true、模态0，但没有收到成功系统握手或保存终态。

原120000ms期限自然失败，Playwright状态`timedOut`、0重试；随后原worker收尾45000ms也超时。原JSON stats为expected0、unexpected1、skipped0、flaky0，总duration166550.349ms；额外收尾时间不是延长用例输入期限。报告SHA256 `42a448372f0e902a52a0b584a497153579a22844164eea8c0766693c0df6422b`，包装receipt SHA256 `5ffb9b86f928ae511a8a3f7e0378d5d80c165cf493dddbf9116d5672ac6a1e8a`，accepted=false。

## 保留范围与复现入口

本次安装根`C:\Users\zhao-\AppData\Local\Temp\dbark-system-installed-sooMDr`和原数据根`C:\Users\zhao-\AppData\Local\Temp\dbark-indent-aaG3ku`均按失败策略保留，未卸载、补清、强停或补按。原owner附件confirmed/closed/willQuit均false，记录PID32648/32676/57972/29416/63356；未在失败后访问SDK、查询其存活或补做文件/SQLite/退出证明。

原命令依次为`node .cache/download-v028-authorized.cjs`、bundled Python执行`.cache/verify-v028-authorized-input.py`、`node .cache/prepare-v028-installed-system.cjs`、`node .cache/serial-evidence/local-system-installed-authorized.cjs run`。验收CLI已退出1；没有持续运行的验收控制服务，原应用owner仍按未知处理。日志在本clone`.cache/serial-evidence/system-installed-authorized/windows-system-installed-05033c30-fe74-4798-aaad-c34355056c4b/`，不提供强停/删除命令。

本机下载receipt SHA256 `cb71e2b1dd07f6163f7f5d35aeef2f012f459cf5fe0526436d9c1d8d552ea0a3`；CRC/input receipt `93cde89b9f4227e4229bba18e08064729cc1dbf83116e57dd16776218324487e`；控制文件 `1e41e31b84c44c7d4a755483d14a47c95ff0cd7859a0c5fdccb491357da0a2dc`；操作者包装脚本 `3149a8dc1652dbfb3f3e4b347cdd492343f43c786b20506a3d604bb9733eb963`。原件保留在ignored目录，机器摘要见[本轮证据](../../docs/releases/v0.28.0-windows-system-installed-evidence.json)。

下一步先确认系统输入工具的窗口绑定问题与可用执行环境，再由统筹决定新的隔离验收；不重试或清理本失败场景。Windows源码系统CtrlS的旧通过保持原归属，Mac关键字、Intel与Mac系统输入缺项不变，0.28仍未完成发行验收。
