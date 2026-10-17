# 查询复制正式离线原生用例候选（2026-10-18）

## 基线与默认关闭

固定基线为 Root 已整合的 `6db40b53c76104e71e48763a1f39f63b1f957e27`。新普通克隆、独立分支 `codex/employee3-query-duplicate-native-spec-20261018`，不使用工作树。本候选只添加 `tests/e2e/query-duplicate-native.spec.ts` 和本文，不追加产品或通用测试框架。

专属开关为 `DBARK_QUERY_DUPLICATE_NATIVE_TEST=1`，同时必须显式设置 `DBARK_INTEGRATION_ENABLED=0`。默认及 `--list` 均不加载桌面夹具；即使列表进程开启专属门并误设 integration=1，仍只列出用例。实际执行在加载 owner 前拒绝实库总门及 `DBARK_TEST_* / C02_* / SSH_* / MTLS_*` 环境键，不读取凭据文件或值。

用例复用现有 `desktop-fixture` 的 `preserveOnUnconfirmedExit: true`：单次启动、捕获本例 owner、正常退出握手、真实 close 和所属 PID 不存在证明，确认后由原夹具清理临时配置目录。失败显式 retain，不强退、不重启、不接续旧 owner；不截图或开启 trace/video。用例成功后 afterAll 再确认目录已不存在，才附加成功终态；目录仍在则失败，不自行删除。命令行开启 trace 在加载桌面夹具前拒绝，文件级 trace、screenshot、video 全部 off。

## 未来原生执行内容

1. 真实界面新建仅属于本例临时配置的假连接：`127.0.0.1:1`、用户名 `offline`、空密码、取消“安全保存密码”、默认库留空，不点击“测试连接”。
2. 通过原“新建查询”流程打开草稿。该流程尝试连接并拒绝，只作为离线边界；必须观察真实拒连错误，不伪造服务器版本、连接状态或补全响应。
3. 用真实 Monaco 键盘选择全文并输入，通过真实“保存查询 / 另存为新查询”界面形成来源记录；只读实际 `settings.get` 和 `queries.list` 核对保存正文、来源绑定及明确空库。
4. 再用键盘编辑来源草稿。复制前先真实 Undo，读取本次实际结果作为基线，再 Redo 恢复；不硬编码第一次 Undo 的分组或预期正文。
5. 点击真实“复制为新查询”，核对两个独立 tab ID、完整复制正文、同连接、`known/null` 默认库、副本无 `sourceBinding` 及其它继承字段，来源保存记录正文保持不变。
6. 用键盘修改副本，核对原草稿及保存来源均未变化；通过真实 tab 按钮回原标签，实际 Undo 结果应等于复制前读取的基线，再 Redo 恢复。最后走 strict owner 的正常退出及目录清理。

正文写入只通过界面键盘，不调用 Monaco 模型、光标设置、执行 SQL、保存写入 IPC 或系统剪贴板；读取只使用界面和实际 settings/queries。没有导入 `live-helpers`、凭据模块、旧 `monaco-caret` 或剪贴板助手。

**边界：** 不同 tab ID 和草稿互不影响只能证明前端归属，不能证明真实数据库线程、事务或临时表隔离。该部分保留给后续实库验收。配置目录、PID、正常退出和实际输入/Undo 结果均需 Root 真正运行后才能认定。

## 本轮只执行的检查

```powershell
node node_modules/@playwright/test/cli.js test tests/e2e/query-duplicate-native.spec.ts --list
node node_modules/typescript/bin/tsc --noEmit
git diff --check
```

另一次仅列表设置了专属门=1、integration=1，确认列表仍成功且不启动桌面。两次均只列出本文件1项用例。类型检查及差异检查通过。本轮未执行原生用例、GUI、数据库、200服务器、Docker、系统剪贴板、旧套件、full或build。

## Root 后续执行入口（本轮未执行）

在 Root 已核对的源码构建或实际安装产物中，使用独立离线进程设置上述两个门，确认无实库环境键，再执行：

```powershell
node node_modules/@playwright/test/cli.js test tests/e2e/query-duplicate-native.spec.ts --workers=1 --retries=0 --trace=off
```

本候选不运行构建，也不修改 CI 或安装执行器。仅提交本地固定候选，供 Root 独审后安排执行。
## Root后续实证

Root `c17ad63` 对齐 Field 下拉的真实可访问名，并让输入行内容接受平台 EOL；来源／复制／Undo 仍严格比较实际原字符串。仅正式安装 runner 的同值 C02_EXE 路径别名可继承，其它认证／实库配置继续拒绝。Windows 开发 Electron 的原一项 run1516 已单次通过、正常退出及配置目录清理确认；三平台源码／安装门随后接入，尚不外推其它平台或真实数据库会话，见[原生检查点](../../tests/integration/acceptance-query-duplicate-native-20261018.md)。
