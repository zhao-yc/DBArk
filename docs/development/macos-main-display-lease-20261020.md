# main原生Mac显示租约接线

## 原问题与改动

main 6977c5b／2716230的两次原Mac arm64源码分栏失败都确认：显示器1024×768、工作区1024×677、请求1400×1000但实际1400×645，可用分栏高度226，没有满足原大于410的门槛。原ZIP及摘要见[同次失败原件](query-result-vm-main-handoff-20261020.md)。这不是分组筛选的Windows验收结果，不降低原测试几何要求。

复用既有Swift及Node显示模式管理：新增准确本仓库ci.yml的main／既有候选分支、desktop job、push／手动事件上下文；Node、Swift及安装清理协议分别核对，不改写GITHUB_REF冒充旧冻结分支。仍只允许GitHub-hosted macOS arm64，保留原镜像版本、单屏、1倍缩放、完整模式目录与实际窗口几何检查。PR、其它ref、标签、Intel及本机入口保持关闭。

源码六专项使用原600秒非续期租约，原CLI自行构建及批准；安装六专项使用另一600秒租约，验证本job源码批准和原安装回执。每阶段原正常owner／文件／SQLite证明闭合后恢复原显示模式；安装还须父IPC恢复确认后才进入legacy及原卸载门。失败不自动重试、强停应用或补造清理证明。

同一job共享已编译程序，但源码、安装的journal／plan／receipt分别写入`.cache/macos-mode-keeper/source/`及`installed/`，原件采用不覆盖写入。旧冻结job继续原目录和原约束。常规CI不重复执行已由显示管理调用的首次文件四例。原报告、编译上下文及两阶段收据分别上传，不将receipt当作上传完成或完整平台通过。

## 当前验证边界

本候选只改CI脚本接线、既有Mac清理协议纯RAM测试及本说明；分组产品、单元和Windows原生队列固定ceb607a的输入不改变。新增纯检查覆盖新旧上下文隔离、阶段、错误repo／workflow／ref／事件／平台、禁用入口和分目录路径；本机不编译Swift、不切换显示模式、不运行应用。

固定候选 `8e419725364b75d176562d178e7617b75a0ad084` 的[首次push检查39394246346](https://github.com/zhao-yc/DBArk/actions/runs/39394246346)成功，已直接读取原job日志：Ubuntu类型／577文件／11071通过／10原win32条件跳过及构建成功，216.95秒；既有Mac清理协议文件38项通过。桌面、剪贴板及发布job跳过，不计作实际模式切换或原Mac失败已修。

随后复核该分支和成功run仍绑定准确8e41972，单次调用原ci.yml的workflow_dispatch（HTTP204，2026-10-20 08:41:36–08:41:42 UTC），读取到[原生CI 39395258185](https://github.com/zhao-yc/DBArk/actions/runs/39395258185)，同SHA、首次attempt，已实际运行。没有重跑旧失败job或更改ref；剪贴板选项采用原默认false，发布job仍不满足push标签条件。等待本回合真实Swift编译、模式、几何、恢复及安装原件，观察中断不能触发重复请求。

分组Windows原回合仍固定ceb607a，尚不可读取终态，不因本候选的Linux检查或Mac CI请求而升级。远端main保持2716230；分组筛选与本CI候选分别收口，暂不发布。
