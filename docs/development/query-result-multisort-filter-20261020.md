# 多列排序与结果筛选整合

开发基线 `39d3ed2`，分支 `codex/query-result-multisort-filter-20261020`，独立普通克隆。提取固定 `3adc89c` 的多列排序、`f37a7c3` 的条件筛选及 `576f0fc` 的复制组合测试，保留已完成的含列名复制和同格重选修复。旧副本和 0.28 候选不修改，暂不发布。

## 实际入口与行为

- 查询完成后，在列头按 Ctrl／Cmd 追加排序列；优先级列表可调整顺序、方向或移除规则，最终并列保持原返回次序。
- 点击“筛选已返回结果”，按字段类型添加条件，选择 AND／OR 后显式应用；取消丢弃草稿。支持文本包含、精确比较及 NULL／非 NULL。
- 先筛选，再排序。应用或清除筛选重置排序和旧选择；无匹配时保留空网格、空导出，禁用含列名复制。
- 复制、查找、详情与导出均使用当前可见行列。原结果、SQL、会话和固定快照不改写，不执行额外 SQL，不读取未返回行。

## 本地验证（Windows，2026-10-20）

本克隆独立安装冻结依赖，没有整目录 `node_modules` 链接。实际执行：

```powershell
node scripts/check-local.mjs --build tests/unit/query-result-multisort.test.ts tests/unit/query-result-filter.test.ts tests/unit/query-result-sort.test.ts tests/unit/query-result-sort-ui.test.tsx tests/unit/query-result-header-copy.test.ts tests/unit/query-result-header-copy-ui.test.tsx tests/unit/result-selected-query-port.test.ts tests/unit/ui-explain-plan-state.test.tsx tests/unit/result-selected-grid.test.tsx tests/unit/query-result-columns-ui.test.tsx tests/unit/query-result-columns.test.ts tests/unit/query-result-columns-revocation.test.ts tests/unit/query-row-details-ui.test.tsx tests/unit/query-result-find-ui.test.tsx tests/unit/query-result-find.test.ts tests/unit/ui-clipboard.test.ts
```

类型检查、16 文件 267 项定向测试全部通过，无跳过，普通构建通过。总耗时 82.34 秒：类型检查 41.76 秒、测试 6.36 秒、构建 34.22 秒。依赖注释和包体积警告保留，退出码 0。

测试包含多列规则 19 项、筛选规则 35 项、真实 QueryTab 排序/筛选入口 55 项、含列名复制入口 18 项及相关回归。新增组合反例验证可见列重排、筛选后精确次级排序、清除筛选、空结果和被排除行漂移后旧复制失效。数据库、文档复制事件和虚拟布局端口仍为内存；RDG 的实际列头处理函数不等于系统键盘验收。

完整回归首次为 567 文件通过、3 文件失败，10843 项通过、24 项失败、1 项条件跳过，原报告保留在本克隆 `.cache/multisort-filter-unit.json`，SHA256 为 `7cf51d89e18ed335658e453cb24dcaeb8f3ad5706147d15b9462d494954434b2`。其中两组旧 AST 测试缺少新增的 `filterLeaseRef/setFilterLease` 初始端口，已仅补依赖、保留原断言；另一个补全 Worker 测试在默认并发下超过原超时。补齐端口后，三文件 72 项定向复查通过，Worker 本体 2499ms。完整复查采用 `--maxWorkers=4`，不修改测试内容或超时，不覆盖首次失败报告。

再次类型检查通过。以下完整复查实际为 **570 文件全部通过、10867 项通过、0 失败、1 条件跳过**，用时 120.74 秒。唯一跳过为 POSIX 严格 umask 的 0664 文件权限检查，当前 Windows 不具备该平台条件。报告 `.cache/multisort-filter-unit-verified.json` 的 SHA256 为 `e91bc8ec703fee49ff07138504749ff6ef3969d53a5c1588e5c793c4e1d4b799`：

```powershell
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vitest/vitest.mjs run --maxWorkers=4 --reporter=json --outputFile=.cache/multisort-filter-unit-verified.json
```

最终筛选面板边框改用项目已有 `--line` 主题变量；随后执行 `node scripts/build.mjs`，普通构建退出 0，Vite 用时 29.68 秒，保留既有依赖注释及包体积警告。该样式修正不改变上述排序、筛选和投递逻辑，未重复完整回归或放宽原生门。

## 手工检查步骤（本轮尚未执行）

运行本克隆 `pnpm dev`，连接授权测试库后执行包含重复分组、BIGINT 和 DECIMAL 的只读查询：

1. 单击分组列升序，按 Ctrl／Cmd 单击数值列，调整优先级及方向，检查精确数值顺序。
2. 打开筛选，组合分组相等与数值比较，先取消再应用，核对草稿、匹配数及排序重置。
3. 勾选过滤后的行，检查复制和 CSV／JSON 导出范围；增加不可能匹配的条件后应为空。
4. 清除筛选，确认原顺序恢复且旧选择失效；切换结果、标签或打开模态后旧动作应拒绝。

系统剪贴板、原生窗口、实库、安装包、macOS 和真实性能尚未验证。本轮本地证据不替代这些层次，功能清单的公开交付计数保持。
