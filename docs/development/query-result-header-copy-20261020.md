# 查询结果复制（含列名）

用户已明确暂缓发行、以开发为主。本功能从已封存的 `c2b8be6`、`ff1a115` 提取复制入口及同格重选修复，单独接入 `codex/query-header-copy-20261020`，基线为 `69fdc77`。使用独立普通克隆，不修改 0.28 冻结候选、旧员工副本或失败现场，也不接入封存的排序、筛选和片段传输改动。

## 使用方式与范围

查询结果区域新增“复制（含列名）”：

- 勾选记录时，复制所选行与全部可见列，保持当前显示的行列顺序。
- 没有勾选时，点击单元格后复制该值及其列名；没有有效选择时禁用，不回退复制全部结果。
- 普通复制快捷键继续只复制数据。任意查询结果仍然只读。

重复或空别名只用作表头，实际取值使用内部唯一列键和原行位置。隐藏列不读取。表头与值复用现有 TSV 引号规则及 `application/x-dbark-cells` v1，保留 NULL、空串、BIGINT/DECIMAL 字符串、日期字符串及二进制值的既有表示。表头计入 50,000 单元格和 10,000,000 字符预算。

## 实现边界

`ResultsGrid.tsx` 复用现有 `selectionScope/isCurrent` 和父级选择接纳逻辑。布局、结果、连接版本、任务、标签、模态和卸载变化撤销旧动作；布局或字节查看器关闭后，同坐标显式点击可重新取得当前选择。复制不改写结果、选择、详情、SQL 或会话。

`queryResultHeaderCopy.ts` 在按钮的同步调用内用 `document.execCommand('copy')` 触发临时捕获事件，写入原文本及类型化格式后立即解绑。未触发事件、拒绝命令或上下文失效均报中文错误；无异步重试、主进程复制命令或全结果回退。部分格式写入后失败时无法承诺恢复原系统剪贴板。

## 本轮验证（Windows，2026-10-20）

独立安装冻结依赖，未使用整目录 `node_modules` 链接。实际命令：

```powershell
node scripts/check-local.mjs --build tests/unit/query-result-header-copy.test.ts tests/unit/query-result-header-copy-ui.test.tsx tests/unit/result-selected-grid.test.tsx tests/unit/query-result-columns-ui.test.tsx tests/unit/query-result-columns.test.ts tests/unit/query-result-columns-revocation.test.ts tests/unit/query-row-details-ui.test.tsx tests/unit/query-result-find-ui.test.tsx tests/unit/query-result-find.test.ts tests/unit/ui-clipboard.test.ts
```

类型检查通过；10 文件、101 项全部通过，无跳过；普通构建通过。本地入口总耗时 72.89 秒，其中类型检查 38.27 秒、定向测试 4.11 秒、构建 30.51 秒。包括 9 项编码/同步事件测试和 13 项真实 React 入口测试，覆盖特殊列名、数值精度、可见列、所选矩阵、预算、旧动作失效以及同坐标重新选择。构建保留依赖注释和大包体积警告，不影响本次退出码 0。

React 测试的数据库、虚拟网格渲染、文档事件和布局仍为内存端口；同坐标两例执行实际安装 RDG 的位置及鼠标处理函数。这些结果不证明真实系统剪贴板、原生窗口、实库、安装包或 macOS 通过。本轮不操作系统剪贴板、不启动旧验收窗口、不发布。
