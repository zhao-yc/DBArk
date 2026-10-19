# 0.28 Intel Mac 标准宿主空间核对

结论为环境阻断，未进行本轮产品窗口、源码专项或安装验收。没有放宽原1400×1000客户区、480底栏、正常退出或120秒要求，也没有以arm64/Rosetta替代原生Intel。

固定验收头`6a4c2d8c32b6a0461bd34720f310e60966052278`，产品仍为`bf08645`。原生Intel只读枚举[39261586810](https://github.com/zhao-yc/DBArk/actions/runs/39261586810)一次成功，matrix以`max-parallel: 1`顺序执行。工具先核GitHub-hosted、指定分支/job和x64；`sysctl.proc_translated`返回ENOENT（errno2），未观察到Rosetta翻译。没有切换显示模式或创建产品窗口。

| 宿主 / job | 系统和镜像 | 当前逻辑模式 / scale | AppKit可见矩形（点） |
| --- | --- | --- | --- |
| macos-15-intel / 118090323752 | 15.7.9 build24G830；20260824.0482.1 | 1920×1080 / 1 | x0、y85、1920×970 |
| macos-26-intel / 118090324177 | 26.6.1 build25G76；20260824.0517.1 | 1920×1080 / 1 | x0、y90、1920×959 |

两宿主都只有一个显示屏。CG API包含重复低分辨率项的完整枚举各返回3条，均为同一个modeID `-2147479552`、1920×1080、30Hz；未提供更高的逻辑模式。AppKit点并非本轮实测Electron DIP，本轮也没有运行Electron读取workArea。因此结论限于“尚未找到可满足原门的标准Intel宿主”，不编造新的产品失败或通过。旧Intel失败仍按原报告保留。

| 原件 | SHA-256 / 校验层 |
| --- | --- |
| 本机提取inventory-1.json | `dcdd642175e890bac10fe64020759a6a3fd63ee0144a1634764d2cbf41e20e84` |
| 本机提取inventory-2.json | `3418d0898f5765ef5824b326d27f7cb2a2edab417a83aa3b1afa555ec93499a6` |
| job118090323752解码归一日志 | `3e33416e2efb7d5bc531dff5569a8b63886424745133208e9d5c7544dbc21223` |
| job118090324177解码归一日志 | `12dd5737402296fc03fc334013f27b283e47620790e05425770fc11ecb7a19f2` |
| artifact12191436660 / 24292字节 | API digest `9967d96686b0e8886688aab0184384f3ad6d88f280781bccec331c256a10b90b`；本机未独立接收ZIP |
| artifact12189858290 / 23818字节 | API digest `3ab0625bdd48f4a2425a47da7c13fea3731dc2ddc3c19b56ad655d201e9e0c25`；本机未独立接收ZIP |

本机JSON为从原job日志提取后重新序列化的清单，日志为连接器解码、去BOM和统一LF的文本；均不冒充GitHub归档原字节。原件位于本接班clone的`.cache/serial-evidence/x64-environment-*`，不入Git。

后续只在取得已授权、空间足够的真实Intel Mac后，先读取Electron真实窗口和workArea，再按原门单次执行。没有为本项开通付费宿主或外部服务。标准宿主标签以[GitHub官方表](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)为依据，翻译状态语义参考[Apple官方说明](https://developer.apple.com/documentation/apple-silicon/about-the-rosetta-translation-environment)。
