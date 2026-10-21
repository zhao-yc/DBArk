# 筛选草稿批量启停 Windows 串行验收

## 前置与准确目标

本单只在 c449 控制加载续验原回合 completed、原 GUI／独立读回与资源终核全部通过后执行；若尚未收尾，保留原任务，不切产品或启动另一轮。此前控制加载失败的80份原件及所有旧失败保持，不借用新通过改判。

目标为统筹消息给出的本单准确提交，产品源码树必须为 `97162ea158e662ab09b8b25c97ecad1b563c3cef`，与 `b61b19271ebd213fa22e9f65040f70e34e356b7f` 相同；仅真实整例加入批量按钮步骤，不修改产品、断言、合同或运行器。先核原 c449 最终源码／测试／dist／构建输入、所有旧封存及新旧 CSV／JSON 的身份、长度和 SHA。工作区干净且可快进时，仅一次 fetch，原测试分支 ff-only 至准确目标，不取浮动 main，不建工作树或新 clone。

新独占 metadata：`outputs/result-filter-bulk-enabled-vm-20261021`。已有目录或匹配任务则续读原状态，不另起代次。

## 一次准备与真实整例

沿用已验证监督模板与外层 esbuild 独立 CJS 加载方式，详见[控制加载续验](query-result-filter-enabled-control-resume-20261021.md)。语法、ready 和首 CIM 均先于正式 Node；原 .NET handle、创建／退出及 stdout／stderr 原字节分别保存，不打印 RAM 对象。父目标、凭据及 UUID 仅回保留布尔。

子环境移除所有大小写 DBARK_*，仅一次准备：

```sh
node scripts/check-local.mjs --build tests/unit/query-result-filter-enabled.test.ts tests/unit/query-result-sort-ui.test.tsx tests/unit/query-result-sort-case-gate.test.ts tests/unit/query-result-sort-case-grid.test.ts
```

四文件当前147项，保持原类型、测试及构建门。准备失败停链，不重装或放宽门槛；新 dist 图另存。通过后沿[原准确 GUI 操作单](query-result-filter-enabled-c449506-vm.md)的唯一实库 GUI 及条件独立读回合同：准确200／13384／MySQL8.4 UUID、三门、helper／raw同一RAM快照、新 nonce 两文件、原120秒、workers1、零重试，严格 owner／观察连接 native 与 stream 正常关闭，原一查询／两导出／pending0／revision0／历史保持。

唯一正式命令仍为：

```sh
node node_modules/@playwright/test/cli.js test tests/e2e/query-result-sort-case.spec.ts --reporter=json
```

新步骤使用真实全部启用／停用按钮：原AND交集 `3,6,7`，批量停用草稿时网格保持、取消后两条仍启用；增加子组 `id=3` 得到 `3`；递归全部停用并应用得到 `1..7`；全部启用保留子组OR、原成员及原值并恢复 `3`；移除子组恢复 `3,6,7`，再沿原移除副本／复制／两文件导出。期待均手写、读取真实网格，不修改DOM、SQL或期待来绕过失败。

GUI通过且严格收尾、原文件checkpoint封存后，预授权仅一次原独立 Python `-I -B` 读回新CSV／JSON，校验原checkpoint SHA、四行八列及18字符串／11NULL／3二进制、精度、Unicode和 stableRead。无需重复合成读回、完整测试、旧Q01、安装或系统输入；复制只使用本页 DataTransfer，不访问系统剪贴板。

## 终态

最终复核准确源码／测试／新dist／构建输入／Git、此前所有封存、新旧两组文件和原进程身份；逐文件SHA封存新报告、manifest、原日志及附件，known-secret扫描只回布尔。任何失败或unknown原样保留，停止后续链，不强杀或补清理。不SSH／Docker、不建库或用户、不轮换／落盘凭据、不发布。此例不等于安装、macOS或所有数据库基线验收。
