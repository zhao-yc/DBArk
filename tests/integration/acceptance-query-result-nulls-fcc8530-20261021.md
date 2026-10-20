# NULL排序位置的Windows检查与首轮窗口失败

## 准确源码

产品／测试固定 `fcc8530ebeee8f0f77fb3fb81d8806abd6dfa30f`，产品树 `55f6b63d3d71ecc77180bb16bf7cc6c56f58ce2a`。普通开发副本分支 `codex/query-result-null-order-20261021` 的后继仅同步文档；WIN11-TEST不跟随后继分支头。通配筛选另已按main4dae140交付，不混用两批验收。

## 已确认检查

- [Linux CI39476897179](https://github.com/zhao-yc/DBArk/actions/runs/39476897179)，job118815078516：类型、586文件11250通过／10平台跳过及构建通过；单元208.98秒，Vite30.53秒。GUI默认关闭，没有在该CI执行。
- Windows唯一五文件命令：`node scripts/check-local.mjs --build tests/unit/query-result-sort-nulls.test.ts tests/unit/query-result-sort-ui.test.tsx tests/unit/query-result-sort.test.ts tests/unit/query-result-filter.test.ts tests/unit/query-result-header-copy-ui.test.tsx`。PID3608，退出0、96.870秒，5文件276通过／0失败／0跳过；类型37.37秒、测试阶段10.29秒、构建49.11秒。

Windows阶段全部DBARK变量移除，无实库或界面操作。原stdout摘要 `9d535e40b84ed3fa20d4e27449a682b3e80f9be9fa5d5c2b14bcdfd87f80a2af`，stderr摘要 `5cd93a38703c97fd6f8521da509fa752582269f38016d600eb413bcb68570967`；包含Rollup注释及大chunk警告，不能写成stderr为空。摘要来自VM封存，Root已读原命令输出，没有在本机复算原文件。

## 第一次NULL专项实库窗口

Root审阅后仅启动一次，原PID11332，2026-10-20T18:58:02.941Z至18:58:13.851Z，退出1、10.906秒，0通过／1失败／0跳过／0flaky。原JSON摘要 `7acfa8f224f3182cb0d2115d42bc9ee21f9c35387b082a7ed756ae50d7b0558a`，stderr为空。原120秒、worker1、零重试、trace／截图／视频关闭均未改变。

输出父目录 `outputs/query-result-nulls-gui-fcc8530-vm-20261021`，子目录 `dbark-query-columns-514ab0a08ebc4fefb072ae51e3487f25` 在原ENOENT及父身份核对后只由用例创建。14个raw/helper键及专项三门核对通过，沿用RAM凭据，没有额外SSH／Docker。已到达原生observer连接及准确MySQL8.4／13384身份检查，没有创建库表用户或写数据。

首错在 `query-result-nulls-live.ts:42:343`：活动tab的kind、connectionId、SQL与常量联合谓词在原5000ms内未满足。具体不一致字段尚待只读诊断，不能先归因产品、焦点、编辑器就绪或持久化延迟。尚未安装查询审计或点击执行，NULL排序矩阵、复制和导出均未到达；两文件原ENOENT，Python读回和完整Windows回归均未启动。后序严格收尾相应失败并保留资源，不能写成正常退出已通过。

## 封存与下一步

原进程观察末次记录均缺席，Git净，574源码和109构建哈希不变；数字PID缺席不等于正常owner／observer同流关闭已证。保留本例profile `dbark-e2e-brLB7y`，dev3929143778、inode1125899906883764，原输出目录及错误不删除、不复用。VM封存20份文件均匹配，报告摘要 `e7382517fd845d5f7ff8a65d327246aeb0ad65b202d29bd9fcaf3335c6697cf3`。

已只派发原错误快照与本例身份匹配的settings草稿只读诊断，比较类型、长度、摘要、换行及首个差异。不得读取或打印凭据、扫描其他profile、启动替代窗口、延长期限、修改断言或重跑GUI。未取得实际差异前保持失败，当前不合入main、不发布，不增加完整Navicat工作包计数。新安装和macOS的NULL能力仍未验。

## 原现场只读诊断与后继准备

WIN11-TEST原只读诊断已完成，Root实际收到终态：profile身份匹配、原进程缺席；error-context只有错误及源码，没有页面快照，不能证明原Monaco可见文本。准确profile的dbark.sqlite仅在SQL.js内存副本读取settings id=1；活动tab为query，id等于activeTabId，connectionId非空。未读取connections，因此连接ID与原profile是否相等仍未证。

SQL均为string，无CR／LF；期望693字符、实际694，首差异索引693：期望EOF、实际单引号。期望SHA256 `b10f407a1c8d5010f1d45ec11a5a59ce7265b7137927016ea829d481dfa70818`，实际 `bccf8cacf495ed22fd4a41bc32e5649b5cb83310e1bef961c76a932acfa44851`。诊断未启动App、实库、测试或清理。持久化不相等已证，具体输入／自动配对根因尚未独立复现，不能声称产品已修复。

后继只调整本用例SQL准备，复用已有参数查询用例的可见textbox聚焦、全选／删除、页内ClipboardEvent paste路径；不读写系统剪贴板、不调用模型／store修改。原693字符常量、settings完整相等、连接匹配、排序矩阵、复制／文件期待及所有期限保持。同步main的守卫诊断后产品树仍55f6b63d3d71ecc77180bb16bf7cc6c56f58ce2a；新提交须独立类型／单元／构建和新目录单次窗口验证，不复用旧profile或输出，不将准备改动写成GUI通过。暂不发布。
