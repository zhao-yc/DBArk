# 前缀核心入口：模式与满列目录期待的独立test-only增量

基底为Root明确指定的 `afecff5406d2c24e6786a48ed1e221fbbae709be`。先加入已知依赖，再仅提交本增量：

| 顺序 | 原提交 | 本分支cherry-pick |
| --- | --- | --- |
| 核心入口依赖 | `3fc01420230c9172cf9a4ed8ccaabbae2eb4d252` | `fd6b0315108c0f159f6479e32df0641d4e5a7fe3` |
| 产品规范化依赖 | `dade28c56dd53e608391c424d89d23310ccc1425` | `5ff8a6092ced1a873a3654d0226a5e99efa3d0ad` |

任务分支为 `codex/employee1-index-prefix-core-normalized-20261017`。Root整合时先具备上述两项依赖，再应用独立test-only增量，不将依赖误记为本次新增产品修改。`3fc0142`原件和旧说明保留，原30秒owner、native观察、1062/close隔离、停链和精确清理链不改。

## 两条更新

1. 专用测试模式门只为Maria追加既有受证的 `IGNORE_SPACE`。公共白名单保持，未知词、ANSI、NO_FIELD_OPTIONS/NO_KEY_OPTIONS/NO_TABLE_OPTIONS、空项和非字符串仍拒绝，不SET会话或全局模式，也不扩大MySQL的IGNORE_SPACE合同。
2. MAX case请求继续为三个CHAR(255)的prefix255，加BINARY前缀12/13，保持3072可用、3073发送前拒绝；不改为254。3072预览必须由已知产品修复生成无长度c/d/e、b(12)的准确SQL。独立SHOW INDEX目录的c/d/e必须为实际SQL NULL对应的JS null；b允许实际驱动数值12或整数文本12。四条记录的自有身份、顺序及Sub_part数据字段均检查，缺字段、继承值、getter、undefined、文字null/NULL、255/254均不能冒充SQL NULL。

没有修改src、verifier、metadata、合同、UI、入口收集结构或三个正式case标题。live直接调用新的专用纯断言，不放宽definitionVerified=true，也不把缺失目录字段用默认null补齐。

## 原红与必要验证

修改前，从依赖版本的真实live读取原模式判定和原MAX目录判定片段，只给RAM输入和assert端口执行：Maria已知IGNORE_SPACE被旧门拒绝，正确NULL/NULL/NULL/12被旧255期待拒绝，两条均按预期为红。原片段、源SHA及结果保留在ignored `.cache/index-prefix-core-normalized-evidence-20261017/parent-predicates.json`，没有导入live、Engine、driver或读取认证。此前047和满列产品修复的父红也未修改。

必要纯测试仅运行两个核心准备文件：32项核心断言和16项入口门控，共48项通过、0跳过。新增覆盖Maria两端口普通模式并存、未知/省略定义模式拒绝、规范SQL、严格SQL NULL、b12、字段缺失/继承/getter及身份顺序；已有30秒/native/close反例继续通过。

```powershell
node D:/svn/DBArk/node_modules/vitest/vitest.mjs run tests/unit/index-fixed-prefix-core.test.ts tests/unit/index-fixed-prefix-list-guard.test.ts
node D:/svn/DBArk/node_modules/vitest/vitest.mjs list --config vitest.integration.config.ts tests/integration/engine-index-fixed-prefix.integration.test.ts --json
node D:/svn/DBArk/node_modules/typescript/bin/tsc --noEmit
```

真正Vitest list在双门开/关均仅收集3个唯一身份，不进入case体。类型检查通过。未重跑产品115项、未运行build或实际集成case。

本轮实际DB、GUI、SSH、CIM、private材料读取、clipboard、CI、安装、Docker和200访问均0；Root旧现场未检查或操作。真实入口保持默认关闭，计数不增加，后续由Root按依赖顺序整合和统一安排真实窗口。
