# W03 定义正文定位：生命周期与正式入口准备

本任务基于 `90c5c0b2c521ff0048b596768d67ba84d3c4cdcb`。检查确认产品已有完整入口：定义正文搜索 → 只读查看准确对象 → 摘要复核 → 绑定实际 Monaco 模型 → 命中行列及前后高亮导航。继续复用保存查询的 UTF16／CRLF 无损位置校验，本次没有重复实现功能，也没有修改产品或后端接口。

## 本次补齐

- 新增 15 项真实 ReactDOM 与 Monaco 模型端口验证：准确目标及行列、前后循环、StrictMode、迟到读取、旧 onReady、连接修订 ABA、删除恢复、模型事件、关闭、卸载、摘要变化及混合行尾降级。编辑器宿主与 IPC 被替换为内存端口，不代表原生 GUI 验收。
- W03 专用 spec 改为列举优先、双开关默认关闭；目标与显式账号校验通过后才加载正式场景。原八项正式场景移入 `definition-navigation-cases.ts`，未执行。
- W03 专用建库夹具改走当前编码目录选择、只读预览、完整库名及两项确认，不再点击旧“执行 SQL”按钮。
- 用例使用本例捕获的页面、应用和观察连接；归属失效、观察未知、退出未确认或建库 apply 未确认成功时保留现场。只在退出确认后清理已证明原先不存在的本例随机库。原生关闭证明仍由已有桌面夹具负责。
- 新增 17 项入口、表单、注册与收尾端口验证。这些内存端口不替代真实 IPC、网络、TLS 或服务器行为。

## 验证证据

- 新增测试共 32 项。将同字节测试放入准确父版普通目录，以该目录为实际工作目录运行：15 项正常产品对照通过，17 项入口／旧夹具反例失败；没有把这些红例解释为产品定位缺陷。
- 当前相关九个测试文件共 172 项通过，0 失败、0 跳过。范围包含定义搜索、定义导航、保存查询导航及模型位置校验，不是全仓回归。
- `node node_modules/typescript/bin/tsc --noEmit` 通过。
- `node scripts/build.mjs` 通过，保留依赖 PURE 注释及大包提示。
- `node node_modules/@playwright/test/cli.js test tests/e2e/definition-navigation.spec.ts --list --reporter=json` 通过，只有默认关闭占位；另有内存注册测试核对八项正式场景和所属资源保留选项。

本机证据位于任务克隆的 `.cache/definition-search/`。前期 `react-initial.json`、`parent-root-option-invalid.json` 与 `parent-incomplete-port-invalid.json` 是测试端口调试记录，不计为验收；采用 `parent-red-accepted.json` 和 `regression-accepted-final.json`。

## 正式验证边界

正式入口仍使用 `DBARK_INTEGRATION_ENABLED=1` 与 `DBARK_W03_DEFINITION_NAVIGATION_TEST=1` 双门，沿用已有显式目标、账号和 TLS 参数。列举不需要开启任何开关。只有 Root 核对本轮实际目标和凭据后才可安排执行；本任务不读取或回填 `.env`，没有开启双门。

真实 GUI、数据库、SSH、200、剪贴板、CI、安装及 Docker 操作均为 0。没有改变原对象定义编辑保存流程，没有执行搜索命中的 SQL，没有新增依赖。正式八场景、真实服务器换行和原生 GUI 表现仍待 Root 验收，本次仅交付纯验证与默认关闭的正式准备。
