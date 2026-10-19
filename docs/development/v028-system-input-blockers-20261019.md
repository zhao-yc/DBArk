# 0.28 当前系统输入缺项与接收边界

最新：用户已明确回复授权。本机现已通过固定GitHub官方API接收原Windows候选及证据ZIP，完整长度/SHA/落盘重读/全部CRC均通过；实际NSIS安装后119相对文件及SHA与原批准全部一致。新nonce05033c30在Sky激活/恢复窗口时失败，Root未发系统键、未写ack；原120秒测试与45秒worker收尾超时，退出未知、安装和数据目录保留，见[准确记录](../../tests/integration/acceptance-v028-windows-system-installed-20261019.md)。以下接收阻断段落保留此前历史，不再作为当前缺文件结论。

Windows源码系统Ctrl+S已有固定`ddeed3c`、nonce `18c06a58`的单次真实输入及两个正常owner证据，继续按[原记录](v028-windows-system-source-20261019.md)读取。本次没有重跑源码用例，也没有把格式化快捷键或页面keydown当作系统保存。

Windows安装版尚未验。本机专用Windows系统输入工具已能枚举应用/窗口；未检测到本任务可复用的DBArk安装。安装前准备接收原成功候选artifact12184231827（142818435字节，ZIP SHA256 `066ec0ed921c59168800161d85d3e0cf6c0bcbe814069d1cf9d3df315b88746f`），尚未接收到本机文件，未执行安装、创建新nonce/ready/ack或发送系统键。

应用内接收过程有两次不同阻断，不能混淆：

1. 初次自动审批把browser2误认为外置Chrome，拒绝绑定。随后新清单明确browser2为当前聊天`01a1540d-944d-75a1-abbc-481014acbd84`的IAB，browser3才是Chrome；凭此证据再次绑定同一空白IAB页成功。没有打开或控制用户Chrome标签，也没有使用外置浏览器替代默认ego lite。
2. 真正等待下载时，浏览器安全门返回无法确认本次下载origin、未授予下载authority并重置会话。未取得Download对象或本机路径；不得将MCP云端file_uri写作已下载文件。没有转用此前被拒的签名地址终端通道、关闭安全门或循环重试。

已向用户请求恢复下载权限，或由用户从[原成功artifact](https://github.com/zhao-yc/DBArk/actions/runs/39244695054/artifacts/12184231827)下载并提供本机路径。拿到文件后须先独立核原ZIP摘要/CRC、EXE摘要，再确认无用户安装、实际安装到新独立根、逐项核原119文件身份；全部准备齐备后才启动原120秒单次系统保存用例。先读ready并核对真实活动`native-source.sql`窗口及正文，再唯一一次系统输入；失败/未知不补按、不重试、不补清原现场。

当前缺文件与下载权限是本机安装系统输入的具体阻断；它不影响通过GitHub官方API在新原生CI中补关键字专项。后者不向本机接收文件、不操作本机系统键，也不证明系统Ctrl+S。

macOS Cmd+S仍未验。当前系统保存门限定Windows，没有可用且已核准的Mac系统输入执行链；不修改平台门或以CDP键盘替代。Intel原生空间另见[只读核对](../../tests/integration/acceptance-v028-x64-environment-20261019.md)。以上缺项须交最终发行审核明确处理，不能把当前版本认定为全部验收完成。
