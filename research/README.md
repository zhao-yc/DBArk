# 本地逆向研究工具

这里仅提交 DBArk 自主编写的取证工具和测试场景。Navicat 安装程序、图标、手册原文、反编译文本和 REA 原始证据保存在被 Git 忽略的 `research/private/`；工具依赖在 `.tools/`。不将第三方产品代码或素材并入 DBArk。

## 已验证的环境

- Windows x64 / Node.js 24.17.0
- REA npm 包 `rea-agents@6.4.0`
- Ghidra `12.1.4_PUBLIC_20260921`
- IDEA 自带完整 JDK：`C:\Program Files\JetBrains\IntelliJ IDEA 2026.1\jbr`，版本 `25.0.2`

Ghidra 官方 ZIP 的 SHA256：`ddac49f903da9d5bac833e5cc79395098b9c33cfd3279be5f31bd00387d2d4db`。实下载文件大小为 569,649,598 字节，摘要与 GitHub 发布资产的 `digest` 一致。

安装入口：[REA](https://github.com/morluto/rea)、[Ghidra 12.1.4](https://github.com/NationalSecurityAgency/ghidra/releases/tag/Ghidra_12.1.4_build)。先核对官方说明和校验值，再安装到 `.tools`，不要改全局 Codex 配置。

```powershell
npm install --prefix .tools/rea rea-agents@6.4.0 --no-audit --no-fund
$env:JAVA_HOME = 'C:\Program Files\JetBrains\IntelliJ IDEA 2026.1\jbr'
$env:GHIDRA_INSTALL_DIR = Join-Path $PWD '.tools/ghidra_12.1.4_PUBLIC'
$env:REA_ANALYSIS_PROVIDER = 'ghidra'
$env:REA_GHIDRA_STARTUP_TIMEOUT_MS = '900000'
& .tools/rea/node_modules/.bin/rea.cmd doctor --provider ghidra --format json
```

`doctor` 的 CLI 范围检查应为 `healthy=true`。未注册 Codex/VS Code MCP 不影响本研究脚本。受限沙箱下 REA 的 Windows 原生句柄校验曾返回 Win32 5；在本次被授权的普通用户运行环境中通过。不要改动用户目录 ACL 来规避错误。

## 取证命令

```powershell
# 只读 PE 导入/字符串线索；结果固定写入 private。
python research/collect-artifact-evidence.py 'C:\Program Files\PremiumSoft\Navicat Premium 17\navicat.exe' --name navicat

# 独立会话发现 170 个 REA 工具，不启动 Ghidra。
node research/run-rea-session.mjs 'C:\Program Files\PremiumSoft\Navicat Premium 17\libmariadb.dll' --catalog-only

# 在一个会话中启动引擎、查询函数、保存原始证据并清理；只读目标文件。
node research/run-rea-session.mjs 'C:\Program Files\PremiumSoft\Navicat Premium 17\libmariadb.dll'
```

每次会话新建私有结果目录，控制台只显示操作状态。MCP 客户端等待上限为 16 分钟，引擎启动上限为 15 分钟；超时是未完成，不是证明目标没有对应功能。每次最多运行一个 Ghidra 原生分析进程，结束后检查 `close_binary` 的清理结果。

`acceptance-scenarios.sql` 是隔离开发库的可重复行为比对脚本；它会新建测试表和过程并修改测试数据，不能直接对生产库运行。取消、跨标签事务、并发编辑冲突需要按研究记录分别操作，不应把整个文件一次执行当作完整验收。
