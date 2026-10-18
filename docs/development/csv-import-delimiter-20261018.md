# F01 CSV 导入分隔符

基于 `3985b421c1ce908013321ed8a822212504d72428`，仅增加 CSV 导入的逗号、分号、Tab 三选一。默认逗号；不识别或猜测文件格式，不支持无表头、任意分隔符或 CSV 导出分隔符配置。

## 使用与合同

在表页打开“导入”，选择 CSV 后设置“CSV 分隔符”和编码，再选择文件。第一条记录必须是非空、不重复的字段名。双引号内的分隔符和换行作为字段内容，`""` 表示字段内的一个双引号。空字符串、`\N`（NULL）、反斜线转义和 `base64:` 二进制沿用已有协议。

`files.preview` 与 `files.import` 增加可选 `csvDelimiter: ',' | ';' | '\t'`，其中 `\t` 在实际 IPC 中是一个制表符。省略字段的旧调用仍使用逗号。严格 IPC 拒绝其它值、未知配置以及 JSON/SQL 的分隔符参数；渲染进程仍只传文件令牌，不接受文件路径。导出合同保持原状。

预览和执行共用 `readRecords`。分隔符加入预览身份及异步表单身份；修改后旧样本和人工映射立即不可用，迟到响应和逗号→分号→逗号的旧响应不能覆盖最新预览。执行入口重新检查就绪身份，并从同一上下文提交分隔符。元数据可以复用，字段映射重新建立。预览仍只读取前 20 行，执行流式读取完整文件。

未更改参数化 INSERT、精度校验、NULL/空串/BLOB 转换、任务取消、每 500 行提交及当前批失败回滚行为；取消和失败不能撤销已提交批次。

## 离线验证与验收边界

新增手工字节样本覆盖三种分隔符、引号内分隔符、转义双引号、跨行、末尾空列、三种编码、重复/空表头、列数错误及不自动猜测。预览结果和完整读取结果分别对照手工期望，未使用产品导出器生成预期。正式引擎入口读取真实测试文件，在数据库驱动边界捕获实际 INSERT SQL 和参数，独立核对大整数、高精度小数、NULL、BLOB 与空串；分号文件第 501 行警告核对先前 500 行提交及当前批回滚。

真实 React 组件在内存 DOM 中核对选择器可见范围、默认值、参数变更失效、映射重置、预览/执行参数一致及执行期间禁用配置。协调器单测另核对迟到响应与参数切回。该验证未打开原生窗口。

必要命令（从任务克隆根目录运行，测试临时目录使用本克隆 `.cache/f01-csv-import/tmp`）：

```powershell
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vitest/vitest.mjs run tests/unit/csv-import-delimiter.test.ts tests/unit/transfer-csv-import-delimiter.test.tsx tests/unit/ui-import-preview.test.ts tests/unit/engine-files.test.ts tests/unit/excel-engine.test.ts tests/unit/lossless-import.test.ts tests/unit/validation.test.ts tests/unit/row-validation.test.ts tests/unit/transfer-csv-export-fields.test.tsx
```

2026-10-18 本轮结果：上述 9 个测试文件共 162 项通过，0 失败、0 跳过；类型检查退出码 0。新增测试的先行运行与本次回归重叠，不另行累加计数。

本轮没有启动 GUI、数据库、Docker、安装程序、本机服务或操作剪贴板，也没有执行全套测试。内存 DOM 不证明原生控件实际操作；驱动模拟不证明数据库端最终存储和跨版本行为。后续真实验收需在核对连接位置后，使用隔离库分别选择三类文件，在原生导入窗口修改分隔符、重新确认映射并导入；独立查询大整数、小数、NULL/空串和二进制字节，核对取消/失败后已提交批次。真实验收本轮未执行。
