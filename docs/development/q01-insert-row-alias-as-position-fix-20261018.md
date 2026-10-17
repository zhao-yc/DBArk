# UPSERT 新行别名 AS 声明位置修复

固定父提交：`621f6d3c55a1d9ca00238b220948b9991359d948`。独立审查报告 SHA256：`013ad726bbee88e8ea1db4a5b27c6e06bdc4108e533d6ff4a513739433954f5e`。

## 问题和修复

原实现收集 INSERT 主体之后所有 `AS 名称`，尚未确认声明位置就保留局部名。SELECT 投影别名和 CAST 类型因此会遮蔽合法 schema 函数；CAST 类型与真实新行别名同名时还会被误判为重复声明。

修复先按词法深度跳过完整 VALUES 元组序列，只将尾部紧邻的 `AS 名称` 视为声明。CAST 等元组内部表达式不会进入候选集合。INSERT SELECT 交回原语义路径，不将 SELECT 投影别名当新行别名。SET 仍不开放新行能力，仅识别同层声明后阻止误回退。目标表 AST 核验、整句语法验证、版本/Worker 能力门、元数据接口和取消机制保持原实现。

原作者测试中一个将 SELECT 投影别名强制断言为 `blocked` 的输入已移出停止列表；该前提正是本次缺陷，改用新增测试检查合法函数目录读取。独立反例文件未修改。独审 I3 原组合测试也包含此旧前提，本轮按要求未重跑该组合、未改其字节；重新独审时应单独区分投影别名和真实新行声明。

## 原字节复现与窄验

在新普通 clone 的 ignored `.cache/as-location-fix-replay` 内复制独立测试原字节，并展开其固定候选及基线源码包。先在未修改的候选上仅运行 I7/M1/M2，结果 **3 失败、6 未选中**。然后只将修复后的辅助源码复制到该候选镜像，同一测试原字节、同一基线、同一命令得到 **3 通过、6 未选中**。原审查目录及本轮 before 文件保留不覆盖。

```powershell
# 工作目录：本任务 clone/.cache/as-location-fix-replay
node D:/svn/DBArk/node_modules/vitest/vitest.mjs run --config vitest-counterexamples.config.ts -t 'I7|M1|M2' --reporter=json --reporter=verbose --outputFile=before-results.json
node D:/svn/DBArk/node_modules/vitest/vitest.mjs run --config vitest-counterexamples.config.ts -t 'I7|M1|M2' --reporter=json --reporter=verbose --outputFile=after-results.json
# 工作目录：本任务 clone
node D:/svn/DBArk/node_modules/vitest/vitest.mjs run tests/unit/completion-insert-row-alias-as-position.test.ts --reporter=json --outputFile=.cache/as-location-fix-replay/controls-results.json
node D:/svn/DBArk/node_modules/typescript/bin/tsc --noEmit
```

新增必要对照 **11 项通过**：实际分析器和建议器验证 SELECT/CAST 不抢占 schema 函数目录，多行 VALUES 中 CAST 和更新右侧 CAST 不干扰同名真实行别名；列别名列表、SET 声明、嵌套 SELECT、未闭合表头和 VALUES 内越界引用仍不读取目录。类型检查退出码 0。

本轮未重跑作者 253 项或旧套件，未运行 full/build/数据库/GUI/剪贴板。交付的是窄修及 RAM 证据；Root 独审、真实补全和整合仍待完成。报告、日志、逐文件 SHA256 和固定源码对应关系存于本任务 ignored `.cache/as-location-fix-replay/handoff.json`。
