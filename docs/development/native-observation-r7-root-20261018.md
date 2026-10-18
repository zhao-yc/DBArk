# R7 启动元信息分离后的原生检查点

新的普通克隆分支 `codex/native-checkpoint-v023-runtime-info-20261018`，固定头 `3125cb2a0b06e427a1a32774bf8bae7c133c7184`。Root 来源 `deb199bfb8044d8351f05704248a199b982a1d0c`，实际产品补丁 `f34f926`（作者 `50dda8d`）。检查点只新增一个 JSON；无 worktree、主分支合并、版本／依赖／工作流／原观察预算改变。

[R7 run 39120833145](https://github.com/zhao-yc/DBArk/actions/runs/39120833145)，attempt 1，push 事件已实际启动。首次元数据为 `in_progress`，尚无整轮或分平台通过结论。Windows x64、macOS arm64／x64 的源码、打包、真实安装和原凭据回归按实际阶段后续读取；不得以任务已提交代替实际验收。

R7 仅移除 App 启动时主动同步加密能力探测：启动元信息走严格空输入 `app.runtimeInfo`；偏好初始“尚未检测”，用户明确检测仍调用原 `app.info`，真实凭据路径完全保留。Root 11 文件／196 RAM 及类型通过，独审原 196 和额外 5 项 React 对照通过，新 Main 分支 75 次读取 safeStorage 为 0；这些不算真实 Keychain 或安装证据，详见[实现与证据](application-runtime-info-20261018.md)。

[R6 原失败](native-observation-r6-root-20261018.md)完整保留。两 Mac 记录只到同步 native 调用前 30／31、主体预算内未确认正常返回，不能断言永久阻塞或具体 Keychain／签名原因；Main 标记上限、上游早期日志不完整和跨通道顺序边界仍适用。R7 不删真实加密／重启断言，不将 unknown 作为通过或跳过条件，不新增系统 Keychain 操作、凭据、签名证书或公开发行。

本检查点版本仍是 0.23.0、Electron 44.7.0，不能当作 0.27／0.28 新功能安装验收。实际安装未验、运行中或失败均须按原报告记录，不能借此前 Windows R6 成功填入本轮通过。
