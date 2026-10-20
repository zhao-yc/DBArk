# Mac arm64：常规CI显示租约接线验收

## 固定来源与原件

固定 `8e419725364b75d176562d178e7617b75a0ad084`，[原生CI 39395258185首次运行](https://github.com/zhao-yc/DBArk/actions/runs/39395258185)，arm64 job `118536307791`。批准记录绑定同一commit／run／attempt 1／desktop／darwin arm64，Node v24.21.0、Electron 44.7.0及Playwright 1.64.0。后继a526846／bd949bb仅记录CI及合入已验分组文档；运行源码、测试、脚本、依赖和workflow与8e41972差异为空。

开发会话独立下载以下原ZIP并复算字节和SHA256，与GitHub artifact元数据匹配；只读打开原JSON／日志，不执行或修改原件：

| artifact | 字节 | SHA256 |
| --- | --- | --- |
| 12252418224，ARM原生测试记录 | 7885684 | 3fc2c69ded90302f5b4a18c657e3cd2a317998a471c68ed11f114269555530d4 |
| 12253282142，两阶段显示租约 | 10359 | 8460a83f4e5743bb270dcb82604e678048bddd78f8c7c9d446fcfc760a20f44f |

## 已核对的实际行为

| 阶段 | 原报告事实 |
| --- | --- |
| 源码 | 缩进1项、分栏1项、首次文件模型4项全部通过，全部retry 0；六份证明均accepted、目录已清理，12个owner均confirmed／willQuit／closed |
| 同次DMG安装 | 同样六项单次通过、六份证明及12个正常owner；安装批准绑定准确源码批准，原报告和批准摘要逐项匹配 |
| 原生几何 | 两阶段均有1400×1000、1400×480、1400×1000、1400×1000四次稳定实际客户区；viewport、BrowserWindow和contentBounds一致、zoom／scale 1，整个窗口位于1600×1091工作区内 |
| 模式租约 | macos26镜像20261013.0424.1，原模式3／1024×768，候选模式9／1600×1200；两个独立600秒租约收据accepted，退出码0、无fault、原专项／文件证明均已消费 |
| 恢复 | 源码180帧、安装99帧原journal均结束于restored、无failed帧；两次均在keeper退出前观察原模式3恢复；没有声称退出后再次观察 |

原六专项SQL执行和系统剪贴板为0。源码批准SHA256 `dbe4c6033f737056b0138a314bbcbafd05d41a55ad1c1a846f274800c32a02c3`，安装批准为 `d1b678182d4fbe7022077d6f28d4ac9ac5709fdc1e6d75d1119c5d551198b89a`；原专项accepted的reportSha256／approvalSha256与本次读取的原字节一致。

安装原批准记录同次DMG SHA256 `7f790f38ab62dd17d9a737ffd2087212999cc0db233c1c195899e075c15a14a4`。开发会话没有独立下载该DMG或在本机安装，不把原报告记录的DMG摘要写成Root独立安装验收。

## CI终态及未验边界

8e41972的首次push检查39394246346已核原日志：类型／577文件／11071通过／10原win32条件跳过／构建成功，216.95秒，Mac纯协议38项通过。原生39395258185的Windows x64、arm64和checks job成功，但整轮因Intel Mac legacy源码失败而失败，发布job跳过，未重跑。

Intel原job `118536307560` 日志为79通过、314跳过、1失败；`tests/e2e/explain-view.spec.ts:32` 的“计划结果表格”点击等待visible／enabled／stable超时30秒。原因未确认，未修改该组件或放宽测试。artifact 12252865232后续已独立下载核对，只有runner trace，详见[原件及诊断](../../docs/development/explain-native-stability-20261020.md)，保留旧失败。

本批只交付已验ARM显示接线，不代表三平台全功能、私网实库、系统输入、签名／公证或发行完成。main实际上下文单独读回见下，不继承候选ref的运行身份；旧两轮main分栏失败不追认为通过。暂不发布。

## 后续准确main上下文

main `43c8bf648373c098d4477545c8fa8c206a4c51b7` 的[CI39400232119](https://github.com/zhao-yc/DBArk/actions/runs/39400232119) ARM原件已另行下载并独立复算，不沿用8e41972运行身份：

| 原artifact | 字节 | SHA256 |
| --- | --- | --- |
| 12255427200，ARM原件 | 7888187 | `95d35361e000a44946ae25c698a95c522e1d50a803d4b2c76adc010fde354d4b` |
| 12255731787，模式租约 | 10621 | `73dcae87e3d6e1c8591bde3ff1da87fe950e4eb461a562fcb6686e0939112045` |

两个原批准均绑定准确main、该run及darwin arm64：源码批准SHA256 `19f6a31618c703854390763bd69a2e03e7c334ab7ba5a754839a0a015f7a1312`，安装批准 `52e22f5b73417b07c22ce9df83cbc567243a0076d0afa8b16a58edb897cce9ed`，后者绑定前者。两阶段各六项单次通过、各12正常owner，共24，错误和重试均0；SQL执行和系统剪贴板均0。

源码及安装实际几何均1400×1000／左栏480／SQL区1000／结果区1000；viewport、原生窗口及client bounds一致，workArea 1600×1091、scale=1，完整窗口在其内。两段租约accepted、keeper退出0且无fault；源码197帧、安装97帧，序号连续、nonce一致、无failed，末帧均恢复原模式3，恢复观察发生在keeper退出前。没有宣称退出后再观察，也未在开发机独立安装该DMG。

同次Intel源码／安装legacy各80通过、314跳过；Windows查找替换初始化失败，整轮仍失败。新单次通过不证明旧Intel偶发根因已修复，旧main失败仍保留，暂不发布。
