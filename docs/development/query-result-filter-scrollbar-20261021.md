# 筛选草稿打开时的结果网格空间

## 原失败与修正

准确3005511的批量启停GUI已终态失败，详情见[原始验收记录](../../tests/integration/acceptance-query-result-filter-bulk-3005511-20261021.md)。最后成功ID为3／6／7；停用草稿后、取消前，原网格外高96.857147、clientHeight89，编辑区已压到0。原读取帮助器要求客户区至少96，未取得该步ID比较结果，不能改判批量筛选正确或错误。

布局hook此前只预留96像素网格外区及复制／查找工具条；横向滚动条仍占客户区。改为读取本网格实际 `offsetHeight-clientHeight`，把滚动条及边框差额另计入结果最小高度和编辑区上限，不硬编码平台宽度。同时观察网格尺寸变化，滚动条出现／消失时重新计算；草稿暂停操作租约时，直接网格和带复制／查找容器的网格都识别。仅测固定容器，不扫描行值，不保存视觉压缩后的编辑器偏好。

原GUI、网格读取器、期望ID、96客户区门、120秒、零重试及严格收尾均不改。前序profile和unknown正常关闭事实保持，不补清理。

## 本机回归

两条按原97外高／89客户区构造的RAM反例，在未修正产品时均失败：父版本给318而非310、386而非378。正式原PID13632，exit1、1.7764686秒，原四项通过／两项失败，日志`.cache/filter-scrollbar-parent-red-20261021/`。更早无重定向观察PID36128仅取得exit1，没有原断言日志，不计为正式反例证据。

修正后执行 `node scripts/check-local.mjs --build`，明确五文件：`query-layout-bounds.test.tsx`、`query-layout-splitter.test.tsx`、`query-layout-integration.test.tsx`、`query-result-sort-ui.test.tsx`、`query-result-sort-case-grid.test.ts`，均在`tests/unit/`。原PID67936，创建UTC2026-10-21T05:30:03.5413750Z、完成05:31:12.5594703Z，exit0、69.0345993秒；类型26.64秒、156项全通过／无失败跳过、Vitest8.35秒，构建33.02秒／Vite32.06秒。

原监督句柄和字节日志保留于`.cache/filter-scrollbar-fixed-20261021/`，stdout SHA256 `a5ed5ac23f433baa66313173b07b95ec7007a86080ebcd6677818f694be445dc`，stderr `e073854a60aba060efc1240612fa2b3f4e5f4a8a93beb0075c1c2b4faffac6bf`。子环境无DBARK_*，保留原Rollup和大分块警告；本机无GUI、数据库或系统剪贴板操作。

以上是源码／RAM反例与构建证据。真实原GUI须在新准确头按同一断言复验，不能用本记录代替；安装、macOS与其它数据库另验，暂不发布。

准确修正头9139a279aab434cbe5dd146094a14a073abd1aba、src a022d8d8e441316acac80828a52c21be7a72c889已推main。[CI39550343640](https://github.com/zhao-yc/DBArk/actions/runs/39550343640)的Linux job119057856453已成功：Python21项／0.181秒，类型、594文件11515项通过／10平台条件跳过、Vitest143.88秒及构建／Vite23.69秒通过，三平台继续。VM准确复验消息返回队列超时，随后主机观察不可达，是否送达未知；未重复派发、未在本机重跑GUI，继续核同一任务状态。
